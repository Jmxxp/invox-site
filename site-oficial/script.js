(() => {
  "use strict";

  const config = window.INVOX_CONFIG || {};
  const dialogTriggers = new WeakMap();
  const header = document.querySelector(".site-header");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const platformNames = {
    windows: "Windows",
    macos: "macOS",
    android: "Android",
  };
  const socialNames = { discord: "Discord", youtube: "YouTube", x: "X" };

  function openDialog(dialog, trigger) {
    if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
    dialogTriggers.set(dialog, trigger || document.activeElement);
    dialog.showModal();
  }

  function showNotice(title, copy, trigger) {
    const dialog = document.getElementById("notice-dialog");
    const titleElement = document.getElementById("notice-title");
    const copyElement = document.getElementById("notice-copy");
    if (!dialog || !titleElement || !copyElement) return;
    titleElement.textContent = title;
    copyElement.textContent = copy;
    openDialog(dialog, trigger);
  }

  function officialUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  document.querySelectorAll("[data-social]").forEach((link) => {
    const key = link.dataset.social;
    const url = officialUrl(config.social?.[key]);

    if (url) {
      link.href = url;
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      return;
    }

    link.href = "#";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const name = socialNames[key] || "INVOX";
      showNotice(
        `INVOX no ${name}`,
        `O link oficial do INVOX no ${name} ainda não está disponível nesta página.`,
        link,
      );
    });
  });

  const downloadLinks = [...document.querySelectorAll('[data-download]')];
  const platformVersions = [...document.querySelectorAll('[data-platform-version]')];
  const downloadStatus = document.getElementById('download-status');
  const retryDownload = document.getElementById('download-retry');
  const cancelDownload = document.getElementById('download-cancel');
  const retryLabel = retryDownload?.querySelector?.('[data-download-retry-label]') || retryDownload;
  const lockDownload = document.getElementById('download-lock');
  const passwordDialog = document.getElementById('download-password-dialog');
  const passwordForm = document.getElementById('download-password-form');
  const passwordInput = document.getElementById('download-password');
  const passwordStatus = document.getElementById('download-password-status');
  const passwordSubmit = document.getElementById('download-password-submit');
  let downloadBusy = false;
  let pendingDownload = null;
  let attempt = 0;
  let lastVisibility = null;
  let availabilityReady = false;
  let activeDownload = null;
  let pendingFileSave = null;
  let availabilitySequence = 0;
  let appliedAvailabilitySequence = 0;
  let automaticAvailabilityPending = false;
  let automaticAvailabilityPromise = null;
  let automaticAvailabilityTimer = null;
  let realtimeUnsubscribe = null;
  let realtimeEpoch = 0;
  let pageSuspended = false;
  let availabilityOwnsStatus = true;
  let lastAutomaticRefreshAt = -Infinity;

  function backend() {
    if (!window.InvoxBackend) throw Object.assign(new Error(), { code: 'offline' });
    return window.InvoxBackend;
  }
  function hasDownloadSession() {
    try { return Boolean(window.InvoxBackend?.hasDownloadSession?.()); }
    catch { return false; }
  }
  function updateDownloadSession() {
    if (lockDownload) lockDownload.hidden = lastVisibility !== 'private' || !hasDownloadSession();
  }
  function updateDownloadControls() {
    downloadLinks.forEach(link => {
      const enabled = availabilityReady && link.dataset.available === 'true' && !downloadBusy;
      link.setAttribute('aria-disabled', String(!enabled));
      if (enabled) link.removeAttribute('tabindex');
      else {
        link.setAttribute('tabindex', '-1');
        link.classList?.remove('is-pointer-active');
      }
    });
  }
  function unavailablePlatform(platform) {
    downloadLinks.filter(link => link.dataset.download === platform).forEach(link => {
      link.dataset.available = 'false';
      link.title = `${platformNames[platform]}: instalador ainda não disponível`;
    });
    updateDownloadControls();
  }
  function unavailableConnection() {
    availabilityReady = false;
    downloadLinks.forEach(link => { link.dataset.available = 'false'; link.title = `${platformNames[link.dataset.download]}: aguardando conexão com o INVOX`; });
    updateDownloadControls();
  }
  function errorCopy(error) {
    return ({
      offline: 'Não foi possível conectar ao INVOX. Tente novamente em instantes.',
      unavailable: 'Este instalador ainda não está disponível. Tente novamente mais tarde.',
      invalid_password: 'Senha incorreta. Confira a senha de acesso e tente novamente.',
      password_required: 'Informe a senha de acesso para continuar.',
      rate_limited: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
      download_integrity: 'A verificação do instalador falhou. O arquivo não foi concluído. Tente novamente.',
      download_network: 'A conexão foi interrompida. O arquivo não foi concluído. Tente novamente.',
      download_invalid: 'Os dados deste instalador são inválidos. Atualize a página e tente novamente.',
      download_unsupported: 'Este navegador não permite gravar o instalador em fluxo. Use um navegador atualizado.',
      save_location_required: 'Clique em Escolher onde salvar para continuar o download.',
      invalid_download_ticket: 'A autorização deste download expirou. Clique novamente na sua plataforma.'
    })[error?.code] || 'Não foi possível preparar o download. Tente novamente em instantes.';
  }
  function setDownloadBusy(value) {
    downloadBusy = value;
    downloadLinks.forEach(link => link.setAttribute('aria-busy', String(value)));
    if (retryDownload) retryDownload.disabled = value;
    if (lockDownload) lockDownload.disabled = value;
    updateDownloadControls();
    if (!value) scheduleAvailabilityRefresh();
  }
  function showDownloadStatus(message, error = false, availability = false) {
    availabilityOwnsStatus = availability;
    if (downloadStatus) {
      downloadStatus.textContent = message;
      downloadStatus.dataset.tone = error ? 'error' : 'normal';
    }
    if (retryDownload) retryDownload.hidden = !error;
    if (retryLabel) retryLabel.textContent = pendingFileSave ? 'Escolher onde salvar' : 'Tentar novamente';
  }
  function availabilityProtected() {
    return downloadBusy || Boolean(passwordDialog?.open) || Boolean(pendingFileSave);
  }
  function deferBackgroundAvailability(sequence) {
    if (pageSuspended || availabilityProtected()) {
      automaticAvailabilityPending = true;
      return true;
    }
    return sequence < appliedAvailabilitySequence;
  }
  async function refreshAvailability({ background = false } = {}) {
    const sequence = ++availabilitySequence;
    let state;
    try { state = await backend().publicState(); }
    catch (error) {
      if (background && deferBackgroundAvailability(sequence)) return null;
      unavailableConnection(); throw error;
    }
    if (background && deferBackgroundAvailability(sequence)) return null;
    if (sequence < appliedAvailabilitySequence) return state;
    if (!state || !['public', 'private'].includes(state.visibility) || !Array.isArray(state.platforms) || !state.platforms.every(item => item && typeof item.platform === 'string' && typeof item.available === 'boolean')) {
      unavailableConnection();
      throw Object.assign(new Error(), { code: 'offline' });
    }
    appliedAvailabilitySequence = sequence;
    availabilityReady = true;
    lastVisibility = state.visibility;
    updateDownloadSession();
    const available = new Map((state.platforms || []).map(item => [item.platform, item]));
    downloadLinks.forEach(link => {
      const item = available.get(link.dataset.download);
      const name = platformNames[link.dataset.download];
      link.dataset.available = String(Boolean(item?.available));
      link.title = item?.available ? `Baixar para ${name}` : `${name}: instalador ainda não disponível`;
      link.href = '#download';
    });
    updateDownloadControls();
    platformVersions.forEach(element => {
      const item = available.get(element.dataset.platformVersion);
      const version = typeof item?.version === 'string' && item.version.trim()
        ? item.version.trim()
        : (typeof state.version === 'string' ? state.version.trim() : '');
      element.textContent = version
        ? `Versão ${version}${item?.available ? '' : ' · Em preparação'}`
        : 'Versão ainda não informada';
    });
    if (typeof state.version === 'string') document.querySelectorAll('[data-game-version]').forEach(element => { element.textContent = state.version; });
    const accessLabel = available.size && [...available.values()].some(item => item.available)
      ? (state.visibility === 'private' ? (hasDownloadSession() ? 'Acesso privado liberado neste navegador' : 'Acesso por senha') : 'Download liberado')
      : 'Instaladores em preparação';
    if (!background || availabilityOwnsStatus) showDownloadStatus(`Versão ${state.version || '1.1.0'} · ${accessLabel}`, false, true);
    return state;
  }
  function scheduleAvailabilityRefresh(delay = 250) {
    if (!automaticAvailabilityPending || automaticAvailabilityTimer !== null || automaticAvailabilityPromise
      || pageSuspended || document.visibilityState === 'hidden' || availabilityProtected()) return;
    const wait = Math.max(delay, 2000 - (Date.now() - lastAutomaticRefreshAt));
    automaticAvailabilityTimer = setTimeout(() => {
      automaticAvailabilityTimer = null;
      flushAvailabilityRefresh();
    }, wait);
  }
  function flushAvailabilityRefresh() {
    if (!automaticAvailabilityPending || pageSuspended || document.visibilityState === 'hidden' || availabilityProtected()) return;
    if (automaticAvailabilityPromise) return automaticAvailabilityPromise;
    automaticAvailabilityPending = false;
    lastAutomaticRefreshAt = Date.now();
    automaticAvailabilityPromise = refreshAvailability({ background: true }).catch(error => {
      if (!pageSuspended && !availabilityProtected() && availabilityOwnsStatus) showDownloadStatus(errorCopy(error), true, true);
    }).finally(() => {
      automaticAvailabilityPromise = null;
      scheduleAvailabilityRefresh();
    });
    return automaticAvailabilityPromise;
  }
  function invalidateAvailability(delay = 250) {
    automaticAvailabilityPending = true;
    scheduleAvailabilityRefresh(delay);
  }
  function catchUpAvailability() {
    connectRealtime();
    automaticAvailabilityPending = true;
    if (automaticAvailabilityTimer !== null) {
      clearTimeout(automaticAvailabilityTimer);
      automaticAvailabilityTimer = null;
    }
    return flushAvailabilityRefresh();
  }
  function connectRealtime() {
    if (pageSuspended || realtimeUnsubscribe || typeof window.InvoxBackend?.subscribeChanges !== 'function') return;
    const epoch = ++realtimeEpoch;
    try {
      const unsubscribe = window.InvoxBackend.subscribeChanges({
        audience: 'public',
        onChange(change) {
          if (epoch === realtimeEpoch && ['settings', 'installers', 'all'].includes(change?.scope)) invalidateAvailability();
        },
        onStatus(status) {
          if (epoch === realtimeEpoch && status === 'SUBSCRIBED') invalidateAvailability(0);
        }
      });
      realtimeUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
    } catch { /* Focus and online catch-up remain available if realtime cannot start. */ }
  }
  function stopRealtime() {
    realtimeEpoch += 1;
    if (automaticAvailabilityTimer !== null) clearTimeout(automaticAvailabilityTimer);
    automaticAvailabilityTimer = null;
    const unsubscribe = realtimeUnsubscribe;
    realtimeUnsubscribe = null;
    try { Promise.resolve(unsubscribe?.()).catch(() => {}); } catch { /* Page teardown must not interrupt the browser. */ }
  }
  async function startDownload(result, context = {}, preferFileSystem = false) {
    if (result?.kind === 'multipart') {
      if (!window.InvoxMultipartDownloads?.start) throw Object.assign(new Error(), { code: 'download_unsupported' });
      const controller = new AbortController();
      activeDownload = controller; pendingFileSave = null;
      if (cancelDownload) cancelDownload.hidden = false;
      showDownloadStatus('Preparando o arquivo. Mantenha esta página aberta até concluir.');
      try {
        let lastPercent = -1;
        await window.InvoxMultipartDownloads.start(result, {
          signal: controller.signal, preferFileSystem,
          getPart: (ticket, index) => backend().downloadPart(ticket, index),
          onProgress(progress) {
            if (controller.signal.aborted || activeDownload !== controller) return;
            const percent = progress.stage === 'verified' ? 100 : Math.min(99, Math.floor(progress.receivedBytes / progress.totalBytes * 100));
            if (percent === lastPercent) return;
            lastPercent = percent;
            showDownloadStatus(percent === 100 ? 'Arquivo verificado. Finalizando a gravação...' : `Baixando e verificando o instalador: ${percent}%. Mantenha esta página aberta.`);
          }
        });
        showDownloadStatus('Arquivo verificado. Seu navegador está finalizando o download.');
        updateDownloadSession();
      } catch (error) {
        if (error?.code === 'save_location_required') pendingFileSave = { result, context };
        throw error;
      } finally {
        activeDownload = null;
        if (cancelDownload) cancelDownload.hidden = true;
      }
      return;
    }
    const url = new URL(result.url);
    if (url.origin !== 'https://wsfdwyghqqaerivyrbil.supabase.co' || url.username || url.password || url.hash || !url.pathname.startsWith('/storage/v1/object/sign/invox-installers/')) throw new Error('Invalid download URL');
    const link = document.createElement('a');
    link.href = url.href;
    link.download = typeof result.fileName === 'string' ? result.fileName : 'INVOX';
    link.rel = 'noopener noreferrer';
    document.body.append(link);
    link.click();
    link.remove();
    showDownloadStatus('Download autorizado. Seu navegador iniciará o arquivo.');
    updateDownloadSession();
  }
  function downloadFailure(error, platform, trigger) {
    if (error?.code === 'download_cancelled') {
      pendingFileSave = null;
      showDownloadStatus('Download cancelado. Nenhum arquivo foi confirmado.');
      return;
    }
    if (error?.code === 'unavailable') unavailablePlatform(platform);
    if (error?.code === 'offline') unavailableConnection();
    updateDownloadSession();
    if (error?.code === 'password_required') askPassword(platform, trigger);
    else showDownloadStatus(errorCopy(error), true);
  }
  function askPassword(platform, trigger) {
    pendingDownload = { platform, trigger };
    passwordInput.value = '';
    passwordStatus.textContent = '';
    document.getElementById('download-password-description').textContent = `O download para ${platformNames[platform]} está reservado. Informe a senha de acesso para continuar.`;
    openDialog(passwordDialog, trigger);
  }

  downloadLinks.forEach(link => {
    link.dataset.available = 'false';
    link.href = '#download';
    link.removeAttribute('target');
    link.addEventListener('click', async event => {
      event.preventDefault();
      if (downloadBusy || !availabilityReady || link.dataset.available !== 'true' || link.getAttribute?.('aria-disabled') === 'true') return;
      const platform = link.dataset.download;
      setDownloadBusy(true);
      showDownloadStatus('Conferindo acesso ao download...');
      try {
        const state = await refreshAvailability();
        if (!state.platforms?.some(item => item.platform === platform && item.available)) throw Object.assign(new Error(), { code: 'unavailable' });
        if (state.visibility === 'private' && !hasDownloadSession()) askPassword(platform, link);
        else await startDownload(await backend().download(platform), { platform, trigger: link });
      } catch (error) {
        downloadFailure(error, platform, link);
      } finally { setDownloadBusy(false); }
    });
  });
  updateDownloadControls();

  passwordForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!pendingDownload || passwordSubmit.disabled || !passwordForm.reportValidity()) return;
    const current = ++attempt;
    const selected = pendingDownload;
    let enteredPassword = passwordInput.value;
    passwordInput.value = '';
    passwordSubmit.disabled = true;
    setDownloadBusy(true);
    passwordSubmit.textContent = 'VERIFICANDO ACESSO...';
    passwordStatus.textContent = '';
    try {
      const result = await backend().download(selected.platform, enteredPassword);
      enteredPassword = '';
      if (current !== attempt || !passwordDialog.open) return;
      if (result?.kind === 'multipart') {
        passwordDialog.close();
        try { await startDownload(result, selected); }
        catch (error) { downloadFailure(error, selected.platform, selected.trigger); }
      } else {
        await startDownload(result);
        passwordDialog.close();
      }
    } catch (error) {
      if (current !== attempt || !passwordDialog.open) return;
      if (error?.code === 'unavailable' || error?.code === 'offline') {
        if (error.code === 'unavailable') unavailablePlatform(selected.platform);
        else unavailableConnection();
        passwordDialog.close();
        showDownloadStatus(errorCopy(error), true);
        return;
      }
      passwordStatus.textContent = errorCopy(error);
      passwordInput.focus();
    } finally {
      enteredPassword = '';
      setDownloadBusy(false);
      if (current === attempt) {
        passwordSubmit.disabled = false;
        passwordSubmit.textContent = 'LIBERAR DOWNLOAD';
      }
    }
  });
  passwordDialog?.addEventListener('close', () => {
    attempt += 1;
    pendingDownload = null;
    passwordInput.value = '';
    passwordStatus.textContent = '';
    passwordSubmit.disabled = false;
    passwordSubmit.textContent = 'LIBERAR DOWNLOAD';
    scheduleAvailabilityRefresh();
  });
  async function retryAvailability(allowFileSave = false) {
    if (downloadBusy || (pendingFileSave && !allowFileSave)) return;
    setDownloadBusy(true);
    if (pendingFileSave) {
      const pending = pendingFileSave;
      try { await startDownload(pending.result, pending.context, true); }
      catch (error) { downloadFailure(error, pending.context.platform, pending.context.trigger); }
      finally { setDownloadBusy(false); }
      return;
    }
    showDownloadStatus('Consultando os instaladores...', false, true);
    try { await refreshAvailability(); }
    catch (error) { showDownloadStatus(errorCopy(error), true, true); }
    finally { setDownloadBusy(false); }
  }
  retryDownload?.addEventListener('click', () => retryAvailability(true));
  cancelDownload?.addEventListener('click', () => activeDownload?.abort());
  lockDownload?.addEventListener('click', async () => {
    if (downloadBusy) return;
    pendingFileSave = null;
    setDownloadBusy(true);
    showDownloadStatus('Encerrando acesso privado...');
    try {
      await backend().lockDownloads();
      showDownloadStatus('Acesso privado encerrado neste navegador.');
    } catch {
      unavailableConnection();
      showDownloadStatus('Acesso encerrado neste navegador. Sem conexão para confirmar no servidor.', true);
    } finally {
      updateDownloadSession();
      setDownloadBusy(false);
    }
  });
  window.addEventListener?.('storage', updateDownloadSession);
  window.addEventListener?.('focus', () => { if (document.visibilityState !== 'hidden') return catchUpAvailability(); });
  window.addEventListener?.('online', catchUpAvailability);
  window.addEventListener?.('pagehide', () => { pageSuspended = true; stopRealtime(); });
  window.addEventListener?.('pageshow', () => {
    if (!pageSuspended) return;
    pageSuspended = false;
    connectRealtime();
    return catchUpAvailability();
  });
  window.addEventListener?.('invox:download-session', updateDownloadSession);
  document.addEventListener('invox:download-session', updateDownloadSession);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') return catchUpAvailability(); });
  connectRealtime();
  retryAvailability();

  document.querySelectorAll("[data-open-dialog]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      openDialog(document.getElementById(trigger.dataset.openDialog), trigger);
    });
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.querySelectorAll("[data-close-dialog]").forEach((closeButton) => {
      closeButton.addEventListener("click", () => dialog.close());
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) dialog.close();
    });
    dialog.addEventListener("close", () => {
      const trigger = dialogTriggers.get(dialog);
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        const focusTarget = trigger.getClientRects().length > 0 ? trigger : menuToggle;
        focusTarget?.focus({ preventScroll: true });
      }
      dialogTriggers.delete(dialog);
    });
  });

  function closeMenu() {
    header?.classList.remove("is-menu-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Abrir menu");
    menuToggle?.querySelector("i")?.classList.replace("fa-xmark", "fa-bars");
  }

  menuToggle?.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(expanded));
    menuToggle.setAttribute("aria-label", expanded ? "Fechar menu" : "Abrir menu");
    const menuIcon = menuToggle.querySelector("i");
    menuIcon?.classList.toggle("fa-bars", !expanded);
    menuIcon?.classList.toggle("fa-xmark", expanded);
    header?.classList.toggle("is-menu-open", expanded);
  });

  header?.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("nav a, nav button")) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && header?.classList.contains("is-menu-open")) {
      closeMenu();
      menuToggle?.focus({ preventScroll: true });
    }
  });
})();
