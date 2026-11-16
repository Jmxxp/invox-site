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
  'access-preview-description', 'summary-version'
].map(id => [id, new Element()]));
const accessForm = ids['access-form'];
const releaseForm = ids['release-form'];
const password = ids['site-password'];
const version = ids['release-version'];
const notes = ids['release-notes'];
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
  const selected = new Element();
  selected.children['.file-name'] = new Element(); selected.children['.file-size'] = new Element();
  const error = new Element(); const dropzone = new Element(); const remove = new Element();
  dropzone.children['.dropzone-title'] = new Element();
  releaseForm.children[`.selected-file[data-platform="${platform}"]`] = selected;
  releaseForm.children[`.file-error[data-platform="${platform}"]`] = error;
  releaseForm.children[`.dropzone[data-platform="${platform}"]`] = dropzone;
  releaseForm.children[`.remove-file[data-platform="${platform}"]`] = remove;
  platformElements[platform] = { input, selected, error, dropzone, remove };
}
Element.prototype.removeAttribute=function(key){delete this.attributes[key]};
Element.prototype.append=function(child){this.children['.current-installer']=child};
const cardElements=[];
for(const item of Object.values(platformElements)){const card=new Element();cardElements.push(card);item.dropzone.parent=card;}
for(const id of ['release-progress','upload-progress','upload-status','upload-limit'])ids[id]=new Element();
const accessControls=[...radios,password,ids['toggle-password']];
const releaseControls=[version,notes,...Object.values(platformElements).flatMap(row=>[row.input,row.remove])];
accessForm.querySelectorAll=selector=>selector.includes('site-visibility')?radios:accessControls;
releaseForm.querySelectorAll=()=>releaseControls;
accessForm.reportValidity=()=>password.disabled||(!password.validationMessage&&(!password.required||password.value.length>=8));
const docEvents={};
const document={getElementById:id=>{assert(ids[id],id);return ids[id]},createElement:()=>new Element(),querySelectorAll:()=>cardElements.map(c=>c.children['.current-installer']).filter(Boolean),addEventListener:(key,fn)=>(docEvents[key]??=[]).push(fn)};
const dispatch=(type,detail)=>{for(const fn of docEvents[type]||[])fn({detail})};
const toasts=[],calls={access:[],uploads:[],releases:[]};
let failAccess=false,failRelease=false;
let server={settings:{visibility:'private',hasPassword:true,version:'1.1.0',releaseNotes:'Atualização real',uploadLimitBytes:1024},installers:[]};
const backend={saveAccess:async payload=>{calls.access.push({...payload});if(failAccess)throw Error('offline');server.settings={...server.settings,visibility:payload.visibility,hasPassword:payload.visibility==='private'};return server.settings},uploadInstaller:async payload=>{calls.uploads.push(payload);return {platform:payload.platform,path:'fixture/'+payload.file.name,fileName:payload.file.name,size:payload.file.size}},saveRelease:async payload=>{calls.releases.push(payload);if(failRelease)throw Error('offline');server={...server,settings:{...server.settings,version:payload.version,releaseNotes:payload.releaseNotes},installers:payload.files.map(f=>({...f,version:payload.version}))};return server}};
const window={InvoxBackend:backend,AdminUI:{toast:(...args)=>toasts.push(args)}};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../painel-admin/settings.js'),'utf8'),{window,document},{filename:'settings.js'});
const snapshot=()=>JSON.parse(JSON.stringify(window.AdminSettings.getState()));
const chooseVisibility=value=>{radios.forEach(r=>{r.checked=r.value===value});radios.find(r=>r.checked).emit('change');accessForm.emit('change')};
const submit=async form=>{const event=form.emit('submit');assert(event.defaultPrevented);await event.completion};
const fixture=(name,size=512)=>({name,size,type:'application/octet-stream',lastModified:1});
(async()=>{
 dispatch('invox:admin-state',server);assert.equal(version.value,'1.1.0');assert.equal(notes.value,'Atualização real');assert.equal(password.required,false);assert.equal(ids['access-preview-status'].textContent,'Downloads com senha');
 await submit(accessForm);assert.equal(calls.access.length,1);assert.equal(calls.access[0].password,'');
 chooseVisibility('public');dispatch('invox:admin-state',server);assert.equal(radios[0].checked,true);assert.equal(ids['access-preview-status'].textContent,'Downloads com senha');
 failAccess=true;await submit(accessForm);assert.equal(snapshot().settings.visibility,'private');assert.equal(toasts.at(-1)[1],'error');
 failAccess=false;await submit(accessForm);assert.equal(snapshot().settings.visibility,'public');assert.equal(ids['access-preview-status'].textContent,'Downloads liberados');
 chooseVisibility('private');password.value='short';await submit(accessForm);assert.equal(snapshot().settings.visibility,'public');
 password.value='fixture-password';password.emit('input');await submit(accessForm);assert.equal(snapshot().settings.visibility,'private');assert.equal(password.value,'');assert(!JSON.stringify(snapshot()).includes('fixture-password'));
 const windows=platformElements.windows;
 windows.input.files=[fixture('fixture.exe')];windows.input.emit('change');assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');
 windows.input.files=[fixture('wrong.apk')];windows.input.emit('change');assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');
 windows.input.files=[fixture('large.exe',1025)];windows.input.emit('change');assert.match(windows.error.textContent,/arquivo entre/);assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');
 version.value='1.1.1';version.emit('input');notes.value='Fixture release';releaseForm.emit('input');
 dispatch('invox:admin-state',server);assert.equal(version.value,'1.1.1');
 failRelease=true;await submit(releaseForm);assert.equal(calls.uploads.length,1);assert.equal(snapshot().selectedFiles.windows.name,'fixture.exe');assert.equal(ids['summary-version'].textContent,'1.1.0');assert.match(ids['upload-status'].textContent,/não foi concluída/);
 failRelease=false;await submit(releaseForm);assert.equal(calls.uploads.length,1,'retry reutiliza upload concluído');assert.equal(calls.releases.length,2);assert.equal(calls.releases[1].files[0].fileName,'fixture.exe');assert.equal(snapshot().selectedFiles.windows,null);assert.equal(ids['summary-version'].textContent,'1.1.1');assert.equal(ids['upload-progress'].value,100);
 dispatch('invox:admin-clear');assert.equal(password.value,'');assert.equal(notes.value,'');assert.equal(snapshot().selectedFiles.windows,null);assert.equal(ids['release-progress'].hidden,true);assert.equal(cardElements[0].children['.current-installer'].textContent,'');
 console.log('PASS connected settings: blank preserves existing password; server failure never confirms; successful password clears; upload limit/ext; dirty refresh; upload/publish failure retry; success metadata; logout clears PII/files.');
})().catch(error=>{console.error(error);process.exitCode=1});
