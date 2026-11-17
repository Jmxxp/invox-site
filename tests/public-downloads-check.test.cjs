const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '..', "site-oficial/script.js"), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Node {
  constructor(id='') { this.id=id;this.dataset={};this.events={};this.attrs={};this.value='';this.textContent='';this.disabled=false;this.open=false;this.isConnected=true;this.hidden=false; }
  setAttribute(k,v){this.attrs[k]=v;} removeAttribute(k){delete this.attrs[k];}
  getAttribute(k){return this.attrs[k];}
  addEventListener(k,fn){(this.events[k]||=[]).push(fn);}
  async emit(k,event={}){for(const fn of this.events[k]||[])await fn({preventDefault(){},...event});}
  querySelectorAll(){return [];} getClientRects(){return [1];} focus(){this.focused=true;}
  showModal(){this.open=true;} close(){this.open=false;return this.emit('close');}
  reportValidity(){return true;} getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
  click(){this.clicked=true;} remove(){this.removed=true;}
}
function harness(){
  const ids=Object.fromEntries(['download-status','download-retry','download-password-dialog','download-password-form','download-password','download-password-status','download-password-submit','download-password-description','notice-dialog','notice-title','notice-copy'].map(id=>[id,new Node(id)]));
  const links=['windows','macos','android'].map(platform=>{const n=new Node();n.dataset.download=platform;return n;});
  const version=new Node(),downloads=[],calls=[];
  const platformVersions=['windows','macos','android'].map(platform=>{const n=new Node();n.dataset.platformVersion=platform;return n;});
  const state={visibility:'public',version:'1.1.0',platforms:[{platform:'windows',available:true,version:'1.1.0'},{platform:'macos',available:false},{platform:'android',available:true,version:'1.0.8'}]};
  let error=null,downloadError=null,response={url:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/test.exe?token=fixture',fileName:'INVOX-1.1.0.exe'};
  const api={publicState:async()=>{calls.push(['state']);if(error)throw error;return state;},download:async(platform,password='')=>{calls.push(['download',platform,password]);if(error||downloadError)throw error||downloadError;return response;}};
  const events={},windowEvents={};
  const document={visibilityState:'visible',activeElement:null,body:{append:n=>downloads.push(n)},getElementById:id=>ids[id],querySelector:()=>null,querySelectorAll:q=>q==='[data-download]'?links:q==='[data-platform-version]'?platformVersions:q==='[data-game-version]'?[version]:q==='dialog'?[ids['notice-dialog'],ids['download-password-dialog']]:[],createElement:()=>new Node(),addEventListener:(name,fn)=>(events[name]||=[]).push(fn)};
  vm.runInNewContext(source,{document,window:{InvoxBackend:api,addEventListener:(name,fn)=>(windowEvents[name]||=[]).push(fn)},HTMLDialogElement:Node,HTMLElement:Node,Element:Node,URL,crypto:require('node:crypto').webcrypto});
  return {ids,links,version,platformVersions,downloads,calls,state,setError:value=>error=value,setDownloadError:value=>downloadError=value,setResponse:value=>response=value,focus:async()=>{for(const fn of windowEvents.focus||[])await fn({});},visible:async value=>{document.visibilityState=value;for(const fn of events.visibilitychange||[])await fn({});}};
}
(async()=>{
  const h=harness();assert(h.links.every(link=>link.attrs['aria-disabled']==='true'&&link.attrs.tabindex==='-1'),'Cards começam desativados enquanto consultam o servidor');await h.links[0].emit('click');assert.equal(h.downloads.length,0);await tick();
  assert.equal(h.version.textContent,'1.1.0');assert(h.links.every(link=>link.href==='#download'));
  assert.deepEqual(h.platformVersions.map(n=>n.textContent),['Versão 1.1.0','Versão 1.1.0 · Em preparação','Versão 1.0.8'],'Cada plataforma usa a versão do próprio instalador, com indicação de preparação quando ausente');
  assert.equal(h.links[0].attrs['aria-disabled'],'false');assert.equal(h.links[0].attrs.tabindex,undefined);assert.equal(h.links[1].attrs['aria-disabled'],'true');
  await h.links[0].emit('click');assert.equal(h.calls.filter(c=>c[0]==='state').length,2);assert.equal(h.downloads.length,1);assert(h.downloads[0].clicked&&h.downloads[0].removed);
  const callsBeforeDisabled=h.calls.length;await h.links[1].emit('click');assert.equal(h.downloads.length,1);assert.equal(h.calls.length,callsBeforeDisabled,'Card sem arquivo não faz requisição nem abre modal');assert.equal(h.ids['download-password-dialog'].open,false);
  h.state.visibility='private';await h.links[0].emit('click');assert(h.ids['download-password-dialog'].open);
  h.ids['download-password'].value='fake-password';h.setError({code:'invalid_password'});await h.ids['download-password-form'].emit('submit');assert(h.ids['download-password-dialog'].open);assert.equal(h.ids['download-password'].value,'');assert.match(h.ids['download-password-status'].textContent,/Código de acesso incorreto/);
  h.setError(null);h.ids['download-password'].value='fake-password';await h.ids['download-password-form'].emit('submit');assert.equal(h.downloads.length,2);assert(!h.ids['download-password-dialog'].open);assert.equal(h.ids['download-password'].value,'');
  h.state.visibility='public';h.setError({code:'offline'});await h.links[0].emit('click');assert.equal(h.downloads.length,2);assert.equal(h.ids['download-retry'].hidden,false);
  assert(h.links.every(link=>link.attrs['aria-disabled']==='true'));const offlineCalls=h.calls.length;await h.links[0].emit('click');assert.equal(h.calls.length,offlineCalls,'Offline mantém cards bloqueados até nova consulta');
  h.setError(null);await h.ids['download-retry'].emit('click');h.setResponse({url:'https://example.test/bypass.exe'});await h.links[0].emit('click');assert.equal(h.downloads.length,2);
  h.setResponse({url:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/public/bypass.exe'});await h.links[0].emit('click');assert.equal(h.downloads.length,2);
  h.state.platforms.forEach(item=>item.available=false);await h.ids['download-retry'].emit('click');assert.match(h.ids['download-status'].textContent,/Instaladores em preparação/);assert(!h.ids['download-status'].textContent.includes('Download liberado'));
  assert(h.links.every(link=>link.attrs['aria-disabled']==='true'&&link.attrs.tabindex==='-1'));
  h.state.platforms[1].available=true;h.state.platforms[1].version='1.1.2';h.setResponse({url:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/mac.zip?token=fixture'});await h.focus();assert.equal(h.links[1].attrs['aria-disabled'],'false','Voltar ao site ativa instalador publicado sem reload');await h.links[1].emit('click');assert.equal(h.downloads.length,3);
  h.state.platforms[1].available=false;await h.links[1].emit('click');assert.equal(h.downloads.length,3);assert.equal(h.links[1].attrs['aria-disabled'],'true','Remoção no servidor bloqueia antes do download');
  h.state.platforms[0].available=true;const beforeHidden=h.calls.length;await h.visible('hidden');assert.equal(h.calls.length,beforeHidden);await h.visible('visible');assert.equal(h.links[0].attrs['aria-disabled'],'false');h.setDownloadError({code:'unavailable'});await h.links[0].emit('click');assert.equal(h.downloads.length,3);assert.equal(h.links[0].attrs['aria-disabled'],'true','Falha de disponibilidade após consulta também desativa');
  console.log('PASS public downloads: initial/loading/unavailable/offline disabled, safe click guard, keyboard exclusion, focus/visibility refresh, fresh access, private password, signed URL validation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
