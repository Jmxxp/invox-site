const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require('node:path').resolve(__dirname, '..', "supabase/functions/invox-api/index.ts"),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob,console};
vm.runInNewContext(source+'\nglobalThis.exports={createHandler,createUnavailableHandler,passwordHash,passwordMatches};',context);
const {createHandler,createUnavailableHandler,passwordHash,passwordMatches}=context.exports;
const ADMIN='11111111-1111-4111-8111-111111111111',FEEDBACK='22222222-2222-4222-8222-222222222222';
function harness(options={}){
 const db={invox_admins:[{email:'admin@example.test',username:'admin',user_id:ADMIN,enabled:true}],invox_site_settings:[{id:true,visibility:'public',download_universal_enabled:true,download_password_hash:null,download_access_generation:1,download_mode_generation:1,version:'1.1.0',release_notes:'',updated_at:'2026-11-16T00:00:00Z'}],invox_feedbacks:[],invox_installers:[{platform:'windows',path:'windows/1.1.0/test.exe',file_name:'INVOX-1.1.0.exe',size:1024,version:'1.1.0'}],invox_uploads:[],invox_announcements:[]};
 const logs={sign:[],upload:[],rpc:[],auth:[],anonymousAuth:[],queries:[]};
 const history=[];
 function snapshot(item,action){const entry={id:`77777777-7777-4777-8777-${String(history.length+1).padStart(12,'0')}`,platform:item.platform,version:item.version,fileName:item.file_name,size:item.size,publishedAt:'2026-11-16T00:00:00.000Z',action,migrated:false};history.push(entry);item.current_history_id=entry.id;}
 const controls={tableError:null,throwQuery:false,rate:true,rateError:false,authError:false,user:{id:ADMIN,email:'admin@example.test',email_confirmed_at:'now'},authPassword:'fake-admin-password',storageSize:1024,storageError:false};
 class Query{
  constructor(table){this.table=table;this.filters=[];this.operation='read';this.value=null;this.one=false;this.optional=false;this.max=Infinity;}
  select(columns){this.columns=columns;return this;}eq(key,value){this.filters.push(row=>row[key]===value);return this;}order(){return this;}limit(value){this.max=value;return this;}
  insert(value){this.operation='insert';this.value=value;return this;}update(value){this.operation='update';this.value=value;return this;}
  single(){this.one=true;return this;}maybeSingle(){this.one=true;this.optional=true;return this;}
  then(resolve,reject){return Promise.resolve().then(()=>{
   logs.queries.push([this.table,this.operation]);
   if(controls.throwQuery)throw Object.assign(new Error('SQL SECRET'),{status:403,code:'sql_error'});
   if(controls.tableError===this.table)return {data:null,error:{message:'SQL SECRET'}};
   let rows=db[this.table].filter(row=>this.filters.every(fn=>fn(row)));
   if(this.operation==='insert'){const row={id:FEEDBACK,created_at:'2026-11-16T00:00:00Z',status:'new',note:'',...this.value};db[this.table].push(row);rows=[row];}
   if(this.operation==='update')rows.forEach(row=>Object.assign(row,this.value));
   rows=rows.slice(0,this.max).map(row=>({...row}));
   if(this.one)return {data:rows[0]||null,error:rows.length||this.optional?null:{message:'missing'}};
   return {data:rows,error:null};
  }).then(resolve,reject);}
 }
 const service={from:table=>new Query(table),auth:{getUser:async token=>{logs.auth.push(token);return {data:{user:controls.user},error:controls.authError?{message:'invalid token'}:null};}},rpc:async(name,args)=>{
  logs.rpc.push([name,args]);
  if(name==='invox_take_rate_limit')return {data:controls.rate,error:controls.rateError?{message:'SQL SECRET'}:null};
  if(name==='invox_record_analytics'||name==='invox_authorize_universal_legacy')return {data:true,error:null};
  if(name==='invox_download_codes_list')return {data:[],error:null};
  if(name==='invox_installer_replacements_list')return {data:[],error:null};
  if(name==='invox_admin_code_pool')return {data:{valid:[],used:[],inactive:[],legacy:[],totals:{valid:0,used:0,inactive:0,legacy:0},evaluatedAt:'2026-11-17T12:00:00Z'},error:null};
  if(name==='invox_installer_history_list')return controls.tableError==='invox_installer_history'?{data:null,error:{message:'SQL SECRET'}}:{data:history.slice(-args.p_limit).reverse().map(entry=>({...entry,isCurrent:db.invox_installers.some(item=>item.current_history_id===entry.id)})),error:null};
  if(name==='invox_multipart_cleanup_due')return {data:[],error:null};
  if(name==='invox_storage_status')return {data:{capacityBytes:args.p_budget_bytes,usedBytes:0,reservedBytes:0,availableBytes:args.p_budget_bytes,cleanupPendingBytes:0},error:null};
  if(name==='invox_reserve_single_upload'){db.invox_uploads.push({path:args.p_path,platform:args.p_platform,file_name:args.p_file_name,size:args.p_size,version:args.p_version,created_by:args.p_admin_id});return {data:null,error:null};}
  if(name==='invox_issue_universal_session')return {data:'2026-12-16T00:00:00Z',error:null};
  if(name==='invox_publish_release'){
   Object.assign(db.invox_site_settings[0],{version:args.p_version,release_notes:args.p_release_notes});
   for(const file of args.p_files){db.invox_installers=db.invox_installers.filter(item=>item.platform!==file.platform);const item={platform:file.platform,path:file.path,file_name:file.fileName,size:file.size,version:file.version||args.p_version};snapshot(item,'published');db.invox_installers.push(item);}
   return {data:null,error:null};
  }
  if(name==='invox_update_installer_version'){const item=db.invox_installers.find(item=>item.platform===args.p_platform);if(!item)return {data:null,error:{code:'P0002',message:'not found'}};if(item.version!==args.p_version){item.version=args.p_version;snapshot(item,'version_updated');}return {data:null,error:null};}
 },storage:{from:bucket=>({createSignedUrl:async(path,expires,options)=>{logs.sign.push({bucket,path,expires,options});return {data:{signedUrl:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/'+bucket+'/'+path+'?token=fixture'},error:null};},createSignedUploadUrl:async(path,options)=>{logs.upload.push({bucket,path,options});return {data:{token:'fake-upload-token',signedUrl:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/upload/sign/'+bucket+'/'+path+'?token=fixture'},error:null};},info:async()=>({data:{size:controls.storageSize},error:controls.storageError?{message:'missing'}:null})})}};
 const handler=createHandler({service,publicCacheTtlMs:options.publicCacheTtlMs,uploadLimitBytes:options.uploadLimitBytes,rateSecret:'fake-service-secret',crypto:webcrypto,now:()=> '2026-11-16T00:00:00Z',randomUUID:()=> '33333333-3333-4333-8333-333333333333',createAuthClient:()=>({auth:{signInWithPassword:async data=>{logs.anonymousAuth.push(data);const valid=data.password===controls.authPassword;return {data:{user:controls.user,session:valid?{access_token:'fake-access',refresh_token:'fake-refresh'}:null},error:valid?null:{message:'invalid credentials'}};}}})});
 async function call(action,data={},admin=false,options={}){const headers={'Content-Type':'application/json','Origin':'https://jmxxp.github.io','x-forwarded-for':'192.0.2.1',...(admin?{Authorization:'Bearer fake-access'}:{}),...options.headers};const response=await handler(new Request('https://example.test/functions/v1/invox-api',{method:options.method||'POST',headers,body:options.method==='GET'||options.method==='OPTIONS'?undefined:options.body||JSON.stringify({action,...data})}));const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,headers:response.headers,text};}
 return {db,controls,logs,handler,call,service,history};
}
module.exports=(async()=>{
 const unavailableHandler=createUnavailableHandler();
 for(const origin of ['http://127.0.0.1:5500','http://localhost:5500','https://jmxxp.github.io']){
  const preflight=await unavailableHandler(new Request('https://example.test/invox-api',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,apikey'}}));
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);assert(preflight.headers.get('Access-Control-Allow-Headers').includes('apikey'));
  const failed=await unavailableHandler(new Request('https://example.test/invox-api',{method:'POST',headers:{Origin:origin}}));
  assert.equal(failed.status,503);assert.equal(failed.headers.get('Access-Control-Allow-Origin'),origin);assert.equal((await failed.json()).error.code,'offline');
 }
 const deniedFallback=await unavailableHandler(new Request('https://example.test/invox-api',{method:'OPTIONS',headers:{Origin:'https://evil.example.test'}}));
 assert.equal(deniedFallback.status,403);assert.equal(deniedFallback.headers.get('Access-Control-Allow-Origin'),null);
 const h=harness();let response=await h.call('state');assert.equal(response.status,200);assert.equal(response.body.version,'1.1.0');assert.equal(response.body.platforms[0].available,true);assert(!response.text.includes('windows/1.1.0/'));assert(!response.text.includes('password_hash'));assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://jmxxp.github.io');
 response=await h.call('admin-state');assert.equal(response.status,401);assert.equal(h.logs.auth.length,0);
 response=await h.call('admin-state',{},true);assert.equal(response.status,200);assert.equal(response.body.admin.username,'admin');assert.equal(response.body.settings.uploadLimitBytes,1610612736);assert.equal(response.body.settings.objectUploadLimitBytes,52428800);assert.equal(response.body.settings.multipartPartSizeBytes,20971520);assert.equal(response.body.installers[0].path,'windows/1.1.0/test.exe');
 h.controls.user={id:'44444444-4444-4444-8444-444444444444',email:'attacker@example.test',email_confirmed_at:'now',user_metadata:{admin:true}};response=await h.call('admin-state',{},true);assert.equal(response.status,403);h.controls.user={id:ADMIN,email:'admin@example.test',email_confirmed_at:null};response=await h.call('admin-state',{},true);assert.equal(response.status,401);h.controls.user={id:ADMIN,email:'admin@example.test',email_confirmed_at:'now'};
 response=await h.call('login',{username:'admin',password:'wrong'});assert.equal(response.status,401);assert.equal(response.body.error.message,'Usuário ou senha inválidos.');response=await h.call('login',{username:'missing',password:'wrong'});assert.equal(response.status,401);assert.equal(response.body.error.message,'Usuário ou senha inválidos.');response=await h.call('login',{username:'ADMIN',password:'fake-admin-password'});assert.equal(response.status,200);assert.equal(response.body.session.access_token,'fake-access');assert.equal(h.logs.anonymousAuth.length,2);
 response=await h.call('download',{platform:'windows'});assert.equal(response.status,200);assert.equal(h.logs.sign.at(-1).expires,60);assert.equal(h.logs.sign.at(-1).options.download,'INVOX-1.1.0.exe');
 const hash=await passwordHash('fake-download-password',webcrypto);assert(!hash.includes('fake-download-password'));assert(await passwordMatches('fake-download-password',hash,webcrypto));assert(!await passwordMatches('wrong',hash,webcrypto));h.db.invox_site_settings[0].visibility='private';h.db.invox_site_settings[0].download_password_hash=hash;const signCount=h.logs.sign.length;
 response=await h.call('download',{platform:'windows'});assert.equal(response.body.error.code,'password_required');response=await h.call('download',{platform:'windows',password:'wrong'});assert.equal(response.body.error.code,'invalid_password');assert.equal(h.logs.sign.length,signCount);response=await h.call('download',{platform:'windows',password:'fake-download-password'});assert.equal(response.status,200);assert.equal(h.logs.sign.length,signCount+1);
 h.controls.rate=false;response=await h.call('download',{platform:'windows',password:'fake-download-password'});assert.equal(response.status,429);assert.equal(h.logs.sign.length,signCount+1);h.controls.rate=true;h.controls.rateError=true;response=await h.call('download',{platform:'windows',password:'fake-download-password'});assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));h.controls.rateError=false;
 response=await h.call('feedback',{name:' Jogador ',contact:' user@example.test ',message:' Uma mensagem real de teste. ',website:''});assert.equal(response.status,201);assert.equal(h.db.invox_feedbacks[0].name,'Jogador');response=await h.call('feedback',{name:'Bot',contact:'bot@example.test',message:'Mensagem de teste inválida',website:'https://spam.example.test'});assert.equal(response.status,400);assert.equal(h.db.invox_feedbacks.length,1);
 // Game and site share the same private inbox; new rows collect no contact.
 for(const kind of ['feedback','suggestion'])for(const source of ['game','site']){
  const inbox=harness();let receipt=await inbox.call('feedback',{name:' Jogador ',message:' Uma mensagem só de conteúdo. ',kind,source,contact:'ignored@example.test'},false,{headers:{Origin:''}});
  assert.equal(receipt.status,201);assert.deepEqual(Object.keys(receipt.body),['id']);const row=inbox.db.invox_feedbacks[0];assert.equal(row.kind,kind);assert.equal(row.source,source);assert(!('contact' in row));assert.equal(row.name,'Jogador');
  receipt=await inbox.call('admin-state',{},true);assert.equal(receipt.body.feedbacks[0].kind,kind);assert.equal(receipt.body.feedbacks[0].source,source);assert.equal(receipt.body.feedbacks[0].contact,'');
 }
 const invalidInbox=harness();
 for(const invalid of [{kind:'invalid'},{source:'unknown'},{name:'x'},{message:'curto'},{message:'x'.repeat(2001)},{name:'x'.repeat(81)},{kind:null},{source:12}]){
  const result=await invalidInbox.call('feedback',{name:'Jogador',message:'Mensagem de teste suficiente.',kind:'feedback',source:'game',...invalid});assert.equal(result.status,400);
 }
 assert.equal(invalidInbox.db.invox_feedbacks.length,0);
 const unicodeInbox=harness();response=await unicodeInbox.call('feedback',{name:'😀'.repeat(80),message:'😀'.repeat(2000),kind:'suggestion',source:'game'});assert.equal(response.status,201);
 response=await unicodeInbox.call('feedback',{name:'😀'.repeat(81),message:'😀'.repeat(2000),source:'game'});assert.equal(response.status,400);
 const news=harness();
 response=await news.call('save-announcement',{title:'Novo recado',message:'Uma mensagem para todos.'});assert.equal(response.status,401);assert.equal(news.db.invox_announcements.length,0);
 response=await news.call('save-announcement',{title:' Novo recado ',message:' Uma mensagem para todos. '},true);assert.equal(response.status,201);assert.equal(response.body.title,'Novo recado');assert.equal(response.body.active,true);const announcementId=response.body.id;assert.equal(news.db.invox_announcements[0].created_by,ADMIN);
 news.db.invox_announcements.push({id:'33333333-3333-4333-8333-333333333333',title:'Recado desativado',message:'Não deve aparecer no jogo',active:false,published_at:'2026-11-15T00:00:00Z',created_by:ADMIN});
 response=await news.call('game-state',{},false,{headers:{Origin:''}});assert.equal(response.status,200);assert.equal(response.body.announcements.length,1);assert.equal(response.body.announcements[0].id,announcementId);assert.equal(response.body.installers.find(row=>row.platform==='windows').version,'1.1.0');assert.equal(response.body.installers.find(row=>row.platform==='android').available,false);assert(!response.text.includes('windows/1.1.0/test.exe'));assert(!response.text.includes('created_by'));assert(!response.text.includes('download_password_hash'));assert(!response.text.includes('contact'));
 news.db.invox_site_settings[0].visibility='private';news.db.invox_site_settings[0].download_password_hash=hash;response=await news.call('game-state');assert.equal(response.status,200);assert.equal(response.body.visibility,'private');assert(!response.text.includes('pbkdf2'));
 response=await news.call('set-announcement-active',{id:announcementId,active:false});assert.equal(response.status,401);
 response=await news.call('set-announcement-active',{id:announcementId,active:false},true);assert.equal(response.status,200);assert.equal(response.body.active,false);response=await news.call('game-state');assert.equal(response.body.announcements.length,0);
 response=await news.call('set-announcement-active',{id:announcementId,active:true},true);assert.equal(response.status,200);assert.equal(response.body.publishedAt,'2026-11-16T00:00:00Z');
 response=await news.call('admin-state',{},true);assert.equal(response.body.announcements.length,2);
 for(const invalid of [{title:''},{title:'x'.repeat(101)},{message:''},{message:'x'.repeat(2001)}]){response=await news.call('save-announcement',{title:'Título',message:'Aviso',...invalid},true);assert.equal(response.status,400);}
 response=await news.call('set-announcement-active',{id:announcementId,active:'false'},true);assert.equal(response.status,400);
 news.controls.tableError='invox_announcements';response=await news.call('game-state');assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));
 response=await h.call('save-access',{visibility:'private',password:''},true);assert.equal(response.status,200);assert.equal(h.db.invox_site_settings[0].download_password_hash,hash);response=await h.call('save-access',{visibility:'private',password:'new-fake-password'},true);assert.equal(response.status,200);assert(response.body.hasPassword);assert(!response.text.includes('pbkdf2'));assert(!response.text.includes('new-fake-password'));response=await h.call('save-access',{visibility:'public'},true);assert.equal(response.body.hasPassword,false);
 response=await h.call('update-feedback',{id:FEEDBACK,status:'answered',note:'Nota interna.'},true);assert.equal(response.status,200);assert.equal(response.body.status,'answered');assert.equal(response.body.receivedAt,'2026-11-16T00:00:00Z');
 const file={platform:'windows',fileName:'INVOX-1.1.0.exe',size:1024,version:'1.1.0'};response=await h.call('create-upload',file,true);assert.equal(response.status,200);const path=response.body.path;assert(path.startsWith('windows/1.1.0/33333333'));assert.equal(h.logs.upload.at(-1).options.upsert,false);assert.equal(h.db.invox_uploads[0].created_by,ADMIN);
 const manifest={platform:'windows',path,fileName:file.fileName,size:1024};const publishCount=()=>h.logs.rpc.filter(([name])=>name==='invox_publish_release').length;
 response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[manifest,manifest]},true);assert.equal(response.status,400);assert.equal(publishCount(),0);
 h.controls.storageSize=1;response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[manifest]},true);assert.equal(response.status,400);assert.equal(publishCount(),0);h.controls.storageSize=1024;
 response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[{...manifest,path:'windows/1.1.0/other.exe'}]},true);assert.equal(response.status,400);assert.equal(publishCount(),0);
 response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[manifest]},true);assert.equal(response.status,200);assert.equal(publishCount(),1);assert.equal(response.body.installers[0].path,path);
 response=await h.call('create-upload',{...file,size:1610612737},true);assert.equal(response.status,400);response=await h.call('create-upload',{...file,fileName:'../bad.exe'},true);assert.equal(response.status,400);response=await h.call('save-release',{version:'01.1.0',releaseNotes:'',files:[]},true);assert.equal(response.status,400);
 response=await h.call('create-upload',{...file,fileName:'가'.repeat(176)+'.exe'},true);assert.equal(response.status,200);assert(response.body.path.length<=512);assert(response.body.path.endsWith('.exe'));assert(response.body.path.split('/').at(-1).length<=217);
 h.controls.tableError='invox_site_settings';response=await h.call('state');assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));h.controls.tableError=null;h.controls.throwQuery=true;response=await h.call('state');assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));h.controls.throwQuery=false;
 response=await h.call('state',{},false,{headers:{Origin:'https://evil.example.test'}});assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);response=await h.call('state',{},false,{method:'GET'});assert.equal(response.status,405);response=await h.call('state',{},false,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4173'}});assert.equal(response.status,204);
 response=await h.call('state',{},false,{body:'x'.repeat(32769)});assert.equal(response.status,413);response=await h.call('state',{},false,{body:'{broken'});assert.equal(response.status,400);
 const beforePreflightAuth=h.logs.auth.length;
 response=await h.call('state',{},false,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5500','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,apikey'}});
 assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5500');assert.equal(h.logs.auth.length,beforePreflightAuth);
 for(const [,args]of h.logs.rpc.filter(([name])=>name==='invox_take_rate_limit')){assert.match(args.p_key_hash,/^[a-f0-9]{64}$/);assert(!JSON.stringify(args).includes('192.0.2.1'));}
 // Exercise only metadata: large installers stream directly to Storage, not through this JSON endpoint.
 const large=harness({uploadLimitBytes:1610612736}),uploadCap=1610612736;
 response=await large.call('create-upload',{...file,size:uploadCap});assert.equal(response.status,401);assert.equal(large.db.invox_uploads.length,0);assert.equal(large.logs.upload.length,0);
 large.controls.user={id:'44444444-4444-4444-8444-444444444444',email:'attacker@example.test',email_confirmed_at:'now',user_metadata:{admin:true}};
 response=await large.call('create-upload',{...file,size:uploadCap},true);assert.equal(response.status,403);assert.equal(large.db.invox_uploads.length,0);assert.equal(large.logs.upload.length,0);
 large.controls.user={id:ADMIN,email:'admin@example.test',email_confirmed_at:'now'};
 for(const size of [50*1024*1024+1,uploadCap]){response=await large.call('create-upload',{...file,size},true);assert.equal(response.status,400);assert.equal(large.logs.upload.length,0);}
 const authorizedCount=large.db.invox_uploads.length,signedCount=large.logs.upload.length,publishedCount=large.logs.rpc.filter(([name])=>name==='invox_publish_release').length;
 response=await large.call('create-upload',{...file,size:uploadCap+1},true);assert.equal(response.status,400);assert.equal(large.db.invox_uploads.length,authorizedCount);assert.equal(large.logs.upload.length,signedCount);
 response=await large.call('save-release',{version:file.version,releaseNotes:'',files:[{platform:file.platform,path:'windows/1.1.0/oversized.exe',fileName:file.fileName,size:uploadCap+1}]},true);assert.equal(response.status,400);assert.equal(large.logs.rpc.filter(([name])=>name==='invox_publish_release').length,publishedCount);
 const live=harness(),liveCap=50*1024*1024;
 response=await live.call('create-upload',{...file,size:liveCap},true);assert.equal(response.status,200);const livePath=response.body.path;live.controls.storageSize=liveCap;
 response=await live.call('save-release',{version:file.version,releaseNotes:'',files:[{platform:file.platform,path:livePath,fileName:file.fileName,size:liveCap}]},true);assert.equal(response.status,200);assert.equal(response.body.settings.uploadLimitBytes,uploadCap);assert.equal(response.body.settings.objectUploadLimitBytes,liveCap);
 response=await live.call('create-upload',{...file,size:liveCap+1,uploadLimitBytes:uploadCap},true);assert.equal(response.status,400);assert.equal(live.logs.upload.length,1);
 response=await live.call('save-release',{version:file.version,releaseNotes:'',files:[{platform:file.platform,path:livePath,fileName:file.fileName,size:liveCap+1}]},true);assert.equal(response.status,400);assert.equal(live.logs.rpc.filter(([name])=>name==='invox_publish_release').length,1);
 for(const configuredLimit of [0,-1,uploadCap,uploadCap+1,Number.NaN,Number.POSITIVE_INFINITY]){response=await harness({uploadLimitBytes:configuredLimit}).call('admin-state',{},true);assert.equal(response.status,200);assert.equal(response.body.settings.objectUploadLimitBytes,liveCap);}
 for(const configuredLimit of [undefined,'invalid','999999999999999999']){
  const runtime=harness();let runtimeHandler;
  const environment={SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',INVOX_UPLOAD_LIMIT_BYTES:configuredLimit};
  vm.runInNewContext(source,{crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob,console,createClient:()=>runtime.service,Deno:{env:{get:key=>environment[key]},serve:handler=>{runtimeHandler=handler;}}});
  const result=await runtimeHandler(new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture',Origin:'https://jmxxp.github.io'},body:JSON.stringify({action:'admin-state'})}));assert.equal(result.status,200);const advertised=(await result.json()).settings;assert.equal(advertised.objectUploadLimitBytes,liveCap);assert.equal(advertised.uploadLimitBytes,uploadCap);
 }
 const uploadsBeforeVersionEdit=h.logs.upload.length;
 response=await h.call('save-release',{version:'9.0.0',releaseNotes:'Independent versions',files:[{...manifest,version:'2.0.0'}]},true);assert.equal(response.status,200);assert.equal(response.body.settings.version,'9.0.0');assert.equal(response.body.installers[0].version,'2.0.0');assert.equal(h.db.invox_uploads[0].version,'1.1.0');assert.equal(response.body.history[0].action,'published');const originalHistoryId=response.body.history[0].id;
 const editsBefore=h.logs.rpc.filter(([name])=>name==='invox_update_installer_version').length;
 response=await h.call('update-installer-version',{platform:'windows',version:'2.1.0'});assert.equal(response.status,401);assert.equal(h.logs.rpc.filter(([name])=>name==='invox_update_installer_version').length,editsBefore);
 for(const invalid of [{platform:'linux',version:'2.1.0'},{platform:'windows',version:'01.2.3'},{platform:'windows',version:null}]){response=await h.call('update-installer-version',invalid,true);assert.equal(response.status,400);}
 response=await h.call('update-installer-version',{platform:'windows',version:' 2.1.0 ',p_admin_id:'attacker',publishedAt:'1900-01-01'},true);assert.equal(response.status,200);assert.equal(response.body.installers[0].version,'2.1.0');assert.equal(response.body.settings.version,'9.0.0');assert.equal(response.body.history[0].action,'version_updated');assert.equal(response.body.history[0].isCurrent,true);assert.notEqual(response.body.history[0].publishedAt,'1900-01-01');const editedHistoryId=response.body.history[0].id;const historyCount=h.history.length;
 assert.equal(h.logs.rpc.findLast(([name])=>name==='invox_update_installer_version')[1].p_admin_id,ADMIN);assert.equal(h.db.invox_uploads[0].version,'1.1.0');assert.equal(h.logs.upload.length,uploadsBeforeVersionEdit);
 response=await h.call('update-installer-version',{platform:'windows',version:'2.1.0'},true);assert.equal(response.status,200);assert.equal(h.history.length,historyCount);assert.equal(response.body.history[0].id,editedHistoryId);
 response=await h.call('update-installer-version',{platform:'windows',version:'2.0.0'},true);assert.equal(response.status,200);assert.notEqual(response.body.history[0].id,originalHistoryId);assert.notEqual(response.body.history[0].id,editedHistoryId);assert.equal(response.body.history.filter(item=>item.isCurrent).length,1);assert.equal(response.body.history.find(item=>item.id===originalHistoryId).isCurrent,false);
 response=await h.call('update-installer-version',{platform:'macos',version:'2.0.0'},true);assert.equal(response.status,404);
 const cached=harness({publicCacheTtlMs:2000});response=await cached.call('game-state');assert.equal(response.body.installers[0].version,'1.1.0');
 response=await cached.call('update-installer-version',{platform:'windows',version:'2.2.0'},true);assert.equal(response.status,200);response=await cached.call('game-state');assert.equal(response.body.version,'1.1.0');assert.equal(response.body.installers[0].version,'2.2.0');assert(!response.text.includes('windows/1.1.0/'));assert(!response.text.includes('history'));
 response=await cached.call('download',{platform:'windows'});assert.equal(response.status,200);assert.match(response.body.url,/windows\/1\.1\.0\//,'editing a platform version keeps the existing installer downloadable');
 const privateHistoryReads=h.logs.rpc.filter(([name])=>name==='invox_installer_history_list').length;response=await h.call('state');assert.equal(response.status,200);assert(!('history'in response.body));assert.equal(h.logs.rpc.filter(([name])=>name==='invox_installer_history_list').length,privateHistoryReads);
 h.controls.tableError='invox_installer_history';response=await h.call('admin-state',{},true);assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));h.controls.tableError=null;
 console.log('PASS invox-api: auth/allowlist, signed uploads, independent platform versions, metadata edits without reupload, private history/current pointers, safe failures, CORS and bounds.');
 return {result:'PASS',checks:['Public state omits paths/hash','Admin Auth + allowlist','Separate username/password Auth client','PBKDF2 private download gate','Rate limiter fail-closed','Signed installer upload','Ownership/size/manifest validation','Atomic publish RPC','Feedback validation','CORS and body limits','SQL and credential errors masked']};
})().catch(error=>{console.error(error);process.exitCode=1;throw error;});
