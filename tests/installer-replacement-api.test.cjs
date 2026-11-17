const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../supabase/functions/invox-api/index.ts'),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob,console};
vm.runInNewContext(source+'\nglobalThis.testExports={createHandler};',context);
const ADMIN='11111111-1111-4111-8111-111111111111',HISTORY='22222222-2222-4222-8222-222222222222',UPLOAD='33333333-3333-4333-8333-333333333333',OTHER='44444444-4444-4444-8444-444444444444';
const PATHS=[`uploads/${UPLOAD}/000-${'a'.repeat(64)}.part`,`uploads/${UPLOAD}/001-${'b'.repeat(64)}.part`];
const replacement={fileName:'INVOX-1.2.0.exe',size:549447078,version:'1.2.0'};
function harness(){
 const calls=[],objects=new Map(PATHS.map(path=>[path,20971520]));
 const controls={uploadFailure:false,incorrectSize:false,foreignAdmin:false,tamperPath:false,kind:'multipart'};
 let job=null,published=true,finished=false;
 function paths(){return controls.kind==='legacy'?['windows/1.1.0/old.exe']:PATHS;}
 function plan(){return {replacement:{platform:'windows',historyId:HISTORY,fileName:'INVOX-old.exe',size:549447078,kind:controls.kind,startedAt:'2026-11-17T12:00:00Z',completedAt:finished?'2026-11-17T12:01:00Z':null,replacement:{...replacement}},releasedBytes:finished?549447078-paths().length:0,replacementPending:!finished,bucket:controls.kind==='legacy'?'invox-installers':'invox-installer-parts',uploadId:controls.kind==='legacy'?null:UPLOAD,paths:controls.tamperPath?['foreign/path']:paths()};}
 const tables={invox_admins:[{user_id:ADMIN,username:'admin',email:'admin@example.test',enabled:true}],invox_site_settings:[{id:true,visibility:'public',download_universal_enabled:true,download_password_hash:null,download_access_generation:1,download_mode_generation:1,version:'1.1.0',release_notes:'',updated_at:'2026-11-17T12:00:00Z'}],invox_feedbacks:[],invox_announcements:[]};
 class Query{
  constructor(table){this.table=table;this.filters=[];this.one=false;}
  select(){return this;}eq(k,v){this.filters.push(row=>row[k]===v);return this;}order(){return this;}limit(){return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}
  then(resolve,reject){const rows=(this.table==='invox_installers'?(published?[{platform:'windows',path:null,multipart_upload_id:UPLOAD,sha256:'a'.repeat(64),current_history_id:HISTORY,file_name:'INVOX-old.exe',size:549447078,version:'1.1.0'}]:[]):tables[this.table]||[]).filter(row=>this.filters.every(filter=>filter(row)));return Promise.resolve({data:this.one?rows[0]||null:rows,error:null}).then(resolve,reject);}
 }
 const service={from:table=>new Query(table),auth:{getUser:async()=>({data:{user:{id:controls.foreignAdmin?OTHER:ADMIN,email:controls.foreignAdmin?'other@example.test':'admin@example.test',email_confirmed_at:'now'}},error:null})},rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='invox_take_rate_limit')return {data:true,error:null};
  if(name==='invox_prepare_installer_replacement'){
   if(args.p_history_id!==HISTORY)return {data:null,error:{message:'invox_installer_changed'}};
   if(args.p_size>1000000000)return {data:null,error:{message:'invox_storage_quota_exceeded'}};
   if(job&&JSON.stringify(job)!==JSON.stringify(args))return {data:null,error:{message:'invox_replacement_conflict'}};
   job=args;published=false;return {data:plan(),error:null};
  }
  if(name==='invox_finish_installer_replacement'){
   assert.equal(args.p_history_id,HISTORY);finished=paths().every(path=>objects.get(path)===1);return {data:plan(),error:null};
  }
  if(name==='invox_installer_replacements_list')return {data:job?[plan().replacement]:[],error:null};
  if(name==='invox_storage_status')return {data:{capacityBytes:args.p_budget_bytes,usedBytes:[...objects.values()].reduce((a,b)=>a+b,0),reservedBytes:finished?0:549447078,availableBytes:finished?999999998:450552922,cleanupPendingBytes:job&&!finished?549447078:0},error:null};
  if(name==='invox_admin_code_pool')return {data:{valid:[],used:[],inactive:[],legacy:[],totals:{valid:0,used:0,inactive:0,legacy:0},evaluatedAt:'2026-11-17T12:00:00Z'},error:null};
  if(['invox_multipart_cleanup_due','invox_installer_history_list','invox_download_codes_list'].includes(name))return {data:[],error:null};
  throw Error('Unexpected RPC '+name);
 },storage:{from:bucket=>({upload:async(path,body,options)=>{
  calls.push({name:'storage.upload',bucket,path,body:[...body],options});
  if(controls.uploadFailure)return {data:null,error:{message:'offline'}};
  objects.set(path,controls.incorrectSize?2:body.byteLength);return {data:{path},error:null};
 }})}};
 const handler=context.testExports.createHandler({service,rateSecret:'fixture-secret',crypto:webcrypto,storageBudgetBytes:1000000000,uploadLimitBytes:1610612736,now:()=> '2026-11-17T12:00:00Z'});
 async function call(overrides={},authenticated=true){const response=await handler(new Request('https://example.test/functions/v1/invox-api',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://jmxxp.github.io','x-forwarded-for':'192.0.2.1',...(authenticated?{Authorization:'Bearer fixture-token'}:{})},body:JSON.stringify({action:'prepare-installer-replacement',platform:'windows',expectedHistoryId:HISTORY,confirm:true,replacement:{...replacement},...overrides})}));return {status:response.status,body:await response.json()};}
 return {call,calls,controls,objects,get finished(){return finished;},get published(){return published;}};
}
module.exports=(async()=>{
 let h=harness(),result=await h.call();
 assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.replacementPending,false);assert.equal(result.body.releasedBytes,549447076);assert.equal(h.finished,true);
 const uploads=h.calls.filter(call=>call.name==='storage.upload');assert.equal(uploads.length,2);
 for(const call of uploads){assert.equal(call.bucket,'invox-installer-parts');assert(PATHS.includes(call.path));assert.deepEqual(call.body,[0]);assert.equal(call.options.upsert,true);assert.equal(call.options.contentType,'application/octet-stream');assert.equal(call.options.cacheControl,'0');}
 const finishIndex=h.calls.findIndex(call=>call.name==='invox_finish_installer_replacement');for(const path of PATHS)assert(h.calls.findIndex(call=>call.name==='storage.upload'&&call.path===path)<finishIndex,'sealing must precede authoritative SQL verification');
 const args=h.calls.find(call=>call.name==='invox_prepare_installer_replacement').args;assert.equal(args.p_admin_id,ADMIN);assert.equal(args.p_platform,'windows');assert.equal(args.p_history_id,HISTORY);assert.equal(args.p_file_name,replacement.fileName);assert.equal(args.p_size,replacement.size);assert.equal(args.p_version,replacement.version);assert.equal(args.p_budget_bytes,1000000000);
 for(const overrides of [{confirm:false},{confirm:undefined},{confirm:'true'},{expectedHistoryId:'bad'},{platform:'unknown'},{replacement:{...replacement,fileName:'../bad.exe'}},{replacement:{...replacement,fileName:'bad.apk'}},{replacement:{...replacement,size:0}},{replacement:{...replacement,size:1610612737}},{replacement:{...replacement,version:'bad'}},{replacement:null}]){
  h=harness();result=await h.call(overrides);assert.equal(result.status,400,JSON.stringify({overrides,result}));assert(!h.calls.some(call=>call.name.includes('replacement')||call.name.startsWith('storage.')),'invalid input must not stage or alter Storage');assert(h.published);
 }
 h=harness();result=await h.call({},false);assert.equal(result.status,401);assert.equal(h.calls.length,0);
 h=harness();h.controls.foreignAdmin=true;result=await h.call();assert.equal(result.status,403);assert(!h.calls.some(call=>call.name.includes('replacement')||call.name.startsWith('storage.')));
 h=harness();result=await h.call({expectedHistoryId:OTHER});assert.equal(result.status,409);assert.equal(result.body.error.code,'installer_changed');assert(h.published);assert(!h.calls.some(call=>call.name.startsWith('storage.')));
 h=harness();result=await h.call({replacement:{...replacement,size:1500000000}});assert.equal(result.status,409);assert.equal(result.body.error.code,'storage_quota_exceeded');assert(h.published);assert(!h.calls.some(call=>call.name.startsWith('storage.')));
 for(const failure of ['uploadFailure','incorrectSize']){
  h=harness();h.controls[failure]=true;result=await h.call();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.replacementPending,true);assert.equal(result.body.releasedBytes,0);assert.equal(h.finished,false);assert.equal(result.body.storage.reservedBytes,549447078);
  h.controls[failure]=false;result=await h.call();assert.equal(result.status,200);assert.equal(result.body.replacementPending,false);assert.equal(h.finished,true);
  const prepares=h.calls.filter(call=>call.name==='invox_prepare_installer_replacement');assert.equal(prepares.length,2);assert.deepEqual(prepares[0].args,prepares[1].args,'retry must resume same immutable replacement job');
  const uploadsBefore=h.calls.filter(call=>call.name==='storage.upload').length;result=await h.call();assert.equal(result.status,200);assert.equal(h.calls.filter(call=>call.name==='storage.upload').length,uploadsBefore,'completed retry must not rewrite Storage');
 }
 h=harness();h.controls.kind='legacy';result=await h.call();assert.equal(result.status,200);assert.equal(result.body.replacementPending,false);assert.equal(h.calls.filter(call=>call.name==='storage.upload').length,1);assert.equal(h.calls.find(call=>call.name==='storage.upload').bucket,'invox-installers');
 h=harness();h.controls.tamperPath=true;result=await h.call();assert.equal(result.status,503);assert(!h.calls.some(call=>call.name.startsWith('storage.')),'corrupt server plan must not write outside owned paths');
 console.log('Installer replacement API: consent, preflight, CAS, one-byte sealing, SQL verification and idempotent recovery passed');
})();
