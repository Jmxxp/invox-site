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
  const downloadStatus = document.getElementById('download-status');
  const retryDownload = document.getElementById('download-retry');
  const passwordDialog = document.getElementById('download-password-dialog');
  const passwordForm = document.getElementById('download-password-form');
  const passwordInput = document.getElementById('download-password');
  const passwordStatus = document.getElementById('download-password-status');
  const passwordSubmit = document.getElementById('download-password-submit');
  let downloadBusy = false;
  let pendingDownload = null;
  let attempt = 0;

  function backend() {
    if (!window.InvoxBackend) throw Object.assign(new Error(), { code: 'offline' });
    return window.InvoxBackend;
  }
  function errorCopy(error) {
    return ({
      offline: 'Não foi possível conectar ao INVOX. Tente novamente em instantes.',
      unavailable: 'Este instalador ainda não está disponível. Tente novamente mais tarde.',
      invalid_password: 'Senha incorreta. Confira a senha de acesso e tente novamente.',
      password_required: 'Informe a senha de acesso para continuar.',
      rate_limited: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
    })[error?.code] || 'Não foi possível preparar o download. Tente novamente em instantes.';
  }
  function setDownloadBusy(value) {
    downloadBusy = value;
    downloadLinks.forEach(link => link.setAttribute('aria-busy', String(value)));
    if (retryDownload) retryDownload.disabled = value;
  }
  function showDownloadStatus(message, error = false) {
    if (downloadStatus) {
      downloadStatus.textContent = message;
      downloadStatus.dataset.tone = error ? 'error' : 'normal';
    }
    if (retryDownload) retryDownload.hidden = !error;
  }
  async function refreshAvailability() {
    const state = await backend().publicState();
    const available = new Map((state.platforms || []).map(item => [item.platform, item]));
    downloadLinks.forEach(link => {
      const item = available.get(link.dataset.download);
      const name = platformNames[link.dataset.download];
      link.dataset.available = String(Boolean(item?.available));
      link.title = item?.available ? `Baixar para ${name}` : `${name}: instalador ainda não disponível`;
      link.href = '#download';
    });
    if (typeof state.version === 'string') document.querySelectorAll('[data-game-version]').forEach(element => { element.textContent = state.version; });
    const accessLabel = available.size && [...available.values()].some(item => item.available)
      ? (state.visibility === 'private' ? 'Acesso por senha' : 'Download liberado')
      : 'Instaladores em preparação';
    showDownloadStatus(`Versão ${state.version || '1.1.0'} · ${accessLabel}`);
    return state;
  }
  function startDownload(result) {
    const url = new URL(result.url);
    if (url.origin !== 'https://wsfdwyghqqaerivyrbil.supabase.co' || !url.pathname.startsWith('/storage/v1/object/sign/')) throw new Error('Invalid download URL');
    const link = document.createElement('a');
    link.href = url.href;
    link.download = typeof result.fileName === 'string' ? result.fileName : 'INVOX';
    link.rel = 'noopener noreferrer';
    document.body.append(link);
    link.click();
    link.remove();
    showDownloadStatus('Download autorizado. Seu navegador iniciará o arquivo.');
  }
  function askPassword(platform, trigger) {
    pendingDownload = { platform, trigger };
    passwordInput.value = '';
    passwordStatus.textContent = '';
    document.getElementById('download-password-description').textContent = `O download para ${platformNames[platform]} está reservado. Informe a senha de acesso para continuar.`;
    openDialog(passwordDialog, trigger);
  }

  downloadLinks.forEach(link => {
    link.href = '#download';
    link.removeAttribute('target');
    link.addEventListener('click', async event => {
      event.preventDefault();
      if (downloadBusy) return;
      const platform = link.dataset.download;
      setDownloadBusy(true);
      showDownloadStatus('Conferindo acesso ao download...');
      try {
        const state = await refreshAvailability();
        if (!state.platforms?.some(item => item.platform === platform && item.available)) throw Object.assign(new Error(), { code: 'unavailable' });
        if (state.visibility === 'private') askPassword(platform, link);
        else startDownload(await backend().download(platform));
      } catch (error) {
        if (error?.code === 'password_required') askPassword(platform, link);
        else showDownloadStatus(errorCopy(error), true);
      } finally { setDownloadBusy(false); }
    });
  });

  passwordForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!pendingDownload || passwordSubmit.disabled || !passwordForm.reportValidity()) return;
    const current = ++attempt;
    const selected = pendingDownload;
    const enteredPassword = passwordInput.value;
    passwordInput.value = '';
    passwordSubmit.disabled = true;
    passwordSubmit.textContent = 'VERIFICANDO ACESSO...';
    passwordStatus.textContent = '';
    try {
      const result = await backend().download(selected.platform, enteredPassword);
      if (current !== attempt || !passwordDialog.open) return;
      startDownload(result);
      passwordDialog.close();
    } catch (error) {
      if (current !== attempt || !passwordDialog.open) return;
      passwordStatus.textContent = errorCopy(error);
      passwordInput.focus();
    } finally {
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
  });
  async function retryAvailability() {
    if (downloadBusy) return;
    setDownloadBusy(true);
    showDownloadStatus('Consultando os instaladores...');
    try { await refreshAvailability(); }
    catch (error) { showDownloadStatus(errorCopy(error), true); }
    finally { setDownloadBusy(false); }
  }
  retryDownload?.addEventListener('click', retryAvailability);
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
