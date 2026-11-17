const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('site-oficial/shared/invox-client.js','utf8');
const project='https://wsfdwyghqqaerivyrbil.supabase.co';
const sessionFixture={access_token:'access-token-fixture',refresh_token:'refresh-token-fixture'};
const checks=[];
function storage(initial={}){
 const values=new Map(Object.entries(initial));
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),entries:()=>[...values.entries()]};
}
function harness(options={}){
 const state={session:null,fetchCalls:[],sdkCalls:[],xhrCalls:[],setSessions:[],responses:[],progress:[],xhrMode:'ok',setSessionError:null};
 const auth={
  async getSession(){return {data:{session:state.session},error:null};},
  async setSession(session){state.setSessions.push(session);if(state.setSessionError)return {error:state.setSessionError};state.session=session;return {error:null};}
 };
 class XHR{
  constructor(){this.upload={};this.headers={};this.status=200;this.statusText='OK';this.responseText='{"Key":"uploaded"}';}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(name,value){this.headers[name]=value;}
  getResponseHeader(){return 'application/json';}
  send(body){this.body=body;state.xhrCalls.push(this);queueMicrotask(()=>{
   if(state.xhrMode==='network')return this.onerror();
   if(state.xhrMode==='timeout')return this.ontimeout();
   this.upload.onprogress({lengthComputable:true,loaded:51,total:100});
   this.upload.onprogress({lengthComputable:true,loaded:100,total:100});
   if(state.xhrMode==='http'){this.status=500;this.statusText='Error';this.responseText='{"error":"upload rejected"}';}
   this.onload();
  });}
 }
 const sdk={createClient(url,key,options){
  state.sdkCalls.push({url,key,options});
  if(!options.global)return {auth};
  return {storage:{from(bucket){return {async uploadToSignedUrl(path,token,file,uploadOptions){
   state.uploadArguments={bucket,path,token,file,uploadOptions};
   try{
    const response=await options.global.fetch(`${url}/storage/v1/object/upload/sign/${bucket}/${path}?token=${encodeURIComponent(token)}`,{method:'PUT',headers:{apikey:key,'Content-Type':uploadOptions.contentType},body:file});
    return response.ok?{data:await response.json(),error:null}:{error:Error('HTTP upload failed')};
   }catch(error){return {error};}
  }}}}};
 }};
 const fetch=async(url,options)=>{
  state.fetchCalls.push({url,options,body:JSON.parse(options.body)});
  if(!state.responses.length)throw Error('Missing mock response');
  const response=await state.responses.shift();
  if(response instanceof Error)throw response;
  if(response.badJson)return {ok:true,status:200,json:async()=>{throw Error('not JSON');}};
  return new Response(JSON.stringify(response.body),{status:response.status||200,headers:{'Content-Type':'application/json'}});
 };
 const timers=new Map();let timerId=0;
 const localStorage=options.localStorage||storage(),sessionStorage=options.sessionStorage||storage();
 const window={supabase:sdk,localStorage,sessionStorage};
 if(options.blockedStorage)Object.defineProperty(window,'localStorage',{get(){throw Error('Storage disabled');}});
 vm.runInNewContext(source,{window,fetch,Headers,Response,Request,URL,URLSearchParams,AbortController,File,XMLHttpRequest:XHR,crypto:require('node:crypto').webcrypto,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}});
 return {state,api:window.InvoxBackend,timers,localStorage,sessionStorage};
}
const ok=body=>({body});
const error=(code,status=400)=>({status,body:{error:{code,message:'Mensagem amigável de teste.'}}});
const ticket=(path='windows/1.1.0/upload-id/INVOX.exe')=>({path,token:'signed-upload-fixture',signedUrl:`${project}/storage/v1/object/upload/sign/invox-installers/${path}?token=signed-upload-fixture`});
(async()=>{
 {
  const {api,state,timers}=harness();state.session=sessionFixture;
  state.responses.push(ok({visibility:'public',version:'1.1.0'}),ok({url:'signed-download'}),ok({id:'feedback-fixture'}));
  await api.publicState();await api.download('windows','password-fixture');await api.sendFeedback({name:'Example',contact:'example@example.test',message:'A message for the fixture.'});
  assert.deepEqual(state.fetchCalls.map(c=>c.body.action),['state','download','feedback']);
  for(const {options} of state.fetchCalls){assert.equal(options.headers.Authorization,undefined);assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');}
  assert.equal(timers.size,0);checks.push('Public actions never forward admin Bearer; no-store and omitted credentials');
 }
 {
  const {api,state}=harness();
  await assert.rejects(()=>api.adminState(),e=>e.code==='unauthorized'&&e.status===401);
  await assert.rejects(()=>api.resetAnalytics(),e=>e.code==='unauthorized'&&e.status===401);
  await assert.rejects(()=>api.saveAnnouncement({title:'Aviso',message:'Recado'}),e=>e.code==='unauthorized'&&e.status===401);
  await assert.rejects(()=>api.setAnnouncementActive({id:'fixture',active:false}),e=>e.code==='unauthorized'&&e.status===401);
  assert.equal(state.fetchCalls.length,0);
  state.session=sessionFixture;state.responses.push(ok({admin:{username:'fixture'}}));
  await api.adminState();assert.equal(state.fetchCalls[0].options.headers.Authorization,'Bearer access-token-fixture');
  state.responses.push(ok({startedAt:'2026-11-17T18:00:00Z',generation:2}));
  const reset=await api.resetAnalytics();
  assert.equal(reset.generation,2);
  assert.deepEqual(state.fetchCalls[1].body,{action:'reset-analytics'});
  assert.equal(state.fetchCalls[1].options.headers.Authorization,'Bearer access-token-fixture');
  checks.push('Admin actions require session and forward raw access token for server validation');
 }
 {
  const {api,state}=harness();
  state.responses.push(Error('network failed'));await assert.rejects(()=>api.publicState(),e=>e.code==='offline');
  state.responses.push(new DOMException('Aborted','AbortError'));await assert.rejects(()=>api.publicState(),e=>e.code==='offline');
  state.responses.push({badJson:true});await assert.rejects(()=>api.publicState(),e=>e.code==='offline');
  state.responses.push(error('rate_limited',429));await assert.rejects(()=>api.download('android'),e=>e.code==='rate_limited'&&e.status===429);
  checks.push('Network/abort/malformed JSON map to offline; server codes/status preserved');
 }
 {
  const {api,state}=harness();
  state.responses.push(error('invalid_credentials',401));await assert.rejects(()=>api.signIn('fixture','password-fixture'),e=>e.code==='invalid_credentials');
  assert.equal(state.setSessions.length,0);
  state.responses.push(ok({session:sessionFixture}),ok({admin:{username:'fixture'}}));
  await api.signIn('fixture','password-fixture');assert.equal(state.setSessions.length,1);
  assert.deepEqual(state.fetchCalls.map(c=>c.body.action),['login','login','admin-state']);
  assert.equal(state.fetchCalls[1].options.headers.Authorization,undefined);assert.equal(state.fetchCalls[2].options.headers.Authorization,'Bearer access-token-fixture');
  state.setSessionError=Error('session rejected');state.responses.push(ok({session:sessionFixture}));
  await assert.rejects(()=>api.signIn('fixture','password-fixture'),e=>e.code==='unauthorized');
  checks.push('Login creates session only after API success; failures never report success');
 }
 const file=new File([new Uint8Array(64)],'INVOX.exe',{type:'application/x-msdownload'});
 {
  const apk=new File([Uint8Array.from({length:64},(_,i)=>i)],'INVOX.apk',{type:'application/vnd.android.package-archive'});
  const apkTicket=ticket('android/1.1.0/upload-id/INVOX.apk');
  const {api,state}=harness();state.session=sessionFixture;state.responses.push(ok(apkTicket));
  const result=await api.uploadInstaller({platform:'android',file:apk,version:'1.1.0',onProgress:value=>state.progress.push(value)});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{platform:'android',path:apkTicket.path,fileName:apk.name,size:64});
  assert.equal(state.uploadArguments.bucket,'invox-installers');assert.equal(state.uploadArguments.uploadOptions.upsert,false);
  assert.equal(state.uploadArguments.uploadOptions.contentType,'application/octet-stream');assert.equal(state.xhrCalls[0].method,'PUT');
  assert.equal(state.xhrCalls[0].headers.Authorization,undefined);
  const payload=state.uploadArguments.file;
  assert.notEqual(payload,apk);assert.equal(payload.type,'application/octet-stream');assert.equal(payload.size,apk.size);
  assert.equal(state.xhrCalls[0].body,payload);
  assert.deepEqual(new Uint8Array(await payload.arrayBuffer()),new Uint8Array(await apk.arrayBuffer()));
  assert.deepEqual(state.progress,[0,51,99,100]);assert.equal(state.sdkCalls[1].options.auth.persistSession,false);
  checks.push('Typed APK becomes equal-size octet-stream Blob with identical bytes; original filename/path preserved; PUT and progress confirmed');
 }
 {
  const boundaryFile=new File([new Uint8Array(6*1024*1024)],'INVOX.exe');
  const {api,state}=harness();state.session=sessionFixture;state.responses.push(ok(ticket()));
  await api.uploadInstaller({platform:'windows',file:boundaryFile,version:'1.1.0'});
  assert.equal(state.xhrCalls.length,1);assert.equal(state.xhrCalls[0].method,'PUT');
  const overBoundary=new File([boundaryFile,new Uint8Array(1)],'INVOX.exe');
  const missing=harness();missing.state.session=sessionFixture;
  await assert.rejects(()=>missing.api.uploadInstaller({platform:'windows',file:overBoundary,version:'1.1.0'}),e=>e.code==='offline');
  assert.equal(missing.state.fetchCalls.length,0);assert.equal(missing.state.xhrCalls.length,0);
  checks.push('Files up to 6 MiB keep signed PUT; larger files fail clearly before requesting a ticket when the resumable client is unavailable');
 }
 {
  const badTickets=[
   {...ticket(),signedUrl:'https://outside.example.test/upload'},
   {...ticket(),signedUrl:ticket().signedUrl.replace('invox-installers','other-bucket')},
   {...ticket(),signedUrl:ticket().signedUrl.replace('signed-upload-fixture','different-token')},
   {...ticket(),path:'android/1.1.0/file.apk'},
   ticket('windows/../android/file.apk'),ticket('windows/1.1.0/%2e%2e/file.exe'),
   {...ticket(),signedUrl:'not a URL'},{...ticket(),path:42}
  ];
  for(const value of badTickets){
   const {api,state}=harness();state.session=sessionFixture;state.responses.push(ok(value));
   await assert.rejects(()=>api.uploadInstaller({platform:'windows',file,version:'1.1.0'}),e=>e.code==='invalid_upload');
   assert.equal(state.sdkCalls.length,1);assert.equal(state.xhrCalls.length,0);
  }
  checks.push('Upload ticket rejects wrong origin, bucket, token, platform and unsafe/malformed paths');
 }
 for(const mode of ['http','network','timeout']){
  const {api,state}=harness();state.session=sessionFixture;state.responses.push(ok(ticket()));state.xhrMode=mode;
  await assert.rejects(()=>api.uploadInstaller({platform:'windows',file,version:'1.1.0',onProgress:value=>state.progress.push(value)}),e=>e.code==='upload_failed');
  assert(!state.progress.includes(100));
 }
 checks.push('HTTP/network/timeout upload failures never emit 100% or success metadata');
 {
  const {api,state}=harness();state.session=sessionFixture;state.responses.push(error('forbidden',403));
  await assert.rejects(()=>api.uploadInstaller({platform:'windows',file,version:'1.1.0'}),e=>e.code==='forbidden');
  assert.equal(state.xhrCalls.length,0);
  await assert.rejects(()=>api.uploadInstaller({platform:'windows',file:{},version:'1.1.0'}),e=>e.code==='invalid_file');
  checks.push('No upload after denied ticket or invalid File');
 }
 {
  const {api,state}=harness();state.responses.push(ok({recorded:true}));
  await api.trackView('11111111-1111-4111-8111-111111111111');
  assert.equal(state.fetchCalls[0].body.action,'track-view');
  assert.equal(state.fetchCalls[0].options.keepalive,true);
  assert.equal(state.fetchCalls[0].options.headers.Authorization,undefined);
  await assert.rejects(()=>api.analytics('week'),e=>e.code==='unauthorized');
  state.session=sessionFixture;state.responses.push(ok({period:'month',series:[]}));
  await api.analytics('month');
  assert.equal(state.fetchCalls[1].body.action,'analytics');
  assert.equal(state.fetchCalls[1].body.period,'month');
  assert.equal(state.fetchCalls[1].options.headers.Authorization,'Bearer '+sessionFixture.access_token);
  checks.push('Page view tracking is anonymous/keepalive; analytics report requires admin session');
 }
 {
  const {api,state,localStorage}=harness();state.session=sessionFixture;
  state.responses.push(ok({url:'part-signed-url',expiresAt:'2026-11-17T19:00:00Z'}));
  await api.downloadPart('opaque-download-ticket',2);
  assert.deepEqual(state.fetchCalls[0].body,{ticket:'opaque-download-ticket',index:2,action:'download-part'});
  assert.equal(state.fetchCalls[0].options.headers.Authorization,undefined);
  assert.equal(state.fetchCalls[0].options.cache,'no-store');assert.equal(state.fetchCalls[0].options.credentials,'omit');
  assert.equal(localStorage.getItem('invox-download-access-wsfdwyghqqaerivyrbil-v1'),null);
  checks.push('Multipart part signing is public and scoped to its opaque ticket/index without admin Bearer or ticket persistence');
 }
 {
  const key='invox-admin-auth-v1',raw=JSON.stringify(sessionFixture);
  const local=storage(),legacy=storage({[key]:raw});
  const first=harness({localStorage:local,sessionStorage:legacy});
  assert.equal(first.state.sdkCalls[0].options.auth.storage,local);
  assert.equal(first.state.sdkCalls[0].options.auth.persistSession,true);
  assert.equal(first.state.sdkCalls[0].options.auth.autoRefreshToken,true);
  assert.equal(local.getItem(key),raw);assert.equal(legacy.getItem(key),null);
  const reopened=harness({localStorage:local});
  assert.equal(reopened.state.sdkCalls[0].options.auth.storage.getItem(key),raw);
  const malformed=harness({sessionStorage:storage({[key]:'broken-json'})});
  assert.equal(malformed.state.sdkCalls[0].options.auth.storage,malformed.localStorage);
  const blocked=harness({blockedStorage:true});assert.equal(blocked.state.sdkCalls[0].options.auth.storage,blocked.sessionStorage);
  checks.push('Admin authentication persists across browser sessions and migrates the existing session safely');
 }
 {
  const saved={token:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()};
  const first=harness();first.state.responses.push(ok({url:project+'/storage/v1/object/sign/file',accessSession:saved}));
  await first.api.download('windows','fixture-access-password');assert.equal(first.api.hasDownloadSession(),true);
  const reopened=harness({localStorage:first.localStorage});assert.equal(reopened.api.hasDownloadSession(),true);
  reopened.state.responses.push(ok({url:project+'/storage/v1/object/sign/file',accessSession:saved}));
  await reopened.api.download('android');
  assert.equal(reopened.state.fetchCalls[0].body.accessToken,saved.token);
  assert.equal(reopened.state.fetchCalls[0].body.password,'');
  assert(!first.localStorage.getItem('invox-download-access-wsfdwyghqqaerivyrbil-v1').includes('fixture-access-password'));
  reopened.state.responses.push(ok({cleared:true}));await reopened.api.lockDownloads();
  assert.equal(reopened.state.fetchCalls[1].body.action,'logout-download');
  assert.equal(reopened.api.hasDownloadSession(),false);assert.equal(first.api.hasDownloadSession(),false);
  checks.push('Private download access persists by opaque grant; logout clears all tabs without storing passwords');
 }
 {
  const local=storage({'invox-download-access-wsfdwyghqqaerivyrbil-v1':JSON.stringify({token:'b'.repeat(64),expiresAt:'2000-01-01T00:00:00Z'})});
  const expired=harness({localStorage:local});assert.equal(expired.api.hasDownloadSession(),false);
  const h=harness();h.state.responses.push(ok({accessSession:{token:'c'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}}));
  await h.api.download('windows','fixture');h.state.responses.push(error('password_required',401));
  await assert.rejects(()=>h.api.download('windows'),e=>e.code==='password_required');assert.equal(h.api.hasDownloadSession(),false);
  checks.push('Expired or revoked private access prompts for a fresh password');
 }
 {
  const h=harness();let finish;
  h.state.responses.push(new Promise(resolve=>{finish=resolve;}));
  const pending=h.api.download('windows','fixture');
  await h.api.lockDownloads();
  finish(ok({accessSession:{token:'d'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}}));
  await pending;assert.equal(h.api.hasDownloadSession(),false);
  checks.push('A delayed download response cannot restore private access after logout');
 }
 {
  const h=harness();
  await assert.rejects(()=>h.api.updateInstallerVersion('windows','1.2.0'),e=>e.code==='unauthorized');
  assert.equal(h.state.fetchCalls.length,0);
  h.state.session=sessionFixture;h.state.responses.push(ok({settings:{version:'1.1.0'},history:[]}));
  await h.api.updateInstallerVersion('macos','1.2.3');
  assert.deepEqual(h.state.fetchCalls[0].body,{action:'update-installer-version',platform:'macos',version:'1.2.3'});
  assert.equal(h.state.fetchCalls[0].options.headers.Authorization,'Bearer access-token-fixture');
  checks.push('Per-platform version edits use the authenticated endpoint without uploading file bytes');
 }
 {
  const h=harness(); const saved={token:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()};
  h.state.responses.push(ok({url:'fixture',accessSession:saved}));await h.api.download('windows','universal-fixture');
  const requestId='88888888-8888-4888-8888-888888888888',code='INVOX-'+('b'.repeat(64));
  h.state.responses.push(ok({url:'fixture',accessSession:{token:'c'.repeat(64),expiresAt:saved.expiresAt}}));
  await h.api.download('windows','',{code,requestId});
  assert.deepEqual(h.state.fetchCalls.at(-1).body,{action:'download',platform:'windows',code,requestId});
  assert(!JSON.stringify(h.localStorage.entries()).includes(code));
  assert(!JSON.stringify(h.sessionStorage.entries()).includes(code));
  assert.equal(JSON.parse(h.localStorage.getItem('invox-download-access-wsfdwyghqqaerivyrbil-v1')).token,saved.token,'code response cannot replace the universal grant');
  checks.push('Code redemption omits universal credentials and never persists a reusable grant');
 }
 {
  const h=harness(),id='88888888-8888-4888-8888-888888888888';
  await assert.rejects(()=>h.api.createDownloadCode({id,maxUses:1}),e=>e.code==='unauthorized');
  await assert.rejects(()=>h.api.revokeDownloadCode(id),e=>e.code==='unauthorized');
  h.state.session=sessionFixture;h.state.responses.push(ok({code:'fixture',downloadCodes:[]}),ok({downloadCodes:[]}));
  await h.api.createDownloadCode({id,maxUses:1,label:'Teste',validForHours:null});await h.api.revokeDownloadCode(id);
  assert.deepEqual(h.state.fetchCalls.map(x=>x.body),[{action:'create-download-code',id,maxUses:1,label:'Teste',validForHours:null},{action:'revoke-download-code',id}]);
  checks.push('Download code creation and revocation require administrative authentication');
 }
 {
  const h=harness(),requestId='99999999-9999-4999-8999-999999999999',accessCode='INVOX-'+('a'.repeat(64));
  const unwanted={token:'c'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()};
  h.state.responses.push(ok({url:'fixture',accessMethod:'code',accessSession:unwanted}));
  await h.api.download('windows','',{accessCode,requestId});
  assert.deepEqual(h.state.fetchCalls[0].body,{action:'download',platform:'windows',accessCode,requestId});
  assert.equal(h.api.hasDownloadSession(),false);
  assert(!JSON.stringify(h.localStorage.entries()).includes(accessCode));
  assert(!JSON.stringify(h.sessionStorage.entries()).includes(accessCode));
  h.state.responses.push(ok({url:'fixture',accessMethod:'universal',accessSession:unwanted}));
  await h.api.download('windows','',{accessCode:'fixture-universal-key',requestId});
  assert.equal(h.api.hasDownloadSession(),true);
  h.state.responses.push(ok({url:'fixture',accessMethod:'code'}));
  await h.api.download('windows','',{accessCode,requestId});
  assert(!Object.hasOwn(h.state.fetchCalls.at(-1).body,'accessToken'));
  assert(!Object.hasOwn(h.state.fetchCalls.at(-1).body,'password'));
  checks.push('Unified access field sends explicit credentials and persists only confirmed universal sessions');
 }
 {
  const h=harness(),id='88888888-8888-4888-8888-888888888888';
  const params={id,count:5,maxUses:1,label:'',validForHours:null};
  await assert.rejects(()=>h.api.createDownloadCodes(params),e=>e.code==='unauthorized');
  assert.equal(h.state.fetchCalls.length,0);
  h.state.session=sessionFixture;h.state.responses.push(ok({codes:['fixture-1','fixture-2'],entries:[],downloadCodes:[]}));
  await h.api.createDownloadCodes(params);
  assert.deepEqual(h.state.fetchCalls[0].body,{action:'create-download-codes',...params});
  assert.equal(h.state.fetchCalls[0].options.headers.Authorization,'Bearer access-token-fixture');
  checks.push('Batch token generation requires authentication and forwards the exact immutable batch parameters');
 }
 {
  const h=harness(),excludeIds=['88888888-8888-4888-8888-888888888888'];
  await assert.rejects(()=>h.api.downloadCodePool(),e=>e.code==='unauthorized');
  await assert.rejects(()=>h.api.selectDownloadCodes({count:5,excludeIds}),e=>e.code==='unauthorized');
  assert.equal(h.state.fetchCalls.length,0);
  h.state.session=sessionFixture;
  h.state.responses.push(ok({valid:[{code:'AB3D7K'}],used:[],inactive:[],legacy:[]}),ok({codes:['AB3D7K'],entries:[],availableCount:1}));
  const pool=await h.api.downloadCodePool(),selection=await h.api.selectDownloadCodes({count:5,excludeIds});
  assert.deepEqual(h.state.fetchCalls.map(call=>call.body),[{action:'download-code-pool'},{action:'select-copy-download-codes',count:5,excludeIds}]);
  assert(h.state.fetchCalls.every(call=>call.options.headers.Authorization==='Bearer access-token-fixture'));
  assert.equal(pool.valid[0].code.length,6);assert.equal(selection.codes[0],'AB3D7K');
  assert(!JSON.stringify(h.localStorage.entries()).includes('AB3D7K'));
  assert(!JSON.stringify(h.sessionStorage.entries()).includes('AB3D7K'));
  checks.push('Short-token inventory and copy selection require admin authentication and never persist plaintext tokens');
 }
 {
  const h=harness();
  const replacement={platform:'windows',expectedHistoryId:'88888888-8888-4888-8888-888888888888',confirm:true,replacement:{fileName:'INVOX.exe',size:549447078,version:'1.2.1'}};
  await assert.rejects(()=>h.api.prepareInstallerReplacement(replacement),e=>e.code==='unauthorized');
  assert.equal(h.state.fetchCalls.length,0);
  h.state.session=sessionFixture;h.state.responses.push(ok({replacement:{releasedBytes:549447078},installers:[]}));
  await h.api.prepareInstallerReplacement(replacement);
  assert.deepEqual(h.state.fetchCalls[0].body,{action:'prepare-installer-replacement',...replacement});
  assert.equal(h.state.fetchCalls[0].options.headers.Authorization,'Bearer access-token-fixture');
  checks.push('Installer replacement requires authentication and forwards explicit confirmation, immutable current release and new file metadata');
 }
 console.log(JSON.stringify({result:'PASS',checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
