(function () {
  'use strict';
  var panel = document.getElementById('panel-feedback');
  if (!panel) return;
  var list = document.getElementById('feedback-list');
  var detail = document.getElementById('feedback-detail');
  var search = document.getElementById('feedback-search');
  var filters = Array.from(panel.querySelectorAll('[data-filter]'));
  var state = { items: [], filter: 'all', query: '', selectedId: null };
  var shortDate = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });
  var fullDate = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
  });
  var drafts = new Map();
  var busyId = null;
  function el(tag, className, content) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function icon(name) {
    var element = el('i', 'fa-solid ' + name);
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
  function normalize(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }
  function filteredItems() {
    var query = normalize(state.query.trim());
    return state.items.filter(function (item) {
      return (state.filter === 'all' || item.status === state.filter) &&
        (!query || normalize(item.name + ' ' + item.contact + ' ' + item.message).includes(query));
    }).sort(function (a, b) {
      return Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
    });
  }
  function statusPill(status) {
    var badge = el('span', 'status-pill ' + status);
    badge.append(icon(status === 'new' ? 'fa-circle' : 'fa-check'),
      document.createTextNode(status === 'new' ? 'Novo' : 'Respondido'));
    return badge;
  }
  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }
  function updateCounts() {
    var newCount = state.items.filter(function (item) { return item.status === 'new'; }).length;
    var answeredCount = state.items.length - newCount;
    setText('sidebar-new-count', newCount);
    setText('stat-new', newCount);
    setText('stat-answered', answeredCount);
    setText('filter-all-count', state.items.length);
    setText('filter-new-count', newCount);
    setText('filter-answered-count', answeredCount);
    filters.forEach(function (button) {
      var active = button.dataset.filter === state.filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function emptyState(className, title, message, iconName) {
    var box = el('div', className);
    var symbol = el('span', 'empty-icon');
    symbol.append(icon(iconName));
    box.append(symbol, el('h3', '', title), el('p', '', message));
    return box;
  }
  function renderList(items) {
    list.replaceChildren();
    if (!items.length) {
      list.append(emptyState('feedback-empty', state.items.length ? 'Nenhum feedback encontrado' : 'Sua comunidade começa aqui',
        state.items.length ? 'Tente outra busca ou selecione um filtro diferente.' : 'Os feedbacks enviados pelo site aparecerão nesta área.', 'fa-magnifying-glass'));
      return;
    }
    items.forEach(function (item) {
      var selected = item.id === state.selectedId;
      var button = el('button', 'feedback-item' + (selected ? ' is-selected' : ''));
      button.type = 'button';
      button.dataset.feedbackId = item.id;
      if (selected) button.setAttribute('aria-current', 'true');
      var top = el('div', 'feedback-item-top');
      var time = el('time', 'feedback-time', shortDate.format(new Date(item.receivedAt)));
      time.dateTime = item.receivedAt;
      top.append(el('strong', 'feedback-name', item.name), time);
      var preview = item.message.replace(/\s+/g, ' ');
      if (preview.length > 112) preview = preview.slice(0, 109) + '…';
      var bottom = el('div', 'feedback-item-bottom');
      bottom.append(statusPill(item.status));
      if (item.note.trim()) {
        var indicator = el('span', 'feedback-note-indicator');
        indicator.append(icon('fa-note-sticky'), document.createTextNode('Anotação'));
        bottom.append(indicator);
      }
      button.append(top, el('p', 'feedback-preview', preview), bottom);
      button.addEventListener('click', function () {
        state.selectedId = item.id;
        render();
      });
      list.append(button);
    });
  }
  function renderDetail(item) {
    detail.replaceChildren();
    if (!item) {
      detail.append(emptyState('detail-empty', 'Nenhum feedback selecionado',
        'As mensagens que correspondem à sua busca aparecerão aqui.', 'fa-message'));
      return;
    }
    var header = el('div', 'feedback-detail-header');
    var topline = el('div', 'feedback-detail-topline');
    topline.append(statusPill(item.status), el('span', 'feedback-reference', 'Feedback recebido'));
    var contact = el('p', 'feedback-contact');
    contact.append(icon('fa-at'), document.createTextNode(item.contact));
    var date = el('time', 'feedback-date', 'Recebido em ' + fullDate.format(new Date(item.receivedAt)) + ' · Brasília');
    date.dateTime = item.receivedAt;
    header.append(topline, el('h3', 'feedback-detail-name', item.name), contact, date);
    var message = el('div', 'feedback-message', item.message);
    var noteBlock = el('div', 'feedback-note-block');
    var noteLabel = el('label', 'field-label', 'Anotação de resposta');
    noteLabel.htmlFor = 'reply-note';
    var note = el('textarea');
    note.id = 'reply-note';
    note.rows = 4;
    note.maxLength = 5000;
    note.placeholder = 'Registre uma resposta ou observação interna...';
    note.value = drafts.has(item.id) ? drafts.get(item.id) : item.note;
    note.disabled = Boolean(busyId);
    note.setAttribute('aria-describedby', 'reply-note-help feedback-send-note');
    var noteHelp = el('p', 'field-help note-status', 'Salve a anotação para mantê-la no painel.');
    noteHelp.id = 'reply-note-help';
    note.addEventListener('input', function () {
      drafts.set(item.id, note.value);
      noteHelp.textContent = 'Alterações não salvas.';
      renderList(filteredItems());
    });
    noteBlock.append(noteLabel, note, noteHelp);
    detail.append(header, message, noteBlock);
    appendActions(item);
  }
  function appendActions(item) {
    var actions = el('div', 'feedback-actions');
    var isNew = item.status === 'new';
    var action = el('button', 'button ' + (isNew ? 'button-primary' : 'button-ghost'));
    action.type = 'button';
    action.dataset.action = isNew ? 'mark-answered' : 'mark-new';
    action.append(icon(isNew ? 'fa-check' : 'fa-rotate-left'),
      document.createTextNode(isNew ? 'Marcar como respondido' : 'Marcar como novo'));
    action.disabled = Boolean(busyId);
    action.addEventListener('click', function () { saveItem(item, isNew ? 'answered' : 'new'); });
    var save = el('button', 'button button-ghost');
    save.type = 'button';
    save.dataset.action = 'save-note';
    save.disabled = Boolean(busyId);
    save.append(icon('fa-floppy-disk'), document.createTextNode('Salvar anotação'));
    save.addEventListener('click', function () { saveItem(item, item.status); });
    actions.append(action, save);
    var notice = el('p', 'feedback-local-notice');
    notice.id = 'feedback-send-note';
    notice.append(icon('fa-circle-info'),
      document.createTextNode('Classificar como respondido não envia uma mensagem.'));
    detail.append(actions, notice);
  }
  async function saveItem(item, status) {
    if (busyId) return;
    busyId = item.id;
    var note = drafts.has(item.id) ? drafts.get(item.id) : item.note;
    detail.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
    try {
      var saved = await window.InvoxBackend.updateFeedback({id:item.id,status:status,note:note});
      var index = state.items.findIndex(function (row) { return row.id === item.id; });
      if (index >= 0) state.items[index] = saved;
      if (drafts.get(item.id) === note) drafts.delete(item.id);
      window.AdminUI.toast('Feedback atualizado.');
    } catch (error) {
      window.AdminUI.toast(error.message || 'Não foi possível salvar o feedback.', 'error');
    } finally {
      busyId = null;
      render();
    }
  }
  function render() {
    var visible = filteredItems();
    if (!visible.some(function (item) { return item.id === state.selectedId; })) {
      state.selectedId = visible.length ? visible[0].id : null;
    }
    updateCounts();
    renderList(visible);
    renderDetail(visible.find(function (item) { return item.id === state.selectedId; }));
  }
  function clear() {
    state.items = [];
    drafts.clear();
    state.filter = 'all';
    state.query = '';
    state.selectedId = null;
    search.value = '';
    render();
  }
  filters.forEach(function (button) {
    button.addEventListener('click', function () {
      state.filter = button.dataset.filter;
      render();
    });
  });
  search.addEventListener('input', function () {
    state.query = search.value;
    render();
  });
  window.AdminFeedback = {
    clear: clear,
    getState: function () { return JSON.parse(JSON.stringify(state)); }
  };
  document.addEventListener('invox:admin-state', function (event) {
    state.items = event.detail.feedbacks || [];
    render();
  });
  document.addEventListener('invox:admin-clear', clear);
  clear();
  if (window.AdminUI && window.AdminUI.lastState) {
    state.items = window.AdminUI.lastState.feedbacks || [];
    render();
  }
})();
