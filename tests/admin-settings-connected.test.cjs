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
  'universal-enabled','universal-key-settings','download-code-form','download-code-quantity','download-code-label','download-code-max','download-code-validity',
  'download-code-create','download-code-create-label','download-code-result','download-code-result-label','download-code-secret',
  'download-code-copy','download-code-hide','download-code-status','download-code-count','download-code-empty','download-code-list',
  'download-code-copy-quantity','download-code-restart','download-code-refresh','download-code-copy-progress',
  'download-code-count-used','download-code-empty-used','download-code-list-used',
  'download-code-count-inactive','download-code-empty-inactive','download-code-list-inactive',
  'download-code-count-legacy','download-code-empty-legacy','download-code-list-legacy',
  'storage-replacement','storage-replacement-review','storage-replacement-start','storage-replacement-confirm','storage-replacement-cancel',
  'storage-replacement-current','storage-replacement-next','storage-replacement-warning','storage-replacement-status'
].map(id => [id, new Element()]));
const accessForm = ids['access-form'];
const releaseForm = ids['release-form'];
const password = ids['site-password'];
const version = ids['release-version'];
const notes = ids['release-notes'];
const universal=ids['universal-enabled'];universal.checked=true;
const codeForm=ids['download-code-form'];ids['download-code-quantity'].value='1';ids['download-code-max'].value='1';ids['download-code-validity'].value='';
ids['download-code-copy-quantity'].value='1';
codeForm.reportValidity=()=>['download-code-quantity','download-code-label','download-code-max','download-code-validity'].every(id=>!ids[id].validationMessage);
codeForm.reset=()=>{ids['download-code-quantity'].value='1';ids['download-code-label'].value='';ids['download-code-max'].value='1';ids['download-code-validity'].value=''};
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
async function storageReplacementControls(){
 const previousServer=server,previousUpload=backend.uploadInstaller,previousRelease=backend.saveRelease,previousPrepare=backend.prepareInstallerReplacement;
 const win=platformElements.windows,oldId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
 const current={platform:'windows',kind:'multipart',path:null,uploadId:'44444444-4444-4444-8444-444444444444',sha256:'a'.repeat(64),fileName:'old.exe',size:549447078,version:'1.1.0',updatedAt:'2026-11-18T00:00:00Z',currentHistoryId:oldId};
 const other={platform:'android',path:'published/android.apk',fileName:'android.apk',size:100,version:'1.0.0',updatedAt:'2026-11-18T00:00:00Z',currentHistoryId:otherId};
 const selected=fixture('<img src=x>.exe',984000000),prepares=[],attempts=[],published=[];let allowed=false,mode='pending',finishPrepare;
 const resetServer=()=>{server={settings:{visibility:'public',hasPassword:false,universalEnabled:true,version:'1.1.0',releaseNotes:'',uploadLimitBytes:1610612736},installers:[{...current},{...other}],history:[],storage:{capacityBytes:1000000000,usedBytes:566231140,reservedBytes:0,availableBytes:433768860}};dispatch('invox:admin-state',server)};
 const prepared=pending=>({...server,installers:server.installers.filter(row=>row.platform!=='windows'),storage:{...server.storage,availableBytes:pending?0:999999900},replacement:{platform:'windows',historyId:oldId,fileName:current.fileName,size:current.size,startedAt:'2026-11-18T00:00:01Z',completedAt:pending?null:'2026-11-18T00:00:02Z'},releasedBytes:pending?0:current.size,replacementPending:pending});
 backend.uploadInstaller=async payload=>{attempts.push(payload);if(!allowed)throw Object.assign(Error('Sem espaço'),{code:'storage_quota_exceeded'});return{platform:payload.platform,path:'new/file.exe',fileName:payload.file.name,size:payload.file.size}};
 backend.saveRelease=async payload=>{published.push(payload);server={...server,settings:{...server.settings,version:payload.version,releaseNotes:payload.releaseNotes},installers:[...server.installers.filter(row=>!payload.files.some(file=>file.platform===row.platform)),...payload.files]};return server};
 backend.prepareInstallerReplacement=async payload=>{prepares.push(payload);if(mode==='bad')return{...server,replacementPending:false};if(mode==='deferred')return new Promise(resolve=>{finishPrepare=()=>resolve(prepared(false))});server=prepared(mode==='pending');if(mode!=='pending')allowed=true;return server};
 try {
  dispatch('invox:admin-clear');resetServer();edit(version,'2.0.0');edit(notes,'Novidades preservadas');win.input.files=[selected];win.input.emit('change');edit(win.version,'2.1.0');assert.equal(prepares.length,0,'selecting a replacement never deletes active bytes');await submit(releaseForm);assert.equal(prepares.length,0,'a first quota failure never deletes active bytes');assert.equal(ids['storage-replacement'].hidden,false);assert.match(ids['storage-replacement-current'].textContent,/old\.exe/);assert(ids['storage-replacement-next'].textContent.includes(selected.name),'filenames render as text');assert.match(ids['storage-replacement-warning'].textContent,/em andamento/);assert.equal(snapshot().selectedFiles.windows.size,selected.size);
  ids['storage-replacement-start'].emit('click');assert.equal(ids['storage-replacement-review'].hidden,false);ids['storage-replacement-cancel'].emit('click');assert.equal(ids['storage-replacement-review'].hidden,true);assert.equal(prepares.length,0,'canceling review keeps the active installer');ids['storage-replacement-start'].emit('click');edit(win.version,'2.1.1');assert.equal(ids['storage-replacement'].hidden,true,'editing a version invalidates the concrete deletion plan');await ids['storage-replacement-confirm'].emit('click').completion;assert.equal(prepares.length,0);
  await submit(releaseForm);ids['storage-replacement-start'].emit('click');server={...server,installers:server.installers.map(row=>row.platform==='windows'?{...row,currentHistoryId:'33333333-3333-4333-8333-333333333333'}:row)};dispatch('invox:admin-state',server);await ids['storage-replacement-confirm'].emit('click').completion;assert.equal(prepares.length,0,'a concurrent publication cannot be deleted using the old confirmation');assert.match(ids['upload-status'].textContent,/mudou/);assert.equal(snapshot().selectedFiles.windows.name,selected.name);
  resetServer();win.input.files=[fixture('too-big.exe',1100000000)];win.input.emit('change');await submit(releaseForm);assert.equal(ids['storage-replacement'].hidden,true,'a new installer that cannot fit alone never gets a destructive option');win.input.files=[selected];win.input.emit('change');await submit(releaseForm);ids['storage-replacement-start'].emit('click');const beforePending=attempts.length;await ids['storage-replacement-confirm'].emit('click').completion;assert.equal(prepares.length,1);assert.deepEqual(JSON.parse(JSON.stringify(prepares[0])),{platform:'windows',expectedHistoryId:oldId,confirm:true,replacement:{fileName:selected.name,size:selected.size,version:'2.1.1'}});assert.equal(attempts.length,beforePending,'pending storage cleanup never starts an upload');assert.equal(snapshot().selectedFiles.windows.name,selected.name);assert.equal(win.version.value,'2.1.1');assert.equal(version.value,'2.0.0');assert.equal(notes.value,'Novidades preservadas');assert.match(ids['storage-replacement-status'].textContent,/pendente/);
  mode='complete';await ids['storage-replacement-confirm'].emit('click').completion;assert.equal(prepares.length,2);assert.equal(prepares[1].expectedHistoryId,oldId,'retry finishes the same exact job');assert.equal(attempts.length,beforePending+1);assert.equal(attempts.at(-1).file,selected,'automatic retry uses the same File');assert.equal(attempts.at(-1).version,'2.1.1');assert.equal(published.length,1);assert.equal(published[0].version,'2.0.0');assert.equal(published[0].releaseNotes,'Novidades preservadas');assert.equal(snapshot().selectedFiles.windows,null);assert.equal(server.installers.find(row=>row.platform==='android').path,other.path,'other platforms remain published');assert.equal(ids['storage-replacement'].hidden,true);
  const publishNormally=backend.saveRelease;backend.saveRelease=async()=>{throw Object.assign(Error('Quota na publicação'),{code:'storage_quota_exceeded'})};win.input.files=[selected];win.input.emit('change');await submit(releaseForm);const readyAttempts=attempts.length;assert.equal(ids['storage-replacement'].hidden,true,'a publication failure after completed bytes never offers active-file deletion');edit(win.version,'2.2.0');await submit(releaseForm);assert.equal(attempts.length,readyAttempts,'editing the version retries completed bytes without a destructive path');assert.equal(ids['storage-replacement'].hidden,true);backend.saveRelease=publishNormally;
  allowed=false;mode='bad';dispatch('invox:admin-clear');resetServer();win.input.files=[selected];win.input.emit('change');await submit(releaseForm);ids['storage-replacement-start'].emit('click');const beforeUnconfirmed=attempts.length;await ids['storage-replacement-confirm'].emit('click').completion;assert.equal(attempts.length,beforeUnconfirmed,'unconfirmed cleanup cannot retry publication');assert.match(ids['storage-replacement-status'].textContent,/não confirmou/);assert.equal(snapshot().selectedFiles.windows.name,selected.name);
  mode='deferred';const staleConfirmation=ids['storage-replacement-confirm'].emit('click');assert.equal(typeof finishPrepare,'function');dispatch('invox:admin-clear');finishPrepare();await staleConfirmation.completion;assert.equal(attempts.length,beforeUnconfirmed,'logout suppresses late cleanup callbacks and automatic uploads');assert.equal(ids['storage-replacement'].hidden,true);assert.equal(snapshot().selectedFiles.windows,null);
 } finally {dispatch('invox:admin-clear');server=previousServer;backend.uploadInstaller=previousUpload;backend.saveRelease=previousRelease;backend.prepareInstallerReplacement=previousPrepare;}
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
 const codeCalls=[],selectCalls=[],secretById=new Map(),batches=new Map();let rows=[],failCreation=false,revokeMode='ok',malformed=false,sequence=0;
 const rowCopies=()=>rows.map(row=>({...row}));
 const fresh=()=>({valid:[],used:[],inactive:[],legacy:[],totals:{valid:0,used:0,inactive:0,legacy:0},evaluatedAt:new Date().toISOString()});
 const poolOf=()=>{const pool=fresh();for(const row of rows){const key=row.codeFormat==='legacy'?'legacy':row.usedCount>0?'used':row.status==='active'?'valid':'inactive';pool.totals[key]++;if(pool[key].length<100)pool[key].push({...row,...(key==='legacy'?{}:{code:secretById.get(row.id)})})}return pool};
 const store=()=>{server.downloadCodes=rowCopies();server.codePool=poolOf()};
 backend.downloadCodePool=async()=>poolOf();
 backend.createDownloadCodes=async payload=>{
  codeCalls.push({...payload});let entries=batches.get(payload.id);
  if(!entries){entries=Array.from({length:payload.count},()=>{const id=require('node:crypto').randomUUID();const row={id,label:payload.label,maxUses:payload.maxUses,usedCount:0,remainingUses:payload.maxUses,createdAt:'2026-11-17T20:00:00Z',expiresAt:null,revokedAt:null,status:'active',prefix:'TOKEN',codeFormat:'short'};rows.push(row);secretById.set(id,(++sequence).toString(36).toUpperCase().padStart(6,'0'));return row});batches.set(payload.id,entries);}
  store();if(failCreation){failCreation=false;throw Error('Conexão perdida');}
  return {codes:malformed?[]:entries.map(row=>secretById.get(row.id)),entries:entries.map(row=>({...row})),downloadCodes:rowCopies()};
 };
 backend.selectDownloadCodes=async payload=>{selectCalls.push({...payload,excludeIds:[...payload.excludeIds]});const entries=rows.filter(row=>row.codeFormat==='short'&&row.usedCount===0&&row.status==='active'&&!payload.excludeIds.includes(row.id)).slice(0,payload.count);return{codes:entries.map(row=>secretById.get(row.id)),entries:entries.map(row=>({...row})),evaluatedAt:new Date().toISOString(),availableCount:entries.length,totalEligible:entries.length}};
 backend.revokeDownloadCode=async id=>{if(revokeMode==='error')throw Error('offline');if(revokeMode==='ok'){const row=rows.find(item=>item.id===id);row.status='revoked';row.revokedAt='2026-11-17T21:00:00Z';}store();return{downloadCodes:rowCopies()}};
 const walk=node=>[node,...(node.childNodes||[]).flatMap(walk)];
 const revokeButton=id=>walk(ids['download-code-list']).find(node=>node.dataset?.revokeCode===id);
 assert.equal(ids['download-code-quantity'].value,'1');assert.equal(ids['download-code-max'].value,'1');assert.equal(ids['download-code-validity'].value,'');
 ids['download-code-quantity'].value='3';ids['download-code-quantity'].emit('input');
 failCreation=true;await submit(codeForm);assert.equal(codeCalls.length,1);assert.equal(codeCalls[0].count,3);assert.equal(codeCalls[0].label,'','only the quantity is needed');assert.equal(codeCalls[0].maxUses,1);assert.equal(codeCalls[0].validForHours,null);assert.equal(ids['download-code-secret'].value,'');assert.match(ids['download-code-status'].textContent,/perdida/);
 dispatch('invox:admin-state',server);assert.equal(ids['download-code-secret'].value,'','realtime never restores a full code from metadata');await submit(codeForm);
 assert.equal(codeCalls.length,2);assert.equal(codeCalls[0].id,codeCalls[1].id,'retry keeps the same batch UUID');assert.equal(rows.length,3,'lost acknowledgement cannot duplicate a batch');
 const firstEntries=batches.get(codeCalls[1].id),firstSecret=firstEntries.map(row=>secretById.get(row.id)).join('\n\n');assert(firstEntries.every(row=>row.id!==codeCalls[1].id),'entry UUIDs differ from the batch UUID');assert.equal(ids['download-code-secret'].value,firstSecret);assert.equal(ids['download-code-result'].hidden,false);assert(!JSON.stringify(snapshot()).includes(firstEntries.map(row=>secretById.get(row.id))[0]),'public UI state does not expose the one-time secrets');assert.equal(snapshot().downloadCodes.length,3,'every token remains in the metadata list');
 assert(firstEntries.every(row=>secretById.get(row.id).length===6));assert(treeText(ids['download-code-list']).includes(secretById.get(firstEntries[0].id)),'available tokens show their six-character identifier');
 ids['download-code-copy-quantity'].value='2';await ids['download-code-copy'].emit('click').completion;assert.equal(copied.at(-1),firstEntries.slice(0,2).map(row=>secretById.get(row.id)).join('\n\n'),'clipboard has one blank line between valid tokens');assert.equal(selectCalls.at(-1).excludeIds.length,0);assert.match(ids['download-code-status'].textContent,/copiados/);assert.match(treeText(ids['download-code-list']),/Copiado nesta rodada/);
 await ids['download-code-copy'].emit('click').completion;assert.equal(selectCalls.at(-1).excludeIds.length,2);assert.equal(copied.at(-1),secretById.get(firstEntries[2].id),'the last partial group never repeats previous IDs');assert.match(ids['download-code-status'].textContent,/restante/);
 const copiedBeforeEmpty=copied.length;await ids['download-code-copy'].emit('click').completion;assert.equal(copied.length,copiedBeforeEmpty,'empty group never touches the clipboard');assert.match(ids['download-code-status'].textContent,/Não há próximos/);
 ids['download-code-restart'].emit('click');ids['download-code-copy-quantity'].value='1';await ids['download-code-copy'].emit('click').completion;assert.equal(copied.at(-1),secretById.get(firstEntries[0].id),'only an explicit new round repeats an available token');
 window.navigator.clipboard.writeText=async()=>{throw Error('permission denied')};Element.prototype.focus=function(){document.activeElement=this};
 ids['download-code-copy-quantity'].value='2';await ids['download-code-copy'].emit('click').completion;const failedExcludes=selectCalls.at(-1).excludeIds;assert.match(ids['download-code-status'].textContent,/grupo não avançou/);assert.equal(ids['download-code-secret'].value,firstEntries.slice(1).map(row=>secretById.get(row.id)).join('\n\n'));
 firstEntries[1].usedCount=1;firstEntries[1].remainingUses=0;firstEntries[1].status='exhausted';store();dispatch('invox:admin-state',server);assert(!treeText(ids['download-code-list']).includes(secretById.get(firstEntries[1].id)),'used tokens leave available immediately');assert(treeText(ids['download-code-list-used']).includes(secretById.get(firstEntries[1].id)),'used tokens remain identifiable by the full six characters');assert.match(treeText(ids['download-code-list-used']),/USADO/);
 window.navigator.clipboard.writeText=async text=>copied.push(text);await ids['download-code-copy'].emit('click').completion;assert.deepEqual(selectCalls.at(-1).excludeIds,failedExcludes,'clipboard failure does not advance the round');assert.equal(copied.at(-1),secretById.get(firstEntries[2].id),'retry revalidates the group and excludes a token used since the failure');
 ids['download-code-hide'].emit('click');assert.equal(ids['download-code-secret'].value,'');assert.equal(ids['download-code-result'].hidden,true);
 for(const invalid of ['0','101','1.5']){ids['download-code-quantity'].value=invalid;ids['download-code-quantity'].emit('input');await submit(codeForm);assert.equal(codeCalls.length,2,'invalid token quantity does not call the backend');}
 ids['download-code-quantity'].value='2';ids['download-code-quantity'].emit('input');
 ids['download-code-max'].value='1001';ids['download-code-max'].emit('input');await submit(codeForm);assert.equal(codeCalls.length,2,'out-of-range max does not request a code');
 ids['download-code-label'].value='<img src=x> Testador';ids['download-code-label'].emit('input');
 ids['download-code-max'].value='5';ids['download-code-max'].emit('input');ids['download-code-validity'].value='168';ids['download-code-validity'].emit('change');
 failCreation=true;await submit(codeForm);const oldAttempt=codeCalls.at(-1).id;ids['download-code-quantity'].value='4';ids['download-code-quantity'].emit('input');await submit(codeForm);assert.notEqual(codeCalls.at(-1).id,oldAttempt,'changed quantity starts a new batch intent');assert.equal(codeCalls.at(-1).count,4);assert.equal(codeCalls.at(-1).maxUses,5);assert.equal(codeCalls.at(-1).validForHours,168);assert(treeText(ids['download-code-list']).includes('<img src=x> Testador'),'labels are literal text');
 const lastEntries=batches.get(codeCalls.at(-1).id),lastId=lastEntries[0].id,lastSecret=lastEntries.map(row=>secretById.get(row.id)).join('\n\n');assert.equal(ids['download-code-secret'].value,lastSecret);lastEntries[1].usedCount=1;lastEntries[1].remainingUses=4;store();dispatch('invox:admin-state',server);assert(!treeText(ids['download-code-list']).includes(secretById.get(lastEntries[1].id)),'a partially used multi-use token is not redistributed');assert(treeText(ids['download-code-list-used']).includes(secretById.get(lastEntries[1].id)));revokeMode='unconfirmed';await revokeButton(lastId).emit('click').completion;assert.match(ids['download-code-status'].textContent,/não confirmou/);assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'active','unconfirmed response cannot show a revoked code');
 revokeMode='error';await revokeButton(lastId).emit('click').completion;assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'active');
 revokeMode='ok';await revokeButton(lastId).emit('click').completion;assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'revoked');assert.equal(ids['download-code-secret'].value,'','a no-longer-valid preview is cleared');assert.equal(revokeButton(lastId),undefined);assert(treeText(ids['download-code-list-inactive']).includes(secretById.get(lastId)));
 const stale=rowCopies().map(row=>row.id===lastId?{...row,status:'active',revokedAt:null}:row);dispatch('invox:admin-state',{...server,downloadCodes:stale});assert.equal(snapshot().downloadCodes.find(row=>row.id===lastId).status,'revoked','stale realtime cannot reactivate a known revocation');
 const confirmedBatch=codeCalls.at(-1).id;await submit(codeForm);assert.notEqual(codeCalls.at(-1).id,confirmedBatch,'a confirmed batch starts a fresh UUID on the next generation');
 malformed=true;await submit(codeForm);const unconfirmedBatch=codeCalls.at(-1).id;assert.match(ids['download-code-status'].textContent,/confirmar/);assert.equal(ids['download-code-secret'].value,'','unconfirmed malformed responses never display a partial list');malformed=false;ids['download-code-quantity'].emit('input');await submit(codeForm);assert.equal(codeCalls.at(-1).id,unconfirmedBatch,'same parameters keep the retry UUID even after an input event');
 for(const invalid of ['0','101','1.2']){const before=selectCalls.length;ids['download-code-copy-quantity'].value=invalid;await ids['download-code-copy'].emit('click').completion;assert.equal(selectCalls.length,before,'invalid copy quantity does not call selection')}
 ids['download-code-copy-quantity'].value='2';
 const legacy={id:require('node:crypto').randomUUID(),label:'Token antigo',maxUses:1,usedCount:0,remainingUses:1,status:'active',createdAt:'2026-11-17T18:00:00Z',codeFormat:'legacy',prefix:'IVX-OLD'};rows.push(legacy);store();dispatch('invox:admin-state',server);assert.match(treeText(ids['download-code-list-legacy']),/IVX-OLD/);assert(!JSON.stringify(snapshot()).includes(secretById.get(lastId)),'pool secrets never leak into public getState');
 dispatch('invox:admin-clear');dispatch('invox:admin-state',server);assert(treeText(ids['download-code-list']).includes(secretById.get(firstEntries[0].id)),'authorized pool survives reload from server state');assert.equal(ids['download-code-secret'].value,'');await ids['download-code-copy'].emit('click').completion;assert.equal(selectCalls.at(-1).excludeIds.length,0,'a new login starts a new copy round');
 const selector=backend.selectDownloadCodes;let finishStaleSelection,staleRow;
 backend.selectDownloadCodes=payload=>new Promise(resolve=>{staleRow=rows.find(row=>row.codeFormat==='short'&&row.usedCount===0&&row.status==='active'&&!payload.excludeIds.includes(row.id));const stale={...staleRow};finishStaleSelection=()=>resolve({codes:[secretById.get(stale.id)],entries:[stale]})});
 const racingCopy=ids['download-code-copy'].emit('click'),beforeRace=copied.length;staleRow.usedCount=1;staleRow.remainingUses-=1;if(!staleRow.remainingUses)staleRow.status='exhausted';store();dispatch('invox:admin-state',server);finishStaleSelection();await racingCopy.completion;assert.equal(copied.length,beforeRace,'a stale selection response cannot copy a token already marked used by Realtime');assert.match(ids['download-code-status'].textContent,/Não há próximos/);backend.selectDownloadCodes=selector;
 backend.selectDownloadCodes=payload=>new Promise(resolve=>{staleRow=rows.find(row=>row.codeFormat==='short'&&row.usedCount===0&&row.status==='active'&&!payload.excludeIds.includes(row.id));const stale={...staleRow};finishStaleSelection=()=>resolve({codes:[secretById.get(stale.id)],entries:[stale]})});
 const racingExpiry=ids['download-code-copy'].emit('click'),beforeExpiry=copied.length;staleRow.status='expired';staleRow.expiresAt='2026-11-17T19:00:00Z';store();dispatch('invox:admin-state',server);finishStaleSelection();await racingExpiry.completion;assert.equal(copied.length,beforeExpiry,'an older active selection cannot reactivate a token expired by a fresh pool');assert.equal(snapshot().downloadCodes.find(row=>row.id===staleRow.id).status,'expired');assert(!treeText(ids['download-code-list']).includes(secretById.get(staleRow.id)));assert(treeText(ids['download-code-list-inactive']).includes(secretById.get(staleRow.id)));backend.selectDownloadCodes=selector;
 window.navigator.clipboard.writeText=undefined;await ids['download-code-copy'].emit('click').completion;assert.match(ids['download-code-status'].textContent,/manualmente/);assert(!ids['download-code-status'].textContent.includes('clipboard unavailable'));window.navigator.clipboard.writeText=async text=>copied.push(text);
 const savedRows=rows;rows=Array.from({length:501},()=>{const row={id:require('node:crypto').randomUUID(),label:'Rodada extensa',maxUses:1,usedCount:0,remainingUses:1,status:'active',createdAt:'2026-11-17T20:00:00Z',codeFormat:'short'};secretById.set(row.id,(++sequence).toString(36).toUpperCase().padStart(6,'0'));return row});store();dispatch('invox:admin-clear');dispatch('invox:admin-state',server);ids['download-code-copy-quantity'].value='100';let firstLargeCopy;
 for(let i=0;i<5;i++){await ids['download-code-copy'].emit('click').completion;if(i===0)firstLargeCopy=copied.at(-1)}assert.match(ids['download-code-copy-progress'].textContent,/500 copiados/);assert.equal(ids['download-code-copy'].disabled,true);const selectionCallsAtLimit=selectCalls.length;await ids['download-code-copy'].emit('click').completion;assert.equal(selectCalls.length,selectionCallsAtLimit,'500 IDs require an explicit new round');ids['download-code-restart'].emit('click');await ids['download-code-copy'].emit('click').completion;assert.equal(copied.at(-1),firstLargeCopy,'only the explicit restart reuses the beginning of the pool');rows=savedRows;store();dispatch('invox:admin-clear');dispatch('invox:admin-state',server);
 ids['download-code-label'].value='Rascunho em edição';ids['download-code-label'].emit('input');ids['download-code-max'].value='9';ids['download-code-max'].emit('input');ids['download-code-quantity'].value='7';ids['download-code-quantity'].emit('input');dispatch('invox:admin-state',{...server,downloadCodes:rowCopies()});assert.equal(ids['download-code-label'].value,'Rascunho em edição');assert.equal(ids['download-code-max'].value,'9');assert.equal(ids['download-code-quantity'].value,'7');
 let finishSelect;backend.selectDownloadCodes=()=>new Promise(resolve=>{finishSelect=()=>resolve({codes:[secretById.get(firstEntries[0].id)],entries:[{...firstEntries[0]}]})});const pendingCopy=ids['download-code-copy'].emit('click');const beforeLogoutCopy=copied.length;dispatch('invox:admin-clear');finishSelect();await pendingCopy.completion;assert.equal(copied.length,beforeLogoutCopy,'late private selection never writes clipboard after logout');assert.equal(ids['download-code-secret'].value,'');assert.equal(ids['download-code-list'].childNodes.length,0);
 dispatch('invox:admin-state',server);
 let finishCode;backend.createDownloadCodes=payload=>new Promise(resolve=>{finishCode=()=>resolve({codes:Array.from({length:payload.count},(_,i)=>String(i).padStart(6,'0')),entries:Array.from({length:payload.count},()=>({id:require('node:crypto').randomUUID(),label:payload.label,maxUses:payload.maxUses,usedCount:0,remainingUses:payload.maxUses,status:'active',createdAt:'2026-11-17T20:00:00Z',expiresAt:null,revokedAt:null,codeFormat:'short'})),downloadCodes:[]})});
 const late=codeForm.emit('submit');assert.equal(snapshot().codeBusy,true);dispatch('invox:admin-clear');finishCode();await late.completion;assert.equal(ids['download-code-secret'].value,'');assert.equal(ids['download-code-result'].hidden,true);assert.equal(snapshot().downloadCodes.length,0);assert.equal(ids['download-code-quantity'].value,'1');assert.equal(ids['download-code-max'].value,'1');assert.equal(ids['download-code-create'].disabled,true,'logout clears secrets and ignores late batch responses');
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
 await storageReplacementControls();
 await accessCodeControls();
 console.log('PASS connected settings: versions/history, universal key, six-character token pools, grouped fresh copies, retry/revalidation races, 500-ID rounds, no plaintext state, Realtime and logout.');
})().catch(error=>{console.error(error);process.exitCode=1});
