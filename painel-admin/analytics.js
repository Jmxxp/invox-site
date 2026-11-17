(() => {
  'use strict';
  const panel = document.getElementById('panel-analytics');
  if (!panel) return;
  const chart = document.getElementById('analytics-views-chart');
  const status = document.getElementById('analytics-status');
  const retry = document.getElementById('analytics-retry');
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
  function validDate(value) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Período de análise inválido.');
    return value;
  }
  function validate(data, selected) {
    if (!data || data.period !== selected || data.timezone !== 'America/Sao_Paulo' || !Array.isArray(data.series) || data.series.length > 366 || !Array.isArray(data.platforms)) throw new Error('Dados de análise indisponíveis.');
    return {
      ...data, startedAt: validDate(data.startedAt), range: { start: validDate(data.range?.start), end: validDate(data.range?.end) },
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
    const plot = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Visualizações do site: ${number.format(report.totals.views)} em ${periods[period]}. Use a tabela abaixo para os valores completos.` });
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
    const tooltip = node('div', 'analytics-tooltip');
    tooltip.hidden = true;
    const labelInterval = Math.max(1, Math.ceil(points.length / (width < 450 ? 4 : 7)));
    points.forEach((point, index) => {
      if (index % labelInterval === 0 || index === points.length - 1) plot.append(svg('text', { x: point.x, y: bottom + 24, 'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle', class: 'analytics-chart-axis' }, point.item.label));
      const description = `${point.item.label}: ${number.format(point.item.views)} visualizações e ${number.format(point.item.downloads)} downloads iniciados`;
      const group = svg('g', { class: 'analytics-chart-point', tabindex: '0', role: 'img', 'aria-label': description });
      group.append(svg('title', {}, description), svg('circle', { cx: point.x, cy: point.y, r: 13, fill: 'transparent', class: 'point-hit' }), svg('circle', { cx: point.x, cy: point.y, r: points.length > 15 ? 2 : 3, class: 'point-dot' }));
      const show = () => { tooltip.textContent = `${point.item.label}\n${number.format(point.item.views)} visualizações · ${number.format(point.item.downloads)} downloads`; tooltip.style.left = `${Math.max(18, Math.min(82, point.x * 100 / width))}%`; tooltip.hidden = false; };
      group.addEventListener('mouseenter', show);
      group.addEventListener('focus', show);
      group.addEventListener('click', show);
      group.addEventListener('mouseleave', () => { tooltip.hidden = true; });
      group.addEventListener('blur', () => { tooltip.hidden = true; });
      plot.append(group);
    });
    plot.addEventListener('pointermove', event => {
      if (!points.length) return;
      const bounds = plot.getBoundingClientRect();
      if (!bounds.width) return;
      const x = (event.clientX - bounds.left) * width / bounds.width;
      const nearest = points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best);
      tooltip.textContent = `${nearest.item.label}\n${number.format(nearest.item.views)} visualizações · ${number.format(nearest.item.downloads)} downloads`;
      tooltip.style.left = `${Math.max(18, Math.min(82, nearest.x * 100 / width))}%`;
      tooltip.hidden = false;
    });
    plot.addEventListener('pointerleave', () => { tooltip.hidden = true; });
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
    text('analytics-started', `Contagem ativa desde ${date.format(new Date(report.startedAt))} às ${time.format(new Date(report.startedAt))} (Brasília). Períodos anteriores à ativação não têm histórico. Acessos locais de desenvolvimento ficam fora da contagem.`);
    text('analytics-chart-note', report.totals.views ? 'Passe o mouse ou use Tab nos pontos para consultar cada intervalo.' : 'Nenhuma visualização registrada neste período. Os valores começam em zero.');
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
  function load() {
    if (!authenticated || panel.hidden) return Promise.resolve();
    if (inflight?.period === period) return inflight.promise;
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
        report = validate(data, selected);
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
      }
    })();
    return request.promise;
  }
  function clear() {
    sequence += 1;
    authenticated = false;
    inflight = null;
    report = null;
    period = 'week';
    panel.setAttribute('aria-busy', 'false');
    status.dataset.tone = 'normal';
    status.textContent = 'Entre no painel para carregar as análises.';
    retry.hidden = true;
    updateButtons(); resetVisuals();
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.period;
    if (!Object.prototype.hasOwnProperty.call(periods, selected) || selected === period) return;
    period = selected;
    sequence += 1;
    report = null;
    updateButtons(); resetVisuals();
    load();
  }));
  retry.addEventListener('click', load);
  document.addEventListener('invox:admin-state', () => { authenticated = true; load(); });
  document.addEventListener('invox:admin-clear', clear);
  document.addEventListener('invox:panel-change', event => { if (event.detail?.panel === 'analytics') load(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (!panel.hidden && report) drawChart(); }).observe(chart);
  else window.addEventListener('resize', () => { if (!panel.hidden && report) drawChart(); });
  window.AdminAnalytics = { refresh: load, clear, getState: () => ({ period, loaded: Boolean(report), authenticated, busy: Boolean(inflight) }) };
  resetVisuals();
  if (authenticated) load();
})();
