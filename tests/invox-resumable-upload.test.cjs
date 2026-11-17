const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const clientSource=fs.readFileSync('site-oficial/shared/invox-client.js','utf8');
const tusSource=fs.readFileSync('site-oficial/shared/vendor/tus.min.js','utf8');
const project='https://wsfdwyghqqaerivyrbil.supabase.co';
const storageOrigin='https://wsfdwyghqqaerivyrbil.storage.supabase.co';
const endpoint=storageOrigin+'/storage/v1/upload/resumable';
const chunkSize=6*1024*1024;
const uploadToken='signed-upload-fixture';
const defaultTicket={path:'windows/1.1.0/upload-id/INVOX.exe',token:uploadToken,signedUrl:project+'/storage/v1/object/upload/sign/invox-installers/windows/1.1.0/upload-id/INVOX.exe?token='+uploadToken};
const checks=[];
function storage(){
 const values=new Map();
 return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
// A native File with a virtual disk-backed size. The transport must ask for
// bounded slices; no test ever allocates or reads a multi-gigabyte buffer.
class DiskFile extends File{
 constructor(size){super(['fixture'],'INVOX.exe',{type:'application/x-msdownload'});this.diskSize=size;this.slices=[];}
 get size(){return this.diskSize;}
 slice(start,end,type){
  assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end));
  assert(start>=0&&end<=this.size&&end-start<=chunkSize,'File reads must stay within one 6 MiB chunk');
  this.slices.push({start,end});
  const part=new Blob([],{type});Object.defineProperty(part,'size',{value:end-start});return part;
 }
 arrayBuffer(){throw Error('Whole-file arrayBuffer is forbidden');}
 stream(){throw Error('Whole-file stream is forbidden');}
 text(){throw Error('Whole-file text is forbidden');}
}
function harness(options={}){
 const state={requests:[],apiCalls:[],sdkCalls:[],uploads:[],retryTimers:[],offset:0,interrupted:false,progress:[]};
 const localStorage=storage(),sessionStorage=storage();
 const session=options.signedOut?null:{access_token:'admin-access-fixture',refresh_token:'admin-refresh-fixture'};
 const sdk={createClient(url,key,settings){state.sdkCalls.push({url,key,settings});return {auth:{getSession:async()=>({data:{session}})}};}};
 class XHR{
  constructor(){this.upload={};this.headers={};this.responseHeaders={};this.status=0;this.responseText='';this.withCredentials=false;}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(name,value){this.headers[name.toLowerCase()]=value;}
  getResponseHeader(name){return this.responseHeaders[name.toLowerCase()]??null;}
  abort(){}
  send(body){
   this.body=body;state.requests.push(this);
   queueMicrotask(()=>{
    if(options.httpStatus){this.status=options.httpStatus;this.responseText='{"message":"rejected"}';this.onload();return;}
    if(this.method==='POST'){
     assert.equal(this.url,endpoint);assert.equal(state.offset,0);
     state.total=Number(this.headers['upload-length']);
     state.offset=body?.size||0;
     this.responseHeaders.location=endpoint+'/upload-fixture';this.status=201;
    }else if(this.method==='HEAD'){
     assert.equal(this.url,endpoint+'/upload-fixture');this.status=200;
    }else if(this.method==='PATCH'){
     assert.equal(this.url,endpoint+'/upload-fixture');assert.equal(Number(this.headers['upload-offset']),state.offset);
     assert(body instanceof Blob);assert(body.size<=chunkSize);
     if(options.interrupt&&!state.interrupted){
      state.interrupted=true;
      // The server committed part of a chunk before the connection disappeared.
      // Resumption must HEAD the accepted offset instead of replaying from zero.
      state.offset+=2*1024*1024;
      this.upload.onprogress?.({lengthComputable:true,loaded:body.size,total:body.size});
      this.onerror(Error('connection interrupted'));return;
     }
     state.offset+=body.size;this.status=204;
    }else throw Error('Unexpected upload method '+this.method);
    if(body)this.upload.onprogress?.({lengthComputable:true,loaded:body.size,total:body.size});
    this.responseHeaders['upload-offset']=String(state.offset);
    this.responseHeaders['upload-length']=String(state.total);
    this.responseHeaders['tus-resumable']='1.0.0';
    this.onload();
   });
  }
 }
 const fetch=async(url,init)=>{
  const body=JSON.parse(init.body);state.apiCalls.push({url,init,body});
  assert.equal(body.action,'create-upload');
  if(options.ticketError)return new Response(JSON.stringify({error:{code:'forbidden',message:'Ticket recusado.'}}),{status:403});
  return new Response(JSON.stringify(options.ticket||defaultTicket),{status:200});
 };
 const window={supabase:sdk,localStorage,sessionStorage};
 const context=vm.createContext({window,localStorage,sessionStorage,navigator:{onLine:true},location:{href:project+'/'},fetch,XMLHttpRequest:XHR,File,Blob,Headers,Response,Request,URL,URLSearchParams,AbortController,crypto:require('node:crypto').webcrypto,
  setTimeout(fn,delay){state.retryTimers.push(delay);return setTimeout(fn,Math.min(delay,1));},clearTimeout,
 });
 vm.runInContext(tusSource,context,{filename:'tus.min.js'});
 const NativeUpload=window.tus.Upload;
 window.tus.Upload=class extends NativeUpload{
  constructor(file,settings){if(options.constructorError)throw Error('sensitive '+uploadToken);super(file,settings);state.uploads.push(this);}
 };
 if(options.unsupported)window.tus.isSupported=false;
 vm.runInContext(clientSource,context,{filename:'invox-client.js'});
 return {api:window.InvoxBackend,state,localStorage,sessionStorage};
}
async function upload(h,file){return h.api.uploadInstaller({platform:'windows',version:'1.1.0',file,onProgress:value=>h.state.progress.push(value)});}
(async()=>{
 {
  const file=new DiskFile(1.5*1024*1024*1024),h=harness();
  const result=await upload(h,file);
  assert.equal(result.size,file.size);assert.equal(result.path,defaultTicket.path);assert.equal(h.state.offset,file.size);
  assert.equal(h.state.requests.filter(r=>r.method==='POST').length,1);
  assert.equal(h.state.requests.filter(r=>r.method==='PATCH').length,255);
  assert.equal(file.slices.length,256);assert.equal(file.slices[0].start,0);assert.equal(file.slices.at(-1).end,file.size);
  assert.equal(h.state.uploads[0].file,file);assert.equal(h.state.sdkCalls.length,1);
  assert.equal(h.state.apiCalls[0].init.headers.Authorization,'Bearer admin-access-fixture');
  const metadata=Object.fromEntries(h.state.requests[0].headers['upload-metadata'].split(',').map(pair=>{const [name,value]=pair.split(' ');return [name,Buffer.from(value,'base64').toString()];}));
  assert.equal(metadata.bucketName,'invox-installers');assert.equal(metadata.objectName,defaultTicket.path);assert.equal(metadata.contentType,'application/octet-stream');
  for(const request of h.state.requests){
   assert.equal(request.headers['x-signature'],uploadToken);assert.equal(request.headers.authorization,undefined);
   assert.equal(request.withCredentials,false);assert.equal(new URL(request.url).origin,storageOrigin);
   assert(!request.url.includes(uploadToken));
  }
  assert.equal(h.state.progress[0],0);assert.equal(h.state.progress.at(-1),100);assert(!h.state.progress.slice(0,-1).includes(100));
  assert([...h.localStorage.values.values(),...h.sessionStorage.values.values()].every(value=>!value.includes(uploadToken)&&!value.includes('/resumable/')));
  checks.push('Real vendored tus uploads a virtual 1.5 GiB File in 256 bounded slices, with scoped signed headers and no extra Auth client or persisted upload URL');
 }
 {
  const file=new DiskFile(20*1024*1024),h=harness({interrupt:true});await upload(h,file);
  assert(h.state.interrupted);assert.equal(h.state.offset,file.size);
  const headIndex=h.state.requests.findIndex(r=>r.method==='HEAD');assert(headIndex>0);
  const resumed=h.state.requests[headIndex+1];assert.equal(resumed.method,'PATCH');assert.equal(Number(resumed.headers['upload-offset']),8*1024*1024);
  assert(file.slices.some(slice=>slice.start===8*1024*1024));assert.equal(h.state.requests.filter(r=>r.method==='POST').length,1);
  assert(h.state.retryTimers.includes(0));
  assert(h.state.progress.every((value,index,list)=>!index||value>=list[index-1]));
  const before=h.state.progress.length;h.state.uploads[0].options.onProgress(0,file.size);h.state.uploads[0].options.onError(Error('late'));assert.equal(h.state.progress.length,before);
  checks.push('Interrupted PATCH resumes from the server HEAD offset without a second POST or backward/late progress');
 }
 for(const status of [401,403,413,500]){
  const h=harness({httpStatus:status}),file=new DiskFile(chunkSize+1);
  const expected=status===413?'file_too_large':status===500?'upload_failed':'upload_expired';
  await assert.rejects(()=>upload(h,file),error=>error.code===expected&&error.status===status&&!error.message.includes(uploadToken));
  assert(!h.state.progress.includes(100));
  assert.equal(h.state.requests.length,status===500?6:1);
  h.state.uploads[0].options.onSuccess();h.state.uploads[0].options.onProgress(file.size,file.size);assert(!h.state.progress.includes(100));
 }
 checks.push('401/403/413 stop without retry; transient 500 exhausts configured retries; failures and late callbacks never emit success or signed credentials');
 for(const options of [{signedOut:true},{ticketError:true},{ticket:{...defaultTicket,signedUrl:'https://outside.example.test/upload'}},{ticket:{...defaultTicket,path:'windows/../file.exe'}}]){
  const h=harness(options);await assert.rejects(()=>upload(h,new DiskFile(chunkSize+1)));
  assert.equal(h.state.requests.length,0);assert.equal(h.state.uploads.length,0);
 }
 checks.push('Unauthenticated, denied and malformed upload tickets never reach tus or Storage');
 {
  const h=harness({unsupported:true});await assert.rejects(()=>upload(h,new DiskFile(chunkSize+1)),error=>error.code==='offline');assert.equal(h.state.apiCalls.length,0);
  const failed=harness({constructorError:true});await assert.rejects(()=>upload(failed,new DiskFile(chunkSize+1)),error=>error.code==='upload_failed'&&!error.message.includes(uploadToken));
  assert.equal(failed.state.requests.length,0);assert(!failed.state.progress.includes(100));
  checks.push('Unsupported browsers and constructor errors produce safe, actionable failures without starting a transfer');
 }
 console.log(JSON.stringify({result:'PASS',checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
