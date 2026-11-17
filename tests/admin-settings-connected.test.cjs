const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(value = '') {
    this.value = value; this.checked = false; this.hidden = false; this.disabled = false;
    this.required = false; this.type = 'text'; this.textContent = ''; this.className = '';
    this.files = []; this.children = {}; this.listeners = {}; this.attributes = {}; this.dataset = {};
    this.validationMessage = ''; this.classes = new Set();
    this.classList = {
      toggle: (key, enabled) => enabled ? this.classes.add(key) : this.classes.delete(key),
      add: key => this.classes.add(key), remove: key => this.classes.delete(key)
    };
  }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  emit(name, extra = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
    event.completion = Promise.all((this.listeners[name] || []).map(listener => listener(event)));
    return event;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { return this.children[selector] || null; }
  closest() { return this.parent; }
  contains(element) { return element === this; }
  setCustomValidity(message) { this.validationMessage = message; }
}

const ids = Object.fromEntries([
  'access-form', 'release-form', 'private-password-fields', 'site-password', 'toggle-password',
  'release-version', 'release-notes', 'access-preview-status', 'access-preview-icon',
  'access-preview-description', 'summary-version', 'release-history-list', 'release-history-empty', 'release-history-count',
  'universal-enabled','universal-key-settings','download-code-form','download-code-label','download-code-max','download-code-validity',
  'download-code-create','download-code-create-label','download-code-result','download-code-result-label','download-code-secret',
  'download-code-copy','download-code-hide','download-code-status','download-code-count','download-code-empty','download-code-list'
].map(id => [id, new Element()]));
const accessForm = ids['access-form'];
const releaseForm = ids['release-form'];
const password = ids['site-password'];
const version = ids['release-version'];
const notes = ids['release-notes'];
const universal=ids['universal-enabled'];universal.checked=true;
const codeForm=ids['download-code-form'];ids['download-code-max'].value='1';ids['download-code-validity'].value='';
codeForm.reportValidity=()=>['download-code-label','download-code-max','download-code-validity'].every(id=>!ids[id].validationMessage);
codeForm.reset=()=>{ids['download-code-label'].value='';ids['download-code-max'].value='1';ids['download-code-validity'].value=''};
const radios = ['public', 'private'].map(value => {
  const element = new Element(value); element.parent = new Element(); return element;
});
radios[0].checked = true;
accessForm.querySelectorAll = selector => { assert.equal(selector, '[name="site-visibility"]'); return radios; };
accessForm.reportValidity = () => password.disabled || (!password.validationMessage && password.value.length >= 8);
releaseForm.reportValidity = () => Boolean(version.value && !version.validationMessage);
accessForm.reset = () => { radios[0].checked = true; radios[1].checked = false; password.value = ''; };
releaseForm.reset = () => { version.value = '1.0.0'; notes.value = ''; };
ids['toggle-password'].children.i = new Element();
version.value = '1.0.0';

