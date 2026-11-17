(() => {
  'use strict';
  const url = 'https://wsfdwyghqqaerivyrbil.supabase.co';
  const key = 'sb_publishable_JRJh2_czP8LlDXwd6E2vZg_qImQ5Gil';
  const authStorageKey = 'invox-admin-auth-v1';
  function authStorage() {
    try {
      const local = window.localStorage;
      if (!local?.getItem || !local?.setItem) return window.sessionStorage;
      local.setItem(authStorageKey + '.probe', '1');
      local.removeItem(authStorageKey + '.probe');
      const previous = window.sessionStorage?.getItem?.(authStorageKey);
      if (previous && !local.getItem(authStorageKey)) {
        try {
          const session = JSON.parse(previous);
          if (typeof session?.access_token === 'string' && typeof session?.refresh_token === 'string') local.setItem(authStorageKey, previous);
        } catch { /* Discard a malformed legacy session without blocking login. */ }
      }
      if (local.getItem(authStorageKey)) window.sessionStorage?.removeItem?.(authStorageKey);
      return local;
    } catch { return window.sessionStorage; }
  }
  const sdk = window.supabase?.createClient(url, key, {
    auth: { storageKey: authStorageKey, storage: authStorage(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  function failure(code, message, status = 0) {
    return Object.assign(new Error(message), { code, status });
  }
  const downloadStorageKey = 'invox-download-access-wsfdwyghqqaerivyrbil-v1';
  let memoryDownloadSession = null;
  let downloadSessionEpoch = 0;
  function validDownloadSession(value) {
    return value && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token)
      && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > Date.now();
  }
  function downloadSession() {
    try {
      if (!window.localStorage?.getItem) return validDownloadSession(memoryDownloadSession) ? memoryDownloadSession : null;
      const value = JSON.parse(window.localStorage.getItem(downloadStorageKey) || 'null');
      if (validDownloadSession(value)) return value;
      window.localStorage.removeItem(downloadStorageKey);
      memoryDownloadSession = null;
      return null;
    } catch { return validDownloadSession(memoryDownloadSession) ? memoryDownloadSession : null; }
  }
  function sessionChanged() {
    if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') window.dispatchEvent(new window.CustomEvent('invox:download-session'));
  }
  function storeDownloadSession(value) {
    downloadSessionEpoch += 1;
    memoryDownloadSession = validDownloadSession(value) ? { token: value.token, expiresAt: value.expiresAt } : null;
    try {
      if (memoryDownloadSession) window.localStorage?.setItem(downloadStorageKey, JSON.stringify(memoryDownloadSession));
      else window.localStorage?.removeItem(downloadStorageKey);
    } catch { /* Browser storage restrictions keep the grant in this tab only. */ }
    sessionChanged();
  }
  async function request(action, body = {}, options = {}) {
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (options.admin) {
      const session = sdk && await sdk.auth.getSession();
      if (!session?.data.session) throw failure('unauthorized', 'Entre no painel para continuar.', 401);
      headers.Authorization = `Bearer ${session.data.session.access_token}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${url}/functions/v1/invox-api`, {
        method: 'POST', headers, body: JSON.stringify({ ...body, action }), signal: controller.signal,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: action === 'track-view'
      });
      let data;
      try { data = await response.json(); } catch { throw failure('offline', 'Serviço indisponível. Tente novamente.'); }
      if (!response.ok) throw failure(data.error?.code || 'request_failed', data.error?.message || 'Não foi possível concluir.', response.status);
      return data;
    } catch (error) {
      if (typeof error.code === 'string') throw error;
      throw failure('offline', 'Não foi possível conectar ao INVOX. Verifique sua conexão e tente novamente.');
    } finally { clearTimeout(timeout); }
  }
  const api = {
    projectUrl: url,
    auth: sdk?.auth,
    request,
    publicState: () => request('state'),
    gameState: () => request('game-state'),
    trackView: eventId => request('track-view', { eventId }),
    analytics: (period = 'week') => request('analytics', { period }, { admin: true }),
    resetAnalytics: () => request('reset-analytics', {}, { admin: true }),
    async download(platform, password = '') {
      const saved = downloadSession();
      const epoch = downloadSessionEpoch;
      try {
        const result = await request('download', { platform, password, ...(saved ? { accessToken: saved.token } : {}) });
        if (result.accessSession && epoch === downloadSessionEpoch) storeDownloadSession(result.accessSession);
        return result;
      } catch (error) {
        if (epoch === downloadSessionEpoch && (error.code === 'password_required' || error.code === 'invalid_password')) storeDownloadSession(null);
        throw error;
      }
    },
    hasDownloadSession: () => Boolean(downloadSession()),
    async lockDownloads() {
      const saved = downloadSession();
      storeDownloadSession(null);
      if (saved) await request('logout-download', { accessToken: saved.token });
      return { cleared: true };
    },
    sendFeedback: data => request('feedback', data),
    adminState: () => request('admin-state', {}, { admin: true }),
    saveAccess: data => request('save-access', data, { admin: true }),
    saveRelease: data => request('save-release', data, { admin: true }),
    updateFeedback: data => request('update-feedback', data, { admin: true }),
    saveAnnouncement: data => request('save-announcement', data, { admin: true }),
    setAnnouncementActive: data => request('set-announcement-active', data, { admin: true }),
    createUpload: data => request('create-upload', data, { admin: true }),
    async signIn(username, password) {
      if (!sdk) throw failure('offline', 'Cliente de autenticação indisponível. Recarregue a página.');
      const result = await request('login', { username, password });
      const { error } = await sdk.auth.setSession(result.session);
      if (error) throw failure('unauthorized', 'Não foi possível iniciar a sessão. Tente novamente.', 401);
      return api.adminState();
    }
  };
  function progressFetch(onProgress) {
    return (input, init = {}) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(init.method || 'GET', String(input));
      new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.timeout = 10 * 60 * 1000;
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && onProgress) onProgress(Math.min(99, Math.round(event.loaded * 100 / event.total)));
      };
      xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText, headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' } }));
      xhr.onerror = xhr.ontimeout = () => reject(failure('upload_failed', 'O envio falhou. Confira sua conexão.'));
      xhr.send(init.body);
    });
  }
  const uploadChunkSize = 6 * 1024 * 1024;
  const resumableEndpoint = `${url.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`;
  function resumableFailure(error) {
    const status = error?.originalResponse?.getStatus?.() || 0;
    if (status === 401 || status === 403) {
      return failure('upload_expired', 'A autorização para este envio expirou. Inicie o envio novamente.', status);
    }
    if (status === 413) {
      return failure('file_too_large', 'O arquivo excede o limite permitido pelo armazenamento. Confira o limite exibido no painel.', status);
    }
    return failure('upload_failed', 'Não foi possível concluir o envio após as tentativas de reconexão. Verifique sua conexão e tente novamente.', status);
  }
  function resumableUpload(file, ticket, onProgress) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let progress = 0;
      const fail = error => {
        if (finished) return;
        finished = true;
        reject(resumableFailure(error));
      };
      try {
        // Keep the File intact: tus reads one chunk at a time and resumes retries
        // from the server's offset without persisting signed upload URLs locally.
        const upload = new window.tus.Upload(file, {
          endpoint: resumableEndpoint,
          headers: { apikey: key, 'x-signature': ticket.token },
          metadata: { bucketName: 'invox-installers', objectName: ticket.path, contentType: 'application/octet-stream', cacheControl: '3600' },
          chunkSize: uploadChunkSize,
          parallelUploads: 1,
          uploadDataDuringCreation: true,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          storeFingerprintForResuming: false,
          removeFingerprintOnSuccess: true,
          onProgress(bytesUploaded, bytesTotal) {
            if (finished || !Number.isFinite(bytesUploaded) || !Number.isFinite(bytesTotal) || bytesUploaded < 0 || bytesTotal <= 0) return;
            progress = Math.max(progress, Math.min(99, Math.round(bytesUploaded * 100 / bytesTotal)));
            onProgress?.(progress);
          },
          onError: fail,
          onSuccess() {
            if (finished) return;
            finished = true;
            resolve();
          }
        });
        upload.start();
      } catch (error) { fail(error); }
    });
  }
  api.uploadInstaller = async ({ platform, file, version, onProgress }) => {
    if (!sdk || !(file instanceof File)) throw failure('invalid_file', 'Selecione um instalador válido.');
    const resumable = file.size > uploadChunkSize;
    if (resumable && (typeof window.tus?.Upload !== 'function' || window.tus.isSupported === false)) {
      throw failure('offline', 'O envio de arquivos grandes está indisponível neste navegador. Recarregue a página ou use um navegador atualizado.');
    }
    const ticket = await api.createUpload({ platform, fileName: file.name, size: file.size, version });
    let uploadUrl;
    let signedPath;
    try {
      uploadUrl = new URL(ticket?.signedUrl);
      signedPath = decodeURIComponent(uploadUrl.pathname);
    } catch {
      throw failure('invalid_upload', 'O servidor retornou um destino de envio inválido.');
    }
    const safePath = typeof ticket.path === 'string' && ticket.path.length <= 512
      && !/[\\%?#\u0000-\u001f\u007f]/.test(ticket.path)
      && ticket.path.split('/').every(part => part && part !== '.' && part !== '..');
    if (!safePath || !ticket.path.startsWith(`${platform}/`)
      || typeof ticket.token !== 'string' || !ticket.token
      || uploadUrl.origin !== url || uploadUrl.username || uploadUrl.password || uploadUrl.hash
      || signedPath !== `/storage/v1/object/upload/sign/invox-installers/${ticket.path}`
      || uploadUrl.searchParams.get('token') !== ticket.token) {
      throw failure('invalid_upload', 'O servidor retornou um destino de envio inválido.');
    }
    onProgress?.(0);
    if (resumable) {
      await resumableUpload(file, ticket, onProgress);
    } else {
      const uploader = window.supabase.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `invox-upload-${crypto.randomUUID()}` },
        global: { fetch: progressFetch(onProgress) }
      });
      const payload = file.slice(0, file.size, 'application/octet-stream');
      const { error } = await uploader.storage.from('invox-installers').uploadToSignedUrl(ticket.path, ticket.token, payload, { contentType: 'application/octet-stream', upsert: false });
      if (error) throw failure('upload_failed', 'Não foi possível enviar o instalador. Tente novamente.');
    }
    onProgress?.(100);
    return { platform, path: ticket.path, fileName: file.name, size: file.size };
  };
  window.InvoxBackend = api;
  window.addEventListener?.('storage', event => {
    if (event.key === downloadStorageKey) { downloadSessionEpoch += 1; memoryDownloadSession = null; sessionChanged(); }
  });
})();
