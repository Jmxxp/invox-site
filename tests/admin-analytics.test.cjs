const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.resolve(__dirname, '../painel-admin/index.html'), 'utf8');
const source = fs.readFileSync(path.resolve(__dirname, '../painel-admin/analytics.js'), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.events = {}; this.attrs = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.clientWidth = 620; this.clientHeight = 265; this.classes = new Set(); this.classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key) }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name, event = {}) { (this.events[name] || []).forEach(callback => callback(event)); }
  getBoundingClientRect() { return {left:100,width:this.rectWidth??(this.className==='analytics-tooltip'?204:this.clientWidth),height:265}; }
  focus() { if(document.activeElement===this)return;document.activeElement?.emit('blur');document.activeElement=this;this.emit('focus'); }
}
const nodes = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
const buttons = ['day', 'week', 'month', 'year'].map(period => { const button = new Element('button'); button.dataset.period = period; return button; });
nodes['panel-analytics'].querySelectorAll = () => buttons;
const events = {};
const document = { getElementById: id => nodes[id], createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), addEventListener: (name, cb) => (events[name] ||= []).push(cb) };
nodes['analytics-reset-confirmation'].hidden=true;
const emit = (name, detail) => (events[name] || []).forEach(callback => callback({ detail }));
const requests = [];
const resets=[];
const windowEvents={};
const window = { AdminUI: { lastState: null, refresh() {} }, addEventListener(name,callback) {(windowEvents[name]||=[]).push(callback);}, InvoxBackend: { analytics: period => new Promise((resolve, reject) => requests.push({ period, resolve, reject })),resetAnalytics:()=>new Promise((resolve,reject)=>resets.push({resolve,reject})) } };
vm.runInNewContext(source, { document, window, Intl, Date });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(period, views = 0, downloads = 0, generation=1) {
  return { period, generation,timezone: 'America/Sao_Paulo', startedAt: generation===1?'2026-11-17T10:00:00Z':'2026-11-17T18:00:00Z', range: { start: '2026-11-16T03:00:00Z', end: '2026-11-17T19:00:00Z' }, series: [{ key: '2026-11-16T03:00:00Z', label: '16/11', views: 0, downloads: 0 }, { key: '2026-11-17T03:00:00Z', label: '17/11', views, downloads }], totals: { views, downloads }, allTime: { views: views + 20, downloads: downloads + 3 }, platforms: [{ platform: 'windows', downloads }, { platform: 'macos', downloads: 0 }, { platform: 'android', downloads: 0 }] };
}
(async () => {
  assert.equal(requests.length, 0, 'Não consulta antes do login');
  assert.equal(nodes['analytics-reset-open'].disabled,true);
  nodes['analytics-reset-confirm'].emit('click');assert.equal(resets.length,0,'Não inicia contagem antes do login');
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
  assert.match(nodes['analytics-started'].textContent, /histórico das contagens anteriores é preservado/);
  {
    const [plot,tooltip]=nodes['analytics-views-chart'].children;
    const cursor=plot.children.find(child=>child.attrs.class==='analytics-chart-cursor');
    const points=plot.children.filter(child=>child.attrs.class==='analytics-chart-point');
    assert.equal(cursor.attrs.visibility,'hidden');
    plot.emit('pointermove',{clientX:210});
    assert.equal(cursor.attrs.x1,'110');assert.equal(cursor.attrs.x2,'110');assert.equal(cursor.attrs.visibility,'visible');
    assert.match(tooltip.textContent,/16\/11\n0 visualizações · 0 downloads/);
    plot.emit('pointermove',{clientX:550});assert.equal(cursor.attrs.x1,'450','Linha segue o mouse, não salta entre pontos');
    assert.match(tooltip.textContent,/17\/11\n7 visualizações · 2 downloads/);
    assert.equal(points[1].classes.has('is-selected'),true);
    plot.emit('pointerleave');assert.equal(tooltip.hidden,true);assert.equal(cursor.attrs.visibility,'hidden');
    assert.equal(points.filter(point=>point.attrs.tabindex==='0').length,1,'Gráfico tem uma única entrada de Tab');
    points[0].focus();assert.equal(tooltip.hidden,false);assert.equal(cursor.attrs.x1,'40');
    let prevented=false;points[0].emit('keydown',{key:'ArrowRight',preventDefault(){prevented=true;}});
    assert(prevented);assert.equal(document.activeElement,points[1]);assert.equal(points[1].attrs.tabindex,'0');assert.equal(points[0].attrs.tabindex,'-1');
    assert.equal(cursor.attrs.x1,'606');assert.match(points[1].attrs['aria-label'],/7 visualizações e 2 downloads/);
    plot.emit('pointermove',{clientX:210});plot.emit('pointerleave');assert.equal(cursor.attrs.x1,'606','Ao sair do mouse mantém a inspeção do ponto em foco');
    points[1].emit('keydown',{key:'Home',preventDefault(){}});assert.equal(document.activeElement,points[0]);
    points[0].emit('keydown',{key:'End',preventDefault(){}});assert.equal(document.activeElement,points[1]);
    points[1].emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(tooltip.hidden,true);
    points[1].emit('keydown',{key:'Enter',preventDefault(){}});assert.equal(tooltip.hidden,false);
    buttons[2].focus();assert.equal(cursor.attrs.visibility,'hidden');
  }
  {
    const chart=nodes['analytics-views-chart'];chart.clientWidth=260;
    windowEvents.resize.forEach(callback=>callback());
    const [plot,tooltip]=chart.children;plot.rectWidth=260;
    let measuredWidth=203;
    tooltip.getBoundingClientRect=()=>{assert.equal(tooltip.hidden,false,'Mede o tooltip somente após exibi-lo');return {width:measuredWidth};};
    function insideChart(){
      assert.match(tooltip.style.left,/px$/);
      const center=Number.parseFloat(tooltip.style.left);
      assert(center-measuredWidth/2>=8,'Extremo esquerdo do tooltip permanece dentro do gráfico estreito');
      assert(center+measuredWidth/2<=252,'Extremo direito do tooltip permanece dentro do gráfico estreito');
    }
    plot.emit('pointermove',{clientX:100});insideChart();assert.match(tooltip.textContent,/16\/11/);
    measuredWidth=177;
    plot.emit('pointermove',{clientX:360});insideChart();assert.match(tooltip.textContent,/17\/11/);
    const points=plot.children.filter(child=>child.attrs.class==='analytics-chart-point');
    points[0].focus();insideChart();points[1].focus();insideChart();
    buttons[2].focus();chart.clientWidth=620;windowEvents.resize.forEach(callback=>callback());
  }
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
  const open=nodes['analytics-reset-open'],confirmation=nodes['analytics-reset-confirmation'],confirm=nodes['analytics-reset-confirm'],cancel=nodes['analytics-reset-cancel'];
  open.emit('click');assert.equal(confirmation.hidden,false);assert.equal(open.attrs['aria-expanded'],'true');assert.equal(document.activeElement,cancel);
  assert.equal(resets.length,0,'Abrir confirmação não inicia contagem');
  cancel.emit('click');assert.equal(confirmation.hidden,true);assert.equal(document.activeElement,open);assert.equal(resets.length,0);
  open.emit('click');confirmation.emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(confirmation.hidden,true);
  window.AdminAnalytics.refresh();const stale=requests.at(-1);
  open.emit('click');confirm.emit('click');
  assert.equal(resets.length,1);assert.equal(window.AdminAnalytics.getState().resetting,true);
  assert.equal(confirm.disabled,true);assert.equal(cancel.disabled,true);assert.equal(open.disabled,true);
  assert.equal(nodes['panel-analytics'].attrs['aria-busy'],'true');
  const beforeResetReload=requests.length;confirm.emit('click');buttons[0].emit('click');await window.AdminAnalytics.refresh();
  assert.equal(resets.length,1,'Confirmações repetidas não duplicam a operação');assert.equal(requests.length,beforeResetReload);assert.equal(window.AdminAnalytics.getState().period,'month');
  stale.resolve(fixture('month',100,100));await flush();assert.equal(nodes['analytics-views'].textContent,'7','Consulta anterior ao reset não altera o painel durante a operação');
  resets[0].resolve({startedAt:'2026-11-17T18:00:00Z',generation:2});await flush();
  assert.equal(confirmation.hidden,true);assert.equal(nodes['analytics-views'].textContent,'—','Sucesso invalida dados antigos enquanto recarrega');
  assert.equal(requests.length,beforeResetReload+1);assert.equal(requests.at(-1).period,'month');assert.match(nodes['analytics-reset-status'].textContent,/histórico anterior foi preservado/);
  requests.at(-1).resolve(fixture('month',999,999,1));await flush();
  assert.equal(nodes['analytics-views'].textContent,'—','Relatório de geração anterior não retorna após o reset');
  assert.equal(nodes['analytics-retry'].hidden,false);
  nodes['analytics-retry'].emit('click');const fresh=fixture('month',0,0,2);fresh.allTime={views:0,downloads:0};requests.at(-1).resolve(fresh);await flush();
  assert.equal(nodes['analytics-views'].textContent,'0');assert.equal(nodes['analytics-downloads'].textContent,'0');assert.match(nodes['analytics-started'].textContent,/às 15:00/);
  open.emit('click');confirm.emit('click');resets[1].reject(new Error('Não foi possível iniciar agora.'));await flush();
  assert.equal(nodes['analytics-views'].textContent,'0','Falha ao reiniciar preserva o relatório atual');assert.equal(confirmation.hidden,false);assert.equal(confirm.disabled,false);
  assert.equal(nodes['analytics-reset-status'].dataset.tone,'error');assert.match(nodes['analytics-reset-status'].textContent,/Não foi possível/);
  cancel.emit('click');open.emit('click');confirm.emit('click');const countBeforeLogout=requests.length;
  emit('invox:admin-clear');resets[2].resolve({startedAt:'2026-11-17T19:00:00Z',generation:3});await flush();
  assert.equal(requests.length,countBeforeLogout,'Reset atrasado não recarrega dados após logout');assert.equal(confirmation.hidden,true);assert.equal(open.disabled,true);assert.equal(nodes['analytics-reset-status'].textContent,'');
  emit('invox:admin-state',{});const logoutRequest=requests.at(-1);emit('invox:admin-clear');
  logoutRequest.resolve(fixture('week', 100, 100));
  await flush();
  assert.equal(nodes['analytics-views'].textContent, '—', 'Logout limpa e bloqueia respostas atrasadas');
  assert.equal(nodes['analytics-table-body'].children.length, 0);
  assert.equal(window.AdminAnalytics.getState().authenticated, false);
  assert.equal(window.AdminAnalytics.getState().busy, false);
  assert(!source.includes('innerHTML'));
  assert(html.includes('data-panel="analytics"') && html.includes('analytics.css') && html.includes('analytics.js'));
  console.log('PASS admin analytics: períodos, gráfico/tabela, cursor contínuo e tooltip, foco/setas, confirmação de nova contagem, busy/erros, gerações e respostas antigas, coalescência e logout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