const platformElements = {};
for (const platform of ['windows', 'macos', 'android']) {
  const input = ids['installer-' + platform] = new Element();
  const platformVersion = ids['installer-version-' + platform] = new Element();
  const saveVersion = ids['save-platform-version-' + platform] = new Element();
  const selected = new Element();
  selected.children['.file-name'] = new Element(); selected.children['.file-size'] = new Element();
  const error = new Element(); const dropzone = new Element(); const remove = new Element();
  dropzone.children['.dropzone-title'] = new Element();
  releaseForm.children[`.selected-file[data-platform="${platform}"]`] = selected;
  releaseForm.children[`.file-error[data-platform="${platform}"]`] = error;
  releaseForm.children[`.dropzone[data-platform="${platform}"]`] = dropzone;
  releaseForm.children[`.remove-file[data-platform="${platform}"]`] = remove;
  platformElements[platform] = { input, selected, error, dropzone, remove, version:platformVersion, saveVersion };
}
Element.prototype.removeAttribute=function(key){delete this.attributes[key]};
Element.prototype.append=function(...children){(this.childNodes??=[]).push(...children);for(const child of children)if(child.className==='current-installer')this.children['.current-installer']=child};
Element.prototype.replaceChildren=function(...children){this.childNodes=children};
const cardElements=[];
for(const item of Object.values(platformElements)){const card=new Element();cardElements.push(card);item.dropzone.parent=card;}
for(const id of ['release-progress','upload-progress','upload-status','upload-limit'])ids[id]=new Element();
const accessControls=[...radios,password,universal,ids['toggle-password']];
const releaseControls=[version,notes,...Object.values(platformElements).flatMap(row=>[row.input,row.remove,row.version,row.saveVersion])];
accessForm.querySelectorAll=selector=>selector.includes('site-visibility')?radios:accessControls;
releaseForm.querySelectorAll=()=>releaseControls;
releaseForm.reportValidity=()=>Boolean(version.value&&!version.validationMessage&&Object.values(platformElements).every(item=>!item.version.validationMessage));
accessForm.reportValidity=()=>password.disabled||(!password.validationMessage&&(!password.required||password.value.length>=8));
const docEvents={};
const document={getElementById:id=>{assert(ids[id],id);return ids[id]},createElement:()=>new Element(),querySelectorAll:()=>cardElements.map(c=>c.children['.current-installer']).filter(Boolean),addEventListener:(key,fn)=>(docEvents[key]??=[]).push(fn)};
const dispatch=(type,detail)=>{for(const fn of docEvents[type]||[])fn({detail})};
const toasts=[],calls={access:[],uploads:[],releases:[],metadata:[]};
let failAccess=false,failRelease=false,failMetadata=false;
let server={settings:{visibility:'private',hasPassword:true,version:'1.1.0',releaseNotes:'Atualização real',uploadLimitBytes:1024},installers:[],history:[]};
const backend={
 saveAccess:async payload=>{calls.access.push({...payload});if(failAccess)throw Error('offline');server.settings={...server.settings,visibility:payload.visibility,hasPassword:payload.visibility==='private'};return server.settings},
 uploadInstaller:async payload=>{calls.uploads.push(payload);payload.onProgress(37.5);assert.equal(ids['upload-progress'].value,37.5,'large uploads keep progress updates');return {platform:payload.platform,path:'fixture/'+payload.file.name,fileName:payload.file.name,size:payload.file.size}},
 saveRelease:async payload=>{
  calls.releases.push(payload);if(failRelease)throw Error('offline');
  const installers=new Map(server.installers.map(item=>[item.platform,item]));for(const file of payload.files)installers.set(file.platform,{...file});
  server={...server,settings:{...server.settings,version:payload.version,releaseNotes:payload.releaseNotes},installers:[...installers.values()]};return server;
 },
 updateInstallerVersion:async(platform,nextVersion)=>{
  calls.metadata.push({platform,version:nextVersion});if(failMetadata)throw Error('metadata offline');
  server={...server,installers:server.installers.map(item=>item.platform===platform?{...item,version:nextVersion}:item)};return server;
 }
};
const copied=[];const window={InvoxBackend:backend,AdminUI:{toast:(...args)=>toasts.push(args)},crypto:require('node:crypto').webcrypto,navigator:{clipboard:{writeText:async text=>copied.push(text)}}};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../painel-admin/settings.js'),'utf8'),{window,document,AbortController},{filename:'settings.js'});
const snapshot=()=>JSON.parse(JSON.stringify(window.AdminSettings.getState()));
const chooseVisibility=value=>{radios.forEach(r=>{r.checked=r.value===value});radios.find(r=>r.checked).emit('change');accessForm.emit('change')};
const submit=async form=>{const event=form.emit('submit');assert(event.defaultPrevented);await event.completion};
const fixture=(name,size=512)=>({name,size,type:'application/octet-stream',lastModified:1});
const treeText=element=>[element.textContent||'',...(element.childNodes||[]).map(treeText)].join(' ');
const edit=(element,value)=>{element.value=value;element.emit('input');releaseForm.emit('input',{target:element})};
async function independentVersions(){
 const win=platformElements.windows,android=platformElements.android,mac=platformElements.macos;
 dispatch('invox:admin-state',server);
 assert.equal(win.version.value,'1.1.1');assert.equal(android.version.value,'');assert.equal(mac.version.value,'');
 assert.equal(win.saveVersion.hidden,false);assert.equal(android.saveVersion.hidden,true);assert.equal(mac.saveVersion.hidden,true);
 edit(version,'2.0.0');assert.equal(win.version.value,'1.1.1','general version does not overwrite a published platform');
 win.input.files=[fixture('independent.exe')];win.input.emit('change');edit(win.version,'2.1.0');
 android.input.files=[fixture('independent.apk')];android.input.emit('change');assert.equal(android.version.value,'2.0.0','new platform starts from the general version');edit(android.version,'3.4.5');edit(mac.version,'9.8.7');
 const beforeUploads=calls.uploads.length;
 dispatch('invox:admin-state',{...server,settings:{...server.settings,version:'8.0.0'},installers:server.installers.map(row=>({...row,version:'1.7.0'}))});
 assert.equal(version.value,'2.0.0');assert.equal(win.version.value,'2.1.0');assert.equal(android.version.value,'3.4.5');assert.equal(mac.version.value,'9.8.7');assert.equal(snapshot().selectedFiles.windows.name,'independent.exe');
 await win.saveVersion.emit('click').completion;assert.equal(calls.metadata.length,0,'selected replacement cannot alter the current file metadata');
 failRelease=true;await submit(releaseForm);assert.equal(calls.uploads.length,beforeUploads+2);
 assert.equal(calls.uploads.at(-2).version,'2.1.0');assert.equal(calls.uploads.at(-1).version,'3.4.5');
 edit(win.version,'2.1.1');edit(android.version,'3.4.6');failRelease=false;await submit(releaseForm);
 assert.equal(calls.uploads.length,beforeUploads+2,'editing metadata after a failed publication never resends the completed bytes');
 assert.equal(calls.releases.at(-1).version,'2.0.0');assert.equal(calls.releases.at(-1).files.find(file=>file.platform==='windows').version,'2.1.1');assert.equal(calls.releases.at(-1).files.find(file=>file.platform==='android').version,'3.4.6');
 assert.equal(win.version.value,'2.1.1');assert.equal(android.version.value,'3.4.6');assert.equal(mac.version.value,'9.8.7','an unsubmitted platform draft survives another publication');assert.equal(mac.saveVersion.hidden,true);
 const original={...server.installers.find(row=>row.platform==='windows')};
 const beforeMetadata=calls.metadata.length;edit(win.version,'invalid');await win.saveVersion.emit('click').completion;assert.equal(calls.metadata.length,beforeMetadata,'invalid platform version never reaches the API');
 edit(win.version,'2.2.0');assert.equal(win.saveVersion.disabled,false);failMetadata=true;await win.saveVersion.emit('click').completion;
 assert.equal(win.version.value,'2.2.0');assert.equal(server.installers.find(row=>row.platform==='windows').version,'2.1.1');assert.equal(toasts.at(-1)[1],'error');
 failMetadata=false;await win.saveVersion.emit('click').completion;
 const current=server.installers.find(row=>row.platform==='windows');assert.equal(current.version,'2.2.0');assert.equal(current.path,original.path);assert.equal(current.fileName,original.fileName);assert.equal(current.size,original.size);assert.equal(server.settings.version,'2.0.0');assert.equal(calls.uploads.length,beforeUploads+2);assert.equal(win.saveVersion.disabled,true);assert.equal(android.version.value,'3.4.6');assert.equal(mac.version.value,'9.8.7');
 server={...server,settings:{...server.settings,version:'2.0.1'}};dispatch('invox:admin-state',server);assert.equal(version.value,'2.0.1','a platform-only draft does not freeze the untouched general version');assert.equal(mac.version.value,'9.8.7');
 const base={id:'current',platform:'windows',version:'2.2.0',fileName:'<img src=x onerror=alert(1)>.exe',size:512,publishedAt:'2026-11-17T19:48:04Z',action:'version_updated',isCurrent:true,migrated:false};
 server.history=[{...base,id:'imported',version:'1.1.1',publishedAt:'2026-11-17T19:48:03Z',action:'published',isCurrent:false,migrated:true},base,{...base,id:'unknown-date',publishedAt:'invalid',isCurrent:false}];
 dispatch('invox:admin-state',server);
 assert.equal(ids['release-history-list'].childNodes.length,3);assert.equal(ids['release-history-count'].textContent,'3 registros');assert.equal(ids['release-history-empty'].hidden,true);
 const newest=ids['release-history-list'].childNodes[0];assert.match(treeText(newest),/Windows · v2\.2\.0/);assert.match(treeText(newest),/Atual/);assert.match(treeText(newest),/17\/11\/2026, 16:48:04 · Brasília/);assert.match(treeText(newest),/Versão atualizada sem reenviar o arquivo/);assert.match(treeText(newest),/<img src=x onerror=alert\(1\)>\.exe/);assert.equal(newest.childNodes[2].dateTime,'2026-11-17T19:48:04.000Z');assert.match(treeText(ids['release-history-list']),/Registro importado/);assert.match(treeText(ids['release-history-list']),/Data indisponível/);
 server.history=Array.from({length:105},(_,index)=>({...base,id:String(index),publishedAt:new Date(Date.parse(base.publishedAt)-index*1000).toISOString()}));dispatch('invox:admin-state',server);assert.equal(ids['release-history-list'].childNodes.length,100,'history is bounded');
 const metadataToasts=toasts.length;let finishMetadata;backend.updateInstallerVersion=()=>new Promise(resolve=>{finishMetadata=resolve});edit(win.version,'2.3.0');const late=win.saveVersion.emit('click');dispatch('invox:admin-clear');finishMetadata(server);await late.completion;assert.equal(toasts.length,metadataToasts);assert.equal(win.version.value,'');assert.equal(ids['release-history-list'].childNodes.length,0);assert.equal(win.saveVersion.hidden,true);
 server.history=[];
}
async function accessCodeControls(){
 dispatch('invox:admin-clear');
 server={...server,settings:{...server.settings,visibility:'private',hasPassword:false,universalEnabled:false},downloadCodes:[]};
 backend.saveAccess=async payload=>{calls.access.push({...payload});if(failAccess)throw Error('offline');server.settings={...server.settings,visibility:payload.visibility,universalEnabled:payload.universalEnabled,hasPassword:payload.visibility==='private'&&Boolean(payload.password||server.settings.hasPassword)};return server.settings};
 dispatch('invox:admin-state',server);
 assert.equal(universal.checked,false);assert.equal(password.required,false);assert.equal(password.disabled,true);assert.equal(ids['access-preview-status'].textContent,'Downloads por código');
 const accessCount=calls.access.length;await submit(accessForm);assert.equal(calls.access.length,accessCount+1,'private code-only mode can save without a universal hash');assert.equal(calls.access.at(-1).universalEnabled,false);assert.equal(calls.access.at(-1).password,'');
 universal.checked=true;universal.emit('change');assert.equal(password.required,true);assert.equal(password.disabled,false);await submit(accessForm);assert.equal(calls.access.length,accessCount+1,'enabling without an existing key requires a key');
 password.value='new-universal-key';password.emit('input');await submit(accessForm);assert.equal(calls.access.at(-1).universalEnabled,true);assert.equal(password.value,'');assert.equal(snapshot().settings.hasPassword,true);
 universal.checked=false;universal.emit('change');dispatch('invox:admin-state',{...server,settings:{...server.settings,universalEnabled:true}});assert.equal(universal.checked,false,'realtime keeps an unsaved universal toggle');
 failAccess=true;await submit(accessForm);assert.equal(snapshot().settings.universalEnabled,true,'failed save does not change the published preview');failAccess=false;await submit(accessForm);assert.equal(snapshot().settings.universalEnabled,false);
 const codeCalls=[],secretById=new Map();let rows=[],failCreation=false,revokeMode='ok';
 const rowCopies=()=>rows.map(row=>({...row}));
 backend.createDownloadCode=async payload=>{
  codeCalls.push({...payload});let row=rows.find(item=>item.id===payload.id);
  if(!row){row={id:payload.id,label:payload.label,maxUses:payload.maxUses,usedCount:0,remainingUses:payload.maxUses,createdAt:'2026-11-17T20:00:00Z',expiresAt:null,revokedAt:null,status:'active',prefix:'IVX-TEST'};rows.push(row);secretById.set(payload.id,'IVX-'+payload.id+'-SECRET');}
  server.downloadCodes=rowCopies();if(failCreation){failCreation=false;throw Error('Conexão perdida');}
  return {code:secretById.get(payload.id),entry:{...row},downloadCodes:rowCopies()};
 };
 backend.revokeDownloadCode=async id=>{if(revokeMode==='error')throw Error('offline');if(revokeMode==='ok'){const row=rows.find(item=>item.id===id);row.status='revoked';row.revokedAt='2026-11-17T21:00:00Z';}return{downloadCodes:rowCopies()}};
 const walk=node=>[node,...(node.childNodes||[]).flatMap(walk)];
 const revokeButton=id=>walk(ids['download-code-list']).find(node=>node.dataset?.revokeCode===id);
 assert.equal(ids['download-code-max'].value,'1');assert.equal(ids['download-code-validity'].value,'');
 ids['download-code-label'].value='<img src=x> Testador';ids['download-code-label'].emit('input');
 failCreation=true;await submit(codeForm);assert.equal(codeCalls.length,1);assert.equal(codeCalls[0].maxUses,1);assert.equal(codeCalls[0].validForHours,null);assert.equal(ids['download-code-secret'].value,'');assert.match(ids['download-code-status'].textContent,/perdida/);
 dispatch('invox:admin-state',server);assert.equal(ids['download-code-secret'].value,'','realtime never restores a full code from metadata');await submit(codeForm);
 assert.equal(codeCalls.length,2);assert.equal(codeCalls[0].id,codeCalls[1].id,'retry keeps the same creation UUID');assert.equal(rows.length,1);
 const firstId=codeCalls[1].id,firstSecret=secretById.get(firstId);assert.equal(ids['download-code-secret'].value,firstSecret);assert.equal(ids['download-code-result'].hidden,false);assert(!JSON.stringify(snapshot()).includes(firstSecret),'public UI state does not expose the one-time secret');assert(treeText(ids['download-code-list']).includes('<img src=x> Testador'),'labels are literal text');
 await ids['download-code-copy'].emit('click').completion;assert.equal(copied.at(-1),firstSecret);assert.match(ids['download-code-status'].textContent,/copiado/);
 window.navigator.clipboard.writeText=async()=>{throw Error('permission denied')};Element.prototype.focus=function(){document.activeElement=this};Element.prototype.select=function(){this.selectionStart=0;this.selectionEnd=this.value.length};
 await ids['download-code-copy'].emit('click').completion;assert.match(ids['download-code-status'].textContent,/manualmente/);assert.equal(ids['download-code-secret'].value,firstSecret);
 ids['download-code-hide'].emit('click');assert.equal(ids['download-code-secret'].value,'');assert.equal(ids['download-code-result'].hidden,true);
 ids['download-code-max'].value='1001';ids['download-code-max'].emit('input');await submit(codeForm);assert.equal(codeCalls.length,2,'out-of-range max does not request a code');
 ids['download-code-max'].value='5';ids['download-code-max'].emit('input');ids['download-code-validity'].value='168';ids['download-code-validity'].emit('change');
 failCreation=true;await submit(codeForm);const oldAttempt=codeCalls.at(-1).id;ids['download-code-max'].value='6';ids['download-code-max'].emit('input');await submit(codeForm);assert.notEqual(codeCalls.at(-1).id,oldAttempt,'changed parameters start a new creation intent');assert.equal(codeCalls.at(-1).maxUses,6);assert.equal(codeCalls.at(-1).validForHours,168);
 const lastId=codeCalls.at(-1).id;assert.equal(ids['download-code-secret'].value,secretById.get(lastId));revokeMode='unconfirmed';await revokeButton(lastId).emit('click').completion;assert.match(ids['download-code-status'].textContent,/não confirmou/);assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'active','unconfirmed response cannot show a revoked code');
 revokeMode='error';await revokeButton(lastId).emit('click').completion;assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'active');
 revokeMode='ok';await revokeButton(lastId).emit('click').completion;assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'revoked');assert.equal(ids['download-code-secret'].value,'');assert.equal(revokeButton(lastId),undefined);
 const stale=rowCopies().map(row=>row.id===lastId?{...row,status:'active',revokedAt:null}:row);dispatch('invox:admin-state',{...server,downloadCodes:stale});assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'revoked','stale realtime cannot reactivate a known revocation');
 ids['download-code-label'].value='Rascunho em edição';ids['download-code-label'].emit('input');ids['download-code-max'].value='9';ids['download-code-max'].emit('input');dispatch('invox:admin-state',{...server,downloadCodes:rowCopies()});assert.equal(ids['download-code-label'].value,'Rascunho em edição');assert.equal(ids['download-code-max'].value,'9');
 let finishCode;backend.createDownloadCode=payload=>new Promise(resolve=>{finishCode=()=>resolve({code:'LATE-SECRET',entry:{id:payload.id,label:payload.label,maxUses:payload.maxUses,usedCount:0,remainingUses:payload.maxUses,status:'active',createdAt:'2026-11-17T20:00:00Z',expiresAt:null,revokedAt:null},downloadCodes:[]})});
 const late=codeForm.emit('submit');assert.equal(snapshot().codeBusy,true);dispatch('invox:admin-clear');finishCode();await late.completion;assert.equal(ids['download-code-secret'].value,'');assert.equal(ids['download-code-result'].hidden,true);assert.equal(snapshot().downloadCodes.length,0);assert.equal(ids['download-code-max'].value,'1');assert.equal(ids['download-code-create'].disabled,true,'logout clears secrets and ignores late creation responses');
}
(async()=>{
 assert.equal(snapshot().settings.uploadLimitBytes,1610612736,'fallback permits 1.5GB before server settings arrive');
 dispatch('invox:admin-state',server);assert.equal(version.value,'1.1.0');assert.equal(notes.value,'Atualização real');assert.equal(password.required,false);assert.equal(ids['access-preview-status'].textContent,'Chave e códigos de acesso');
 assert.equal(snapshot().settings.uploadLimitBytes,1024,'the server limit overrides the fallback');assert.match(ids['upload-limit'].textContent,/1 KB/);
 await submit(accessForm);assert.equal(calls.access.length,1);assert.equal(calls.access[0].password,'');
 chooseVisibility('public');dispatch('invox:admin-state',server);assert.equal(radios[0].checked,true);assert.equal(ids['access-preview-status'].textContent,'Chave e códigos de acesso');
 failAccess=true;await submit(accessForm);assert.equal(snapshot().settings.visibility,'private');assert.equal(toasts.at(-1)[1],'error');
 failAccess=false;await submit(accessForm);assert.equal(snapshot().settings.visibility,'public');assert.equal(ids['access-preview-status'].textContent,'Downloads liberados');
 chooseVisibility('private');password.value='short';await submit(accessForm);assert.equal(snapshot().settings.visibility,'public');
 password.value='fixture-password';password.emit('input');await submit(accessForm);assert.equal(snapshot().settings.visibility,'private');assert.equal(password.value,'');assert(!JSON.stringify(snapshot()).includes('fixture-password'));
 const windows=platformElements.windows;
 windows.input.files=[fixture('fixture.exe')];windows.input.emit('change');assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');
 windows.input.files=[fixture('wrong.apk')];windows.input.emit('change');assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');
 windows.input.files=[fixture('large.exe',1025)];windows.input.emit('change');assert.match(windows.error.textContent,/arquivo entre/);assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');
 server.settings.uploadLimitBytes=1610612736;dispatch('invox:admin-state',server);assert.match(ids['upload-limit'].textContent,/1,5 GB/);
 windows.input.files=[fixture('fixture.exe',1610612736)];windows.input.emit('change');assert.equal(windows.error.textContent,'');assert.equal(snapshot().selectedFiles.windows.size,1610612736);assert.match(windows.selected.children['.file-size'].textContent,/1,5 GB/);
 windows.input.files=[fixture('too-large.exe',1610612737)];windows.input.emit('change');assert.match(windows.error.textContent,/1,5 GB/);assert.equal(snapshot().selectedFiles.windows.size,1610612736,'oversized selection preserves the previously accepted file');
 version.value='1.1.1';version.emit('input');notes.value='Fixture release';releaseForm.emit('input');
 dispatch('invox:admin-state',server);assert.equal(version.value,'1.1.1');
 failRelease=true;await submit(releaseForm);assert.equal(calls.uploads.length,1);assert.equal(calls.uploads[0].file.size,1610612736,'a file at the limit reaches the upload backend');assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');assert.equal(ids['summary-version'].textContent,'1.1.0');assert.match(ids['upload-status'].textContent,/não foi concluída/);
 failRelease=false;await submit(releaseForm);assert.equal(calls.uploads.length,1,'retry reutiliza upload concluído');assert.equal(calls.releases.length,2);assert.equal(calls.releases[1].files[0].fileName,'fixture.exe');assert.equal(snapshot().selectedFiles.windows,null);assert.equal(ids['summary-version'].textContent,'1.1.1');assert.equal(ids['upload-progress'].value,100);
 dispatch('invox:admin-clear');assert.equal(password.value,'');assert.equal(notes.value,'');assert.equal(snapshot().selectedFiles.windows,null);assert.equal(ids['release-progress'].hidden,true);assert.equal(cardElements[0].children['.current-installer'].textContent,'');assert.equal(snapshot().settings.uploadLimitBytes,1610612736,'logout restores the fallback limit');
 await independentVersions();
 server.settings.multipartPartSizeBytes=20*1024*1024;server.settings.objectUploadLimitBytes=50*1024*1024;server.storage={capacityBytes:1000000000,usedBytes:0,reservedBytes:40*1024*1024,availableBytes:958056960};dispatch('invox:admin-state',server);assert.match(ids['upload-limit'].textContent,/partes de 20 MB/);assert.match(ids['upload-limit'].textContent,/Espaço disponível/);assert.match(ids['upload-limit'].textContent,/40 MB reservados/);
 const pending=[];backend.uploadInstaller=payload=>new Promise(resolve=>pending.push({payload,resolve}));
 windows.input.files=[fixture('first.exe')];windows.input.emit('change');version.value='1.2.0';const first=releaseForm.emit('submit');assert.equal(pending.length,1);assert.equal(pending[0].payload.objectUploadLimitBytes,50*1024*1024);assert.equal(pending[0].payload.signal.aborted,false);dispatch('invox:admin-clear');assert.equal(pending[0].payload.signal.aborted,true,'logout aborts the active transport');
 dispatch('invox:admin-state',server);windows.input.files=[fixture('second.exe')];windows.input.emit('change');version.value='1.2.1';const second=releaseForm.emit('submit');assert.equal(pending.length,2);assert.equal(version.disabled,true);const currentStatus=ids['upload-status'].textContent;pending[0].payload.onStatus('stale update');assert.equal(ids['upload-status'].textContent,currentStatus);pending[0].resolve({platform:'windows',fileName:'first.exe',size:512,path:'fixture/first.exe'});await first.completion;assert.equal(version.disabled,true,'old finally cannot unlock a new session upload');
 pending[1].payload.onStatus('Verificando partes');assert.match(ids['upload-status'].textContent,/Windows: Verificando partes/);pending[1].resolve({kind:'multipart',uploadId:'fixture-id',platform:'windows',fileName:'second.exe',size:512,sha256:'fixture'});await second.completion;assert.equal(version.disabled,false);assert.equal(calls.releases.at(-1).files[0].kind,'multipart');dispatch('invox:admin-clear');
 await accessCodeControls();
 console.log('PASS connected settings: independent versions/history, universal toggle/key rotation, bounded download codes, one-time secret display, idempotent retry, revoke/copy confirmation, realtime drafts and logout.');
})().catch(error=>{console.error(error);process.exitCode=1});
