(() => {
  'use strict';
  const pages = {
    analytics: ['O INVOX em números', 'Acompanhe as visualizações do site e os downloads por plataforma.', 'Análises'],
    feedback: ['Mensagens da comunidade', 'Ajuda, feedback e sugestões do site e do jogo.', 'Mensagens'],
    announcements: ['Recados para os jogadores', 'Publique avisos que aparecem dentro do jogo.', 'Recados'],
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
  let autoRefreshTimer = null;
  let knownFeedbackIds = null;
  let feedbackBaseline = 0;
  let browserNotifications = false;
  const notificationButton = document.getElementById('enable-feedback-notifications');
  const notificationStatus = document.getElementById('feedback-notification-status');
  const notificationKey = 'invox-admin-feedback-notifications';
  try { browserNotifications = window.localStorage?.getItem(notificationKey) === 'enabled'; } catch { /* Optional preference only. */ }
  function updateNotificationControl() {
    if (!notificationButton) return;
    const supported = typeof window.Notification === 'function';
    notificationButton.disabled = !supported;
    notificationButton.textContent = browserNotifications && window.Notification?.permission === 'granted' ? 'Desativar notificações do navegador' : 'Ativar notificações do navegador';
    if (notificationStatus) notificationStatus.textContent = !supported ? 'As novas mensagens atualizam o painel automaticamente. Este navegador não oferece notificações.' : 'Atualização a cada 20 segundos enquanto o painel estiver aberto. Novidades aparecem também no contador lateral.';
  }
  notificationButton?.addEventListener('click', async () => {
    if (typeof window.Notification !== 'function') return;
    if (browserNotifications && window.Notification.permission === 'granted') browserNotifications = false;
    else browserNotifications = (await window.Notification.requestPermission()) === 'granted';
    try { window.localStorage?.setItem(notificationKey, browserNotifications ? 'enabled' : 'disabled'); } catch { /* Session preference still works. */ }
    updateNotificationControl();
    if (!browserNotifications && window.Notification.permission === 'denied' && notificationStatus) notificationStatus.textContent = 'Notificações bloqueadas pelo navegador. O contador de novas mensagens continua ativo no painel.';
  });
  function announceFeedbacks(items) {
    const ids = new Set(items.map(item => item.id));
    if (!knownFeedbackIds) feedbackBaseline = Math.max(0, ...items.map(item => Date.parse(item.receivedAt) || 0));
    const incoming = knownFeedbackIds ? items.filter(item => !knownFeedbackIds.has(item.id) && item.status === 'new' && Date.parse(item.receivedAt) >= feedbackBaseline) : [];
    // Retain observed IDs so changing filters, a refresh or an older row moving
    // into the bounded list never announces the same record twice this session.
    if (!knownFeedbackIds) knownFeedbackIds = new Set();
    for (const id of ids) knownFeedbackIds.add(id);
    if (!incoming.length) return;
    toast(incoming.length === 1 ? 'Uma nova mensagem chegou à comunidade.' : `${incoming.length} novas mensagens chegaram à comunidade.`);
    if (browserNotifications && window.Notification?.permission === 'granted') {
      for (const item of incoming.slice(0, 3)) {
        try {
          const notification = new window.Notification(item.kind === 'suggestion' ? 'Nova sugestão no INVOX' : 'Novo feedback no INVOX', { body: `Mensagem de ${item.name}. Abra o painel para ler.`, tag: `invox-feedback-${item.id}` });
          notification.onclick = () => { window.focus?.(); navigate('feedback'); notification.close(); };
        } catch { /* Browser may require a service worker; the panel badge remains available. */ }
      }
    }
  }
  function startAutoRefresh() {
    if (autoRefreshTimer !== null || typeof window.setInterval !== 'function') return;
    autoRefreshTimer = window.setInterval(() => { if (!shell.hidden) refreshAdmin(false, true); }, 20000);
  }
  updateNotificationControl();
  function authMessage(message, error = false) {
    loginStatus.textContent = message;
    loginStatus.classList.toggle('is-error', error);
  }
  function clearAdmin(message) {
    authEpoch += 1;
    if (autoRefreshTimer !== null) window.clearInterval?.(autoRefreshTimer);
    autoRefreshTimer = null;
    knownFeedbackIds = null;
    feedbackBaseline = 0;
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
  async function refreshAdmin(notify = false, background = false) {
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
        announceFeedbacks(state.feedbacks || []);
        updateNotificationControl();
        window.AdminUI.lastState = state;
        document.dispatchEvent(new CustomEvent('invox:admin-state', {detail:state}));
        startAutoRefresh();
        if (notify) toast('Painel atualizado.');
      } catch (error) {
        if (epoch !== authEpoch) return;
        if (background && window.AdminUI.lastState && !['forbidden', 'unauthorized'].includes(error.code)) {
          if (notificationStatus) notificationStatus.textContent = 'Sem conexão para atualizar. As mensagens carregadas foram preservadas; nova tentativa automática em instantes.';
          return;
        }
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
