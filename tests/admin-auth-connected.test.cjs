const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').resolve(__dirname, '..', "painel-admin/index.html"),'utf8');
const source=fs.readFileSync(require('node:path').resolve(__dirname, '..', "painel-admin/admin.js"),'utf8');
class Element{
 constructor(id){this.id=id;this.value='';this.textContent='';this.hidden=id==='admin-shell';this.disabled=false;this.dataset={};this.events={};this.attrs={};this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),contains:k=>this.classes.has(k),toggle:(k,v)=>v?this.classes.add(k):this.classes.delete(k)};}
 addEventListener(k,f){(this.events[k]??=[]).push(f)}
 emit(k,e={}){return Promise.all((this.events[k]||[]).map(f=>f({preventDefault(){},...e})));}
 setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}focus(){}reportValidity(){return true}
 querySelectorAll(){return this.children||[]}
}
const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
const panels=['feedback','access','downloads'].map(k=>nodes['panel-'+k]);
const nav=['feedback','access','downloads'].map(k=>{const n=new Element(k);n.dataset.panel=k;return n});
nodes['admin-sidebar'].querySelector=()=>nav.find(n=>n.classes.has('is-active'));
nodes['login-form'].children=[nodes['login-password-submit']];
const listeners={}, dispatched=[];
const document={body:new Element('body'),querySelector:s=>nodes[s.slice(1)],getElementById:id=>nodes[id],querySelectorAll:s=>s==='.admin-panel'?panels:nav,addEventListener:(k,f)=>(listeners[k]??=[]).push(f),dispatchEvent:e=>{dispatched.push(e);(listeners[e.type]||[]).forEach(f=>f(e))}};
let currentSession=null,authChange,failLogin=false,failState=false,failOffline=false,loginCall,poll=null,permissionRequests=0;
const notifications=[];
class Notification{static permission='default';static async requestPermission(){permissionRequests++;this.permission='granted';return 'granted'}constructor(title,options){notifications.push({title,options})}close(){}}
const state={admin:{username:'fixture'},settings:{version:'1.1.0'},feedbacks:[{id:'baseline',name:'Antes',status:'new',receivedAt:'2026-11-17T10:00:00Z'}],installers:[]};
const api={auth:{getSession:async()=>({data:{session:currentSession}}),onAuthStateChange:f=>{authChange=f},signOut:async()=>({error:null})},signIn:async(u,p)=>{loginCall=[u,p];if(failLogin)throw new Error('Credenciais inválidas');currentSession={access_token:'fixture'}},adminState:async()=>{if(failState)throw Object.assign(new Error('Negado'),{code:'forbidden'});if(failOffline)throw Object.assign(new Error('Offline'),{code:'offline'});return state}};
const window={InvoxBackend:api,Notification,innerWidth:1200,addEventListener(){},setInterval(fn,ms){assert.equal(ms,20000);poll=fn;return 1},clearInterval(){poll=null}};
const context={document,window,location:{hash:'',protocol:'http:'},CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail}},setTimeout,clearTimeout};
vm.runInNewContext(source,context);
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 await flush();assert.equal(nodes['admin-shell'].hidden,true);assert.equal(nodes['admin-auth'].hidden,false);
 nodes['login-username'].value=' fixture ';nodes['login-password'].value='test-only-password';
 failLogin=true;await nodes['login-form'].emit('submit');await flush();
 assert.equal(nodes['admin-shell'].hidden,true);assert.match(nodes['login-status'].textContent,/inválidas/);assert.equal(nodes['login-password'].value,'');
 failLogin=false;failState=true;nodes['login-password'].value='test-only-password';
 await nodes['login-form'].emit('submit');await flush();
 assert.equal(nodes['admin-shell'].hidden,true);assert.match(nodes['login-status'].textContent,/permissão/);assert.equal(window.AdminUI.lastState,null);
 failState=false;nodes['login-password'].value='test-only-password';await nodes['login-form'].emit('submit');await flush();
 assert.deepEqual(loginCall,['fixture','test-only-password']);assert.equal(nodes['admin-shell'].hidden,false);assert.equal(nodes['admin-auth'].hidden,true);
 assert.equal(nodes['admin-email'].textContent,'fixture');assert.equal(nodes['summary-version'].textContent,'1.1.0');assert.equal(window.AdminUI.lastState,state);
 assert(dispatched.some(e=>e.type==='invox:admin-state'&&e.detail===state));
 assert(poll);assert.equal(notifications.length,0);assert.equal(permissionRequests,0);
 await nodes['enable-feedback-notifications'].emit('click');assert.equal(permissionRequests,1);
 state.feedbacks.push({id:'new-game',name:'Jogador',kind:'suggestion',source:'game',status:'new',receivedAt:'2026-11-17T10:01:00Z'});poll();await flush();assert.equal(notifications.length,1);assert.match(notifications[0].title,/sugestão/);
 poll();await flush();assert.equal(notifications.length,1);
 state.feedbacks.push({id:'unseen-old',name:'Antigo',status:'new',receivedAt:'2026-11-16T10:00:00Z'});poll();await flush();assert.equal(notifications.length,1);
 failOffline=true;poll();await flush();assert.equal(nodes['admin-shell'].hidden,false);assert.equal(window.AdminUI.lastState,state);assert.match(nodes['feedback-notification-status'].textContent,/preservadas/);failOffline=false;
 await nodes['admin-signout'].emit('click');assert.equal(nodes['admin-shell'].hidden,true);assert.equal(window.AdminUI.lastState,null);assert.equal(nodes['admin-email'].textContent,'');assert.equal(nodes['summary-version'].textContent,'—');assert(dispatched.some(e=>e.type==='invox:admin-clear'));
 assert.equal(poll,null);
 assert(!source.includes('signInWithOtp'));assert(!/innerHTML/.test(source));assert(!html.includes('id="login-email"'));assert(!html.includes('example.test'));assert(!html.includes('reset-demo'));
 console.log('PASS admin auth: login falho fecha painel; permissão validada no servidor; usuário/senha; estado real; logout limpa estado e PII; sem signup/OTP/dados de exemplo.');
})().catch(e=>{console.error(e);process.exitCode=1});
