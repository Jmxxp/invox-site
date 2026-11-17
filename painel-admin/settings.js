(function () {
  'use strict';

  const accessForm = document.getElementById('access-form');
  const releaseForm = document.getElementById('release-form');
  if (!accessForm || !releaseForm) return;

  const radios = Array.from(accessForm.querySelectorAll('[name="site-visibility"]'));
  const passwordFields = document.getElementById('private-password-fields');
  const password = document.getElementById('site-password');
  const passwordToggle = document.getElementById('toggle-password');
  const version = document.getElementById('release-version');
  const notes = document.getElementById('release-notes');
  const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
  const platforms = {
    windows: { extensions: ['exe', 'msi', 'zip'], label: 'Windows' },
    macos: { extensions: ['dmg', 'pkg', 'zip'], label: 'macOS' },
    android: { extensions: ['apk'], label: 'Android' }
  };
  const files = { windows: null, macos: null, android: null };
  const defaultUploadLimitBytes = 1610612736;
  let savedSettings = { visibility: 'public', hasPassword: false, version: '1.1.0', releaseNotes: '', uploadLimitBytes: defaultUploadLimitBytes };
  let accessDirty = false;
  let releaseDirty = false;
  let busy = false;
  let sessionEpoch = 0;
  let uploadController = null;
  let savedStorage = null;
  const uploaded = {};
  const savedInstallers = {};
  const platformVersions = {};
  const platformVersionDirty = {};
  const platformVersionButtons = {};
  Object.keys(platforms).forEach(function (platform) {
    platformVersions[platform] = document.getElementById('installer-version-' + platform);
    platformVersionButtons[platform] = document.getElementById('save-platform-version-' + platform);
    platformVersionButtons[platform].setAttribute('aria-label', 'Salvar versão do instalador ' + platforms[platform].label);
    platformVersionDirty[platform] = false;
  });
  const historyList = document.getElementById('release-history-list');
  const historyEmpty = document.getElementById('release-history-empty');
  const historyCount = document.getElementById('release-history-count');
  const historyDate = new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'});


  function toast(message, tone) {
    if (window.AdminUI) window.AdminUI.toast(message, tone || 'success');
  }

  function setPasswordVisibility(visible) {
    password.type = visible ? 'text' : 'password';
    passwordToggle.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.querySelector('i').className = 'fa-solid ' + (visible ? 'fa-eye-slash' : 'fa-eye');
  }

  function selectedVisibility() {
    return radios.find(function (radio) { return radio.checked; }).value;
  }

  function updateVisibility() {
    const isPrivate = selectedVisibility() === 'private';
    radios.forEach(function (radio) {
      radio.closest('.visibility-option').classList.toggle('is-selected', radio.checked);
    });
    passwordFields.hidden = !isPrivate;
    password.required = isPrivate && !savedSettings.hasPassword;
    password.disabled = !isPrivate;
    password.setCustomValidity('');
    if (!isPrivate) {
      password.value = '';
    }
    setPasswordVisibility(false);
  }

  function renderAccessPreview() {
    const isPrivate = savedSettings.visibility === 'private';
    document.getElementById('access-preview-status').classList.toggle('is-private', isPrivate);
    document.getElementById('access-preview-status').dataset.visibility = savedSettings.visibility;
    document.getElementById('access-preview-status').textContent = isPrivate ? 'Downloads com senha' : 'Downloads liberados';
    document.getElementById('access-preview-icon').className = 'fa-solid ' + (isPrivate ? 'fa-lock' : 'fa-globe');
    document.getElementById('access-preview-description').textContent = isPrivate
      ? 'Cada download exige a senha configurada e recebe um link temporário.'
      : 'Qualquer visitante pode baixar os instaladores disponíveis diretamente pelo site.';
  }

  radios.forEach(function (radio) { radio.addEventListener('change', updateVisibility); });
  passwordToggle.addEventListener('click', function () { setPasswordVisibility(password.type === 'password'); });
  password.addEventListener('input', function () { password.setCustomValidity(''); });
  accessForm.addEventListener('input', function () { accessDirty = true; });
  accessForm.addEventListener('change', function () { accessDirty = true; });
  releaseForm.addEventListener('input', function (event) {
    if (event.target === version || event.target === notes || event.target === releaseForm) releaseDirty = true;
  });
  function setBusy(form, value) {
    form.querySelectorAll('input,textarea,button').forEach(function (field) { field.disabled = value; });
    if (!value) updateVisibility();
    updatePlatformButtons();
  }
  accessForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    const isPrivate = selectedVisibility() === 'private';
    if (isPrivate && ((!savedSettings.hasPassword && !password.value) || (password.value && (password.value.length < 8 || !password.value.trim())))) {
      password.setCustomValidity('Use uma senha com pelo menos 8 caracteres.');
    }
    if (!accessForm.reportValidity()) return;
    const payload = {visibility:isPrivate ? 'private' : 'public',password:isPrivate ? password.value : ''};
    const epoch = sessionEpoch;
    busy = true;
    setBusy(accessForm, true);
    try {
      const settings = await window.InvoxBackend.saveAccess(payload);
      if (epoch !== sessionEpoch) return;
      savedSettings = Object.assign({}, savedSettings, settings);
      password.value = '';
      accessDirty = false;
      renderAccessPreview();
      toast('Acesso atualizado no site.');
    } catch (error) {
      if (epoch === sessionEpoch) toast(error.message || 'Não foi possível salvar o acesso.', 'error');
    } finally {
      payload.password = '';
      if (epoch === sessionEpoch) {
        busy = false;
        setBusy(accessForm, false);
      }
    }
  });

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return size.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' ' + units[unit];
  }

  function fileMetadata(file) {
    return file ? { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified } : null;
  }
  function updatePlatformButtons() {
    Object.keys(platforms).forEach(function (platform) {
      const current = savedInstallers[platform];
      const candidate = platformVersions[platform].value.trim();
      const button = platformVersionButtons[platform];
      button.hidden = !current;
      button.disabled = busy || !current || Boolean(files[platform]) || !versionPattern.test(candidate) || candidate === current.version;
      button.title = files[platform] ? 'A versão selecionada será publicada com o novo arquivo.' : 'Alterar a versão publicada sem reenviar o arquivo';
    });
  }
  async function savePlatformVersion(platform) {
    if (busy || !savedInstallers[platform] || files[platform]) return;
    const input = platformVersions[platform];
    const candidate = input.value.trim();
    input.setCustomValidity(versionPattern.test(candidate) ? '' : 'Use uma versão válida, como 1.1.0.');
    if (!versionPattern.test(candidate)) { input.reportValidity?.(); return; }
    if (candidate === savedInstallers[platform].version) return;
    const epoch = sessionEpoch;
    busy = true;
    setBusy(releaseForm, true);
    platformVersionButtons[platform].setAttribute('aria-busy', 'true');
    try {
      const state = await window.InvoxBackend.updateInstallerVersion(platform, candidate);
      if (epoch !== sessionEpoch) return;
      platformVersionDirty[platform] = false;
      loadState(state);
      toast('Versão do instalador ' + platforms[platform].label + ' atualizada.');
    } catch (error) {
      if (epoch === sessionEpoch) toast(error.message || 'Não foi possível atualizar a versão.', 'error');
    } finally {
      if (epoch === sessionEpoch) {
        busy = false;
        platformVersionButtons[platform].setAttribute('aria-busy', 'false');
        setBusy(releaseForm, false);
      }
    }
  }

  function fileElements(platform) {
    return {
      input: document.getElementById('installer-' + platform),
      selected: releaseForm.querySelector('.selected-file[data-platform="' + platform + '"]'),
      error: releaseForm.querySelector('.file-error[data-platform="' + platform + '"]'),
      dropzone: releaseForm.querySelector('.dropzone[data-platform="' + platform + '"]')
    };
  }

  function renderFile(platform) {
    const elements = fileElements(platform);
    const file = files[platform];
    elements.selected.hidden = !file;
    elements.selected.querySelector('.file-name').textContent = file ? file.name : '';
    elements.selected.querySelector('.file-size').textContent = file ? formatBytes(file.size) + ' · selecionado' : '';
    elements.dropzone.querySelector('.dropzone-title').textContent = file ? 'Trocar instalador' : 'Selecionar instalador';
    updatePlatformButtons();
  }

  function selectFile(platform, selection) {
    if (busy) return;
    const elements = fileElements(platform);
    elements.error.textContent = '';
    if (!selection || !selection.length) return;
    if (selection.length !== 1) {
      elements.error.textContent = 'Selecione apenas um arquivo para ' + platforms[platform].label + '.';
      return;
    }
    const file = selection[0];
    const extension = file.name.split('.').pop().toLowerCase();
    if (!platforms[platform].extensions.includes(extension)) {
      elements.error.textContent = 'Formato inválido. Use ' + platforms[platform].extensions.map(function (ext) { return ext.toUpperCase(); }).join(', ') + '.';
      return;
    }
    if (file.size <= 0 || file.size > savedSettings.uploadLimitBytes) {
      elements.error.textContent = 'Use um arquivo entre 1 B e ' + formatBytes(savedSettings.uploadLimitBytes) + '.';
      return;
    }
    files[platform] = file;
    if (!platformVersions[platform].value.trim()) platformVersions[platform].value = version.value.trim() || savedSettings.version;
    delete uploaded[platform];
    elements.input.value = '';
    renderFile(platform);
  }

  Object.keys(platforms).forEach(function (platform) {
    const elements = fileElements(platform);
    platformVersions[platform].addEventListener('input', function () {
      platformVersionDirty[platform] = true;
      platformVersions[platform].setCustomValidity('');
      updatePlatformButtons();
    });
    platformVersionButtons[platform].addEventListener('click', function () { return savePlatformVersion(platform); });
    elements.input.addEventListener('change', function () {
      selectFile(platform, elements.input.files);
      elements.input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (eventName) {
      elements.dropzone.addEventListener(eventName, function (event) {
        event.preventDefault();
        elements.dropzone.classList.add('is-dragging');
      });
    });
    elements.dropzone.addEventListener('dragleave', function (event) {
      if (!elements.dropzone.contains(event.relatedTarget)) elements.dropzone.classList.remove('is-dragging');
    });
    elements.dropzone.addEventListener('drop', function (event) {
      event.preventDefault();
      elements.dropzone.classList.remove('is-dragging');
      selectFile(platform, event.dataTransfer && event.dataTransfer.files);
    });
    releaseForm.querySelector('.remove-file[data-platform="' + platform + '"]').addEventListener('click', function () {
      if (busy) return;
      files[platform] = null;
      platformVersions[platform].setCustomValidity('');
      if (!platformVersionDirty[platform]) platformVersions[platform].value = savedInstallers[platform]?.version || '';
      delete uploaded[platform];
      elements.input.value = '';
      elements.error.textContent = '';
      renderFile(platform);
      toast('Instalador ' + platforms[platform].label + ' removido da seleção.');
    });
  });

  version.addEventListener('input', function () {
    version.setCustomValidity('');
    Object.keys(platforms).forEach(function (platform) {
      if (!savedInstallers[platform] && !platformVersionDirty[platform]) {
        platformVersions[platform].placeholder = 'Ex.: ' + version.value;
        if (files[platform]) platformVersions[platform].value = version.value;
      }
    });
    updatePlatformButtons();
  });
  releaseForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    version.value = version.value.trim();
    version.setCustomValidity(versionPattern.test(version.value) ? '' : 'Use uma versão válida, como 1.1.0 ou 1.1.0-beta.1.');
    const selected = Object.keys(platforms).filter(function (platform) { return files[platform]; });
    const releaseVersion = version.value;
    const selectedVersions = {};
    Object.keys(platforms).forEach(function (platform) {
      const candidate = platformVersions[platform].value.trim() || releaseVersion;
      selectedVersions[platform] = candidate;
      platformVersions[platform].setCustomValidity(selected.includes(platform) && !versionPattern.test(candidate) ? 'Use uma versão válida para este instalador.' : '');
    });
    if (!releaseForm.reportValidity() || selected.some(function (platform) { return !versionPattern.test(selectedVersions[platform]); })) return;
    const releaseNotes = notes.value.trim();
    const epoch = sessionEpoch;
    const controller = new AbortController();
    uploadController = controller;
    const progressBox = document.getElementById('release-progress');
    const progress = document.getElementById('upload-progress');
    const status = document.getElementById('upload-status');
    busy = true;
    setBusy(releaseForm, true);
    progressBox.hidden = false;
    progress.removeAttribute('value');
    const results = [];
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const platform = selected[index];
        const file = files[platform];
        status.textContent = 'Enviando ' + platforms[platform].label + ' (' + (index + 1) + '/' + selected.length + ')…';
        if (!uploaded[platform] || uploaded[platform].file !== file) {
          const metadata = await window.InvoxBackend.uploadInstaller({platform:platform,file:file,version:selectedVersions[platform],uploadLimitBytes:savedSettings.uploadLimitBytes,objectUploadLimitBytes:savedSettings.objectUploadLimitBytes,signal:controller.signal,onStatus:function (message) {
            if (epoch === sessionEpoch) status.textContent = platforms[platform].label + ': ' + message;
          },onProgress:function (percent) {
            if (epoch !== sessionEpoch) return;
            if (Number.isFinite(percent)) progress.value = Math.max(0, Math.min(100, percent));
          }});
          if (epoch !== sessionEpoch) return;
          uploaded[platform] = {file:file,metadata:metadata};
        }
        results.push(Object.assign({}, uploaded[platform].metadata, {version:selectedVersions[platform]}));
        progress.removeAttribute('value');
      }
      status.textContent = 'Publicando versão…';
      const state = await window.InvoxBackend.saveRelease({version:releaseVersion,releaseNotes:releaseNotes,files:results});
      if (epoch !== sessionEpoch) return;
      Object.keys(platforms).forEach(function (platform) {
        files[platform] = null;
        delete uploaded[platform];
        if (selected.includes(platform)) platformVersionDirty[platform] = false;
        renderFile(platform);
      });
      releaseDirty = false;
      loadState(state);
      progress.value = 100;
      status.textContent = 'Versão ' + state.settings.version + ' publicada.';
      toast('Versão e instaladores publicados.');
    } catch (error) {
      if (epoch !== sessionEpoch) return;
      status.textContent = 'A publicação não foi concluída. Sua seleção foi preservada para tentar novamente.';
      toast(error.message || 'Não foi possível publicar a versão.', 'error');
    } finally {
      if (uploadController === controller) uploadController = null;
      if (epoch === sessionEpoch) {
        busy = false;
        setBusy(releaseForm, false);
      }
    }
  });

  function historyElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function renderHistory(items, signedOut = false) {
    historyList.replaceChildren();
    const rows = (Array.isArray(items) ? items : []).filter(function (row) { return row && Object.prototype.hasOwnProperty.call(platforms, row.platform); }).slice(0, 100);
    rows.sort(function (a, b) { return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0); });
    historyCount.textContent = rows.length + (rows.length === 1 ? ' registro' : ' registros');
    historyEmpty.hidden = rows.length > 0;
    historyEmpty.textContent = signedOut ? 'Entre no painel para consultar o histórico.' : 'Nenhum instalador publicado ainda.';
    const icons = {windows:'fa-windows',macos:'fa-apple',android:'fa-android'};
    rows.forEach(function (item) {
      const row = historyElement('article', 'history-entry');
      row.setAttribute('role', 'listitem');
      const icon = historyElement('i', 'fa-brands ' + icons[item.platform] + ' history-platform-icon');
      icon.setAttribute('aria-hidden', 'true');
      const copy = historyElement('div', 'history-entry-copy');
      const title = historyElement('div', 'history-entry-title');
      title.append(historyElement('strong', '', platforms[item.platform].label + ' · v' + item.version));
      if (item.isCurrent) title.append(historyElement('span', 'history-current', 'Atual'));
      const size = Number(item.size);
      copy.append(title, historyElement('p', 'history-file', String(item.fileName || 'Arquivo não informado') + (Number.isFinite(size) && size >= 0 ? ' · ' + formatBytes(size) : '')));
      const action = item.action === 'version_updated' ? 'Versão atualizada sem reenviar o arquivo' : 'Arquivo publicado';
      copy.append(historyElement('span', 'history-action', item.migrated ? 'Registro importado · ' + action : action));
      const date = historyElement('time', 'history-date');
      const timestamp = Date.parse(item.publishedAt);
      if (Number.isFinite(timestamp)) {
        date.dateTime = new Date(timestamp).toISOString();
        date.textContent = historyDate.format(new Date(timestamp)) + ' · Brasília';
      } else date.textContent = 'Data indisponível';
      row.append(icon, copy, date);
      historyList.append(row);
    });
  }
  function loadState(state) {
    savedSettings = Object.assign({}, savedSettings, state.settings);
    if (state.storage) savedStorage = Object.assign({}, state.storage);
    if (!accessDirty) {
      radios.forEach(function (radio) { radio.checked = radio.value === savedSettings.visibility; });
      password.value = '';
    }
    if (!releaseDirty) {
      version.value = savedSettings.version;
      notes.value = savedSettings.releaseNotes || '';
    }
    document.getElementById('summary-version').textContent = savedSettings.version;
    const uploadHelp = ['Limite por instalador: ' + formatBytes(savedSettings.uploadLimitBytes) + '.'];
    if (savedSettings.multipartPartSizeBytes) uploadHelp.push('Arquivos grandes são enviados em partes de ' + formatBytes(savedSettings.multipartPartSizeBytes) + ', com retomada.');
    if (savedStorage && Number.isFinite(savedStorage.availableBytes)) {
      uploadHelp.push('Espaço disponível para novos envios: ' + formatBytes(Math.max(0, savedStorage.availableBytes)) + '.');
      if (savedStorage.reservedBytes > 0) uploadHelp.push(formatBytes(savedStorage.reservedBytes) + ' reservados para envios em andamento.');
      uploadHelp.push('A versão anterior é preservada até concluir a publicação.');
    }
    document.getElementById('upload-limit').textContent = uploadHelp.join(' ');
    Object.keys(platforms).forEach(function (platform) {
      const card = fileElements(platform).dropzone.closest('.upload-card');
      let current = card.querySelector('.current-installer');
      if (!current) { current = document.createElement('p'); current.className = 'current-installer'; card.append(current); }
      const installer = (state.installers || []).find(function (row) { return row.platform === platform; });
      if (installer) savedInstallers[platform] = installer;
      else delete savedInstallers[platform];
      if (!platformVersionDirty[platform] && !files[platform]) platformVersions[platform].value = installer?.version || '';
      platformVersions[platform].placeholder = 'Ex.: ' + savedSettings.version;
      current.textContent = installer ? 'Publicado: ' + installer.fileName + ' · ' + formatBytes(installer.size) + ' · v' + installer.version : 'Nenhum instalador publicado.';
    });
    renderHistory(state.history);
    updatePlatformButtons();
    updateVisibility();
    renderAccessPreview();
  }
  function clear() {
    if (uploadController) uploadController.abort();
    uploadController = null;
    sessionEpoch += 1;
    busy = false;
    savedStorage = null;
    accessForm.reset();
    releaseForm.reset();
    savedSettings = {visibility:'public',hasPassword:false,version:'1.1.0',releaseNotes:'',uploadLimitBytes:defaultUploadLimitBytes};
    accessDirty = false;
    releaseDirty = false;
    password.value = '';
    version.setCustomValidity('');
    Object.keys(platforms).forEach(function (platform) {
      files[platform] = null;
      delete uploaded[platform];
      delete savedInstallers[platform];
      platformVersionDirty[platform] = false;
      platformVersions[platform].value = '';
      platformVersions[platform].setCustomValidity('');
      platformVersionButtons[platform].setAttribute('aria-busy', 'false');
      const elements = fileElements(platform);
      elements.input.value = '';
      elements.error.textContent = '';
      elements.dropzone.classList.remove('is-dragging');
      renderFile(platform);
    });
    document.querySelectorAll('.current-installer').forEach(function (element) { element.textContent = ''; });
    document.getElementById('release-progress').hidden = true;
    document.getElementById('upload-status').textContent = '';
    document.getElementById('upload-limit').textContent = 'Conferindo limite de envio…';
    renderHistory([], true);
    setBusy(accessForm, false);
    setBusy(releaseForm, false);
    updateVisibility();
  }
  window.AdminSettings = {clear:clear,getState:function () {
    return {settings:Object.assign({},savedSettings),accessDirty:accessDirty,releaseDirty:releaseDirty,selectedFiles:Object.fromEntries(Object.keys(platforms).map(function (platform) { return [platform,fileMetadata(files[platform])]; })),platformVersions:Object.fromEntries(Object.keys(platforms).map(function (platform) { return [platform,platformVersions[platform].value]; }))};
  }};
  document.addEventListener('invox:admin-state', function (event) { loadState(event.detail); });
  document.addEventListener('invox:admin-clear', clear);
  updateVisibility();
  renderAccessPreview();
  updatePlatformButtons();
  renderHistory([], true);
  if (window.AdminUI && window.AdminUI.lastState) loadState(window.AdminUI.lastState);
})();
