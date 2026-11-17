(() => {
  'use strict';
  const form = document.getElementById('announcement-form');
  if (!form) return;
  const title = document.getElementById('announcement-title');
  const message = document.getElementById('announcement-message');
  const publish = document.getElementById('announcement-publish');
  const status = document.getElementById('announcement-status');
  const list = document.getElementById('announcement-list');
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  let items = [];
  let busy = false;
  let epoch = 0;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setBusy(value) {
    busy = value;
    title.disabled = message.disabled = publish.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  function remember(item) {
    items = [item, ...items.filter(row => row.id !== item.id)].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    if (window.AdminUI.lastState) window.AdminUI.lastState.announcements = items;
    render();
  }
  function render() {
    list.replaceChildren();
    if (!items.length) { list.append(element('p', 'field-hint', 'Nenhum recado publicado.')); return; }
    for (const item of items) {
      const card = element('article', 'settings-card announcement-card');
      const heading = element('div', 'announcement-heading');
      heading.append(element('h3', '', item.title), element('span', 'status-pill ' + (item.active ? 'new' : 'answered'), item.active ? 'Ativo' : 'Desativado'));
      const time = element('time', 'field-hint', date.format(new Date(item.publishedAt)) + ' · Brasília');
      time.dateTime = item.publishedAt;
      const action = element('button', 'button button-ghost button-small', item.active ? 'Desativar recado' : 'Reativar recado');
      action.type = 'button';
      action.disabled = busy;
      action.dataset.announcementId = item.id;
      action.addEventListener('click', async () => {
        if (busy) return;
        const currentEpoch = epoch;
        setBusy(true); render();
        try {
          const saved = await window.InvoxBackend.setAnnouncementActive({ id: item.id, active: !item.active });
          if (epoch !== currentEpoch) return;
          remember(saved);
          status.textContent = saved.active ? 'Recado reativado. Quem já o fechou não recebe um aviso repetido.' : 'Recado desativado. Ele saiu das próximas consultas do jogo.';
        } catch (error) {
          if (epoch === currentEpoch) status.textContent = error.message || 'Não foi possível alterar o recado.';
        } finally { if (epoch === currentEpoch) { setBusy(false); render(); } }
      });
      card.append(heading, element('p', 'announcement-message', item.message), time, action);
      list.append(card);
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    title.value = title.value.trim(); message.value = message.value.trim();
    title.setCustomValidity(!title.value || Array.from(title.value).length > 100 ? 'Informe um título de até 100 caracteres.' : '');
    message.setCustomValidity(!message.value || Array.from(message.value).length > 2000 ? 'Informe uma mensagem de até 2000 caracteres.' : '');
    if (!form.reportValidity()) return;
    const currentEpoch = epoch;
    setBusy(true); render(); status.textContent = 'Publicando o recado...';
    try {
      const saved = await window.InvoxBackend.saveAnnouncement({ title: title.value, message: message.value });
      if (epoch !== currentEpoch) return;
      if (!saved?.id) throw new Error('O servidor não confirmou a publicação.');
      remember(saved); form.reset();
      status.textContent = 'Recado publicado para os jogadores. Ele aparecerá na próxima consulta do jogo.';
    } catch (error) {
      if (epoch === currentEpoch) status.textContent = error.message || 'Não foi possível publicar. O texto foi preservado.';
    } finally { if (epoch === currentEpoch) { setBusy(false); render(); } }
  });
  [title, message].forEach(field => field.addEventListener('input', () => field.setCustomValidity('')));
  document.addEventListener('invox:admin-state', event => { items = event.detail.announcements || []; render(); });
  document.addEventListener('invox:admin-clear', () => { epoch++; items = []; form.reset(); status.textContent = ''; setBusy(false); render(); });
  if (window.AdminUI?.lastState) items = window.AdminUI.lastState.announcements || [];
  render();
})();
