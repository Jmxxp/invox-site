(() => {
  'use strict';
  const pages = {
    feedback: ['Feedbacks da comunidade', 'Organize as ideias que podem virar o próximo absurdo.', 'Feedbacks'],
    access: ['Acesso ao site', 'Prepare a visibilidade e o acesso da próxima publicação.', 'Acesso ao site'],
    downloads: ['Versão e arquivos', 'Organize os instaladores e as novidades da próxima versão.', 'Versão e arquivos']
  };
  const toggle = document.querySelector('#sidebar-toggle');
  const backdrop = document.querySelector('#sidebar-backdrop');
  const sidebar = document.querySelector('#admin-sidebar');
  let toastTimer;
  function closeSidebar(restoreFocus = false) {
    document.body.classList.remove('sidebar-open');
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir navegação');
    if (restoreFocus) toggle.focus();
  }
  function navigate(key, updateHash = true) {
    if (!Object.prototype.hasOwnProperty.call(pages, key)) key = 'feedback';
    for (const panel of document.querySelectorAll('.admin-panel')) panel.hidden = panel.id !== `panel-${key}`;
    for (const button of document.querySelectorAll('.nav-item[data-panel]')) {
      const active = button.dataset.panel === key;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    document.querySelector('#page-title').textContent = pages[key][0];
    document.querySelector('#page-description').textContent = pages[key][1];
    document.querySelector('#breadcrumb-current').textContent = pages[key][2];
    document.title = `INVOX Admin — ${pages[key][2]}`;
    closeSidebar(document.body.classList.contains('sidebar-open'));
    if (updateHash && location.hash !== `#${key}`) location.hash = key;
  }
  function toast(message, tone = 'success') {
    const element = document.querySelector('#admin-toast');
    clearTimeout(toastTimer);
    element.textContent = message;
    element.dataset.tone = tone;
    element.classList.add('is-visible');
    toastTimer = setTimeout(() => element.classList.remove('is-visible'), 4400);
  }
  window.AdminUI = { navigate, toast };
  document.querySelectorAll('.nav-item[data-panel]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.panel)));
  toggle.addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-open')) return closeSidebar(true);
    document.body.classList.add('sidebar-open');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Fechar navegação');
    sidebar.querySelector('.nav-item.is-active').focus();
  });
  backdrop.addEventListener('click', () => closeSidebar(true));
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('sidebar-open')) return;
    if (event.key === 'Escape') closeSidebar(true);
    if (event.key === 'Tab') {
      const items = [...sidebar.querySelectorAll('a, button')];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 900) closeSidebar(); });
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1), false));
  document.querySelector('#reset-demo').addEventListener('click', () => {
    window.AdminFeedback?.resetDemo();
    window.AdminSettings?.resetDemo();
    toast('Prévia restaurada. Os rascunhos desta sessão foram limpos.');
  });
  navigate(location.hash.slice(1), false);
})();
