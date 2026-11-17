((global) => {
  'use strict';
  const MAX_PART_BYTES = 20 * 1024 * 1024;
  const MAX_FILE_BYTES = 1610612736;
  const HASH = /^[a-f0-9]{64}$/i;
  const STORAGE_ORIGIN = 'https://wsfdwyghqqaerivyrbil.supabase.co';
  const base = new URL('.', global.document?.currentScript?.src || global.document?.baseURI || global.location.href);
  const active = new Set();
  const failure = (code, message) => Object.assign(new Error(message), { code });
  const cancelled = () => failure('download_cancelled', 'Download cancelado.');
  function check(signal) { if (signal?.aborted) throw cancelled(); }
  function manifestOf(value) {
    if (!value || value.kind !== 'multipart' || !HASH.test(value.ticket || '')
      || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_FILE_BYTES
      || !HASH.test(value.sha256 || '') || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 128
      || typeof value.fileName !== 'string' || !value.fileName.trim()
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
      throw failure('download_invalid', 'Os dados deste instalador são inválidos. Atualize a página.');
    }
    let size = 0;
    const parts = value.parts.map((part, index) => {
      if (!part || part.index !== index || !Number.isSafeInteger(part.size) || part.size < 1
        || part.size > MAX_PART_BYTES || !HASH.test(part.sha256 || '')) {
        throw failure('download_invalid', 'A lista de partes do instalador é inválida.');
      }
      size += part.size;
      return { index, size: part.size, sha256: part.sha256.toLowerCase() };
    });
    if (size !== value.size) throw failure('download_invalid', 'O tamanho do instalador não confere.');
    return { ticket: value.ticket, fileName: value.fileName.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 180), size,
      sha256: value.sha256.toLowerCase(), parts };
  }
  function signedPart(value, part) {
    let url;
    try { url = new URL(value?.url); } catch { /* Reject malformed metadata below. */ }
    if (!url || url.origin !== STORAGE_ORIGIN || !url.pathname.startsWith('/storage/v1/object/sign/')
      || value.index !== part.index || value.size !== part.size || String(value.sha256).toLowerCase() !== part.sha256) {
      throw failure('download_integrity', 'A autorização da parte não corresponde ao instalador.');
    }
    return url.href;
  }
  function abortable(promise, signal, timeout = 0) {
    return new Promise((resolve, reject) => {
      let timer, settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', stop);
        if (timer) global.clearTimeout(timer);
        callback(value);
      };
      const stop = () => finish(reject, cancelled());
      if (signal?.aborted) return stop();
      signal?.addEventListener('abort', stop, { once: true });
      if (timeout) timer = global.setTimeout(() => finish(reject, failure('download_stream_unavailable', 'O navegador não iniciou a gravação em fluxo.')), timeout);
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  function notify(callback, receivedBytes, totalBytes, stage) {
    try { callback?.({ receivedBytes, totalBytes, stage }); } catch { /* Rendering cannot alter file bytes. */ }
  }
  async function fileSink(manifest, signal) {
    if (typeof global.showSaveFilePicker !== 'function') throw failure('download_unsupported', 'Este navegador não permite salvar este arquivo em fluxo. Use um navegador atualizado.');
    let handle;
    try {
      // Invoke the picker before this function's first await to retain the click gesture.
      handle = await global.showSaveFilePicker({ suggestedName: manifest.fileName });
    } catch (error) {
      if (error?.name === 'AbortError') throw cancelled();
      throw failure('save_location_required', 'Clique em Escolher onde salvar para continuar.');
    }
    check(signal);
    const file = await handle.createWritable({ keepExistingData: false });
    return { writer: file.getWriter(), method: 'file-system', cleanup() {} };
  }
  async function streamSink(manifest, controller) {
    const signal = controller.signal;
    const registration = await abortable(global.navigator.serviceWorker.register(new URL('download-worker.js', base).href,
      { scope: base.href, updateViaCache: 'none' }), signal, 15000);
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) throw failure('download_stream_unavailable', 'O navegador não ativou a gravação em fluxo.');
    if (worker.state && worker.state !== 'activated') {
      await abortable(new Promise((resolve, reject) => {
        const changed = () => {
          if (worker.state === 'activated') { worker.removeEventListener('statechange', changed); resolve(); }
          else if (worker.state === 'redundant') { worker.removeEventListener('statechange', changed); reject(failure('download_stream_unavailable', 'Atualize a página para iniciar o download.')); }
        };
        worker.addEventListener('statechange', changed); changed();
      }), signal, 15000);
    }
    check(signal);
    const bridge = new global.TransformStream(undefined, { highWaterMark: 1 }, { highWaterMark: 0 });
    const writer = bridge.writable.getWriter();
    writer.closed.catch(() => {});
    const channel = new global.MessageChannel();
    const id = [...global.crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const route = new URL('__invox_download__/' + id, registration.scope);
    let readyResolve, readyReject, startedResolve, startedReject, frame;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const started = new Promise((resolve, reject) => { startedResolve = resolve; startedReject = reject; });
    ready.catch(() => {}); started.catch(() => {});
    channel.port1.onmessage = event => {
      if (event.data?.type === 'INVOX_DOWNLOAD_READY') readyResolve();
      else if (event.data?.type === 'INVOX_DOWNLOAD_STARTED') startedResolve();
      else if (event.data?.type === 'INVOX_DOWNLOAD_ERROR') {
        const error = failure('download_stream_unavailable', 'O navegador não conseguiu iniciar o arquivo.');
        readyReject(error); startedReject(error);
      }
    };
    try {
      worker.postMessage({ type: 'INVOX_DOWNLOAD_PREPARE', id, stream: bridge.readable, fileName: manifest.fileName, size: manifest.size },
        [channel.port2, bridge.readable]);
      await abortable(ready, signal, 10000);
      frame = global.document.createElement('iframe');
      frame.hidden = true; frame.title = 'Download INVOX'; frame.setAttribute('aria-hidden', 'true');
      frame.src = route.href; global.document.body.append(frame);
      await abortable(started, signal, 10000);
      channel.port1.close();
      return { writer, method: 'stream', cleanup(success) {
        if (success) global.setTimeout(() => frame.remove(), 2000);
        else frame.remove();
      } };
    } catch (error) {
      try { worker.postMessage({ type: 'INVOX_DOWNLOAD_DISCARD', id }); } catch { /* Worker may already be stopped. */ }
      frame?.remove(); channel.port1.close(); channel.port2.close();
      await writer.abort(error).catch(() => {});
      throw error;
    }
  }
  function streamingSupported() {
    return global.isSecureContext !== false && global.navigator?.serviceWorker
      && typeof global.TransformStream === 'function' && typeof global.MessageChannel === 'function';
  }
  async function readPart(manifest, part, scratch, options, signal, completed) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      check(signal);
      const metadata = await abortable(options.getPart(manifest.ticket, part.index), signal);
      const url = signedPart(metadata, part);
      let reader;
      try {
        const response = await global.fetch(url, { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok || !response.body?.getReader) throw failure('download_network', 'Não foi possível receber uma parte do instalador.');
        const length = response.headers.get('Content-Length');
        if (length !== null && Number(length) !== part.size) throw failure('download_integrity', 'Uma parte do instalador tem tamanho incorreto.');
        reader = response.body.getReader();
        let offset = 0;
        while (true) {
          check(signal);
          const chunk = await reader.read();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || offset + chunk.value.byteLength > part.size) throw failure('download_integrity', 'Uma parte do instalador excede o tamanho esperado.');
          scratch.set(chunk.value, offset); offset += chunk.value.byteLength;
          notify(options.onProgress, completed + offset, manifest.size, 'receiving');
        }
        if (offset !== part.size) throw failure('download_integrity', 'Uma parte do instalador chegou incompleta.');
        return scratch.subarray(0, offset);
      } catch (error) {
        await reader?.cancel().catch(() => {});
        check(signal);
        if (error?.code === 'download_integrity') throw error;
        if (attempt === 2) throw failure('download_network', 'A conexão foi interrompida. Tente baixar novamente.');
        await abortable(new Promise(resolve => global.setTimeout(resolve, (attempt + 1) * 400)), signal);
      } finally { reader?.releaseLock(); }
    }
  }
  async function start(value, options = {}) {
    const manifest = manifestOf(value);
    if (typeof options.getPart !== 'function' || typeof global.hashwasm?.createSHA256 !== 'function') throw failure('download_unsupported', 'Atualize a página para carregar a verificação do instalador.');
    const controller = new global.AbortController(), signal = controller.signal;
    const stop = () => controller.abort();
    if (options.signal?.aborted) throw cancelled();
    options.signal?.addEventListener('abort', stop, { once: true });
    active.add(controller);
    let sink, success = false;
    const abortSink = () => { sink?.writer.abort(cancelled()).catch(() => {}); };
    signal.addEventListener('abort', abortSink, { once: true });
    try {
      if (options.preferFileSystem || !streamingSupported()) sink = await fileSink(manifest, signal);
      else {
        try { sink = await streamSink(manifest, controller); }
        catch (error) {
          check(signal);
          if (typeof global.showSaveFilePicker !== 'function') throw failure('download_unsupported', 'Este navegador não iniciou a gravação em fluxo. Use um navegador atualizado.');
          sink = await fileSink(manifest, signal);
        }
      }
      sink.writer.closed.catch(() => controller.abort());
      const [wholeHash, partHash] = await abortable(Promise.all([global.hashwasm.createSHA256(), global.hashwasm.createSHA256()]), signal);
      wholeHash.init();
      const scratch = new Uint8Array(Math.max(...manifest.parts.map(part => part.size)));
      let completed = 0;
      for (const part of manifest.parts) {
        check(signal);
        const bytes = await readPart(manifest, part, scratch, options, signal, completed);
        partHash.init(); partHash.update(bytes);
        if (partHash.digest('hex').toLowerCase() !== part.sha256) throw failure('download_integrity', 'A verificação de uma parte falhou. O download foi interrompido.');
        wholeHash.update(bytes);
        const last = part.index === manifest.parts.length - 1;
        if (last && (completed + bytes.byteLength !== manifest.size || wholeHash.digest('hex').toLowerCase() !== manifest.sha256)) {
          throw failure('download_integrity', 'A verificação do instalador falhou. O download foi interrompido.');
        }
        // Do not expose the last part until the entire original file is verified.
        // Copy bounded chunks so the single scratch buffer can be safely reused.
        for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
          check(signal);
          await abortable(sink.writer.write(bytes.slice(offset, Math.min(offset + 64 * 1024, bytes.byteLength))), signal);
        }
        completed += bytes.byteLength;
        notify(options.onProgress, completed, manifest.size, last ? 'verified' : 'writing');
      }
      check(signal); await abortable(sink.writer.close(), signal); success = true;
      return { fileName: manifest.fileName, size: manifest.size, verified: true, method: sink.method };
    } catch (error) {
      controller.abort();
      sink?.writer.abort(error).catch(() => {});
      throw error?.name === 'AbortError' ? cancelled() : error;
    } finally {
      options.signal?.removeEventListener('abort', stop); active.delete(controller);
      signal.removeEventListener('abort', abortSink);
      sink?.cleanup(success);
    }
  }
  global.InvoxMultipartDownloads = { start };
  global.addEventListener?.('pagehide', () => active.forEach(controller => controller.abort()));
  global.addEventListener?.('beforeunload', event => {
    if (active.size) { event.preventDefault(); event.returnValue = ''; }
  });
})(window);
