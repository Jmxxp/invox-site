import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const UPLOAD_LIMIT = 1.5 * 1024 * 1024 * 1024;
const DEFAULT_UPLOAD_LIMIT = 50 * 1024 * 1024;
const PART_LIMIT = 20 * 1024 * 1024;
const PART_BUCKET = 'invox-installer-parts';
const DEFAULT_STORAGE_BUDGET = 1000000000;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BODY = 32 * 1024;
const BUCKET = 'invox-installers';
const PLATFORMS = ['windows', 'macos', 'android'];
const EXTENSIONS = { windows: ['exe', 'msi', 'zip'], macos: ['dmg', 'pkg', 'zip'], android: ['apk'] };
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOWNLOAD_TOKEN = /^[a-f0-9]{64}$/;
const SETTINGS_COLUMNS = 'visibility,download_password_hash,download_access_generation,version,release_notes,updated_at';
const INSTALLER_COLUMNS = 'platform,path,file_name,size,version,updated_at,multipart_upload_id,sha256';
const ADMIN_COLUMNS = 'email,username,user_id,enabled';
const FEEDBACK_COLUMNS = 'id,name,contact,message,status,note,created_at,updated_at';

const SAFE_FAULTS = new WeakSet();
function fault(code, message, status = 400) {
  const error = Object.assign(new Error(message), { code, status });
  SAFE_FAULTS.add(error);
  return error;
}
function unavailable() { return fault('offline', 'Serviço temporariamente indisponível. Tente novamente.', 503); }
function invalidInput() { return fault('invalid_input', 'Confira os dados informados e tente novamente.'); }
function resultData(result) { if (result.error || result.data == null) throw unavailable(); return result.data; }
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw unavailable();
  try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0)); }
  catch { throw unavailable(); }
}
async function sha256(value, cryptography) {
  const bytes = new Uint8Array(await cryptography.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function passwordHash(password, cryptography = globalThis.crypto) {
  const salt = cryptography.getRandomValues(new Uint8Array(16));
  const key = await cryptography.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = new Uint8Array(await cryptography.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 210000, salt }, key, 256));
  return `pbkdf2-sha256$210000$${base64url(salt)}$${base64url(hash)}`;
}
export async function passwordMatches(password, stored, cryptography = globalThis.crypto) {
  if (typeof stored !== 'string' || stored.length > 256) throw unavailable();
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '210000') throw unavailable();
  const salt = unbase64url(parts[2]), expected = unbase64url(parts[3]);
  if (salt.length !== 16 || expected.length !== 32) throw unavailable();
  const key = await cryptography.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await cryptography.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 210000, salt }, key, 256));
  let different = 0;
  for (let index = 0; index < expected.length; index++) different |= expected[index] ^ actual[index];
  return different === 0;
}

