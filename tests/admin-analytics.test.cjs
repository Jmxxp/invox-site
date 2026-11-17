const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.resolve(__dirname, '../painel-admin/index.html'), 'utf8');
const source = fs.readFileSync(path.resolve(__dirname, '../painel-admin/analytics.js'), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.events = {}; this.attrs = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.textContent = ''; this.clientWidth = 620; this.clientHeight = 265; this.classes = new Set(); this.classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key) }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name, event = {}) { (this.events[name] || []).forEach(callback => callback(event)); }
}
const nodes = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
const buttons = ['day', 'week', 'month', 'year'].map(period => { const button = new Element('button'); button.dataset.period = period; return button; });
nodes['panel-analytics'].querySelectorAll = () => buttons;
const events = {};
const document = { getElementById: id => nodes[id], createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), addEventListener: (name, cb) => (events[name] ||= []).push(cb) };
const emit = (name, detail) => (events[name] || []).forEach(callback => callback({ detail }));
const requests = [];
const window = { AdminUI: { lastState: null, refresh() {} }, addEventListener() {}, InvoxBackend: { analytics: period => new Promise((resolve, reject) => requests.push({ period, resolve, reject })) } };
vm.runInNewContext(source, { document, window, Intl, Date });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(period, views = 0, downloads = 0) {
  return { period, timezone: 'America/Sao_Paulo', startedAt: '2026-11-17T10:00:00Z', range: { start: '2026-11-16T03:00:00Z', end: '2026-11-17T14:00:00Z' }, series: [{ key: '2026-11-16T03:00:00Z', label: '16/11', views: 0, downloads: 0 }, { key: '2026-11-17T03:00:00Z', label: '17/11', views, downloads }], totals: { views, downloads }, allTime: { views: views + 20, downloads: downloads + 3 }, platforms: [{ platform: 'windows', downloads }, { platform: 'macos', downloads: 0 }, { platform: 'android', downloads: 0 }] };
}
(async () => {
  assert.equal(requests.length, 0, 'Não consulta antes do login');
  assert.equal(nodes['analytics-views'].textContent, '—');
  nodes['panel-analytics'].hidden = true;
  emit('invox:admin-state', {});
  assert.equal(requests.length, 0, 'Área oculta não consulta');
  nodes['panel-analytics'].hidden = false;
  emit('invox:panel-change', { panel: 'analytics' });
  emit('invox:admin-state', {});
  assert.equal(requests.length, 1, 'Coalesce consultas do mesmo período');
  assert.equal(requests[0].period, 'week');
  requests[0].resolve(fixture('week'));
  await flush();
  assert.equal(nodes['analytics-views'].textContent, '0');
  assert.equal(nodes['analytics-downloads'].textContent, '0');
  assert.equal(nodes['analytics-views-chart'].children[0].tagName, 'svg');
  assert.equal(nodes['analytics-table-body'].children.length, 2);
  assert.match(nodes['analytics-chart-note'].textContent, /Nenhuma visualização/);
  assert.equal(nodes['analytics-platforms'].children.length, 3);
  buttons[0].emit('click');
  buttons[2].emit('click');
  assert.equal(requests[1].period, 'day');
  assert.equal(requests[2].period, 'month');
  requests[1].resolve(fixture('day', 99, 99));
  await flush();
  assert.equal(nodes['analytics-views'].textContent, '—', 'Resposta antiga não altera o novo período');
  requests[2].resolve(fixture('month', 7, 2));
  await flush();
  assert.equal(nodes['analytics-views'].textContent, '7');
  assert.equal(nodes['analytics-downloads'].textContent, '2');
  assert.equal(buttons[2].attrs['aria-pressed'], 'true');
  assert.match(nodes['analytics-range'].textContent, /Horário de Brasília/);
  assert.match(nodes['analytics-started'].textContent, /17\/11\/2026/);
  assert.match(nodes['analytics-started'].textContent, /às 07:00 \(Brasília\)/);
  assert.match(nodes['analytics-started'].textContent, /anteriores à ativação não têm histórico/);
  const refresh = window.AdminAnalytics.refresh();
  requests[3].reject(new Error('Conexão indisponível.'));
  await refresh;
  assert.equal(nodes['analytics-views'].textContent, '7');
  assert.equal(nodes['analytics-retry'].hidden, false);
  assert.match(nodes['analytics-status'].textContent, /últimos dados/);
  nodes['analytics-retry'].emit('click');
  const malformed = fixture('month', 10, 3);
  malformed.totals.views = -1;
  requests[4].resolve(malformed);
  await flush();
  assert.equal(nodes['analytics-views'].textContent, '7', 'Dados inválidos não aparecem como métricas');
  window.AdminAnalytics.refresh();
  emit('invox:admin-clear');
  requests[5].resolve(fixture('month', 100, 100));
  await flush();
  assert.equal(nodes['analytics-views'].textContent, '—', 'Logout limpa e bloqueia respostas atrasadas');
  assert.equal(nodes['analytics-table-body'].children.length, 0);
  assert.equal(window.AdminAnalytics.getState().authenticated, false);
  assert.equal(window.AdminAnalytics.getState().busy, false);
  assert(!source.includes('innerHTML'));
  assert(html.includes('data-panel="analytics"') && html.includes('analytics.css') && html.includes('analytics.js'));
  console.log('PASS admin analytics: servidor autenticado, períodos, gráfico/tabela, zero real, plataformas, coalescência, falha preserva dados, respostas fora de ordem, validação e logout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
