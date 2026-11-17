(() => {
  'use strict';
  const pages = {
    analytics: ['O INVOX em números', 'Acompanhe as visualizações do site e os downloads por plataforma.', 'Análises'],
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
    if (!Object.prototype.hasOwnProperty.call(pages, key)) key = 'analytics';
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
    const communitySummary = document.getElementById('community-summary');
    if (communitySummary) communitySummary.hidden = key === 'analytics';
    closeSidebar(document.body.classList.contains('sidebar-open'));
    if (updateHash && location.hash !== `#${key}`) location.hash = key;
    document.dispatchEvent(new CustomEvent('invox:panel-change', { detail: { panel: key } }));
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

  navigate(location.hash.slice(1), false);
  const api = window.InvoxBackend;
  const shell = document.getElementById('admin-shell');
  const authScreen = document.getElementById('admin-auth');
  const loginForm = document.getElementById('login-form');
  const username = document.getElementById('login-username');
  const password = document.getElementById('login-password');
  const loginStatus = document.getElementById('login-status');
  const retry = document.getElementById('auth-retry');
  const refreshButton = document.getElementById('refresh-admin');
  let refreshPromise = null;
  let authEpoch = 0;
  function authMessage(message, error = false) {
    loginStatus.textContent = message;
    loginStatus.classList.toggle('is-error', error);
  }
  function clearAdmin(message) {
    authEpoch += 1;
    shell.hidden = true;
    authScreen.hidden = false;
    closeSidebar();
    document.getElementById('admin-email').textContent = '';
    document.getElementById('summary-version').textContent = '—';
    password.value = '';
    window.AdminUI.lastState = null;
    document.dispatchEvent(new CustomEvent('invox:admin-clear'));
    authMessage(message || 'Entre com sua conta para continuar.');
  }
  async function refreshAdmin(notify = false) {
    if (refreshPromise) return refreshPromise;
    const epoch = authEpoch;
    refreshButton.disabled = true;
    retry.hidden = true;
    refreshPromise = (async () => {
      try {
        const state = await api.adminState();
        if (epoch !== authEpoch) return;
        document.getElementById('admin-email').textContent = state.admin.username || state.admin.email;
        document.getElementById('summary-version').textContent = state.settings.version;
        shell.hidden = false;
        authScreen.hidden = true;
        password.value = '';
        window.AdminUI.lastState = state;
        document.dispatchEvent(new CustomEvent('invox:admin-state', {detail:state}));
        if (notify) toast('Painel atualizado.');
      } catch (error) {
        if (epoch !== authEpoch) return;
        clearAdmin();
        authMessage(error.code === 'forbidden' ? 'Esta conta não tem permissão de administrador.' : (error.message || 'Não foi possível validar seu acesso. Tente novamente.'), true);
        retry.hidden = false;
      } finally {
        refreshPromise = null;
        refreshButton.disabled = false;
      }
    })();
    return refreshPromise;
  }
  window.AdminUI.refresh = refreshAdmin;
  refreshButton.addEventListener('click', () => refreshAdmin(true));
  async function authAction(operation) {
    loginForm.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await operation(); }
    catch (error) { authMessage(error.message || 'Não foi possível entrar. Confira seus dados.', true); }
    finally { password.value = ''; loginForm.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    if (!password.value) { authMessage('Informe a senha da sua conta.', true); password.focus(); return; }
    authAction(async () => {
      authMessage('Entrando…');
      await api.signIn(username.value.trim(), password.value);
      password.value = '';
      await refreshAdmin();
    });
  });
  document.getElementById('admin-signout').addEventListener('click', async () => {
    clearAdmin('Saindo…');
    const {error} = await api.auth.signOut({scope:'local'});
    authMessage(error ? 'O painel foi fechado. Não foi possível encerrar a sessão no navegador; tente sair novamente ao entrar.' : 'Sessão encerrada.', Boolean(error));
  });
  retry.addEventListener('click', () => { if (api?.auth) refreshAdmin(); else location.reload(); });
  if (!api?.auth || location.protocol === 'file:') {
    authMessage(location.protocol === 'file:' ? 'Abra o painel por um servidor HTTP ou pelo endereço publicado para entrar.' : 'Não foi possível carregar a conexão. Recarregue a página.', true);
    loginForm.querySelectorAll('button').forEach(button => { button.disabled = true; });
    retry.hidden = false;
    return;
  }
  api.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === 'SIGNED_OUT') clearAdmin('Sessão encerrada.');
      else if (session) refreshAdmin();
    }, 0);
  });
  api.auth.getSession().then(({data,error}) => {
    if (error) { authMessage(error.message, true); retry.hidden = false; }
    else if (data.session) refreshAdmin();
    else clearAdmin();
  }).catch(() => { authMessage('Não foi possível recuperar sua sessão.', true); retry.hidden = false; });
})();
