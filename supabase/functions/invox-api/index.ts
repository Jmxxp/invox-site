import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const UPLOAD_LIMIT = 50 * 1024 * 1024;
const MAX_BODY = 32 * 1024;
const BUCKET = 'invox-installers';
const PLATFORMS = ['windows', 'macos', 'android'];
const EXTENSIONS = { windows: ['exe', 'msi', 'zip'], macos: ['dmg', 'pkg', 'zip'], android: ['apk'] };
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTINGS_COLUMNS = 'visibility,download_password_hash,version,release_notes,updated_at';
const INSTALLER_COLUMNS = 'platform,path,file_name,size,version,updated_at';
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
function fileManifest(value, requirePath = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !PLATFORMS.includes(value.platform)) throw invalidInput();
  const { platform, fileName, size, path } = value;
  if (typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 180 || /[\\/\x00-\x1f\x7f]/.test(fileName) || fileName.trim() !== fileName) throw invalidInput();
  if (!EXTENSIONS[platform].includes(fileName.split('.').pop().toLowerCase()) || !Number.isSafeInteger(size) || size < 1 || size > UPLOAD_LIMIT) throw invalidInput();
  if (requirePath && (typeof path !== 'string' || path.length < 1 || path.length > 512 || /[\\\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..'))) throw invalidInput();
  return requirePath ? { platform, path, fileName, size } : { platform, fileName, size };
}
function settingsOutput(settings) { return { visibility: settings.visibility, version: settings.version, releaseNotes: settings.release_notes, hasPassword: Boolean(settings.download_password_hash), uploadLimitBytes: UPLOAD_LIMIT, updatedAt: settings.updated_at }; }
function installerOutput(item) { return { platform: item.platform, path: item.path, fileName: item.file_name, size: Number(item.size), version: item.version, updatedAt: item.updated_at }; }
function feedbackOutput(item) { return { id: item.id, name: item.name, contact: item.contact, message: item.message, status: item.status, note: item.note, receivedAt: item.created_at, updatedAt: item.updated_at }; }

export function createHandler(dependencies) {
  const { service, createAuthClient, rateSecret } = dependencies;
  const cryptography = dependencies.crypto || globalThis.crypto;
  const now = dependencies.now || (() => new Date().toISOString());
  const uuid = dependencies.randomUUID || (() => cryptography.randomUUID());

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
    const [settings, installerRows, feedbackResult] = await Promise.all([
      getSettings(), installers(), service.from('invox_feedbacks').select(FEEDBACK_COLUMNS).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200)
    ]);
    return { admin: { username: admin.username, email: admin.email }, settings: settingsOutput(settings), installers: installerRows.map(installerOutput), feedbacks: resultData(feedbackResult).map(feedbackOutput) };
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
    const settings = await getSettings();
    if (settings.visibility === 'private') {
      await rateLimit(request, 'private_download', 900, 10);
      if (typeof body.password !== 'string' || body.password.length === 0) throw fault('password_required', 'Informe a senha de acesso.', 401);
      if (body.password.length > 128 || !await passwordMatches(body.password, settings.download_password_hash, cryptography)) throw fault('invalid_password', 'Senha de acesso incorreta.', 403);
    }
    const installer = await service.from('invox_installers').select(INSTALLER_COLUMNS).eq('platform', body.platform).maybeSingle();
    if (installer.error) throw unavailable();
    if (!installer.data) throw fault('unavailable', 'Este instalador ainda não está disponível.', 404);
    const data = resultData(await service.storage.from(BUCKET).createSignedUrl(installer.data.path, 60, { download: installer.data.file_name }));
    if (!data.signedUrl) throw unavailable();
    return { url: data.signedUrl, fileName: installer.data.file_name, expiresIn: 60 };
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
    return settingsOutput(resultData(result));
  }
  async function updateFeedback(body) {
    if (typeof body.id !== 'string' || !UUID.test(body.id) || !['new', 'answered'].includes(body.status) || typeof body.note !== 'string' || body.note.length > 5000) throw invalidInput();
    const result = await service.from('invox_feedbacks').update({ status: body.status, note: body.note, updated_at: now() }).eq('id', body.id).select(FEEDBACK_COLUMNS).maybeSingle();
    if (result.error) throw unavailable();
    if (!result.data) throw fault('not_found', 'Este feedback não foi encontrado.', 404);
    return feedbackOutput(result.data);
  }
  async function createUpload(body, admin) {
    const file = fileManifest(body, false), version = versionValue(body.version);
    const extensionIndex = file.fileName.lastIndexOf('.');
    const extension = file.fileName.slice(extensionIndex);
    const baseName = file.fileName.slice(0, extensionIndex).normalize('NFKD').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeName = `${baseName.slice(0, 180 - extension.length) || 'installer'}${extension}`;
    const path = `${file.platform}/${version}/${uuid()}-${safeName}`;
    const created = await service.from('invox_uploads').insert({ path, platform: file.platform, file_name: file.fileName, size: file.size, version, created_by: admin.user_id });
    if (created.error) throw unavailable();
    const data = resultData(await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false }));
    if (!data.token || !data.signedUrl) throw unavailable();
    return { path, token: data.token, signedUrl: data.signedUrl };
  }
  async function saveRelease(body, admin) {
    const version = versionValue(body.version);
    if (typeof body.releaseNotes !== 'string' || body.releaseNotes.length > 5000 || !Array.isArray(body.files) || body.files.length > 3) throw invalidInput();
    const files = body.files.map(file => fileManifest(file));
    if (new Set(files.map(file => file.platform)).size !== files.length) throw invalidInput();
    await Promise.all(files.map(async file => {
      const pending = await service.from('invox_uploads').select('path,platform,file_name,size,version,created_by').eq('path', file.path).maybeSingle();
      if (pending.error) throw unavailable();
      const row = pending.data;
      if (!row || row.created_by !== admin.user_id || row.platform !== file.platform || row.file_name !== file.fileName || Number(row.size) !== file.size || row.version !== version) throw fault('invalid_input', 'Um instalador não corresponde ao envio autorizado. Envie o arquivo novamente.');
      const stored = await service.storage.from(BUCKET).info(file.path);
      if (stored.error || !stored.data || Number(stored.data.size) !== file.size) throw fault('invalid_input', 'Um instalador não terminou de ser enviado ou possui tamanho diferente. Envie o arquivo novamente.');
    }));
    const published = await service.rpc('invox_publish_release', { p_version: version, p_release_notes: body.releaseNotes.trim(), p_files: files, p_admin_id: admin.user_id });
    if (published.error) throw unavailable();
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
        case 'login': return json(await login(request, body));
        case 'download': return json(await download(request, body));
        case 'feedback': return json(await feedback(request, body), 201);
      }
      if (!['admin-state', 'save-access', 'update-feedback', 'create-upload', 'save-release'].includes(body.action)) throw invalidInput();
      const admin = await authenticate(request);
      switch (body.action) {
        case 'admin-state': return json(await adminState(admin));
        case 'save-access': return json(await saveAccess(body));
        case 'update-feedback': return json(await updateFeedback(body));
        case 'create-upload': return json(await createUpload(body, admin));
        case 'save-release': return json(await saveRelease(body, admin));
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
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  if (!url || !serviceKey || !anonKey) {
    Deno.serve(() => new Response(JSON.stringify({ error: { code: 'offline', message: 'Serviço temporariamente indisponível.' } }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
  } else {
    const service = createClient(url, serviceKey, options);
    Deno.serve(createHandler({ service, rateSecret: serviceKey, createAuthClient: () => createClient(url, anonKey, options) }));
  }
}
