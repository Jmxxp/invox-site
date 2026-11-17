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
  releaseForm.addEventListener('input', function () { releaseDirty = true; });
  function setBusy(form, value) {
    form.querySelectorAll('input,textarea,button').forEach(function (field) { field.disabled = value; });
    if (!value) updateVisibility();
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
    delete uploaded[platform];
    releaseDirty = true;
    elements.input.value = '';
    renderFile(platform);
  }

  Object.keys(platforms).forEach(function (platform) {
    const elements = fileElements(platform);
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
      delete uploaded[platform];
      releaseDirty = true;
      elements.input.value = '';
      elements.error.textContent = '';
      renderFile(platform);
      toast('Instalador ' + platforms[platform].label + ' removido da seleção.');
    });
  });

  version.addEventListener('input', function () { version.setCustomValidity(''); });
  releaseForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    version.value = version.value.trim();
    version.setCustomValidity(versionPattern.test(version.value) ? '' : 'Use uma versão válida, como 1.1.0 ou 1.1.0-beta.1.');
    if (!releaseForm.reportValidity()) return;
    const selected = Object.keys(platforms).filter(function (platform) { return files[platform]; });
    const releaseVersion = version.value;
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
        if (!uploaded[platform] || uploaded[platform].file !== file || uploaded[platform].version !== releaseVersion) {
          const metadata = await window.InvoxBackend.uploadInstaller({platform:platform,file:file,version:releaseVersion,uploadLimitBytes:savedSettings.uploadLimitBytes,objectUploadLimitBytes:savedSettings.objectUploadLimitBytes,signal:controller.signal,onStatus:function (message) {
            if (epoch === sessionEpoch) status.textContent = platforms[platform].label + ': ' + message;
          },onProgress:function (percent) {
            if (epoch !== sessionEpoch) return;
            if (Number.isFinite(percent)) progress.value = Math.max(0, Math.min(100, percent));
          }});
          if (epoch !== sessionEpoch) return;
          uploaded[platform] = {file:file,version:releaseVersion,metadata:metadata};
        }
        results.push(uploaded[platform].metadata);
        progress.removeAttribute('value');
      }
      status.textContent = 'Publicando versão…';
      const state = await window.InvoxBackend.saveRelease({version:releaseVersion,releaseNotes:releaseNotes,files:results});
      if (epoch !== sessionEpoch) return;
      Object.keys(platforms).forEach(function (platform) { files[platform] = null; delete uploaded[platform]; renderFile(platform); });
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
      current.textContent = installer ? 'Publicado: ' + installer.fileName + ' · ' + formatBytes(installer.size) + ' · v' + installer.version : 'Nenhum instalador publicado.';
    });
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
    setBusy(accessForm, false);
    setBusy(releaseForm, false);
    updateVisibility();
  }
  window.AdminSettings = {clear:clear,getState:function () {
    return {settings:Object.assign({},savedSettings),accessDirty:accessDirty,releaseDirty:releaseDirty,selectedFiles:Object.fromEntries(Object.keys(platforms).map(function (platform) { return [platform,fileMetadata(files[platform])]; }))};
  }};
  document.addEventListener('invox:admin-state', function (event) { loadState(event.detail); });
  document.addEventListener('invox:admin-clear', clear);
  updateVisibility();
  renderAccessPreview();
  if (window.AdminUI && window.AdminUI.lastState) loadState(window.AdminUI.lastState);
})();
