(() => {
  'use strict';
  const url = 'https://wsfdwyghqqaerivyrbil.supabase.co';
  const key = 'sb_publishable_JRJh2_czP8LlDXwd6E2vZg_qImQ5Gil';
  const sdk = window.supabase?.createClient(url, key, {
    auth: { storageKey: 'invox-admin-auth-v1', storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  function failure(code, message, status = 0) {
    return Object.assign(new Error(message), { code, status });
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
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
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
    download: (platform, password = '') => request('download', { platform, password }),
    sendFeedback: data => request('feedback', data),
    adminState: () => request('admin-state', {}, { admin: true }),
    saveAccess: data => request('save-access', data, { admin: true }),
    saveRelease: data => request('save-release', data, { admin: true }),
    updateFeedback: data => request('update-feedback', data, { admin: true }),
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
  api.uploadInstaller = async ({ platform, file, version, onProgress }) => {
    if (!sdk || !(file instanceof File)) throw failure('invalid_file', 'Selecione um instalador válido.');
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
    const uploader = window.supabase.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `invox-upload-${crypto.randomUUID()}` },
      global: { fetch: progressFetch(onProgress) }
    });
    onProgress?.(0);
    const payload = file.slice(0, file.size, 'application/octet-stream');
    const { error } = await uploader.storage.from('invox-installers').uploadToSignedUrl(ticket.path, ticket.token, payload, { contentType: 'application/octet-stream', upsert: false });
    if (error) throw failure('upload_failed', 'Não foi possível enviar o instalador. Tente novamente.');
    onProgress?.(100);
    return { platform, path: ticket.path, fileName: file.name, size: file.size };
  };
  window.InvoxBackend = api;
})();
