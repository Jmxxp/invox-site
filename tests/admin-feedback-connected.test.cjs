const fs=require('fs'),vm=require('vm'),assert=require('assert');
const nodes=new Map();
class Element {
constructor(tag){this.tagName=tag;this.children=[];this.events={};this.dataset={};this.attributes={};this.className='';this.value='';this.textContent='';this.classList={toggle:(name,value)=>{const c=new Set(this.className.split(/\s+/).filter(Boolean));value?c.add(name):c.delete(name);this.className=[...c].join(' ');}};}
set id(v){this._id=v;nodes.set(v,this);}get id(){return this._id;}
append(...v){this.children.push(...v);}replaceChildren(...v){this.children=v;}
setAttribute(k,v){this.attributes[k]=v;}
addEventListener(e,f){(this.events[e]||=[]).push(f);}
emit(e){(this.events[e]||[]).forEach(f=>f({target:this}));}
querySelectorAll(){return this.children.filter(e=>e.dataset&&e.dataset.filter);}
}
function element(id,tag='div'){const n=new Element(tag);n.id=id;return n;}
const panel=element('panel-feedback');
const filters=['all','new','answered'].map(filter=>{const n=new Element('button');n.dataset.filter=filter;panel.append(n);return n;});
const list=element('feedback-list'),detail=element('feedback-detail'),search=element('feedback-search','input');
['sidebar-new-count','stat-new','stat-answered','filter-all-count','filter-new-count','filter-answered-count'].forEach(id=>element(id));
const events={};
const document={getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),addEventListener:(key,fn)=>(events[key]??=[]).push(fn)};
const dispatch=(key,detail)=>{for(const fn of events[key]||[])fn({detail})};
const toasts=[],calls=[];let fail=false;
const window={AdminUI:{toast:(...args)=>toasts.push(args)},InvoxBackend:{updateFeedback:async payload=>{calls.push(payload);if(fail)throw Error('offline');return {...items.find(row=>row.id===payload.id),...payload}}}};
const source=fs.readFileSync(require('node:path').resolve(__dirname, '..', "painel-admin/feedback.js"),'utf8');
vm.runInNewContext(source,{document,window,Intl,Date,console});
const items=[{id:'old',name:'Fixture 02',contact:'fixture02@example.test',message:'A física precisa de mais opções.',status:'new',receivedAt:'2026-11-15T10:00:00Z',note:''},{id:'new',name:'Fixture 01',contact:'fixture01@example.test',message:'Uma mensagem mais recente e normal.',status:'new',receivedAt:'2026-11-16T10:00:00Z',note:''}];
const get=()=>window.AdminFeedback.getState();
const button=action=>detail.children.flatMap(c=>c.children||[]).find(c=>c.dataset&&c.dataset.action===action);
const count=id=>nodes.get(id).textContent;
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 assert.equal(get().items.length,0);dispatch('invox:admin-state',{feedbacks:items});assert.equal(list.children[0].dataset.feedbackId,'new');assert.equal(count('stat-new'),'2');
 const payload='<img src=x onerror=alert(1)> fixture';nodes.get('reply-note').value=payload;nodes.get('reply-note').emit('input');
 list.children[1].emit('click');list.children[0].emit('click');assert.equal(nodes.get('reply-note').value,payload);
 fail=true;button('mark-answered').emit('click');await flush();assert.equal(count('stat-new'),'2');assert.equal(get().items.find(r=>r.id==='new').status,'new');assert.equal(nodes.get('reply-note').value,payload);assert.equal(toasts.at(-1)[1],'error');
 fail=false;button('mark-answered').emit('click');await flush();assert.equal(count('stat-new'),'1');assert.equal(count('stat-answered'),'1');assert.equal(get().items.find(r=>r.id==='new').note,payload);assert.equal(calls.at(-1).status,'answered');
 nodes.get('reply-note').value='Anotação persistida';nodes.get('reply-note').emit('input');button('save-note').emit('click');await flush();assert.equal(calls.at(-1).status,'answered');assert.equal(get().items.find(r=>r.id==='new').note,'Anotação persistida');
 search.value='FISICA';search.emit('input');assert.equal(get().selectedId,'old');assert.equal(list.children.length,1);
 dispatch('invox:admin-clear');assert.equal(get().items.length,0);assert.equal(count('stat-new'),'0');assert.equal(count('stat-answered'),'0');assert.equal(search.value,'');assert.equal(detail.children[0].className,'detail-empty');
 assert(!/innerHTML|fetch\(|XMLHttpRequest|localStorage/.test(source));assert(!source.includes('makeDemo'));
 console.log('PASS connected feedback: real rows newest first; draft preservation; failed API never classifies; success persists status/note; note-only save; accent search; logout clears data; safe text rendering.');
})().catch(e=>{console.error(e);process.exitCode=1});
