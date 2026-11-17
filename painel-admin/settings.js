(function () {
  'use strict';

  const accessForm = document.getElementById('access-form');
  const releaseForm = document.getElementById('release-form');
  if (!accessForm || !releaseForm) return;

  const radios = Array.from(accessForm.querySelectorAll('[name="site-visibility"]'));
  const passwordFields = document.getElementById('private-password-fields');
  const password = document.getElementById('site-password');
  const passwordToggle = document.getElementById('toggle-password');
  const universal = document.getElementById('universal-enabled');
  const universalSettings = document.getElementById('universal-key-settings');
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
  let savedSettings = { visibility: 'public', hasPassword: false, universalEnabled: true, version: '1.1.0', releaseNotes: '', uploadLimitBytes: defaultUploadLimitBytes };
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
  const codeForm = document.getElementById('download-code-form');
  const codeFields = {count:document.getElementById('download-code-quantity'),label:document.getElementById('download-code-label'),max:document.getElementById('download-code-max'),validity:document.getElementById('download-code-validity')};
  const copyCount = document.getElementById('download-code-copy-quantity');
  let downloadCodes = [], codeBusy = false, codesAuthenticated = false, codeAttempt = null;
  let secretCode = '', secretEntries = [], codeOperation = '';
  let codePool = null;
  const copiedCodeIds = new Set();


  function toast(message, tone) {
    if (window.AdminUI) window.AdminUI.toast(message, tone || 'success');
  }
  function codeStatus(text, tone) {
    const status = document.getElementById('download-code-status');
    status.textContent = text; status.dataset.tone = tone || '';
  }
  function codeState(row) {
    if (row.revokedAt || row.status === 'revoked') return 'revoked';
    if (row.status === 'expired') return 'expired';
    if (row.status === 'exhausted' || row.remainingUses <= 0) return 'exhausted';
    return row.status === 'active' ? 'active' : 'unavailable';
  }
  function validCode(row) {
    return row && typeof row.id === 'string' && /^[a-f0-9-]{36}$/i.test(row.id)
      && (row.label == null || typeof row.label === 'string') && Number.isInteger(row.maxUses) && row.maxUses >= 1 && row.maxUses <= 1000
      && Number.isInteger(row.usedCount) && row.usedCount >= 0 && Number.isInteger(row.remainingUses) && row.remainingUses >= 0 && row.remainingUses <= row.maxUses;
  }
  function mergeCodes(rows) {
    const merged = new Map(downloadCodes.map(function (row) { return [row.id,row]; }));
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!validCode(row)) return;
      const old = merged.get(row.id);
      const metadata = {id:row.id,label:row.label || '',maxUses:row.maxUses,usedCount:row.usedCount,remainingUses:row.remainingUses,createdAt:row.createdAt,expiresAt:row.expiresAt,revokedAt:row.revokedAt,status:row.status,prefix:row.prefix,codeFormat:row.codeFormat};
      merged.set(row.id,old ? Object.assign(metadata,{usedCount:Math.max(old.usedCount,row.usedCount),remainingUses:Math.min(old.remainingUses,row.remainingUses),revokedAt:old.revokedAt || row.revokedAt,status:old.status === 'expired' ? 'expired' : row.status}) : metadata);
      merged.get(row.id).status = codeState(merged.get(row.id));
    });
    downloadCodes = Array.from(merged.values()).sort(function (a,b) { return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0); });
  }
  function shortCode(value) { return typeof value === 'string' && /^[a-z0-9]{6}$/i.test(value); }
  function acceptPool(pool) {
    if (!pool || !['valid','used','inactive','legacy'].every(function (key) { return Array.isArray(pool[key]) && pool[key].every(validCode); })) throw new Error('Não foi possível confirmar a lista de tokens.');
    if (!['valid','used','inactive'].every(function (key) { return pool[key].every(function (row) { return shortCode(row.code); }); })) throw new Error('Não foi possível confirmar os identificadores dos tokens.');
    if (codePool && Date.parse(pool.evaluatedAt) < Date.parse(codePool.evaluatedAt)) return;
    const next = {valid:[],used:[],inactive:[],legacy:[],totals:pool.totals || {},evaluatedAt:pool.evaluatedAt};
    mergeCodes(['valid','used','inactive','legacy'].flatMap(function (key) { return pool[key]; }));
    const metadataById = new Map(downloadCodes.map(function (row) { return [row.id,row]; }));
    ['valid','used','inactive','legacy'].forEach(function (key) {
      pool[key].forEach(function (row) {
        const metadata = metadataById.get(row.id) || row;
        const category = row.codeFormat === 'legacy' || key === 'legacy' ? 'legacy' : metadata.usedCount > 0 ? 'used' : codeState(metadata) === 'active' && shortCode(row.code) && key === 'valid' ? 'valid' : 'inactive';
        next[category].push(category === 'legacy' ? Object.assign({},metadata) : Object.assign({},metadata,{code:shortCode(row.code) ? row.code : ''}));
      });
    });
    codePool = next;
  }
  async function refreshCodePool(epoch) {
    const pool = await window.InvoxBackend.downloadCodePool();
    if (epoch !== sessionEpoch) return false;
    acceptPool(pool); renderCodes(); return true;
  }
  function hideCode() {
    secretCode = ''; secretEntries = [];
    document.getElementById('download-code-secret').value = '';
    document.getElementById('download-code-result-label').textContent = '';
    document.getElementById('download-code-result').hidden = true;
  }
  function showCodes(entries,codes) {
    secretEntries = entries.map(function (entry,index) { return {id:entry.id,code:codes[index]}; });
    secretCode = codes.join('\n\n');
    document.getElementById('download-code-secret').value = secretCode;
    document.getElementById('download-code-result-label').textContent = entries.length + (entries.length === 1 ? ' token selecionado' : ' tokens selecionados');
    document.getElementById('download-code-result').hidden = !entries.length;
  }
  function codeControls() {
    Object.values(codeFields).forEach(function (field) { field.disabled = codeBusy || !codesAuthenticated; });
    document.getElementById('download-code-create').disabled = codeBusy || !codesAuthenticated;
    document.getElementById('download-code-create-label').textContent = codeOperation === 'create' ? 'GERANDO…' : 'GERAR TOKENS';
    copyCount.disabled = codeBusy || !codesAuthenticated;
    document.getElementById('download-code-copy').disabled = codeBusy || !codesAuthenticated || copiedCodeIds.size >= 500;
    document.getElementById('download-code-copy').setAttribute('aria-busy',String(codeOperation === 'copy'));
    document.getElementById('download-code-refresh').disabled = codeBusy || !codesAuthenticated;
    document.getElementById('download-code-restart').disabled = codeBusy || !codesAuthenticated || copiedCodeIds.size === 0;
    document.getElementById('download-code-copy-progress').textContent = copiedCodeIds.size + ' copiados nesta rodada. Copiar não consome downloads.' + (copiedCodeIds.size >= 500 ? ' Inicie uma nova rodada para continuar.' : '');
    document.getElementById('download-code-hide').disabled = !codesAuthenticated || !secretCode;
    codeForm.setAttribute('aria-busy',String(codeBusy));
  }
  function codeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function codeDate(value) {
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) ? historyDate.format(new Date(stamp)) + ' · Brasília' : 'Data não informada';
  }
  function renderCodes() {
    const groups = {valid:[],used:[],inactive:[],legacy:[]};
    if (codePool) ['valid','used','inactive','legacy'].forEach(function (key) {
      codePool[key].forEach(function (row) {
        const known = downloadCodes.find(function (item) { return item.id === row.id; });
        const current = known ? Object.assign({},row,known) : row;
        const category = key === 'legacy' ? 'legacy' : current.usedCount > 0 ? 'used' : key === 'valid' && codeState(current) === 'active' ? 'valid' : 'inactive';
        groups[category].push(current);
      });
    });
    else groups.legacy = downloadCodes.slice(0,100);
    const states = {active:'Disponível',exhausted:'Usado',expired:'Expirado',revoked:'Revogado',unavailable:'Indisponível'};
    ['valid','used','inactive','legacy'].forEach(function (key) {
      const suffix = key === 'valid' ? '' : '-' + key;
      const list = document.getElementById('download-code-list' + suffix);
      list.replaceChildren();
      const total = Math.max(groups[key].length,Number(codePool?.totals?.[key]) || 0);
      document.getElementById('download-code-count' + suffix).textContent = (total > groups[key].length ? groups[key].length + ' de ' : '') + total + (total === 1 ? ' token' : ' tokens');
      const empty = document.getElementById('download-code-empty' + suffix);
      empty.hidden = groups[key].length > 0;
      empty.textContent = codesAuthenticated ? key === 'valid' ? 'Nenhum token disponível. Gere novos tokens ou atualize a lista.' : key === 'used' ? 'Nenhum token usado.' : key === 'legacy' ? 'Nenhum token de versões anteriores.' : 'Nenhum token expirado ou revogado.' : 'Entre no painel para consultar os tokens.';
      groups[key].forEach(function (row) {
      const status = codeState(row), card = codeElement('article','download-code-entry');
      card.setAttribute('role','listitem');
      const content = codeElement('div');
      if (key !== 'legacy' && shortCode(row.code)) content.append(codeElement('strong','download-token-value',row.code));
      content.append(codeElement('h5','',row.label || (key === 'valid' ? 'Token de download' : 'Sem identificação')));
      if (key === 'legacy') content.append(codeElement('span','download-code-mask',row.prefix ? String(row.prefix) + ' ••••' : 'Código protegido'));
      const usage = codeElement('p','download-code-usage');
      usage.append(codeElement('strong','',row.remainingUses + ' / ' + row.maxUses),codeElement('span','',row.remainingUses === 1 ? 'download restante' : 'downloads restantes'));
      const meta = codeElement('div','download-code-meta');
      meta.append(codeElement('span','','Criado em ' + codeDate(row.createdAt)),codeElement('span','',row.expiresAt ? 'Expira em ' + codeDate(row.expiresAt) : 'Sem expiração'));
      content.append(usage,meta);
      const controls = codeElement('div','download-code-entry-controls'), badge = codeElement('span','download-code-state',key === 'used' ? 'USADO' : key === 'legacy' ? 'Formato anterior' : states[status]);
      badge.dataset.state = status; controls.append(badge);
      if (copiedCodeIds.has(row.id)) controls.append(codeElement('span','download-code-copied','Copiado nesta rodada'));
      if (status === 'active') {
        const revoke = codeElement('button','button button-ghost button-small','Revogar');
        revoke.type = 'button'; revoke.dataset.revokeCode = row.id;
        revoke.setAttribute('aria-label','Revogar código ' + (row.label || row.prefix || 'sem identificação'));
        revoke.disabled = codeBusy || !codesAuthenticated;
        revoke.addEventListener('click',function () { return revokeCode(row.id); });
        controls.append(revoke);
      }
      card.append(content,controls); list.append(card);
      });
    });
    if (secretEntries.some(function (entry) { const row = downloadCodes.find(function (item) { return item.id === entry.id; }); return row && (row.usedCount > 0 || codeState(row) !== 'active'); })) hideCode();
    codeControls();
  }
  function codeParameters() {
    const count = Number(codeFields.count.value), label = codeFields.label.value.trim(), maxUses = Number(codeFields.max.value);
    const expiry = codeFields.validity.value, validForHours = expiry === '' ? null : Number(expiry);
    codeFields.count.setCustomValidity(Number.isInteger(count) && count >= 1 && count <= 100 ? '' : 'Escolha de 1 a 100 tokens.');
    codeFields.label.setCustomValidity(label.length <= 80 ? '' : 'Use uma identificação de até 80 caracteres.');
    codeFields.max.setCustomValidity(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000 ? '' : 'Escolha de 1 a 1000 downloads.');
    codeFields.validity.setCustomValidity(validForHours === null || [24,168,720].includes(validForHours) ? '' : 'Selecione uma validade disponível.');
    const options = codeForm.querySelector('.download-code-options');
    if (options && [codeFields.label,codeFields.max,codeFields.validity].some(function (field) { return field.validationMessage; })) options.open = true;
    const browserValid = codeForm.reportValidity();
    return browserValid && Number.isInteger(count) && count >= 1 && count <= 100 && label.length <= 80 && Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000 && (validForHours === null || [24,168,720].includes(validForHours)) ? {count:count,label:label,maxUses:maxUses,validForHours:validForHours} : null;
  }
  async function createCode(event) {
    event.preventDefault();
    if (codeBusy || !codesAuthenticated) return;
    const params = codeParameters(); if (!params) return;
    const fingerprint = JSON.stringify(params), epoch = sessionEpoch;
    try {
      if (!codeAttempt || codeAttempt.fingerprint !== fingerprint) {
        const cryptography = window.crypto || globalThis.crypto;
        if (typeof cryptography?.randomUUID !== 'function') throw new Error('Use um navegador atualizado para gerar tokens.');
        codeAttempt = {id:cryptography.randomUUID(),fingerprint:fingerprint};
      }
      const attempt = codeAttempt;
      hideCode(); codeBusy = true; codeOperation = 'create'; renderCodes(); codeStatus('Gerando tokens…');
      const result = await window.InvoxBackend.createDownloadCodes(Object.assign({id:attempt.id},params));
      if (epoch !== sessionEpoch) return;
      if (!result || !Array.isArray(result.codes) || result.codes.length !== params.count
        || !result.codes.every(shortCode)
        || new Set(result.codes).size !== params.count || !Array.isArray(result.entries) || result.entries.length !== params.count
        || !result.entries.every(function (entry) { return validCode(entry) && entry.maxUses === params.maxUses; })
        || new Set(result.entries.map(function (entry) { return entry.id; })).size !== params.count || !Array.isArray(result.downloadCodes)) throw new Error('Não foi possível confirmar os tokens criados. Tente novamente com os mesmos campos.');
      mergeCodes(result.downloadCodes); mergeCodes(result.entries);
      codeAttempt = null;
      const eligible = result.entries.map(function (row,index) { return {row:row,code:result.codes[index]}; }).filter(function (item) { return item.row.usedCount === 0 && codeState(item.row) === 'active'; });
      showCodes(eligible.map(function (item) { return item.row; }),eligible.map(function (item) { return item.code; }));
      codeStatus('Tokens de 6 caracteres gerados. Escolha quantos copiar abaixo.','success');
      try { await refreshCodePool(epoch); } catch { if (epoch === sessionEpoch) codeStatus('Tokens gerados. Atualize a lista para confirmar os disponíveis.'); }
      renderCodes();
    } catch (error) {
      if (epoch === sessionEpoch) codeStatus(error.message || 'Não foi possível confirmar a criação. Tente novamente sem alterar os campos.','error');
    } finally {
      if (epoch === sessionEpoch) { codeBusy = false; codeOperation = ''; renderCodes(); }
    }
  }
  async function revokeCode(id) {
    if (codeBusy || !codesAuthenticated) return;
    const item = downloadCodes.find(function (row) { return row.id === id; });
    if (!item || codeState(item) !== 'active') return;
    const epoch = sessionEpoch;
    codeBusy = true; codeOperation = 'revoke'; renderCodes(); codeStatus('Revogando código…');
    try {
      const result = await window.InvoxBackend.revokeDownloadCode(id);
      if (epoch !== sessionEpoch) return;
      const confirmed = Array.isArray(result?.downloadCodes) && result.downloadCodes.find(function (row) { return row.id === id && (row.revokedAt || row.status === 'revoked'); });
      if (!confirmed) throw new Error('O servidor não confirmou a revogação. Atualize a lista e tente novamente.');
      mergeCodes(result.downloadCodes);
      codeStatus('Código revogado. Ele não libera novos downloads.','success');
      try { await refreshCodePool(epoch); } catch { if (epoch === sessionEpoch) codeStatus('Token revogado. Atualize a lista para conferir o histórico.'); }
    } catch (error) {
      if (epoch === sessionEpoch) codeStatus(error.message || 'Não foi possível revogar o código.','error');
    } finally {
      if (epoch === sessionEpoch) { codeBusy = false; codeOperation = ''; renderCodes(); }
    }
  }
  async function copyCode() {
    if (codeBusy || !codesAuthenticated) return;
    const requested = Number(copyCount.value), epoch = sessionEpoch;
    copyCount.setCustomValidity(Number.isInteger(requested) && requested >= 1 && requested <= 100 ? '' : 'Escolha de 1 a 100 tokens por cópia.');
    if (!Number.isInteger(requested) || requested < 1 || requested > 100) { copyCount.reportValidity?.(); return; }
    if (copiedCodeIds.size >= 500) { codeStatus('O limite desta rodada foi atingido. Inicie uma nova rodada de cópia para continuar.'); return; }
    codeBusy = true; codeOperation = 'copy'; renderCodes(); codeStatus('Conferindo os próximos tokens disponíveis…');
    try {
      const count = Math.min(requested,500 - copiedCodeIds.size);
      const result = await window.InvoxBackend.selectDownloadCodes({count:count,excludeIds:Array.from(copiedCodeIds)});
      if (epoch !== sessionEpoch) return;
      if (!result || !Array.isArray(result.codes) || result.codes.length > count || !result.codes.every(shortCode)
        || new Set(result.codes).size !== result.codes.length || !Array.isArray(result.entries) || result.entries.length !== result.codes.length
        || !result.entries.every(function (row) { return validCode(row) && row.codeFormat === 'short' && row.usedCount === 0 && codeState(row) === 'active' && !copiedCodeIds.has(row.id); })
        || new Set(result.entries.map(function (row) { return row.id; })).size !== result.entries.length) throw new Error('Não foi possível confirmar os tokens disponíveis. Tente novamente.');
      mergeCodes(result.entries);
      const selected = result.entries.map(function (row,index) { return {entry:row,code:result.codes[index],latest:downloadCodes.find(function (item) { return item.id === row.id; })}; }).filter(function (item) { return item.latest && item.latest.usedCount === 0 && codeState(item.latest) === 'active' && item.latest.codeFormat === 'short'; });
      if (!selected.length) { hideCode(); codeStatus('Não há próximos tokens disponíveis nesta rodada. Gere novos tokens ou inicie uma nova rodada de cópia.'); return; }
      showCodes(selected.map(function (item) { return item.entry; }),selected.map(function (item) { return item.code; }));
      try {
        if (typeof window.navigator?.clipboard?.writeText !== 'function') throw new Error('clipboard unavailable');
        await window.navigator.clipboard.writeText(selected.map(function (item) { return item.code; }).join('\n\n'));
      }
      catch { if (epoch === sessionEpoch) { codeStatus('A cópia automática não foi confirmada. Tente copiar novamente ou selecione o texto e copie manualmente; o grupo não avançou.','error'); const input = document.getElementById('download-code-secret'); input.focus(); input.select?.(); } return; }
      if (epoch !== sessionEpoch) return;
      selected.forEach(function (item) { copiedCodeIds.add(item.entry.id); });
      codeStatus(selected.length + (selected.length === 1 ? ' token copiado.' : ' tokens copiados.') + (selected.length < requested ? ' Este é o grupo restante disponível.' : '') + (copiedCodeIds.size >= 500 ? ' Inicie uma nova rodada de cópia para continuar.' : ''),'success');
    } catch (error) {
      if (epoch === sessionEpoch) codeStatus(error.message || 'Não foi possível conferir os tokens. Tente novamente.','error');
    } finally {
      if (epoch === sessionEpoch) { try { await refreshCodePool(epoch); } catch { /* A seleção já foi conferida; mantenha o resultado da cópia. */ } }
      if (epoch === sessionEpoch) { codeBusy = false; codeOperation = ''; renderCodes(); }
    }
  }
  async function reloadCodes() {
    if (codeBusy || !codesAuthenticated) return;
    const epoch = sessionEpoch; codeBusy = true; codeOperation = 'refresh'; codeControls(); codeStatus('Atualizando tokens…');
    try { if (await refreshCodePool(epoch)) codeStatus('Lista de tokens atualizada.','success'); }
    catch (error) { if (epoch === sessionEpoch) codeStatus(error.message || 'Não foi possível atualizar os tokens.','error'); }
    finally { if (epoch === sessionEpoch) { codeBusy = false; codeOperation = ''; renderCodes(); } }
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
    const useUniversal = universal.checked;
    radios.forEach(function (radio) {
      radio.closest('.visibility-option').classList.toggle('is-selected', radio.checked);
    });
    universalSettings.hidden = !isPrivate;
    passwordFields.hidden = !isPrivate || !useUniversal;
    password.required = isPrivate && useUniversal && !savedSettings.hasPassword;
    password.disabled = !isPrivate || !useUniversal || busy;
    passwordToggle.disabled = password.disabled;
    password.setCustomValidity('');
    if (!isPrivate || !useUniversal) {
      password.value = '';
    }
    setPasswordVisibility(false);
  }

  function renderAccessPreview() {
    const isPrivate = savedSettings.visibility === 'private';
    document.getElementById('access-preview-status').classList.toggle('is-private', isPrivate);
    document.getElementById('access-preview-status').dataset.visibility = savedSettings.visibility;
    document.getElementById('access-preview-status').textContent = isPrivate ? (savedSettings.universalEnabled !== false ? 'Chave e códigos de acesso' : 'Downloads por código') : 'Downloads liberados';
    document.getElementById('access-preview-icon').className = 'fa-solid ' + (isPrivate ? 'fa-lock' : 'fa-globe');
    document.getElementById('access-preview-description').textContent = isPrivate
      ? (savedSettings.universalEnabled !== false ? 'Use a chave universal ou um código válido para liberar um download protegido.' : 'A chave universal está desativada. O acesso exige um código válido com downloads disponíveis.')
      : 'Qualquer visitante pode baixar os instaladores disponíveis diretamente pelo site.';
  }

  radios.forEach(function (radio) { radio.addEventListener('change', updateVisibility); });
  universal.addEventListener('change', function () { accessDirty = true; updateVisibility(); });
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
    if (isPrivate && universal.checked && ((!savedSettings.hasPassword && !password.value) || (password.value && (password.value.length < 8 || !password.value.trim())))) {
      password.setCustomValidity('Use uma senha com pelo menos 8 caracteres.');
    }
    if (!accessForm.reportValidity()) return;
    const payload = {visibility:isPrivate ? 'private' : 'public',password:isPrivate && universal.checked ? password.value : '',universalEnabled:universal.checked};
    const epoch = sessionEpoch;
    busy = true;
    setBusy(accessForm, true);
    try {
      const settings = await window.InvoxBackend.saveAccess(payload);
      if (epoch !== sessionEpoch) return;
      savedSettings = Object.assign({}, savedSettings, settings);
      universal.checked = savedSettings.universalEnabled !== false;
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
      universal.checked = savedSettings.universalEnabled !== false;
      password.value = '';
    }
    codesAuthenticated = true;
    mergeCodes(state.downloadCodes);
    if (state.codePool) { try { acceptPool(state.codePool); } catch (error) { codeStatus(error.message,'error'); } }
    renderCodes();
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
    savedSettings = {visibility:'public',hasPassword:false,universalEnabled:true,version:'1.1.0',releaseNotes:'',uploadLimitBytes:defaultUploadLimitBytes};
    universal.checked = true;
    codesAuthenticated = false; codeBusy = false; codeOperation = ''; codeAttempt = null; downloadCodes = []; codePool = null; copiedCodeIds.clear();
    copyCount.value = '1'; copyCount.setCustomValidity('');
    hideCode(); codeForm.reset(); codeFields.count.value = '1'; codeFields.label.value = ''; codeFields.max.value = '1'; codeFields.validity.value = '';
    Object.values(codeFields).forEach(function (field) { field.setCustomValidity(''); });
    codeStatus(''); renderCodes();
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
    return {settings:Object.assign({},savedSettings),accessDirty:accessDirty,releaseDirty:releaseDirty,selectedFiles:Object.fromEntries(Object.keys(platforms).map(function (platform) { return [platform,fileMetadata(files[platform])]; })),platformVersions:Object.fromEntries(Object.keys(platforms).map(function (platform) { return [platform,platformVersions[platform].value]; })),downloadCodes:downloadCodes.map(function (row) { return Object.assign({},row); }),codeBusy:codeBusy};
  }};
  document.addEventListener('invox:admin-state', function (event) { loadState(event.detail); });
  document.addEventListener('invox:admin-clear', clear);
  codeForm.addEventListener('submit',createCode);
  Object.values(codeFields).forEach(function (field) {
    const changed = function () { if (codeBusy) return; field.setCustomValidity(''); if (!secretCode) codeStatus(''); };
    field.addEventListener('input',changed); field.addEventListener('change',changed);
  });
  document.getElementById('download-code-copy').addEventListener('click',copyCode);
  document.getElementById('download-code-refresh').addEventListener('click',reloadCodes);
  document.getElementById('download-code-restart').addEventListener('click',function () {
    if (codeBusy || !codesAuthenticated) return;
    copiedCodeIds.clear(); hideCode(); codeStatus('Nova rodada iniciada. Tokens disponíveis poderão ser copiados novamente.'); renderCodes();
  });
  copyCount.addEventListener('input',function () { copyCount.setCustomValidity(''); });
  document.getElementById('download-code-hide').addEventListener('click',function () { hideCode(); codeStatus('Seleção ocultada. Os tokens continuam disponíveis nas listas.'); codeControls(); });
  updateVisibility();
  renderAccessPreview();
  updatePlatformButtons();
  renderHistory([], true);
  renderCodes();
  if (window.AdminUI && window.AdminUI.lastState) loadState(window.AdminUI.lastState);
})();
