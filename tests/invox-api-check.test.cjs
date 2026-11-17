const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require('node:path').resolve(__dirname, '..', "supabase/functions/invox-api/index.ts"),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob,console};
vm.runInNewContext(source+'\nglobalThis.exports={createHandler,createUnavailableHandler,passwordHash,passwordMatches};',context);
const {createHandler,createUnavailableHandler,passwordHash,passwordMatches}=context.exports;
const ADMIN='11111111-1111-4111-8111-111111111111',FEEDBACK='22222222-2222-4222-8222-222222222222';
function harness(){
 const db={invox_admins:[{email:'admin@example.test',username:'admin',user_id:ADMIN,enabled:true}],invox_site_settings:[{id:true,visibility:'public',download_password_hash:null,version:'1.1.0',release_notes:'',updated_at:'2026-11-16T00:00:00Z'}],invox_feedbacks:[],invox_installers:[{platform:'windows',path:'windows/1.1.0/test.exe',file_name:'INVOX-1.1.0.exe',size:1024,version:'1.1.0'}],invox_uploads:[]};
 const logs={sign:[],upload:[],rpc:[],auth:[],anonymousAuth:[],queries:[]};
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
  if(name==='invox_record_analytics')return {data:true,error:null};
  if(name==='invox_create_download_session')return {data:'2026-12-16T00:00:00Z',error:null};
  if(name==='invox_publish_release'){
   Object.assign(db.invox_site_settings[0],{version:args.p_version,release_notes:args.p_release_notes});
   for(const file of args.p_files){db.invox_installers=db.invox_installers.filter(item=>item.platform!==file.platform);db.invox_installers.push({platform:file.platform,path:file.path,file_name:file.fileName,size:file.size,version:args.p_version});}
   return {data:null,error:null};
  }
 },storage:{from:bucket=>({createSignedUrl:async(path,expires,options)=>{logs.sign.push({bucket,path,expires,options});return {data:{signedUrl:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/'+bucket+'/'+path+'?token=fixture'},error:null};},createSignedUploadUrl:async(path,options)=>{logs.upload.push({bucket,path,options});return {data:{token:'fake-upload-token',signedUrl:'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/upload/sign/'+bucket+'/'+path+'?token=fixture'},error:null};},info:async()=>({data:{size:controls.storageSize},error:controls.storageError?{message:'missing'}:null})})}};
 const handler=createHandler({service,rateSecret:'fake-service-secret',crypto:webcrypto,now:()=> '2026-11-16T00:00:00Z',randomUUID:()=> '33333333-3333-4333-8333-333333333333',createAuthClient:()=>({auth:{signInWithPassword:async data=>{logs.anonymousAuth.push(data);const valid=data.password===controls.authPassword;return {data:{user:controls.user,session:valid?{access_token:'fake-access',refresh_token:'fake-refresh'}:null},error:valid?null:{message:'invalid credentials'}};}}})});
 async function call(action,data={},admin=false,options={}){const headers={'Content-Type':'application/json','Origin':'https://jmxxp.github.io','x-forwarded-for':'192.0.2.1',...(admin?{Authorization:'Bearer fake-access'}:{}),...options.headers};const response=await handler(new Request('https://example.test/functions/v1/invox-api',{method:options.method||'POST',headers,body:options.method==='GET'||options.method==='OPTIONS'?undefined:options.body||JSON.stringify({action,...data})}));const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,headers:response.headers,text};}
 return {db,controls,logs,handler,call};
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
 response=await h.call('admin-state',{},true);assert.equal(response.status,200);assert.equal(response.body.admin.username,'admin');assert.equal(response.body.settings.uploadLimitBytes,52428800);assert.equal(response.body.installers[0].path,'windows/1.1.0/test.exe');
 h.controls.user={id:'44444444-4444-4444-8444-444444444444',email:'attacker@example.test',email_confirmed_at:'now',user_metadata:{admin:true}};response=await h.call('admin-state',{},true);assert.equal(response.status,403);h.controls.user={id:ADMIN,email:'admin@example.test',email_confirmed_at:null};response=await h.call('admin-state',{},true);assert.equal(response.status,401);h.controls.user={id:ADMIN,email:'admin@example.test',email_confirmed_at:'now'};
 response=await h.call('login',{username:'admin',password:'wrong'});assert.equal(response.status,401);assert.equal(response.body.error.message,'Usuário ou senha inválidos.');response=await h.call('login',{username:'missing',password:'wrong'});assert.equal(response.status,401);assert.equal(response.body.error.message,'Usuário ou senha inválidos.');response=await h.call('login',{username:'ADMIN',password:'fake-admin-password'});assert.equal(response.status,200);assert.equal(response.body.session.access_token,'fake-access');assert.equal(h.logs.anonymousAuth.length,2);
 response=await h.call('download',{platform:'windows'});assert.equal(response.status,200);assert.equal(h.logs.sign.at(-1).expires,60);assert.equal(h.logs.sign.at(-1).options.download,'INVOX-1.1.0.exe');
 const hash=await passwordHash('fake-download-password',webcrypto);assert(!hash.includes('fake-download-password'));assert(await passwordMatches('fake-download-password',hash,webcrypto));assert(!await passwordMatches('wrong',hash,webcrypto));h.db.invox_site_settings[0].visibility='private';h.db.invox_site_settings[0].download_password_hash=hash;const signCount=h.logs.sign.length;
 response=await h.call('download',{platform:'windows'});assert.equal(response.body.error.code,'password_required');response=await h.call('download',{platform:'windows',password:'wrong'});assert.equal(response.body.error.code,'invalid_password');assert.equal(h.logs.sign.length,signCount);response=await h.call('download',{platform:'windows',password:'fake-download-password'});assert.equal(response.status,200);assert.equal(h.logs.sign.length,signCount+1);
 h.controls.rate=false;response=await h.call('download',{platform:'windows',password:'fake-download-password'});assert.equal(response.status,429);assert.equal(h.logs.sign.length,signCount+1);h.controls.rate=true;h.controls.rateError=true;response=await h.call('download',{platform:'windows',password:'fake-download-password'});assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));h.controls.rateError=false;
 response=await h.call('feedback',{name:' Jogador ',contact:' user@example.test ',message:' Uma mensagem real de teste. ',website:''});assert.equal(response.status,201);assert.equal(h.db.invox_feedbacks[0].name,'Jogador');response=await h.call('feedback',{name:'Bot',contact:'bot@example.test',message:'Mensagem de teste inválida',website:'https://spam.example.test'});assert.equal(response.status,400);assert.equal(h.db.invox_feedbacks.length,1);
 response=await h.call('save-access',{visibility:'private',password:''},true);assert.equal(response.status,200);assert.equal(h.db.invox_site_settings[0].download_password_hash,hash);response=await h.call('save-access',{visibility:'private',password:'new-fake-password'},true);assert.equal(response.status,200);assert(response.body.hasPassword);assert(!response.text.includes('pbkdf2'));assert(!response.text.includes('new-fake-password'));response=await h.call('save-access',{visibility:'public'},true);assert.equal(response.body.hasPassword,false);
 response=await h.call('update-feedback',{id:FEEDBACK,status:'answered',note:'Nota interna.'},true);assert.equal(response.status,200);assert.equal(response.body.status,'answered');assert.equal(response.body.receivedAt,'2026-11-16T00:00:00Z');
 const file={platform:'windows',fileName:'INVOX-1.1.0.exe',size:1024,version:'1.1.0'};response=await h.call('create-upload',file,true);assert.equal(response.status,200);const path=response.body.path;assert(path.startsWith('windows/1.1.0/33333333'));assert.equal(h.logs.upload.at(-1).options.upsert,false);assert.equal(h.db.invox_uploads[0].created_by,ADMIN);
 const manifest={platform:'windows',path,fileName:file.fileName,size:1024};const publishCount=()=>h.logs.rpc.filter(([name])=>name==='invox_publish_release').length;
 response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[manifest,manifest]},true);assert.equal(response.status,400);assert.equal(publishCount(),0);
 h.controls.storageSize=1;response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[manifest]},true);assert.equal(response.status,400);assert.equal(publishCount(),0);h.controls.storageSize=1024;
 response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[{...manifest,path:'windows/1.1.0/other.exe'}]},true);assert.equal(response.status,400);assert.equal(publishCount(),0);
 response=await h.call('save-release',{version:'1.1.0',releaseNotes:'Atualização.',files:[manifest]},true);assert.equal(response.status,200);assert.equal(publishCount(),1);assert.equal(response.body.installers[0].path,path);
 response=await h.call('create-upload',{...file,size:52428801},true);assert.equal(response.status,400);response=await h.call('create-upload',{...file,fileName:'../bad.exe'},true);assert.equal(response.status,400);response=await h.call('save-release',{version:'01.1.0',releaseNotes:'',files:[]},true);assert.equal(response.status,400);
 response=await h.call('create-upload',{...file,fileName:'가'.repeat(176)+'.exe'},true);assert.equal(response.status,200);assert(response.body.path.length<=512);assert(response.body.path.endsWith('.exe'));assert(response.body.path.split('/').at(-1).length<=217);
 h.controls.tableError='invox_site_settings';response=await h.call('state');assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));h.controls.tableError=null;h.controls.throwQuery=true;response=await h.call('state');assert.equal(response.status,503);assert(!response.text.includes('SQL SECRET'));h.controls.throwQuery=false;
 response=await h.call('state',{},false,{headers:{Origin:'https://evil.example.test'}});assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);response=await h.call('state',{},false,{method:'GET'});assert.equal(response.status,405);response=await h.call('state',{},false,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4173'}});assert.equal(response.status,204);
 response=await h.call('state',{},false,{body:'x'.repeat(32769)});assert.equal(response.status,413);response=await h.call('state',{},false,{body:'{broken'});assert.equal(response.status,400);
 const beforePreflightAuth=h.logs.auth.length;
 response=await h.call('state',{},false,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5500','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,apikey'}});
 assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5500');assert.equal(h.logs.auth.length,beforePreflightAuth);
 for(const [,args]of h.logs.rpc.filter(([name])=>name==='invox_take_rate_limit')){assert.match(args.p_key_hash,/^[a-f0-9]{64}$/);assert(!JSON.stringify(args).includes('192.0.2.1'));}
 console.log('PASS invox-api: anonymous/public/private downloads, PBKDF2, admin allowlist, username login, feedback, rate limits, signed uploads, immutable release validation, query fail-closed, no SQL leakage, CORS and body bounds.');
 return {result:'PASS',checks:['Public state omits paths/hash','Admin Auth + allowlist','Separate username/password Auth client','PBKDF2 private download gate','Rate limiter fail-closed','Signed installer upload','Ownership/size/manifest validation','Atomic publish RPC','Feedback validation','CORS and body limits','SQL and credential errors masked']};
})().catch(error=>{console.error(error);process.exitCode=1;throw error;});