function allowedOrigin(origin) {
  if (!origin || origin === 'https://jmxxp.github.io') return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && ['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.origin === origin;
  } catch { return false; }
}
function responseHeaders(origin) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' });
  if (origin && allowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return headers;
}
export function createUnavailableHandler() {
  return request => {
    const origin = request.headers.get('origin') || '';
    const headers = responseHeaders(origin);
    if (!allowedOrigin(origin)) return new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Origem não permitida.' } }), { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') {
      headers.set('Allow', 'POST, OPTIONS');
      return new Response(JSON.stringify({ error: { code: 'invalid_method', message: 'Método não permitido.' } }), { status: 405, headers });
    }
    return new Response(JSON.stringify({ error: { code: 'offline', message: 'Serviço temporariamente indisponível.' } }), { status: 503, headers });
  };
}
async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw fault('invalid_input', 'Envie uma solicitação JSON.', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw fault('invalid_input', 'Solicitação muito grande.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw invalidInput();
  const chunks = []; let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.byteLength;
    if (length > MAX_BODY) { await reader.cancel(); throw fault('invalid_input', 'Solicitação muito grande.', 413); }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalidInput(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidInput();
  return data;
}

function versionValue(value) {
  if (typeof value !== 'string' || value.length > 64 || !VERSION.test(value.trim())) throw invalidInput();
  return value.trim();
}
function fileManifest(value, requirePath = true, uploadLimitBytes = DEFAULT_UPLOAD_LIMIT) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !PLATFORMS.includes(value.platform)) throw invalidInput();
  const { platform, fileName, size, path } = value;
  if (typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 180 || /[\\/\x00-\x1f\x7f]/.test(fileName) || fileName.trim() !== fileName) throw invalidInput();
  if (!EXTENSIONS[platform].includes(fileName.split('.').pop().toLowerCase()) || !Number.isSafeInteger(size) || size < 1 || size > uploadLimitBytes) throw invalidInput();
  if (requirePath && (typeof path !== 'string' || path.length < 1 || path.length > 512 || /[\\\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..'))) throw invalidInput();
  return requirePath ? { platform, path, fileName, size } : { platform, fileName, size };
}
function settingsOutput(settings, objectUploadLimitBytes = DEFAULT_UPLOAD_LIMIT) { return { visibility: settings.visibility, version: settings.version, releaseNotes: settings.release_notes, hasPassword: Boolean(settings.download_password_hash), uploadLimitBytes: UPLOAD_LIMIT, objectUploadLimitBytes, multipartPartSizeBytes: PART_LIMIT, updatedAt: settings.updated_at }; }
function installerOutput(item) { return { platform: item.platform, path: item.path, fileName: item.file_name, size: Number(item.size), version: item.version, updatedAt: item.updated_at, ...(item.multipart_upload_id ? { kind: 'multipart', uploadId: item.multipart_upload_id, sha256: item.sha256 } : {}) }; }
function feedbackOutput(item) { return { id: item.id, name: item.name, contact: item.contact, message: item.message, status: item.status, note: item.note, receivedAt: item.created_at, updatedAt: item.updated_at }; }

export function createHandler(dependencies) {
  const { service, createAuthClient, rateSecret } = dependencies;
  const cryptography = dependencies.crypto || globalThis.crypto;
  const now = dependencies.now || (() => new Date().toISOString());
  const uuid = dependencies.randomUUID || (() => cryptography.randomUUID());
  // Larger files remain opt-in until the project's Storage plan and limits support them.
  const requestedUploadLimit = dependencies.uploadLimitBytes;
  const uploadLimitBytes = Number.isSafeInteger(requestedUploadLimit) && requestedUploadLimit > 0 && requestedUploadLimit <= DEFAULT_UPLOAD_LIMIT ? requestedUploadLimit : DEFAULT_UPLOAD_LIMIT;
  const storageBudgetBytes = Number.isSafeInteger(dependencies.storageBudgetBytes) && dependencies.storageBudgetBytes > 0 ? dependencies.storageBudgetBytes : DEFAULT_STORAGE_BUDGET;

  async function multipartRpc(name, args, nullable = false) {
    const result = await service.rpc(name, args);
    if (result?.error) {
      if (result.error.message === 'invox_storage_quota_exceeded') throw fault('storage_quota_exceeded', 'Não há espaço disponível para este envio. Libere envios pendentes antes de tentar novamente.', 409);
      if (result.error.message === 'invox_download_ticket_expired') throw fault('download_expired', 'Este download expirou ou o acesso foi alterado. Inicie o download novamente.', 401);
      if (result.error.code === '42501') throw fault('forbidden', 'Este envio não está disponível para sua conta.', 403);
      if (result.error.code === 'P0002') throw fault('unavailable', 'Este instalador não está disponível.', 404);
      if (result.error.code === '22023') throw invalidInput();
      throw unavailable();
    }
    if (!result || (!nullable && result.data == null)) throw unavailable();
    return result.data;
  }
  function opaqueToken() { return Array.from(cryptography.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); }
  function uploadId(value) { if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput(); return value; }
  function partIndex(value) { if (!Number.isInteger(value) || value < 0 || value > 76) throw invalidInput(); return value; }
  async function opportunisticCleanup(admin) {
    // Maintenance is bounded and optional. Quota checks still fail closed if it fails.
    try {
      const rows = await multipartRpc('invox_multipart_cleanup_due', { p_admin_id: admin.user_id, p_limit: 2 });
      if (!Array.isArray(rows) || rows.length > 2) throw unavailable();
      for (const row of rows) {
        const id = uploadId(row.uploadId);
        if (!Array.isArray(row.paths) || row.paths.length > 77 || row.paths.some(path => typeof path !== 'string' || !path.startsWith(`uploads/${id}/`) || !/^uploads\/[a-f0-9-]{36}\/[0-9]{3}-[a-f0-9]{64}\.part$/.test(path))) throw unavailable();
        if (row.paths.length) { const removed = await service.storage.from(PART_BUCKET).remove(row.paths); if (removed.error) throw unavailable(); }
        await multipartRpc('invox_purge_multipart_due', { p_admin_id: admin.user_id, p_upload_id: id }, true);
      }
    } catch { /* Failed maintenance keeps its quota reservation and can be retried. */ }
  }

  async function rateLimit(request, category, seconds, limit) {
    const ip = (request.headers.get('x-forwarded-for') || '').split(',').at(-1).trim() || 'unknown';
    const key = await cryptography.subtle.importKey('raw', new TextEncoder().encode(rateSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = new Uint8Array(await cryptography.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
    const keyHash = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    const result = await service.rpc('invox_take_rate_limit', { p_key_hash: keyHash, p_category: category, p_window_seconds: seconds, p_limit: limit });
    if (result.error || typeof result.data !== 'boolean') throw unavailable();
    if (!result.data) throw Object.assign(fault('rate_limited', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', 429), { retryAfter: seconds });
  }
  async function getSettings() {
    const settings = resultData(await service.from('invox_site_settings').select(SETTINGS_COLUMNS).eq('id', true).single());
    if (!['public', 'private'].includes(settings.visibility) || typeof settings.version !== 'string') throw unavailable();
    return settings;
  }
  async function installers() { return resultData(await service.from('invox_installers').select(INSTALLER_COLUMNS)); }
  async function recordAnalytics(kind, eventId = null, platform = null) {
    const result = await service.rpc('invox_record_analytics', { p_kind: kind, p_event_id: eventId, p_platform: platform });
    if (result.error || typeof result.data !== 'boolean') throw unavailable();
    return result.data;
  }
  async function trackView(request, body) {
    if (typeof body.eventId !== 'string' || !UUID.test(body.eventId)) throw invalidInput();
    await rateLimit(request, 'page_view', 60, 60);
    return { recorded: await recordAnalytics('page_view', body.eventId) };
  }
  async function analytics(body) {
    const period = body.period === undefined ? 'week' : body.period;
    if (!['day', 'week', 'month', 'year'].includes(period)) throw invalidInput();
    return resultData(await service.rpc('invox_analytics_report', { p_period: period }));
  }
  async function resetAnalytics(admin) {
    const data = resultData(await service.rpc('invox_reset_analytics', { p_admin_id: admin.user_id }));
    if (typeof data.startedAt !== 'string' || !Number.isFinite(Date.parse(data.startedAt)) || !Number.isSafeInteger(data.generation) || data.generation < 1) throw unavailable();
    return { startedAt: data.startedAt, generation: data.generation };
  }
  async function lookupAdmin(user) {
    if (!user?.id || typeof user.email !== 'string' || !user.email_confirmed_at) throw fault('unauthorized', 'Entre com uma conta administrativa autorizada.', 401);
    const result = await service.from('invox_admins').select(ADMIN_COLUMNS).eq('user_id', user.id).eq('enabled', true).maybeSingle();
    if (result.error) throw unavailable();
    const admin = result.data;
    if (!admin || !admin.enabled || admin.user_id !== user.id || admin.email !== user.email.trim().toLowerCase()) throw fault('forbidden', 'Sua conta não tem acesso a este painel.', 403);
    return admin;
  }
  async function authenticate(request) {
    const authorization = request.headers.get('authorization') || '';
    const token = /^Bearer ([^\s]{1,16384})$/i.exec(authorization)?.[1];
    if (!token) throw fault('unauthorized', 'Entre no painel para continuar.', 401);
    const result = await service.auth.getUser(token);
    if (result.error || !result.data?.user) throw fault('unauthorized', 'Sua sessão expirou. Entre novamente.', 401);
    return lookupAdmin(result.data.user);
  }
  async function adminState(admin) {
    await opportunisticCleanup(admin);
    const [settings, installerRows, feedbackResult, storage, history] = await Promise.all([
      getSettings(), installers(), service.from('invox_feedbacks').select(FEEDBACK_COLUMNS).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
      multipartRpc('invox_storage_status', { p_budget_bytes: storageBudgetBytes }),
      multipartRpc('invox_installer_history_list', { p_admin_id: admin.user_id, p_limit: 100 })
    ]);
    if (!Array.isArray(history)) throw unavailable();
    return { admin: { username: admin.username, email: admin.email }, settings: settingsOutput(settings, uploadLimitBytes), installers: installerRows.map(installerOutput), feedbacks: resultData(feedbackResult).map(feedbackOutput), storage, history };
  }
  async function login(request, body) {
    await rateLimit(request, 'admin_login', 900, 10);
    const denied = () => fault('unauthorized', 'Usuário ou senha inválidos.', 401);
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 128) throw denied();
    const username = body.username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{1,31}$/.test(username)) throw denied();
    const result = await service.from('invox_admins').select(ADMIN_COLUMNS).eq('username', username).eq('enabled', true).maybeSingle();
    if (result.error) throw unavailable();
    const admin = result.data;
    if (!admin?.enabled || !admin.user_id) throw denied();
    // Um cliente anon separado evita substituir o token privilegiado do cliente de serviço.
    const client = createAuthClient();
    const signIn = await client.auth.signInWithPassword({ email: admin.email, password: body.password });
    const user = signIn.data?.user, session = signIn.data?.session;
    if (signIn.error || !user || !session?.access_token || !session?.refresh_token || !user.email_confirmed_at || user.id !== admin.user_id || user.email?.trim().toLowerCase() !== admin.email) throw denied();
    return { session: { access_token: session.access_token, refresh_token: session.refresh_token } };
  }
  async function publicState() {
    const [settings, rows] = await Promise.all([getSettings(), installers()]);
    return { visibility: settings.visibility, version: settings.version, releaseNotes: settings.release_notes, platforms: PLATFORMS.map(platform => {
      const item = rows.find(row => row.platform === platform);
      return { platform, available: Boolean(item), ...(item ? { fileName: item.file_name, size: Number(item.size), version: item.version } : {}) };
    }) };
  }
  async function download(request, body) {
    if (!PLATFORMS.includes(body.platform)) throw invalidInput();
    if (body.accessToken !== undefined && (typeof body.accessToken !== 'string' || body.accessToken.length > 64)) throw invalidInput();
    const settings = await getSettings();
    let accessSession = null;
    let passwordFingerprint = null;
    if (settings.visibility === 'private') {
      await rateLimit(request, 'private_download', 900, 10);
      if (typeof settings.download_password_hash !== 'string') throw unavailable();
      passwordFingerprint = await sha256(settings.download_password_hash, cryptography);
      if (typeof body.accessToken === 'string' && DOWNLOAD_TOKEN.test(body.accessToken)) {
        const tokenHash = await sha256(body.accessToken, cryptography);
        const result = await service.from('invox_download_sessions').select('password_fingerprint,expires_at').eq('token_hash', tokenHash).maybeSingle();
        if (result.error) throw unavailable();
        const expiry = Date.parse(result.data?.expires_at);
        if (result.data?.password_fingerprint === passwordFingerprint && Number.isFinite(expiry) && expiry > Date.parse(now())) {
          accessSession = { token: body.accessToken, expiresAt: result.data.expires_at };
        }
      }
      if (!accessSession) {
        if (typeof body.password !== 'string' || body.password.length === 0) throw fault('password_required', 'Informe a senha de acesso.', 401);
        if (body.password.length > 128 || !await passwordMatches(body.password, settings.download_password_hash, cryptography)) throw fault('invalid_password', 'Senha de acesso incorreta.', 403);
      }
    }
    const installer = await service.from('invox_installers').select(INSTALLER_COLUMNS).eq('platform', body.platform).maybeSingle();
    if (installer.error) throw unavailable();
    if (!installer.data) throw fault('unavailable', 'Este instalador ainda não está disponível.', 404);
    let multipart = null, data = null;
    if (installer.data.multipart_upload_id) {
      await rateLimit(request, 'multipart_download', 60, 30);
      multipart = await mintMultipartDownload(installer.data.multipart_upload_id, settings);
    } else {
      data = resultData(await service.storage.from(BUCKET).createSignedUrl(installer.data.path, 60, { download: installer.data.file_name }));
      if (!data.signedUrl) throw unavailable();
    }
    if (settings.visibility === 'private' && !accessSession) {
      const token = Array.from(cryptography.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      const expiresAt = resultData(await service.rpc('invox_create_download_session', {
        p_token_hash: await sha256(token, cryptography), p_password_fingerprint: passwordFingerprint
      }));
      if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now())) throw unavailable();
      accessSession = { token, expiresAt };
    }
    if (multipart) return { ...multipart, ...(accessSession ? { accessSession } : {}) };
    if (!await recordAnalytics('download', null, body.platform)) throw unavailable();
    return { url: data.signedUrl, fileName: installer.data.file_name, expiresIn: 60, ...(accessSession ? { accessSession } : {}) };
  }
  async function mintMultipartDownload(id, settings, admin = null) {
    const ticket = opaqueToken();
    const data = await multipartRpc('invox_mint_multipart_download', { p_upload_id: id, p_token_hash: await sha256(ticket, cryptography), p_access_generation: settings.download_access_generation, p_preview: Boolean(admin), p_admin_id: admin?.user_id || null });
    if (data.kind !== 'multipart' || !Array.isArray(data.parts) || data.parts.length < 1 || data.parts.length > 77 || !Number.isSafeInteger(data.size) || data.size > UPLOAD_LIMIT || !SHA256.test(data.sha256) || !Number.isFinite(Date.parse(data.expiresAt))) throw unavailable();
    return { kind: 'multipart', ticket, fileName: data.fileName, size: data.size, sha256: data.sha256, expiresAt: data.expiresAt, parts: data.parts };
  }
  async function downloadPart(request, body) {
    if (typeof body.ticket !== 'string' || !DOWNLOAD_TOKEN.test(body.ticket)) throw invalidInput();
    const index = partIndex(body.index), tokenHash = await sha256(body.ticket, cryptography);
    await rateLimit(request, 'download_part', 60, 360);
    const part = await multipartRpc('invox_download_multipart_part', { p_token_hash: tokenHash, p_index: index });
    if (typeof part.uploadId !== 'string' || !UUID.test(part.uploadId) || part.path !== `uploads/${part.uploadId}/${String(index).padStart(3, '0')}-${part.sha256}.part` || part.index !== index || !Number.isSafeInteger(part.size) || part.size < 1 || part.size > PART_LIMIT || !SHA256.test(part.sha256)) throw unavailable();
    const data = resultData(await service.storage.from(PART_BUCKET).createSignedUrl(part.path, 60));
    if (typeof data.signedUrl !== 'string' || !data.signedUrl) throw unavailable();
    if (!await multipartRpc('invox_count_multipart_download', { p_token_hash: tokenHash })) throw unavailable();
    return { url: data.signedUrl, expiresIn: 60, index, size: part.size, sha256: part.sha256 };
  }
  async function logoutDownload(request, body) {
    if (body.accessToken === undefined || body.accessToken === '') return { cleared: true };
    if (typeof body.accessToken !== 'string' || body.accessToken.length > 64) throw invalidInput();
    if (!DOWNLOAD_TOKEN.test(body.accessToken)) return { cleared: true };
    await rateLimit(request, 'download_logout', 60, 60);
    const result = await service.from('invox_download_sessions').delete().eq('token_hash', await sha256(body.accessToken, cryptography));
    if (result.error) throw unavailable();
    return { cleared: true };
  }
  async function feedback(request, body) {
    await rateLimit(request, 'feedback', 3600, 5);
    if (typeof body.name !== 'string' || typeof body.contact !== 'string' || typeof body.message !== 'string' || (body.website !== undefined && (typeof body.website !== 'string' || body.website !== ''))) throw invalidInput();
    const name = body.name.trim(), contact = body.contact.trim(), message = body.message.trim();
    if (name.length < 2 || name.length > 80 || contact.length < 3 || contact.length > 200 || message.length < 10 || message.length > 2000) throw invalidInput();
    const data = resultData(await service.from('invox_feedbacks').insert({ name, contact, message }).select('id').single());
    return { id: data.id };
  }
  async function saveAccess(body) {
    if (!['public', 'private'].includes(body.visibility) || (body.password !== undefined && typeof body.password !== 'string')) throw invalidInput();
    const current = await getSettings();
    const password = body.password || '';
    let hash = current.download_password_hash;
    if (body.visibility === 'public') hash = null;
    else if (password) {
      if (password.length < 8 || password.length > 128 || !password.trim()) throw fault('invalid_input', 'Use uma senha de acesso com 8 a 128 caracteres.');
      hash = await passwordHash(password, cryptography);
    } else if (!hash) throw fault('invalid_input', 'Defina uma senha para ativar o acesso privado.');
    const result = await service.from('invox_site_settings').update({ visibility: body.visibility, download_password_hash: hash, updated_at: now() }).eq('id', true).select(SETTINGS_COLUMNS).single();
    return settingsOutput(resultData(result), uploadLimitBytes);
  }
  async function updateFeedback(body) {
    if (typeof body.id !== 'string' || !UUID.test(body.id) || !['new', 'answered'].includes(body.status) || typeof body.note !== 'string' || body.note.length > 5000) throw invalidInput();
    const result = await service.from('invox_feedbacks').update({ status: body.status, note: body.note, updated_at: now() }).eq('id', body.id).select(FEEDBACK_COLUMNS).maybeSingle();
    if (result.error) throw unavailable();
    if (!result.data) throw fault('not_found', 'Este feedback não foi encontrado.', 404);
    return feedbackOutput(result.data);
  }
  async function createMultipartUpload(body, admin) {
    await opportunisticCleanup(admin);
    const file = fileManifest(body, false, UPLOAD_LIMIT), version = versionValue(body.version);
    if (typeof body.sha256 !== 'string' || !SHA256.test(body.sha256) || !Array.isArray(body.parts) || body.parts.length !== Math.ceil(file.size / PART_LIMIT)) throw invalidInput();
    const parts = body.parts.map((part, index) => {
      const size = Math.min(PART_LIMIT, file.size - index * PART_LIMIT);
      if (!part || part.index !== index || part.size !== size || typeof part.sha256 !== 'string' || !SHA256.test(part.sha256)) throw invalidInput();
      return { index, size, sha256: part.sha256 };
    });
    return multipartRpc('invox_create_multipart_upload', { p_admin_id: admin.user_id, p_platform: file.platform, p_file_name: file.fileName, p_size: file.size, p_version: version,
      p_sha256: body.sha256, p_manifest_sha256: await sha256(JSON.stringify(parts), cryptography), p_parts: parts, p_budget_bytes: storageBudgetBytes });
  }
  async function multipartPart(admin, id, index) {
    const part = await multipartRpc('invox_multipart_part', { p_admin_id: admin.user_id, p_upload_id: id, p_index: index });
    const expectedPath = `uploads/${id}/${String(index).padStart(3, '0')}-${part.sha256}.part`;
    if (part.path !== expectedPath || !SHA256.test(part.sha256) || !Number.isSafeInteger(part.size) || part.size < 1 || part.size > PART_LIMIT) throw unavailable();
    return part;
  }
  async function verifyMultipartPart(admin, id, index, part) {
    if (!part.objectId || Number(part.objectSize) !== part.size || typeof part.objectVersion !== 'string') throw fault('integrity_error', 'Uma parte não terminou de ser enviada ou possui tamanho diferente. Envie-a novamente.');
    if (part.verified_at && part.verified_object_id === part.objectId && part.verified_object_version === part.objectVersion && part.verified_sha256 === part.sha256) return true;
    const blob = resultData(await service.storage.from(PART_BUCKET).download(part.path));
    if (blob.size !== part.size || blob.size > PART_LIMIT) throw fault('integrity_error', 'Uma parte possui tamanho diferente. Envie-a novamente.');
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength !== part.size) throw fault('integrity_error', 'Uma parte possui tamanho diferente. Envie-a novamente.');
    const hash = Array.from(new Uint8Array(await cryptography.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== part.sha256) throw fault('integrity_error', 'Uma parte não passou na verificação de integridade. Envie-a novamente.');
    const current = await multipartPart(admin, id, index);
    if (current.objectId !== part.objectId || current.objectVersion !== part.objectVersion || current.objectSize !== part.objectSize) throw fault('upload_changed', 'Esta parte foi alterada durante a verificação. Tente novamente.', 409);
    if (!await multipartRpc('invox_confirm_multipart_part', { p_admin_id: admin.user_id, p_upload_id: id, p_index: index, p_object_id: part.objectId, p_object_version: part.objectVersion, p_sha256: hash })) throw unavailable();
    return true;
  }
  async function multipartPartUpload(body, admin) {
    const id = uploadId(body.uploadId), index = partIndex(body.index), part = await multipartPart(admin, id, index);
    if (part.objectId) {
      try { await verifyMultipartPart(admin, id, index, part); return { completed: true, index }; }
      catch (error) {
        if (!SAFE_FAULTS.has(error) || error.code !== 'integrity_error' || !['uploading', 'ready'].includes(part.uploadStatus)) throw error;
        const removed = await service.storage.from(PART_BUCKET).remove([part.path]); if (removed.error) throw unavailable();
      }
    }
    await multipartRpc('invox_multipart_upload_ticket', { p_admin_id: admin.user_id, p_upload_id: id, p_index: index, p_budget_bytes: storageBudgetBytes }, true);
    const data = resultData(await service.storage.from(PART_BUCKET).createSignedUploadUrl(part.path, { upsert: false }));
    if (typeof data.token !== 'string' || !data.token || typeof data.signedUrl !== 'string' || !data.signedUrl) throw unavailable();
    return { completed: false, path: part.path, token: data.token, signedUrl: data.signedUrl, bucket: PART_BUCKET };
  }
  async function confirmMultipartPart(body, admin) {
    const id = uploadId(body.uploadId), index = partIndex(body.index);
    await verifyMultipartPart(admin, id, index, await multipartPart(admin, id, index));
    return { index, verified: true };
  }
  async function cleanupMultipartUpload(body, admin) {
    const id = uploadId(body.uploadId), data = await multipartRpc('invox_cancel_multipart_upload', { p_admin_id: admin.user_id, p_upload_id: id });
    if (!Array.isArray(data.paths) || data.paths.length > 77 || data.paths.some(path => typeof path !== 'string' || !path.startsWith(`uploads/${id}/`) || !/^uploads\/[a-f0-9-]{36}\/[0-9]{3}-[a-f0-9]{64}\.part$/.test(path))) throw unavailable();
    if (data.paths.length) { const removed = await service.storage.from(PART_BUCKET).remove(data.paths); if (removed.error) throw unavailable(); }
    return { ...await multipartRpc('invox_finish_multipart_cleanup', { p_admin_id: admin.user_id, p_upload_id: id }), removedParts: data.paths.length };
  }
  async function createUpload(body, admin) {
    await opportunisticCleanup(admin);
    const file = fileManifest(body, false, uploadLimitBytes), version = versionValue(body.version);
    const extensionIndex = file.fileName.lastIndexOf('.');
    const extension = file.fileName.slice(extensionIndex);
    const baseName = file.fileName.slice(0, extensionIndex).normalize('NFKD').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeName = `${baseName.slice(0, 180 - extension.length) || 'installer'}${extension}`;
    const path = `${file.platform}/${version}/${uuid()}-${safeName}`;
    await multipartRpc('invox_reserve_single_upload', { p_admin_id: admin.user_id, p_path: path, p_platform: file.platform, p_file_name: file.fileName, p_size: file.size, p_version: version, p_budget_bytes: storageBudgetBytes }, true);
    const data = resultData(await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false }));
    if (!data.token || !data.signedUrl) throw unavailable();
    return { path, token: data.token, signedUrl: data.signedUrl };
  }
  async function updateInstallerVersion(body, admin) {
    if (!PLATFORMS.includes(body.platform)) throw invalidInput();
    await multipartRpc('invox_update_installer_version', { p_admin_id: admin.user_id, p_platform: body.platform, p_version: versionValue(body.version) }, true);
    return adminState(admin);
  }
  async function saveRelease(body, admin) {
    const version = versionValue(body.version);
    if (typeof body.releaseNotes !== 'string' || body.releaseNotes.length > 5000 || !Array.isArray(body.files) || body.files.length > 3) throw invalidInput();
    const files = body.files.map(file => {
      const fileVersion = file?.version === undefined ? version : versionValue(file.version);
      if (file?.kind !== 'multipart') return { ...fileManifest(file, true, uploadLimitBytes), version: fileVersion };
      const metadata = fileManifest(file, false, UPLOAD_LIMIT);
      if (!SHA256.test(file.sha256)) throw invalidInput();
      return { kind: 'multipart', uploadId: uploadId(file.uploadId), ...metadata, version: fileVersion, sha256: file.sha256 };
    });
    if (new Set(files.map(file => file.platform)).size !== files.length) throw invalidInput();
    await Promise.all(files.map(async file => {
      if (file.kind === 'multipart') return;
      const pending = await service.from('invox_uploads').select('path,platform,file_name,size,version,created_by').eq('path', file.path).maybeSingle();
      if (pending.error) throw unavailable();
      const row = pending.data;
      if (!row || row.created_by !== admin.user_id || row.platform !== file.platform || row.file_name !== file.fileName || Number(row.size) !== file.size) throw fault('invalid_input', 'Um instalador não corresponde ao envio autorizado. Envie o arquivo novamente.');
      const stored = await service.storage.from(BUCKET).info(file.path);
      if (stored.error || !stored.data || Number(stored.data.size) !== file.size) throw fault('invalid_input', 'Um instalador não terminou de ser enviado ou possui tamanho diferente. Envie o arquivo novamente.');
    }));
    await multipartRpc('invox_publish_release', { p_version: version, p_release_notes: body.releaseNotes.trim(), p_files: files, p_admin_id: admin.user_id }, true);
    return adminState(admin);
  }

  return async function handleRequest(request) {
    const origin = request.headers.get('origin') || '';
    const headers = responseHeaders(origin);
    function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers }); }
    try {
      if (!allowedOrigin(origin)) throw fault('forbidden', 'Origem não permitida.', 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') { headers.set('Allow', 'POST, OPTIONS'); throw fault('invalid_method', 'Método não permitido.', 405); }
      const body = await readBody(request);
      switch (body.action) {
        case 'state': return json(await publicState());
        case 'track-view': return json(await trackView(request, body));
        case 'login': return json(await login(request, body));
        case 'download': return json(await download(request, body));
        case 'download-part': return json(await downloadPart(request, body));
        case 'logout-download': return json(await logoutDownload(request, body));
        case 'feedback': return json(await feedback(request, body), 201);
      }
      if (!['admin-state', 'analytics', 'reset-analytics', 'save-access', 'update-feedback', 'create-upload', 'save-release', 'update-installer-version', 'create-multipart-upload', 'multipart-part-upload', 'confirm-multipart-part', 'finish-multipart-upload', 'preview-multipart-upload', 'cleanup-multipart-upload'].includes(body.action)) throw invalidInput();
      const admin = await authenticate(request);
      switch (body.action) {
        case 'admin-state': return json(await adminState(admin));
        case 'analytics': return json(await analytics(body));
        case 'reset-analytics': return json(await resetAnalytics(admin));
        case 'save-access': return json(await saveAccess(body));
        case 'update-feedback': return json(await updateFeedback(body));
        case 'create-upload': return json(await createUpload(body, admin));
        case 'create-multipart-upload': return json(await createMultipartUpload(body, admin));
        case 'multipart-part-upload': return json(await multipartPartUpload(body, admin));
        case 'confirm-multipart-part': return json(await confirmMultipartPart(body, admin));
        case 'finish-multipart-upload': return json(await multipartRpc('invox_finish_multipart_upload', { p_admin_id: admin.user_id, p_upload_id: uploadId(body.uploadId) }));
        case 'preview-multipart-upload': return json(await mintMultipartDownload(uploadId(body.uploadId), await getSettings(), admin));
        case 'cleanup-multipart-upload': return json(await cleanupMultipartUpload(body, admin));
        case 'save-release': return json(await saveRelease(body, admin));
        case 'update-installer-version': return json(await updateInstallerVersion(body, admin));
      }
      throw invalidInput();
    } catch (error) {
      // Nunca devolve erros de SQL, credenciais, tokens ou hashes ao navegador.
      const known = SAFE_FAULTS.has(error);
      if (known && error.retryAfter) headers.set('Retry-After', String(error.retryAfter));
      return json({ error: { code: known ? error.code : 'offline', message: known ? error.message : 'Serviço temporariamente indisponível. Tente novamente.' } }, known ? error.status : 503);
    }
  };
}

if (typeof Deno !== 'undefined') {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const uploadLimitBytes = Number(Deno.env.get('INVOX_UPLOAD_LIMIT_BYTES') || DEFAULT_UPLOAD_LIMIT);
  const storageBudgetBytes = Number(Deno.env.get('INVOX_STORAGE_BUDGET_BYTES') || DEFAULT_STORAGE_BUDGET);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  if (!url || !serviceKey || !anonKey) {
    Deno.serve(createUnavailableHandler());
  } else {
    const service = createClient(url, serviceKey, options);
    Deno.serve(createHandler({ service, rateSecret: serviceKey, uploadLimitBytes, storageBudgetBytes, createAuthClient: () => createClient(url, anonKey, options) }));
  }
}
