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
  function makeDemo() {
    var now = Date.now();
    return [
      { id: 'demo-01', name: 'Jogador de exemplo 01', contact: 'exemplo01@example.test',
        message: 'Seria muito legal combinar veículos com habilidades de voo! Imaginem uma corrida de carros voadores em um mapa criado pela comunidade.',
        status: 'new', receivedAt: new Date(now - 12 * 60000).toISOString(), note: '' },
      { id: 'demo-02', name: 'Jogador de exemplo 02', contact: 'exemplo02@example.test',
        message: 'Durante um teste com amigos, um bloco continuou flutuando depois de remover a base. Seria ótimo revisar essa interação da física.\n\nMensagem fictícia para demonstrar o painel.',
        status: 'new', receivedAt: new Date(now - 48 * 60000).toISOString(), note: '' },
      { id: 'demo-03', name: 'Jogador de exemplo 03', contact: 'exemplo03@example.test',
        message: 'Adoraria ter mais opções para personalizar as regras das salas. Poder salvar combinações de voz seria incrível.',
        status: 'new', receivedAt: new Date(now - 3 * 3600000).toISOString(), note: '' },
      { id: 'demo-04', name: 'Jogador de exemplo 04', contact: 'exemplo04@example.test',
        message: 'Testei as combinações de objetos com meus amigos e nos divertimos muito. Minha sugestão é adicionar um atalho para repetir o último comando de voz.',
        status: 'answered', receivedAt: new Date(now - 26 * 3600000).toISOString(),
        note: 'Exemplo de anotação interna: sugestão registrada para avaliar nas próximas versões.' }
    ];
  }
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
      list.append(emptyState('feedback-empty', 'Nenhum feedback encontrado',
        'Tente outra busca ou selecione um filtro diferente.', 'fa-magnifying-glass'));
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
    topline.append(statusPill(item.status), el('span', 'feedback-reference', 'Feedback de exemplo'));
    var contact = el('p', 'feedback-contact');
    contact.append(icon('fa-at'), document.createTextNode(item.contact));
    var date = el('time', 'feedback-date', 'Recebido em ' + fullDate.format(new Date(item.receivedAt)) + ' · Brasília');
    date.dateTime = item.receivedAt;
    header.append(topline, el('h3', 'feedback-detail-name', item.name), contact, date);
    var message = el('div', 'feedback-message', item.message);
    var noteBlock = el('div', 'feedback-note-block');
    var noteLabel = el('label', 'field-label', 'Anotação de resposta (prévia)');
    noteLabel.htmlFor = 'reply-note';
    var note = el('textarea');
    note.id = 'reply-note';
    note.rows = 4;
    note.maxLength = 5000;
    note.placeholder = 'Registre uma resposta ou observação interna...';
    note.value = item.note;
    note.setAttribute('aria-describedby', 'reply-note-help feedback-send-note');
    var noteHelp = el('p', 'field-help note-status', 'Anotação mantida apenas nesta sessão.');
    noteHelp.id = 'reply-note-help';
    note.addEventListener('input', function () {
      item.note = note.value;
      noteHelp.textContent = 'Anotação mantida apenas nesta sessão.';
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
    action.addEventListener('click', function () {
      item.status = item.status === 'new' ? 'answered' : 'new';
      render();
      if (window.AdminUI && typeof window.AdminUI.toast === 'function') {
        window.AdminUI.toast('Classificação atualizada nesta sessão.');
      }
    });
    actions.append(action);
    var notice = el('p', 'feedback-local-notice');
    notice.id = 'feedback-send-note';
    notice.append(icon('fa-circle-info'),
      document.createTextNode('Classificar como respondido não envia uma mensagem.'));
    detail.append(actions, notice);
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
  function resetDemo() {
    state.items = makeDemo();
    state.filter = 'all';
    state.query = '';
    state.selectedId = state.items[0].id;
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
    resetDemo: resetDemo,
    getState: function () { return JSON.parse(JSON.stringify(state)); }
  };
  resetDemo();
})();
