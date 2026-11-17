(() => {
  'use strict';
  const panel = document.getElementById('panel-analytics');
  if (!panel) return;
  const chart = document.getElementById('analytics-views-chart');
  const status = document.getElementById('analytics-status');
  const retry = document.getElementById('analytics-retry');
  const resetOpen = document.getElementById('analytics-reset-open');
  const resetBox = document.getElementById('analytics-reset-confirmation');
  const resetConfirm = document.getElementById('analytics-reset-confirm');
  const resetCancel = document.getElementById('analytics-reset-cancel');
  const resetStatus = document.getElementById('analytics-reset-status');
  const buttons = [...panel.querySelectorAll('[data-period]')];
  const periods = { day: 'hoje', week: 'os últimos 7 dias', month: 'os últimos 30 dias', year: 'os últimos 12 meses' };
  const platforms = [['windows', 'Windows', 'fa-windows'], ['macos', 'macOS', 'fa-apple'], ['android', 'Android', 'fa-android']];
  const number = new Intl.NumberFormat('pt-BR');
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  let period = 'week';
  let report = null;
  let authenticated = Boolean(window.AdminUI?.lastState);
  let sequence = 0;
  let inflight = null;
  let resetting = false;
  let generation = null;
  let realtimeTimer = null;
  let realtimeDirty = false;
  let lastRealtimeFetch = 0;
  function invalidateRealtime() {
    if (!authenticated) return;
    realtimeDirty = true;
    scheduleRealtime();
  }
  function scheduleRealtime() {
    if (!realtimeDirty || realtimeTimer !== null || !authenticated || panel.hidden || document.hidden || resetting || inflight) return;
    const delay = Math.max(250, 1500 - (Date.now() - lastRealtimeFetch));
    realtimeTimer = setTimeout(() => {
      realtimeTimer = null;
      if (!authenticated || panel.hidden || document.hidden || resetting || inflight) return;
      load();
    }, delay);
  }
  function text(id, value) { document.getElementById(id).textContent = value; }
  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }
  function svg(tag, attributes = {}, value) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, item] of Object.entries(attributes)) element.setAttribute(key, String(item));
    if (value !== undefined) element.textContent = value;
    return element;
  }
  function count(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Dados de análise inválidos.');
    return value;
  }
  function validGeneration(value) {
    if (count(value) < 1) throw new Error('Dados de análise inválidos.');
    return value;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Período de análise inválido.');
    return value;
  }
  function validate(data, selected) {
    if (!data || data.period !== selected || data.timezone !== 'America/Sao_Paulo' || !Array.isArray(data.series) || data.series.length > 366 || !Array.isArray(data.platforms)) throw new Error('Dados de análise indisponíveis.');
    return {
      ...data, generation: validGeneration(data.generation), startedAt: validDate(data.startedAt), range: { start: validDate(data.range?.start), end: validDate(data.range?.end) },
      totals: { views: count(data.totals?.views), downloads: count(data.totals?.downloads) },
      allTime: { views: count(data.allTime?.views), downloads: count(data.allTime?.downloads) },
      series: data.series.map(item => {
        if (typeof item.label !== 'string' || item.label.length > 64) throw new Error('Intervalo inválido.');
        return { key: validDate(item.key), label: item.label, views: count(item.views), downloads: count(item.downloads) };
      }),
      platforms: platforms.map(([platform]) => ({ platform, downloads: count(data.platforms.find(item => item.platform === platform)?.downloads ?? 0) }))
    };
  }
  function drawChart() {
    chart.replaceChildren();
    if (!report) {
      chart.append(node('div', 'analytics-chart-placeholder', 'Os dados do gráfico aparecerão aqui.'));
      return;
    }
    const width = Math.max(260, chart.clientWidth || 700);
    const height = chart.clientHeight || 265;
    const left = 40, right = width - 14, top = 24, bottom = height - 34;
    const maximum = Math.max(0, ...report.series.map(item => item.views));
    const step = Math.max(1, Math.ceil(maximum / 4));
    const ceiling = step * 4;
    const plot = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': `Visualizações do site: ${number.format(report.totals.views)} em ${periods[period]}.`, 'aria-describedby': 'analytics-chart-note' });
    const definitions = svg('defs');
    const gradient = svg('linearGradient', { id: 'analytics-area', x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(svg('stop', { offset: '0%', 'stop-color': '#b72eec', 'stop-opacity': '.22' }), svg('stop', { offset: '100%', 'stop-color': '#b72eec', 'stop-opacity': '0' }));
    definitions.append(gradient);
    plot.append(definitions);
    for (let index = 0; index <= 4; index++) {
      const y = bottom - index * (bottom - top) / 4;
      plot.append(svg('line', { x1: left, x2: right, y1: y, y2: y, class: 'analytics-chart-grid' }), svg('text', { x: left - 9, y: y + 3, 'text-anchor': 'end', class: 'analytics-chart-axis' }, number.format(index * step)));
    }
    const points = report.series.map((item, index, rows) => ({ item, x: rows.length === 1 ? (left + right) / 2 : left + index * (right - left) / (rows.length - 1), y: bottom - item.views * (bottom - top) / ceiling }));
    if (points.length) {
      const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
      plot.append(svg('path', { d: `${line} L${points.at(-1).x},${bottom} L${points[0].x},${bottom} Z`, class: 'analytics-chart-fill' }), svg('path', { d: line, class: 'analytics-chart-line' }));
    }
    const cursor = svg('line', { x1: left, x2: left, y1: top, y2: bottom, class: 'analytics-chart-cursor', visibility: 'hidden', 'aria-hidden': 'true' });
    plot.append(cursor);
    const tooltip = node('div', 'analytics-tooltip');
    tooltip.style.width = 'max-content';
    tooltip.id = 'analytics-chart-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    let focusedIndex = null;
    function show(index, cursorX = points[index].x) {
      const point = points[index];
      const x = Math.max(left, Math.min(right, cursorX));
      cursor.setAttribute('x1', x);
      cursor.setAttribute('x2', x);
      cursor.setAttribute('visibility', 'visible');
      points.forEach((item, position) => item.element.classList.toggle('is-selected', position === index));
      tooltip.textContent = `${point.item.label}\n${number.format(point.item.views)} visualizações · ${number.format(point.item.downloads)} downloads`;
      const chartWidth = chart.clientWidth || width;
      const margin = 8;
      tooltip.style.maxWidth = `${Math.min(210, Math.max(0, chartWidth - margin * 2))}px`;
      tooltip.hidden = false;
      const halfTooltip = tooltip.getBoundingClientRect().width / 2;
      const center = Math.max(margin + halfTooltip, Math.min(chartWidth - margin - halfTooltip, x * chartWidth / width));
      tooltip.style.left = `${center}px`;
    }
    function hide() {
      cursor.setAttribute('visibility', 'hidden');
      tooltip.hidden = true;
      points.forEach(point => point.element.classList.toggle('is-selected', false));
    }
    const labelInterval = Math.max(1, Math.ceil(points.length / (width < 450 ? 4 : 7)));
    points.forEach((point, index) => {
      if (index % labelInterval === 0 || index === points.length - 1) plot.append(svg('text', { x: point.x, y: bottom + 24, 'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle', class: 'analytics-chart-axis' }, point.item.label));
      const description = `${point.item.label}: ${number.format(point.item.views)} visualizações e ${number.format(point.item.downloads)} downloads iniciados`;
      const group = svg('g', { class: 'analytics-chart-point', tabindex: index === 0 ? '0' : '-1', role: 'button', 'aria-label': description, 'aria-describedby': 'analytics-chart-tooltip' });
      point.element = group;
      group.append(svg('title', {}, description), svg('circle', { cx: point.x, cy: point.y, r: 13, fill: 'transparent', class: 'point-hit' }), svg('circle', { cx: point.x, cy: point.y, r: points.length > 15 ? 2 : 3, class: 'point-dot' }));
      group.addEventListener('focus', () => {
        focusedIndex = index;
        points.forEach((item, position) => item.element.setAttribute('tabindex', position === index ? '0' : '-1'));
        show(index);
      });
      group.addEventListener('click', () => { group.focus(); show(index); });
      group.addEventListener('blur', () => { focusedIndex = null; hide(); });
      group.addEventListener('keydown', event => {
        const destinations = { ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(points.length - 1, index + 1), Home: 0, End: points.length - 1 };
        if (Object.prototype.hasOwnProperty.call(destinations, event.key)) {
          event.preventDefault();
          points[destinations[event.key]].element.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); show(index);
        } else if (event.key === 'Escape') {
          event.preventDefault(); focusedIndex = null; hide();
        }
      });
      plot.append(group);
    });
    plot.addEventListener('pointermove', event => {
      if (!points.length) return;
      const bounds = plot.getBoundingClientRect();
      if (!bounds.width) return;
      const x = (event.clientX - bounds.left) * width / bounds.width;
      const nearest = points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0);
      show(nearest, x);
    });
    plot.addEventListener('pointerleave', () => { if (focusedIndex === null) hide(); else show(focusedIndex); });
    chart.append(plot, tooltip);
  }
  function drawPlatforms() {
    const holder = document.getElementById('analytics-platforms');
    holder.replaceChildren();
    const maximum = report ? Math.max(1, ...report.platforms.map(item => item.downloads)) : 1;
    platforms.forEach(([platform, label, iconName]) => {
      const downloads = report?.platforms.find(item => item.platform === platform)?.downloads ?? null;
      const item = node('div', `analytics-platform ${platform}`);
      const row = node('div', 'analytics-platform-row');
      const icon = node('i', `fa-brands ${iconName}`);
      icon.setAttribute('aria-hidden', 'true');
      row.append(icon, node('span', '', label), node('strong', '', downloads === null ? '—' : number.format(downloads)));
      const track = node('div', 'analytics-platform-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = node('div', 'analytics-platform-fill');
      fill.style.width = `${downloads === null ? 0 : downloads * 100 / maximum}%`;
      track.append(fill);
      item.append(row, track);
      holder.append(item);
    });
  }
  function drawTable() {
    const body = document.getElementById('analytics-table-body');
    body.replaceChildren();
    if (!report) return;
    report.series.forEach(item => {
      const row = node('tr');
      row.append(node('td', '', item.label), node('td', '', number.format(item.views)), node('td', '', number.format(item.downloads)));
      body.append(row);
    });
  }
  function render() {
    text('analytics-views', number.format(report.totals.views));
    text('analytics-downloads', number.format(report.totals.downloads));
    text('analytics-all-views', `${number.format(report.allTime.views)} desde o início da contagem`);
    text('analytics-all-downloads', `${number.format(report.allTime.downloads)} desde o início da contagem`);
    text('analytics-range', `${date.format(new Date(report.range.start))} — ${date.format(new Date(report.range.end))} · Horário de Brasília`);
    text('analytics-started', `Contagem atual desde ${date.format(new Date(report.startedAt))} às ${time.format(new Date(report.startedAt))} (Brasília). O histórico das contagens anteriores é preservado. Acessos locais de desenvolvimento ficam fora da contagem.`);
    text('analytics-chart-note', `${report.totals.views ? 'Passe o mouse para consultar cada intervalo.' : 'Nenhuma visualização registrada neste período.'} Use Tab para entrar no gráfico e as setas, Home ou End para navegar.`);
    text('analytics-platform-note', report.totals.downloads ? 'Downloads iniciados no período selecionado.' : 'Nenhum download iniciado neste período.');
    drawChart(); drawPlatforms(); drawTable();
  }
  function resetVisuals() {
    ['analytics-views', 'analytics-downloads'].forEach(id => text(id, '—'));
    ['analytics-all-views', 'analytics-all-downloads'].forEach(id => text(id, 'Aguardando dados do servidor'));
    text('analytics-range', 'Horário de Brasília');
    text('analytics-started', 'A contagem começa com a ativação das análises.');
    text('analytics-chart-note', 'Escolha um período para acompanhar os acessos.');
    text('analytics-platform-note', 'Os downloads serão separados entre Windows, macOS e Android.');
    drawChart(); drawPlatforms(); drawTable();
  }
  function updateButtons() {
    buttons.forEach(button => {
      const active = button.dataset.period === period;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function updateControls() {
    buttons.forEach(button => { button.disabled = resetting; });
    retry.disabled = resetting;
    resetOpen.disabled = !authenticated || resetting;
    resetConfirm.disabled = !authenticated || resetting;
    resetCancel.disabled = resetting;
    resetBox.setAttribute('aria-busy', String(resetting));
  }
  function closeConfirmation(restoreFocus = true) {
    resetBox.hidden = true;
    resetOpen.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !panel.hidden) resetOpen.focus();
  }
  function load() {
    if (!authenticated || panel.hidden || resetting) return Promise.resolve();
    if (inflight?.period === period) return inflight.promise;
    clearTimeout(realtimeTimer);
    realtimeTimer = null;
    realtimeDirty = false;
    lastRealtimeFetch = Date.now();
    const current = ++sequence;
    const selected = period;
    const request = { period: selected, promise: null };
    inflight = request;
    panel.setAttribute('aria-busy', 'true');
    status.dataset.tone = 'normal';
    status.textContent = `Consultando ${periods[selected]}…`;
    retry.hidden = true;
    request.promise = (async () => {
      try {
        const data = await window.InvoxBackend.analytics(selected);
        if (current !== sequence || !authenticated || selected !== period) return;
        const next = validate(data, selected);
        if (generation !== null && next.generation < generation) throw new Error('A nova contagem ainda está sendo atualizada. Tente novamente.');
        generation = next.generation;
        report = next;
        render();
        status.textContent = `Atualizado às ${time.format(new Date())} · Horário de Brasília`;
      } catch (error) {
        if (current !== sequence || !authenticated || selected !== period) return;
        status.dataset.tone = 'error';
        status.textContent = `${error.message || 'Não foi possível carregar as análises.'}${report ? ' Os últimos dados consultados continuam exibidos.' : ''}`;
        retry.hidden = false;
        if (error.code === 'unauthorized' || error.code === 'forbidden') window.AdminUI?.refresh();
      } finally {
        if (inflight === request) inflight = null;
        if (current === sequence) panel.setAttribute('aria-busy', 'false');
        scheduleRealtime();
      }
    })();
    return request.promise;
  }
  async function startNewCount() {
    if (!authenticated || resetting || resetBox.hidden) return;
    const current = ++sequence;
    resetting = true;
    inflight = null;
    updateControls();
    panel.setAttribute('aria-busy', 'true');
    retry.hidden = true;
    status.dataset.tone = 'normal';
    status.textContent = 'Aguardando o início da nova contagem…';
    resetStatus.dataset.tone = 'normal';
    resetStatus.textContent = 'Iniciando uma nova contagem…';
    let completed = false;
    try {
      const result = await window.InvoxBackend.resetAnalytics();
      if (current !== sequence || !authenticated) return;
      const nextGeneration = validGeneration(result?.generation);
      const startedAt = validDate(result?.startedAt);
      if (generation !== null && nextGeneration < generation) throw new Error('Não foi possível confirmar a nova contagem. Atualize as análises.');
      generation = nextGeneration;
      report = null;
      resetVisuals();
      text('analytics-started', `Nova contagem desde ${date.format(new Date(startedAt))} às ${time.format(new Date(startedAt))} (Brasília). Atualizando os dados…`);
      closeConfirmation(false);
      resetStatus.textContent = 'Nova contagem iniciada. O histórico anterior foi preservado.';
      completed = true;
    } catch (error) {
      if (current !== sequence || !authenticated) return;
      resetStatus.dataset.tone = 'error';
      resetStatus.textContent = error.message || 'Não foi possível iniciar a nova contagem. Tente novamente.';
      status.textContent = report ? 'Os últimos dados consultados continuam exibidos.' : 'Atualize as análises para consultar os dados.';
      retry.hidden = false;
      if (error.code === 'unauthorized' || error.code === 'forbidden') window.AdminUI?.refresh();
    } finally {
      if (current === sequence) {
        resetting = false;
        updateControls();
        panel.setAttribute('aria-busy', 'false');
        if (!panel.hidden) (completed ? resetOpen : resetConfirm).focus();
        if (!completed) scheduleRealtime();
      }
    }
    if (completed && current === sequence && authenticated) await load();
  }
  function clear() {
    clearTimeout(realtimeTimer);
    realtimeTimer = null;
    realtimeDirty = false;
    lastRealtimeFetch = 0;
    sequence += 1;
    authenticated = false;
    inflight = null;
    report = null;
    generation = null;
    resetting = false;
    period = 'week';
    panel.setAttribute('aria-busy', 'false');
    status.dataset.tone = 'normal';
    status.textContent = 'Entre no painel para carregar as análises.';
    retry.hidden = true;
    closeConfirmation(false);
    resetStatus.textContent = '';
    resetStatus.dataset.tone = 'normal';
    updateControls();
    updateButtons(); resetVisuals();
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.period;
    if (resetting || !Object.prototype.hasOwnProperty.call(periods, selected) || selected === period) return;
    period = selected;
    sequence += 1;
    report = null;
    updateButtons(); resetVisuals();
    load();
  }));
  resetOpen.addEventListener('click', () => {
    if (!authenticated || resetting) return;
    resetBox.hidden = false;
    resetOpen.setAttribute('aria-expanded', 'true');
    resetStatus.textContent = '';
    resetStatus.dataset.tone = 'normal';
    resetCancel.focus();
  });
  resetCancel.addEventListener('click', () => { if (!resetting) closeConfirmation(); });
  resetBox.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !resetting) { event.preventDefault(); closeConfirmation(); }
  });
  resetConfirm.addEventListener('click', startNewCount);
  retry.addEventListener('click', load);
  document.addEventListener('invox:admin-state', event => {
    const firstState = !authenticated;
    authenticated = true;
    updateControls();
    if (firstState || event.refreshAnalytics !== false) load();
  });
  document.addEventListener('invox:admin-realtime', event => {
    if (event.detail?.scopes?.some(scope => scope === 'analytics' || scope === 'all')) invalidateRealtime();
  });
  document.addEventListener('invox:admin-clear', clear);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRealtime(); });
  document.addEventListener('invox:panel-change', event => { if (event.detail?.panel === 'analytics') load(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (!panel.hidden && report) drawChart(); }).observe(chart);
  else window.addEventListener('resize', () => { if (!panel.hidden && report) drawChart(); });
  window.AdminAnalytics = { refresh: load, clear, getState: () => ({ period, loaded: Boolean(report), authenticated, busy: Boolean(inflight) || resetting, resetting }) };
  updateControls();
  resetVisuals();
  if (authenticated) load();
})();
