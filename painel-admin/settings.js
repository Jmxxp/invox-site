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
  let accessDraft = { visibility: 'public', hasPassword: false };
  let releaseDraft = { version: '1.0.0', notes: '', files: {} };

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
    password.required = isPrivate;
    password.disabled = !isPrivate;
    password.setCustomValidity('');
    if (!isPrivate) {
      password.value = '';
    }
    setPasswordVisibility(false);
  }

  function renderAccessPreview() {
    const isPrivate = accessDraft.visibility === 'private';
    document.getElementById('access-preview-status').classList.toggle('is-private', isPrivate);
    document.getElementById('access-preview-status').dataset.visibility = accessDraft.visibility;
    document.getElementById('access-preview-status').textContent = isPrivate ? 'Rascunho privado' : 'Rascunho público';
    document.getElementById('access-preview-icon').className = 'fa-solid ' + (isPrivate ? 'fa-lock' : 'fa-globe');
    document.getElementById('access-preview-description').textContent = isPrivate
      ? 'A configuração com senha está preparada nesta sessão. O acesso real ainda depende da integração do servidor.'
      : 'O site ficará disponível para qualquer visitante quando esta configuração for integrada.';
  }

  radios.forEach(function (radio) { radio.addEventListener('change', updateVisibility); });
  passwordToggle.addEventListener('click', function () { setPasswordVisibility(password.type === 'password'); });
  password.addEventListener('input', function () { password.setCustomValidity(''); });
  accessForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const isPrivate = selectedVisibility() === 'private';
    if (isPrivate && (password.value.length < 8 || !password.value.trim())) {
      password.setCustomValidity('Use uma senha com pelo menos 8 caracteres.');
    }
    if (!accessForm.reportValidity()) return;
    accessDraft = { visibility: isPrivate ? 'private' : 'public', hasPassword: isPrivate && Boolean(password.value) };
    renderAccessPreview();
    toast('Rascunho de acesso salvo nesta sessão. O site publicado não foi alterado.');
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
    files[platform] = file;
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
      files[platform] = null;
      elements.input.value = '';
      elements.error.textContent = '';
      renderFile(platform);
      toast('Instalador ' + platforms[platform].label + ' removido da seleção.');
    });
  });

  version.addEventListener('input', function () { version.setCustomValidity(''); });
  releaseForm.addEventListener('submit', function (event) {
    event.preventDefault();
    version.value = version.value.trim();
    version.setCustomValidity(versionPattern.test(version.value) ? '' : 'Use uma versão válida, como 1.0.0 ou 1.0.0-beta.1.');
    if (!releaseForm.reportValidity()) return;
    releaseDraft = { version: version.value, notes: notes.value.trim(), files: {} };
    Object.keys(platforms).forEach(function (platform) { releaseDraft.files[platform] = fileMetadata(files[platform]); });
    document.getElementById('summary-version').textContent = releaseDraft.version;
    toast('Rascunho da versão salvo nesta sessão. Nenhum arquivo foi enviado.');
  });

  window.AdminSettings = {
    resetDemo: function () {
      accessForm.reset();
      releaseForm.reset();
      password.value = '';
      version.value = '1.0.0';
      version.setCustomValidity('');
      accessDraft = { visibility: 'public', hasPassword: false };
      releaseDraft = { version: '1.0.0', notes: '', files: {} };
      Object.keys(platforms).forEach(function (platform) {
        files[platform] = null;
        fileElements(platform).error.textContent = '';
        fileElements(platform).dropzone.classList.remove('is-dragging');
        renderFile(platform);
      });
      document.getElementById('summary-version').textContent = '1.0.0';
      updateVisibility();
      renderAccessPreview();
    },
    getState: function () {
      return {
        access: Object.assign({}, accessDraft),
        release: JSON.parse(JSON.stringify(releaseDraft)),
        selectedFiles: Object.fromEntries(Object.keys(platforms).map(function (platform) { return [platform, fileMetadata(files[platform])]; }))
      };
    }
  };

  updateVisibility();
  renderAccessPreview();
})();
