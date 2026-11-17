const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const nodes=new Map(),events={};
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.events={};this.dataset={};this.value='';this.textContent='';this.disabled=false;}
 append(...items){this.children.push(...items)}replaceChildren(...items){this.children=items}
 setAttribute(key,value){this[key]=value}addEventListener(key,fn){(this.events[key]??=[]).push(fn)}
 async emit(key){await Promise.all((this.events[key]||[]).map(fn=>fn({preventDefault(){}})))}
 setCustomValidity(value){this.error=value}
}
for(const id of ['announcement-form','announcement-title','announcement-message','announcement-publish','announcement-status','announcement-list'])nodes.set(id,new Element(id));
const form=nodes.get('announcement-form'),title=nodes.get('announcement-title'),message=nodes.get('announcement-message'),status=nodes.get('announcement-status'),list=nodes.get('announcement-list');
form.reportValidity=()=>!title.error&&!message.error;
form.reset=()=>{title.value='';message.value=''};
let fail=false,pending=null;
const calls=[];
const fixture={id:'fixture-news',title:'Aviso',message:'Mensagem do recado',active:true,publishedAt:'2026-11-17T20:00:00Z'};
const window={AdminUI:{lastState:{announcements:[]}},InvoxBackend:{
 async saveAnnouncement(payload){calls.push(payload);if(fail)throw Error('offline');if(pending==='defer')return new Promise(resolve=>pending=resolve);return {...fixture,...payload}},
 async setAnnouncementActive(payload){calls.push(payload);if(fail)throw Error('offline');return {...fixture,...payload}}
}};
const document={getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),addEventListener:(key,fn)=>(events[key]??=[]).push(fn)};
const dispatch=(key,detail)=>{for(const fn of events[key]||[])fn({detail})};
const source=fs.readFileSync('painel-admin/announcements.js','utf8');
vm.runInNewContext(source,{document,window,Intl,Date,console});
(async()=>{
 await form.emit('submit');assert.equal(calls.length,0);assert(title.error&&message.error);
 title.value='  Aviso importante  ';message.value='  Conteúdo do recado  ';fail=true;await form.emit('submit');assert.equal(title.value,'Aviso importante');assert.equal(message.value,'Conteúdo do recado');assert.equal(nodes.get('announcement-publish').disabled,false);assert.equal(status.textContent,'offline');
 fail=false;await form.emit('submit');assert.equal(list.children.length,1);assert.equal(title.value,'');assert.equal(message.value,'');assert.match(status.textContent,/publicado/);assert.equal(calls.at(-1).title,'Aviso importante');
 let action=list.children[0].children.at(-1);await action.emit('click');assert.equal(calls.at(-1).active,false);assert.match(status.textContent,/desativado/);
 action=list.children[0].children.at(-1);await action.emit('click');assert.equal(calls.at(-1).active,true);assert.match(status.textContent,/não recebe um aviso repetido/);
 title.value='Rascunho';message.value='Texto que ainda estou escrevendo';dispatch('invox:admin-state',{announcements:[fixture]});assert.equal(title.value,'Rascunho');assert.equal(message.value,'Texto que ainda estou escrevendo');
 pending='defer';const saving=form.emit('submit');await form.emit('submit');assert.equal(nodes.get('announcement-publish').disabled,true);const count=calls.length;
 dispatch('invox:admin-clear');pending({...fixture,title:'Não deve reaparecer'});await saving;assert.equal(calls.length,count);assert.equal(title.value,'');assert.equal(message.value,'');assert.equal(list.children.length,1);assert.equal(list.children[0].textContent,'Nenhum recado publicado.');assert.equal(nodes.get('announcement-publish').disabled,false);
 assert(!source.includes('innerHTML'));assert(!source.includes('fetch('));
 const schema=fs.readFileSync('supabase/migrations/20261117194103_invox_game_announcements.sql','utf8');assert.match(schema,/enable row level security/);assert.match(schema,/revoke all.*from public, anon, authenticated/);assert.match(schema,/grant all.*to service_role/);
 console.log('PASS announcements: trimmed publish, failed send retains draft, server receipt, deactivate/reactivate, polling preserves draft, pending dedup, logout rejects stale response, safe text and private migration.');
})().catch(error=>{console.error(error);process.exitCode=1});
