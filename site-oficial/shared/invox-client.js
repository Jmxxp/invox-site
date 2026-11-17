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
      options.uploadGuard?.checkSession(session?.data?.session);
      if (!session?.data.session) throw failure('unauthorized', 'Entre no painel para continuar.', 401);
      headers.Authorization = `Bearer ${session.data.session.access_token}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const unbind = options.uploadGuard?.bindAbort(() => controller.abort());
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
      options.uploadGuard?.throwIfCancelled();
      if (typeof error.code === 'string') throw error;
      throw failure('offline', 'Não foi possível conectar ao INVOX. Verifique sua conexão e tente novamente.');
    } finally { clearTimeout(timeout); unbind?.(); }
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
    downloadPart: (ticket, index) => request('download-part', { ticket, index }),
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
    updateInstallerVersion: (platform, version) => request('update-installer-version', { platform, version }, { admin: true }),
    updateFeedback: data => request('update-feedback', data, { admin: true }),
    saveAnnouncement: data => request('save-announcement', data, { admin: true }),
    setAnnouncementActive: data => request('set-announcement-active', data, { admin: true }),
    createUpload: (data, uploadGuard) => request('create-upload', data, { admin: true, uploadGuard }),
    createMultipartUpload: (data, uploadGuard) => request('create-multipart-upload', data, { admin: true, uploadGuard }),
    multipartPartUpload: (data, uploadGuard) => request('multipart-part-upload', data, { admin: true, uploadGuard }),
    confirmMultipartPart: (data, uploadGuard) => request('confirm-multipart-part', data, { admin: true, uploadGuard }),
    finishMultipartUpload: (data, uploadGuard) => request('finish-multipart-upload', data, { admin: true, uploadGuard }),
    async signIn(username, password) {
      if (!sdk) throw failure('offline', 'Cliente de autenticação indisponível. Recarregue a página.');
      const result = await request('login', { username, password });
      const { error } = await sdk.auth.setSession(result.session);
      if (error) throw failure('unauthorized', 'Não foi possível iniciar a sessão. Tente novamente.', 401);
      return api.adminState();
    }
  };
  api.subscribeChanges = ({ audience, onChange, onStatus } = {}) => {
    const privateChannel = audience === 'admin';
    const scopes = new Set(privateChannel ? ['feedback', 'analytics', 'settings', 'installers', 'all'] : ['settings', 'installers', 'all']);
    let disposed = false, channel = null, authSubscription = null, owner = null;
    const status = value => { try { onStatus?.(value); } catch { /* UI callbacks cannot break transport cleanup. */ } };
    const stop = () => {
      if (disposed) return;
      disposed = true;
      authSubscription?.unsubscribe();
      authSubscription = null;
      if (channel) {
        try { Promise.resolve(sdk.removeChannel(channel)).catch(() => {}); } catch { /* Already closed locally. */ }
        channel = null;
      }
      status('CLOSED');
    };
    const connect = async () => {
      if (disposed) return;
      if (!['public', 'admin'].includes(audience) || typeof sdk?.channel !== 'function') throw failure('offline', 'Atualizações em tempo real indisponíveis.');
      if (privateChannel) {
        authSubscription = sdk.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT' || (owner && session && session.user?.id !== owner)) stop();
        })?.data?.subscription;
        if (disposed) { authSubscription?.unsubscribe(); authSubscription = null; return; }
        const session = (await sdk.auth.getSession())?.data?.session;
        if (disposed) return;
        if (!session?.user?.id || !session.access_token) throw failure('unauthorized', 'Entre no painel para continuar.', 401);
        owner = session.user.id;
        // The pinned SDK resolves the current session and refreshes Realtime JWTs
        // on Auth events. Do not retain a separate, potentially stale token.
        await sdk.realtime?.setAuth();
        if (disposed) return;
        const current = (await sdk.auth.getSession())?.data?.session;
        if (disposed) return;
        if (current?.user?.id !== owner) { stop(); return; }
      }
      if (disposed) return;
      channel = sdk.channel(privateChannel ? 'invox:admin' : 'invox:site', {
        config: { private: privateChannel, broadcast: { self: false, ack: false } }
      });
      channel.on('broadcast', { event: 'invalidate' }, message => {
        if (disposed || !scopes.has(message?.payload?.scope)) return;
        // Events only invalidate; all state still comes from the authorized API.
        try { onChange?.({ scope: message.payload.scope }); } catch { /* Keep transport alive. */ }
      }).subscribe(value => { if (!disposed) status(value); });
    };
    Promise.resolve().then(connect).catch(() => {
      if (disposed) return;
      authSubscription?.unsubscribe();
      authSubscription = null;
      if (channel) {
        try { Promise.resolve(sdk.removeChannel(channel)).catch(() => {}); } catch { /* Setup failed before subscription. */ }
        channel = null;
      }
      status('CHANNEL_ERROR');
    });
    return stop;
  };
  function cancelledUpload() {
    return failure('upload_cancelled', 'O envio foi interrompido. Selecione o arquivo novamente para retomar.');
  }
  async function uploadGuard(signal) {
    const initial = (await sdk.auth.getSession())?.data?.session;
    if (!initial) throw failure('unauthorized', 'Entre no painel para continuar.', 401);
    const owner = initial.user?.id;
    const sameOwner = session => Boolean(session && (owner ? session.user?.id === owner : session.access_token === initial.access_token));
    let cancelled = false;
    let activeAbort = null;
    const cancel = () => { cancelled = true; activeAbort?.(); };
    const throwIfCancelled = () => { if (cancelled) throw cancelledUpload(); };
    const checkSession = session => { if (!sameOwner(session)) cancel(); throwIfCancelled(); };
    signal?.addEventListener?.('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const subscription = sdk.auth.onAuthStateChange?.((event, session) => {
      if (event === 'SIGNED_OUT' || (session && !sameOwner(session))) cancel();
    })?.data?.subscription;
    return {
      throwIfCancelled,
      checkSession,
      async check() {
        throwIfCancelled();
        const current = (await sdk.auth.getSession())?.data?.session;
        checkSession(current);
      },
      bindAbort(callback) {
        activeAbort = callback;
        if (cancelled) callback();
        return () => { if (activeAbort === callback) activeAbort = null; };
      },
      dispose() {
        activeAbort = null;
        subscription?.unsubscribe();
        signal?.removeEventListener?.('abort', cancel);
      }
    };
  }
  function progressFetch(onProgress, guard) {
    return (input, init = {}) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let finished = false;
      let unbind = () => {};
      const settle = (callback, value) => { if (!finished) { finished = true; unbind(); callback(value); } };
      xhr.open(init.method || 'GET', String(input));
      new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.timeout = 10 * 60 * 1000;
      xhr.upload.onprogress = event => {
        if (!finished && event.lengthComputable && onProgress) onProgress(Math.min(99, Math.round(event.loaded * 100 / event.total)));
      };
      xhr.onload = () => settle(resolve, new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText, headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' } }));
      xhr.onerror = xhr.ontimeout = () => settle(reject, failure('upload_failed', 'O envio falhou. Confira sua conexão.'));
      unbind = guard.bindAbort(() => { settle(reject, cancelledUpload()); xhr.abort?.(); });
      if (!finished) xhr.send(init.body);
    });
  }
  const uploadChunkSize = 6 * 1024 * 1024;
  const singleUploadLimit = 50 * 1024 * 1024;
  const multipartPartSize = 20 * 1024 * 1024;
  const hashReadSize = 1024 * 1024;
  const installerSizeLimit = 1.5 * 1024 * 1024 * 1024;
  const sha256Pattern = /^[a-f0-9]{64}$/;
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const resumableEndpoint = `${url.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable/sign`;
  function validResumableDestination(value) {
    try {
      const destination = new URL(value);
      const endpoint = new URL(resumableEndpoint);
      return destination.origin === endpoint.origin && !destination.username && !destination.password && !destination.search && !destination.hash
        && (destination.pathname === endpoint.pathname || destination.pathname.startsWith(endpoint.pathname + '/'));
    } catch { return false; }
  }
  function resumableFailure(error) {
    if (error?.code === 'invalid_upload') return failure('invalid_upload', 'O servidor retornou um destino de envio inválido.');
    const status = error?.originalResponse?.getStatus?.() || 0;
    if (status === 401 || status === 403) {
      return failure('upload_expired', 'A autorização para este envio expirou. Inicie o envio novamente.', status);
    }
    if (status === 413) {
      return failure('file_too_large', 'O arquivo excede o limite permitido pelo armazenamento. Confira o limite exibido no painel.', status);
    }
    return failure('upload_failed', 'Não foi possível concluir o envio após as tentativas de reconexão. Verifique sua conexão e tente novamente.', status);
  }
  function resumableUpload(file, ticket, onProgress, guard, bucket = 'invox-installers') {
    return new Promise((resolve, reject) => {
      let finished = false;
      let progress = 0;
      let unbind = () => {};
      let upload;
      const fail = error => {
        if (finished) return;
        finished = true;
        unbind();
        reject(resumableFailure(error));
      };
      try {
        // Keep the File intact: tus reads one chunk at a time and resumes retries
        // from the server's offset without persisting signed upload URLs locally.
        upload = new window.tus.Upload(file, {
          endpoint: resumableEndpoint,
          headers: { apikey: key, 'x-signature': ticket.token },
          metadata: { bucketName: bucket, objectName: ticket.path, contentType: 'application/octet-stream', cacheControl: '3600' },
          chunkSize: uploadChunkSize,
          parallelUploads: 1,
          uploadDataDuringCreation: true,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          storeFingerprintForResuming: false,
          removeFingerprintOnSuccess: true,
          onBeforeRequest(request) {
            if (validResumableDestination(request.getURL())) return;
            const error = failure('invalid_upload', 'O servidor retornou um destino de envio inválido.');
            fail(error);
            try { Promise.resolve(upload.abort()).catch(() => {}); } catch { /* No request is sent to an invalid destination. */ }
            throw error;
          },
          onProgress(bytesUploaded, bytesTotal) {
            if (finished || !Number.isFinite(bytesUploaded) || !Number.isFinite(bytesTotal) || bytesUploaded < 0 || bytesTotal <= 0) return;
            progress = Math.max(progress, Math.min(99, Math.round(bytesUploaded * 100 / bytesTotal)));
            onProgress?.(progress);
          },
          onError: fail,
          onSuccess() {
            if (finished) return;
            finished = true;
            unbind();
            resolve();
          }
        });
        unbind = guard.bindAbort(() => {
          if (finished) return;
          finished = true;
          unbind();
          try { Promise.resolve(upload.abort()).catch(() => {}); } catch { /* The operation remains cancelled even if transport cleanup fails. */ }
          reject(cancelledUpload());
        });
        if (!finished) upload.start();
      } catch (error) { fail(error); }
    });
  }
  function validateUploadTicket(ticket, bucket, expectedPath, platform) {
    let uploadUrl;
    let signedPath;
    try {
      uploadUrl = new URL(ticket?.signedUrl);
      signedPath = decodeURIComponent(uploadUrl.pathname);
    } catch {
      throw failure('invalid_upload', 'O servidor retornou um destino de envio inválido.');
    }
    const safePath = typeof ticket?.path === 'string' && ticket.path.length <= 512
      && !/[\\%?#\u0000-\u001f\u007f]/.test(ticket.path)
      && ticket.path.split('/').every(part => part && part !== '.' && part !== '..');
    if (!safePath || (expectedPath ? ticket.path !== expectedPath || ticket.bucket !== bucket : !ticket.path.startsWith(`${platform}/`))
      || typeof ticket.token !== 'string' || !ticket.token
      || uploadUrl.origin !== url || uploadUrl.username || uploadUrl.password || uploadUrl.hash
      || signedPath !== `/storage/v1/object/upload/sign/${bucket}/${ticket.path}`
      || uploadUrl.searchParams.get('token') !== ticket.token) {
      throw failure('invalid_upload', 'O servidor retornou um destino de envio inválido.');
    }
  }
  async function uploadSingle({ platform, file, version, onProgress }, guard) {
    const ticket = await api.createUpload({ platform, fileName: file.name, size: file.size, version }, guard);
    await guard.check();
    validateUploadTicket(ticket, 'invox-installers', null, platform);
    const resumable = file.size > uploadChunkSize;
    if (resumable) {
      await resumableUpload(file, ticket, onProgress, guard);
    } else {
      const uploader = window.supabase.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `invox-upload-${crypto.randomUUID()}` },
        global: { fetch: progressFetch(onProgress, guard) }
      });
      const payload = file.slice(0, file.size, 'application/octet-stream');
      const { error } = await uploader.storage.from('invox-installers').uploadToSignedUrl(ticket.path, ticket.token, payload, { contentType: 'application/octet-stream', upsert: false });
      await guard.check();
      if (error) throw failure('upload_failed', 'Não foi possível enviar o instalador. Tente novamente.');
    }
    return { platform, path: ticket.path, fileName: file.name, size: file.size };
  }
  async function hashInstaller(file, guard, onStatus) {
    let whole;
    let partHasher;
    try {
      [whole, partHasher] = await Promise.all([window.hashwasm.createSHA256(), window.hashwasm.createSHA256()]);
      whole.init();
    } catch { throw failure('hash_unavailable', 'A verificação do arquivo está indisponível. Recarregue a página ou use um navegador atualizado.'); }
    await guard.check();
    const parts = [];
    for (let start = 0, index = 0; start < file.size; start += multipartPartSize, index++) {
      const partEnd = Math.min(file.size, start + multipartPartSize);
      partHasher.init();
      for (let cursor = start; cursor < partEnd; cursor += hashReadSize) {
        await guard.check();
        const end = Math.min(partEnd, cursor + hashReadSize);
        let buffer;
        try { buffer = await file.slice(cursor, end).arrayBuffer(); }
        catch {
          await guard.check();
          throw failure('file_read_failed', 'Não foi possível ler o arquivo. Selecione-o novamente para continuar.');
        }
        await guard.check();
        if (buffer.byteLength !== end - cursor) throw failure('file_read_failed', 'O arquivo mudou durante a leitura. Selecione-o novamente.');
        const bytes = new Uint8Array(buffer);
        whole.update(bytes);
        partHasher.update(bytes);
        onStatus?.(`Verificando o arquivo… ${Math.floor(end * 100 / file.size)}%`);
      }
      parts.push({ index, size: partEnd - start, sha256: partHasher.digest('hex') });
    }
    const sha256 = whole.digest('hex');
    if (!sha256Pattern.test(sha256) || parts.some(part => !sha256Pattern.test(part.sha256))) throw failure('hash_unavailable', 'Não foi possível verificar o arquivo. Recarregue a página e tente novamente.');
    return { sha256, parts };
  }
  async function uploadMultipart({ platform, file, version, onProgress, onStatus }, guard) {
    onStatus?.('Verificando o arquivo…');
    const manifest = await hashInstaller(file, guard, onStatus);
    await guard.check();
    onStatus?.('Preparando o envio…');
    const session = await api.createMultipartUpload({ platform, fileName: file.name, size: file.size, version, ...manifest }, guard);
    await guard.check();
    if (!uuidPattern.test(session?.uploadId) || !['uploading', 'ready', 'published'].includes(session.status) || !Array.isArray(session.completedParts)
      || session.completedParts.some(index => !Number.isInteger(index) || index < 0 || index >= manifest.parts.length)
      || new Set(session.completedParts).size !== session.completedParts.length
      || (session.status !== 'uploading' && session.completedParts.length !== manifest.parts.length)) throw failure('invalid_upload', 'O servidor retornou uma sessão de envio inválida.');
    const uploadId = session.uploadId;
    const completed = new Set(session.completedParts);
    let completedBytes = manifest.parts.filter(part => completed.has(part.index)).reduce((total, part) => total + part.size, 0);
    let progress = 0;
    const emitProgress = bytes => {
      progress = Math.max(progress, Math.min(99, Math.floor(bytes * 100 / file.size)));
      onProgress?.(progress);
    };
    emitProgress(completedBytes);
    if (completed.size) onStatus?.(`Retomando envio: ${completed.size} de ${manifest.parts.length} partes já recebidas.`);
    for (const part of manifest.parts) {
      if (completed.has(part.index)) continue;
      await guard.check();
      onStatus?.(`Preparando parte ${part.index + 1} de ${manifest.parts.length}…`);
      const ticket = await api.multipartPartUpload({ uploadId, index: part.index }, guard);
      await guard.check();
      if (ticket?.completed === true) {
        if (ticket.index !== part.index) throw failure('invalid_upload', 'O servidor retornou uma parte de envio inválida.');
      } else {
        if (ticket?.completed !== false) throw failure('invalid_upload', 'O servidor retornou uma parte de envio inválida.');
        const path = `uploads/${uploadId}/${String(part.index).padStart(3, '0')}-${part.sha256}.part`;
        validateUploadTicket(ticket, 'invox-installer-parts', path);
        onStatus?.(`Enviando parte ${part.index + 1} de ${manifest.parts.length}…`);
        const payload = file.slice(part.index * multipartPartSize, part.index * multipartPartSize + part.size, 'application/octet-stream');
        await resumableUpload(payload, ticket, percent => emitProgress(completedBytes + part.size * percent / 100), guard, 'invox-installer-parts');
        await guard.check();
        onStatus?.(`Verificando parte ${part.index + 1} de ${manifest.parts.length}…`);
        const confirmation = await api.confirmMultipartPart({ uploadId, index: part.index }, guard);
        await guard.check();
        if (confirmation?.index !== part.index || confirmation.verified !== true) throw failure('invalid_upload', 'Não foi possível confirmar uma parte do arquivo. Tente novamente.');
      }
      completedBytes += part.size;
      emitProgress(completedBytes);
    }
    await guard.check();
    onStatus?.('Concluindo o envio…');
    const result = await api.finishMultipartUpload({ uploadId }, guard);
    await guard.check();
    if (result?.kind !== 'multipart' || result.uploadId !== uploadId || result.platform !== platform || result.fileName !== file.name || result.size !== file.size || result.version !== version || result.sha256 !== manifest.sha256) throw failure('invalid_upload', 'Não foi possível confirmar o arquivo completo. Tente novamente.');
    return { kind: 'multipart', uploadId, platform, fileName: file.name, size: file.size, version, sha256: manifest.sha256 };
  }
  api.uploadInstaller = async ({ platform, file, version, onProgress, onStatus, signal, objectUploadLimitBytes = singleUploadLimit, uploadLimitBytes = installerSizeLimit }) => {
    if (!sdk || !(file instanceof File) || !Number.isSafeInteger(file.size) || file.size <= 0) throw failure('invalid_file', 'Selecione um instalador válido.');
    if (!Number.isSafeInteger(objectUploadLimitBytes) || objectUploadLimitBytes <= 0 || !Number.isSafeInteger(uploadLimitBytes) || uploadLimitBytes <= 0) throw failure('invalid_upload', 'O limite de envio está indisponível. Atualize o painel e tente novamente.');
    const objectLimit = Math.min(singleUploadLimit, objectUploadLimitBytes);
    const fileLimit = Math.min(installerSizeLimit, uploadLimitBytes);
    if (file.size > fileLimit) throw failure('file_too_large', 'O instalador excede o limite de envio exibido no painel.');
    if (file.size > objectLimit && objectLimit < multipartPartSize) throw failure('file_too_large', 'O limite atual do armazenamento não permite enviar este instalador em partes.');
    const guard = await uploadGuard(signal);
    try {
      await guard.check();
      if (file.size > uploadChunkSize && (typeof window.tus?.Upload !== 'function' || window.tus.isSupported === false)) throw failure('offline', 'O envio de arquivos grandes está indisponível neste navegador. Recarregue a página ou use um navegador atualizado.');
      if (file.size > objectLimit && typeof window.hashwasm?.createSHA256 !== 'function') throw failure('hash_unavailable', 'A verificação do arquivo está indisponível. Recarregue a página ou use um navegador atualizado.');
      onProgress?.(0);
      const options = { platform, file, version, onProgress, onStatus };
      const result = await (file.size > objectLimit ? uploadMultipart(options, guard) : uploadSingle(options, guard));
      await guard.check();
      onProgress?.(100);
      return result;
    } finally { guard.dispose(); }
  };
  window.InvoxBackend = api;
  window.addEventListener?.('storage', event => {
    if (event.key === downloadStorageKey) { downloadSessionEpoch += 1; memoryDownloadSession = null; sessionChanged(); }
  });
})();
