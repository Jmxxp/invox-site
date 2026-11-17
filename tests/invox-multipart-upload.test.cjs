const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const clientSource=fs.readFileSync('site-oficial/shared/invox-client.js','utf8');
const tusSource=fs.readFileSync('site-oficial/shared/vendor/tus.min.js','utf8');
const hashSource=fs.readFileSync('site-oficial/shared/vendor/sha256.umd.min.js','utf8');
const MiB=1024*1024,partSize=20*MiB,endpoint='https://wsfdwyghqqaerivyrbil.storage.supabase.co/storage/v1/upload/resumable/sign';
const project='https://wsfdwyghqqaerivyrbil.supabase.co',uploadId='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222',otherOwner='33333333-3333-4333-8333-333333333333';
const checks=[];
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
class DiskSlice extends Blob{
 constructor(file,start,size,type=''){super([],{type});this.file=file;this.start=start;this.diskSize=size;}
 get size(){return this.diskSize;}
 slice(start=0,end=this.size,type=''){return new DiskSlice(this.file,this.start+start,Math.max(0,Math.min(this.size,end)-start),type);}
 async arrayBuffer(){
  assert(this.size<=MiB,'Hash reader must never buffer more than 1 MiB');
  this.file.maxRead=Math.max(this.file.maxRead,this.size);this.file.bytesRead+=this.size;
  this.file.onRead?.(this);
  if(this.file.failRead)throw Error('unreadable disk fixture');
  return new ArrayBuffer(this.size);
 }
}
class DiskFile extends File{
 constructor(size=55*MiB+123){super([],'INVOX.exe',{type:'application/x-msdownload'});this.diskSize=size;this.maxRead=0;this.bytesRead=0;}
 get size(){return this.diskSize;}
 slice(start=0,end=this.size,type=''){return new DiskSlice(this,start,Math.max(0,Math.min(this.size,end)-start),type);}
 arrayBuffer(){throw Error('Whole-file arrayBuffer is forbidden');}
 stream(){throw Error('Whole-file stream is forbidden');}
}
const digestCache=new Map(),zeroBlock=Buffer.alloc(MiB);
function zeroDigest(size){
 if(!digestCache.has(size)){const hash=crypto.createHash('sha256');for(let offset=0;offset<size;offset+=MiB)hash.update(zeroBlock.subarray(0,Math.min(MiB,size-offset)));digestCache.set(size,hash.digest('hex'));}
 return digestCache.get(size);
}
function server(options={}){return {options,manifest:null,verified:new Set(options.completed||[]),objects:new Map(),resources:new Map(),resourceCounter:0,confirmFailed:false,interrupted:false};}
function harness(options={},remote=server()){
 const state={apiCalls:[],requests:[],progress:[],statuses:[],uploads:[],aborts:[],authListeners:new Set(),sdkCalls:[],session:{user:{id:owner},access_token:'admin-access-fixture'}};
 if(options.signedOut)state.session=null;
 const localStorage=storage(),sessionStorage=storage();
 const sdk={createClient(url,key,settings){state.sdkCalls.push(settings);return {auth:{
  getSession:async()=>{options.onGetSession?.(state);return {data:{session:state.session}};},
  onAuthStateChange(callback){state.authListeners.add(callback);return {data:{subscription:{unsubscribe(){state.authListeners.delete(callback);}}}};}
 }}}};
 state.authChange=(event,session)=>{state.session=session;for(const callback of [...state.authListeners])callback(event,session);};
 function metadata(request){return Object.fromEntries(request.headers['upload-metadata'].split(',').map(pair=>{const [key,value]=pair.split(' ');return [key,Buffer.from(value,'base64').toString()];}));}
 function partPath(index){return `uploads/${uploadId}/${String(index).padStart(3,'0')}-${remote.manifest.parts[index].sha256}.part`;}
 class XHR{
  constructor(){this.upload={};this.headers={};this.responseHeaders={};this.status=0;this.responseText='';this.withCredentials=false;this.aborted=false;}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(key,value){this.headers[key.toLowerCase()]=value;}
  getResponseHeader(key){return this.responseHeaders[key.toLowerCase()]??null;}
  abort(){this.aborted=true;}
  send(body){
   this.body=body;state.requests.push(this);
   queueMicrotask(()=>{
    options.onTransfer?.(state,this);
    if(this.aborted)return;
    let resource;
    if(this.method==='POST'){
     assert.equal(this.url,endpoint);
     const meta=metadata(this);assert.equal(meta.bucketName,'invox-installer-parts');assert.equal(meta.contentType,'application/octet-stream');
     const index=remote.manifest.parts.findIndex(part=>partPath(part.index)===meta.objectName);assert(index>=0);
     resource={index,size:Number(this.headers['upload-length']),offset:0};
     const resourceUrl=endpoint+'/resource-'+(++remote.resourceCounter);remote.resources.set(resourceUrl,resource);
     this.responseHeaders.location=resourceUrl;this.status=201;
    }else{
     resource=remote.resources.get(this.url);assert(resource);
     if(this.method==='HEAD')this.status=200;
     else{
      assert.equal(this.method,'PATCH');assert.equal(Number(this.headers['upload-offset']),resource.offset);this.status=204;
      if(options.interrupt&&!remote.interrupted){remote.interrupted=true;resource.offset+=2*MiB;this.onerror(Error('interrupted'));return;}
     }
    }
    if(body){assert(body.size<=6*MiB);resource.offset+=body.size;this.upload.onprogress?.({lengthComputable:true,loaded:body.size,total:body.size});}
    if(resource.offset===resource.size)remote.objects.set(resource.index,{size:resource.size});
    this.responseHeaders['upload-offset']=String(resource.offset);this.responseHeaders['upload-length']=String(resource.size);this.responseHeaders['tus-resumable']='1.0.0';
    this.onload();
   });
  }
 }
 const fetch=async(url,init)=>{
  const body=JSON.parse(init.body);state.apiCalls.push({url,init,body});
  assert.equal(init.headers.Authorization,'Bearer '+state.session?.access_token);
  await options.onAction?.(state,body);
  let result;
  if(body.action==='create-multipart-upload'){
   if(options.capacityError)return new Response(JSON.stringify({error:{code:'storage_full',message:'Espaço insuficiente.'}}),{status:409});
   if(remote.manifest)assert.deepEqual(body,remote.manifest);else remote.manifest=body;
   if(!options.fastHash){assert.equal(body.sha256,zeroDigest(body.size));for(const part of body.parts)assert.equal(part.sha256,zeroDigest(part.size));}
   assert.equal(body.parts.reduce((total,part)=>total+part.size,0),body.size);
   body.parts.forEach((part,index)=>{assert.equal(part.index,index);assert(part.size<=partSize);});
   if(options.allComplete)remote.verified=new Set(body.parts.map(part=>part.index));
   result={uploadId,status:options.allComplete?'ready':'uploading',completedParts:[...remote.verified]};
   if(options.badSession)result=options.badSession(result);
  }else if(body.action==='multipart-part-upload'){
   assert.equal(body.uploadId,uploadId);const part=remote.manifest.parts[body.index];assert(part);
   if(remote.objects.get(body.index)?.size===part.size)remote.verified.add(body.index);
   if(remote.verified.has(body.index))result={completed:true,index:body.index};
   else{
    const path=partPath(body.index),token='part-token-'+body.index;
    result={completed:false,bucket:'invox-installer-parts',path,token,signedUrl:`${project}/storage/v1/object/upload/sign/invox-installer-parts/${path}?token=${token}`};
    if(options.badTicket)result=options.badTicket(result);
   }
  }else if(body.action==='confirm-multipart-part'){
   assert.equal(body.uploadId,uploadId);assert.equal(remote.objects.get(body.index)?.size,remote.manifest.parts[body.index].size);
   if(remote.options.loseConfirmation&&!remote.confirmFailed){remote.confirmFailed=true;throw Error('response lost before verification acknowledgement');}
   remote.verified.add(body.index);result={index:body.index,verified:!options.badConfirmation};
  }else if(body.action==='finish-multipart-upload'){
   assert.equal(body.uploadId,uploadId);assert.equal(remote.verified.size,remote.manifest.parts.length);
   const {platform,fileName,size,version,sha256}=remote.manifest;
   result={kind:'multipart',uploadId,platform,fileName,size,version,sha256:options.badFinish?'f'.repeat(64):sha256};
  }else throw Error('Unexpected API action '+body.action);
  return new Response(JSON.stringify(result),{status:200});
 };
 const window={supabase:sdk,localStorage,sessionStorage};
 const context=vm.createContext({window,localStorage,sessionStorage,navigator:{onLine:true},location:{href:project+'/'},fetch,XMLHttpRequest:XHR,File,Blob,Headers,Response,Request,URL,URLSearchParams,AbortController,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,WebAssembly,crypto:crypto.webcrypto,setTimeout:(fn,delay)=>setTimeout(fn,Math.min(delay,1)),clearTimeout});
 vm.runInContext(tusSource,context,{filename:'tus.min.js'});vm.runInContext(hashSource,context,{filename:'sha256.umd.min.js'});
 window.hashwasm=context.hashwasm;
 if(options.fastHash)window.hashwasm={createSHA256:async()=>({init(){},update(){},digest(){return 'a'.repeat(64);}})};
 if(options.missingHash)window.hashwasm=null;
 const NativeUpload=window.tus.Upload;
 window.tus.Upload=class extends NativeUpload{constructor(file,settings){super(file,settings);state.uploads.push(this);}abort(...args){state.aborts.push(args);return super.abort(...args);}};
 vm.runInContext(clientSource,context,{filename:'invox-client.js'});
 return {state,api:window.InvoxBackend,remote,localStorage,sessionStorage};
}
function upload(h,file,options={}){return h.api.uploadInstaller({platform:'windows',version:'1.1.0',file,onProgress:value=>h.state.progress.push(value),onStatus:value=>h.state.statuses.push(value),...options});}
(async()=>{
 {
  const h=harness({interrupt:true}),file=new DiskFile();const result=await upload(h,file);
  assert.equal(result.kind,'multipart');assert.equal(result.uploadId,uploadId);assert.equal(result.sha256,zeroDigest(file.size));assert.equal(result.path,undefined);
  assert.equal(file.bytesRead,file.size);assert.equal(file.maxRead,MiB);assert.equal(h.remote.verified.size,3);
  assert(h.state.requests.some(request=>request.method==='HEAD'),'TUS resumes a partially accepted chunk');
  assert.equal(h.state.requests.filter(request=>request.method==='POST').length,3,'One Storage object is created per logical part');
  for(const request of h.state.requests){assert.equal(request.headers.authorization,undefined);assert(request.headers['x-signature'].startsWith('part-token-'));assert.equal(request.withCredentials,false);}
  assert.equal(h.state.sdkCalls.length,1);assert.equal(h.state.authListeners.size,0);
  assert.equal(h.state.progress.at(-1),100);assert(!h.state.progress.slice(0,-1).includes(100));assert(h.state.progress.every((value,index,list)=>!index||value>=list[index-1]));
  assert(h.state.statuses.some(value=>value.startsWith('Verificando o arquivo')));
  assert([...h.localStorage.values.values(),...h.sessionStorage.values.values()].every(value=>!value.includes('part-token-')&&!value.includes('/resumable/')));
  checks.push('Real hash-wasm and tus verify whole/part SHA-256, bounded 1 MiB disk reads, 20 MiB objects and 6 MiB transfers with in-memory resumption');
 }
 {
  const remote=server({loseConfirmation:true}),first=harness({},remote);await assert.rejects(()=>upload(first,new DiskFile()),error=>error.code==='offline');
  assert.equal(remote.objects.size,1);assert.equal(remote.verified.size,0);assert(!first.state.progress.includes(100));
  const reloaded=harness({},remote);await upload(reloaded,new DiskFile());
  assert.equal(reloaded.state.apiCalls[0].body.action,'create-multipart-upload');
  assert.equal(reloaded.state.requests.filter(request=>request.method==='POST').length,2,'Existing object with lost acknowledgement is adopted instead of uploaded again');
  assert(!reloaded.state.apiCalls.some(call=>call.body.action==='confirm-multipart-part'&&call.body.index===0));
  assert.equal(remote.verified.size,3);assert.equal(reloaded.localStorage.values.size,0);
  checks.push('A fresh client and reselected file recover the same server session and adopt a completed object even when its confirmation response was lost');
 }
 {
  const h=harness({fastHash:true,allComplete:true}),file=new DiskFile(1.5*1024*MiB);await upload(h,file);
  assert.equal(file.bytesRead,file.size);assert.equal(file.maxRead,MiB);assert.equal(h.remote.manifest.parts.length,77);assert.equal(h.remote.manifest.parts.at(-1).size,16*MiB);
  assert.equal(h.state.requests.length,0);assert.deepEqual(h.state.apiCalls.map(call=>call.body.action),['create-multipart-upload','finish-multipart-upload']);
  checks.push('The 1.5 GiB logical boundary is streamed into 77 parts and already verified parts require no new Storage upload');
 }
 for(const options of [
  {fastHash:true,badSession:value=>({...value,uploadId:'not-a-uuid'})},
  {fastHash:true,badSession:value=>({...value,completedParts:[0,0]})},
  {fastHash:true,badTicket:value=>({...value,path:value.path.replace(uploadId,otherOwner)})},
  {fastHash:true,badTicket:value=>({...value,bucket:'outside-bucket'})},
  {fastHash:true,badTicket:value=>({...value,signedUrl:'https://outside.example.test/upload'})}
 ]){
  const h=harness(options);await assert.rejects(()=>upload(h,new DiskFile()),error=>error.code==='invalid_upload');assert.equal(h.state.requests.length,0);
 }
 for(const options of [{fastHash:true,badConfirmation:true},{fastHash:true,badFinish:true}]){
  const h=harness(options);await assert.rejects(()=>upload(h,new DiskFile()),error=>error.code==='invalid_upload');assert(!h.state.progress.includes(100));
 }
 checks.push('Malformed sessions, ticket origin/bucket/UUID, unverified parts and mismatched final descriptors cannot report upload success');
 for(const mode of ['signal','signout','other-user']){
  const controller=new AbortController();
  const h=harness({fastHash:true,onTransfer(state){if(mode==='signal')controller.abort();else state.authChange(mode==='signout'?'SIGNED_OUT':'SIGNED_IN',mode==='signout'?null:{user:{id:otherOwner},access_token:'other-token'});}});
  await assert.rejects(()=>upload(h,new DiskFile(),{signal:controller.signal}),error=>error.code==='upload_cancelled');
  assert.equal(h.state.aborts.length,1);assert(h.state.aborts.every(args=>args[0]!==true));assert(h.state.requests.every(request=>request.method!=='DELETE'));
  assert(!h.state.apiCalls.some(call=>call.body.action==='confirm-multipart-part'||call.body.action==='finish-multipart-upload'));assert(!h.state.progress.includes(100));assert.equal(h.state.authListeners.size,0);
  h.state.uploads[0].options.onSuccess();h.state.uploads[0].options.onProgress(1,1);assert(!h.state.progress.includes(100),'Late transport callbacks cannot revive a cancelled operation');
 }
 checks.push('AbortSignal, logout and admin replacement immediately abort active tus without terminating the remote resource or making later API calls');
 {
  const h=harness({fastHash:true,onAction(state,body){if(body.action==='multipart-part-upload')state.authChange('TOKEN_REFRESHED',{user:{id:owner},access_token:'refreshed-token'});}});
  await upload(h,new DiskFile());assert(h.state.apiCalls.some(call=>call.body.action==='confirm-multipart-part'&&call.init.headers.Authorization==='Bearer refreshed-token'));
  const cancelled=harness({fastHash:true}),file=new DiskFile(),controller=new AbortController();file.onRead=()=>controller.abort();
  await assert.rejects(()=>upload(cancelled,file,{signal:controller.signal}),error=>error.code==='upload_cancelled');assert.equal(cancelled.state.apiCalls.length,0);
  const raced=harness({fastHash:true,onGetSession(state){if(state.replaceAtRequest){state.replaceAtRequest=false;state.authChange('SIGNED_IN',{user:{id:otherOwner},access_token:'replacement-token'});}}});
  await assert.rejects(()=>upload(raced,new DiskFile(),{onStatus:message=>{if(message==='Preparando o envio…')raced.state.replaceAtRequest=true;}}),error=>error.code==='upload_cancelled');
  assert.equal(raced.state.apiCalls.length,0,'Identity is checked again inside request after getSession and before fetch');
  checks.push('A same-user token refresh continues; cancellation while hashing or an identity change inside request stops before creating any remote session');
 }
 {
  const smallLimit=harness({fastHash:true,allComplete:true});await upload(smallLimit,new DiskFile(21*MiB),{objectUploadLimitBytes:20*MiB});assert.equal(smallLimit.state.apiCalls[0].body.action,'create-multipart-upload');
  for(const options of [{objectUploadLimitBytes:19*MiB},{uploadLimitBytes:50*MiB}]){const h=harness({fastHash:true});await assert.rejects(()=>upload(h,new DiskFile(),options),error=>error.code==='file_too_large');assert.equal(h.state.apiCalls.length,0);}
  const full=harness({fastHash:true,capacityError:true});await assert.rejects(()=>upload(full,new DiskFile()),error=>error.code==='storage_full');assert.equal(full.state.requests.length,0);
  const missing=harness({missingHash:true});await assert.rejects(()=>upload(missing,new DiskFile()),error=>error.code==='hash_unavailable');assert.equal(missing.state.apiCalls.length,0);
  const unreadable=harness(),file=new DiskFile();file.failRead=true;await assert.rejects(()=>upload(unreadable,file),error=>error.code==='file_read_failed');assert.equal(unreadable.state.apiCalls.length,0);
  checks.push('Runtime object/file limits, unavailable hashing, unreadable files and capacity refusals stop before Storage upload');
 }
 console.log(JSON.stringify({result:'PASS',checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
