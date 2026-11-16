const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '..', "site-oficial/script.js"), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Node {
  constructor(id='') { this.id=id;this.dataset={};this.events={};this.attrs={};this.value='';this.textContent='';this.disabled=false;this.open=false;this.isConnected=true;this.hidden=false; }
  setAttribute(k,v){this.attrs[k]=v;} removeAttribute(k){delete this.attrs[k];}
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
  const state={visibility:'public',version:'1.1.0',platforms:[{platform:'windows',available:true},{platform:'macos',available:false},{platform:'android',available:true}]};
  let error=null, response={url:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/test.exe?token=fixture',fileName:'INVOX-1.1.0.exe'};
  const api={publicState:async()=>{calls.push(['state']);if(error)throw error;return state;},download:async(platform,password='')=>{calls.push(['download',platform,password]);if(error)throw error;return response;}};
  const document={activeElement:null,body:{append:n=>downloads.push(n)},getElementById:id=>ids[id],querySelector:()=>null,querySelectorAll:q=>q==='[data-download]'?links:q==='[data-game-version]'?[version]:q==='dialog'?[ids['notice-dialog'],ids['download-password-dialog']]:[],createElement:()=>new Node(),addEventListener(){}};
  vm.runInNewContext(source,{document,window:{InvoxBackend:api},HTMLDialogElement:Node,HTMLElement:Node,Element:Node,URL});
  return {ids,links,version,downloads,calls,state,setError:value=>error=value,setResponse:value=>response=value};
}
(async()=>{
  const h=harness();await tick();
  assert.equal(h.version.textContent,'1.1.0');assert(h.links.every(link=>link.href==='#download'));
  await h.links[0].emit('click');assert.equal(h.calls.filter(c=>c[0]==='state').length,2);assert.equal(h.downloads.length,1);assert(h.downloads[0].clicked&&h.downloads[0].removed);
  await h.links[1].emit('click');assert.equal(h.downloads.length,1);assert.match(h.ids['download-status'].textContent,/ainda não está disponível/);
  h.state.visibility='private';await h.links[0].emit('click');assert(h.ids['download-password-dialog'].open);
  h.ids['download-password'].value='fake-password';h.setError({code:'invalid_password'});await h.ids['download-password-form'].emit('submit');assert(h.ids['download-password-dialog'].open);assert.equal(h.ids['download-password'].value,'');assert.match(h.ids['download-password-status'].textContent,/Senha incorreta/);
  h.setError(null);h.ids['download-password'].value='fake-password';await h.ids['download-password-form'].emit('submit');assert.equal(h.downloads.length,2);assert(!h.ids['download-password-dialog'].open);assert.equal(h.ids['download-password'].value,'');
  h.state.visibility='public';h.setError({code:'offline'});await h.links[0].emit('click');assert.equal(h.downloads.length,2);assert.equal(h.ids['download-retry'].hidden,false);
  h.setError(null);h.setResponse({url:'https://example.test/bypass.exe'});await h.links[0].emit('click');assert.equal(h.downloads.length,2);
  h.setResponse({url:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/public/bypass.exe'});await h.links[0].emit('click');assert.equal(h.downloads.length,2);
  h.state.platforms.forEach(item=>item.available=false);await h.ids['download-retry'].emit('click');assert.match(h.ids['download-status'].textContent,/Instaladores em preparação/);assert(!h.ids['download-status'].textContent.includes('Download liberado'));
  console.log('PASS public downloads: fresh access, availability, private password, wrong password remains open, signed download, offline fail-closed, untrusted/public URL rejected.');
})().catch(error=>{console.error(error);process.exitCode=1;});
