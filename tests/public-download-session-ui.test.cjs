const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../site-oficial/script.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Node {
 constructor(){this.dataset={};this.events={};this.attrs={};this.value='';this.textContent='';this.disabled=false;this.open=false;this.isConnected=true;this.hidden=false;}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,fn){(this.events[k]||=[]).push(fn);}
 async emit(k,event={}){for(const fn of this.events[k]||[])await fn({preventDefault(){},...event});}
 querySelectorAll(){return [];}getClientRects(){return [1];}focus(){this.focused=true;}reportValidity(){return true;}
 showModal(){this.open=true;}close(){this.open=false;return this.emit('close');}getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
 click(){this.clicked=true;}remove(){this.removed=true;}
}
function harness(){
 const ids=Object.fromEntries(['download-status','download-retry','download-lock','download-password-dialog','download-password-form','download-password','download-password-status','download-password-submit','download-password-description','notice-dialog','notice-title','notice-copy'].map(id=>[id,new Node()]));
 const links=['windows','macos','android'].map(platform=>{const element=new Node();element.dataset.download=platform;return element;});
 const state={visibility:'private',version:'1.1.0',platforms:[{platform:'windows',available:true}]};
 const events={},windowEvents={},downloads=[],calls=[];
 let grant=true,expired=false,logoutError=false;
 const signal=()=>{for(const callback of windowEvents['invox:download-session']||[])callback({});};
 const api={publicState:async()=>state,hasDownloadSession:()=>grant,download:async(platform,password='')=>{
  calls.push(['download',platform,password]);
  if(expired){grant=false;signal();throw {code:'password_required'};}
  if(password){grant=true;signal();}
  return {url:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/test.exe?token=fixture',fileName:'INVOX.exe'};
 },lockDownloads:async()=>{calls.push(['lock']);grant=false;signal();if(logoutError)throw Error('Offline');}};
 const document={activeElement:null,body:{append:element=>downloads.push(element)},getElementById:id=>ids[id],querySelector:()=>null,querySelectorAll:q=>q==='[data-download]'?links:q==='dialog'?[ids['notice-dialog'],ids['download-password-dialog']]:[],createElement:()=>new Node(),addEventListener:(name,callback)=>(events[name]||=[]).push(callback)};
 const window={InvoxBackend:api,addEventListener:(name,callback)=>(windowEvents[name]||=[]).push(callback)};
 vm.runInNewContext(source,{document,window,HTMLDialogElement:Node,HTMLElement:Node,Element:Node,URL});
 return {ids,links,state,downloads,calls,setGrant:value=>{grant=value;for(const callback of windowEvents.storage||[])callback({});},setExpired:value=>expired=value,setLogoutError:value=>logoutError=value};
}
(async()=>{
 const h=harness();await tick();
 assert.equal(h.ids['download-lock'].hidden,false,'Sessão persistida aparece após carregar a página');
 await h.links[0].emit('click');
 assert.equal(h.ids['download-password-dialog'].open,false,'Sessão válida dispensa pedir senha outra vez');
 assert.equal(h.downloads.length,1);assert.deepEqual(h.calls[0],['download','windows','']);
 h.setGrant(false);assert.equal(h.ids['download-lock'].hidden,true,'Mudança em outra aba atualiza controle');
 await h.links[0].emit('click');assert.equal(h.ids['download-password-dialog'].open,true);
 h.ids['download-password'].value='fixture-password';await h.ids['download-password-form'].emit('submit');
 assert.equal(h.downloads.length,2);assert.equal(h.ids['download-password-dialog'].open,false);assert.equal(h.ids['download-password'].value,'');assert.equal(h.ids['download-lock'].hidden,false);
 h.setExpired(true);await h.links[0].emit('click');
 assert.equal(h.ids['download-password-dialog'].open,true,'Token revogado/expirado pede nova senha');assert.equal(h.ids['download-lock'].hidden,true);
 h.setExpired(false);await h.ids['download-password-dialog'].close();h.setGrant(true);
 await h.ids['download-lock'].emit('click');assert.equal(h.ids['download-lock'].hidden,true);assert.match(h.ids['download-status'].textContent,/encerrado neste navegador/);
 h.setGrant(true);h.setLogoutError(true);await h.ids['download-lock'].emit('click');
 assert.equal(h.ids['download-lock'].hidden,true);assert.match(h.ids['download-status'].textContent,/Sem conexão para confirmar/);
 h.setGrant(true);h.state.visibility='public';await h.ids['download-retry'].emit('click');
 assert.equal(h.ids['download-lock'].hidden,true,'Modo público não mostra logout privado');
 assert(!source.includes('localStorage'),'UI não grava senha ou token diretamente');
 console.log('PASS visitor download session UI: persisted grant bypasses password modal, cross-tab update, renewal after expiry, explicit lock and truthful offline lock.');
})().catch(error=>{console.error(error);process.exitCode=1;});
