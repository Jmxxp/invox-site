const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash,randomUUID}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/invox-api/index.ts'),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob};
vm.runInNewContext(source+'\nglobalThis.api={createHandler,passwordHash};',context);
const ADMIN='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',PART=20971520,CAP=1610612736;
const digest=value=>createHash('sha256').update(value).digest('hex');
const payload=Buffer.from('A real immutable installer part.');
const manifest=(size=payload.length)=>({platform:'windows',version:'1.1.0',fileName:'INVOX.exe',size,sha256:size===payload.length?digest(payload):'a'.repeat(64),parts:Array.from({length:Math.ceil(size/PART)},(_,index)=>({index,size:Math.min(PART,size-index*PART),sha256:size===payload.length?digest(payload):'b'.repeat(64)}))});
function harness(options={}){
 const sessions=new Map(),objects=new Map(),tickets=new Map(),privateSessions=new Map(),logs={rpc:[],sign:[],upload:[],reads:[],remove:[]};
 const settings={id:true,visibility:'public',download_password_hash:null,download_access_generation:1,version:'1.1.0',release_notes:'',updated_at:'2026-11-17T00:00:00Z'};
 const controls={user:ADMIN,allowed:true,quota:false,signError:false,countError:false,changeDuringVerify:false,tamperPath:false,now:Date.parse('2026-11-17T12:00:00Z')};
 let installers=[{platform:'windows',path:'legacy.exe',file_name:'legacy.exe',size:7,version:'1.0.0'}],downloads=0;
 const user=()=>controls.user?{id:controls.user,email:controls.user===ADMIN?'admin@example.test':'other@example.test',email_confirmed_at:'now'}:null;
 const error=(message,code='P0001')=>({data:null,error:{message,code}});
 const owned=(args)=>{const u=sessions.get(args.p_upload_id);return u&&u.owner===args.p_admin_id&&!['cancelled','purged'].includes(u.status)?u:null;};
 const row=(u,index)=>{const p=u.parts[index],o=objects.get(p.path);return {...p,uploadStatus:u.status,objectId:o?.id||null,objectVersion:o?.version||null,objectSize:o?.bytes.length||null,path:controls.tamperPath?'../foreign':p.path};};
 const complete=u=>u.parts.every(p=>{const o=objects.get(p.path);return p.verified_at&&o&&p.verified_object_id===o.id&&p.verified_object_version===o.version&&p.size===o.bytes.length;});
 const activeTicket=args=>{const t=tickets.get(args.p_token_hash),u=t&&sessions.get(t.uploadId);return t&&u&&t.expires>controls.now&&t.generation===settings.download_access_generation&&['ready','published','retired'].includes(u.status)?[t,u]:null;};
 const service={auth:{getUser:async()=>({data:{user:user()},error:null})},from:table=>{
  const filters=[];const rows=()=>{let result=table==='invox_site_settings'?[settings]:table==='invox_admins'?(controls.allowed&&user()?[{user_id:user().id,email:user().email,enabled:true,username:'admin'}]:[]):table==='invox_installers'?installers:table==='invox_download_sessions'?[...privateSessions.values()]:[];return result.filter(r=>filters.every(([k,v])=>r[k]===v));};
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},limit(){return q;},single:async()=>({data:rows()[0],error:null}),maybeSingle:async()=>({data:rows()[0]||null,error:null}),then(resolve,reject){return Promise.resolve({data:rows(),error:null}).then(resolve,reject);}};return q;
 },storage:{from:bucket=>({
  createSignedUploadUrl:async(p,opts)=>{logs.upload.push({bucket,path:p,opts});return {data:{token:'signed-upload-token',signedUrl:'https://example.test/storage/v1/object/upload/sign/'+bucket+'/'+p+'?token=fixture'},error:null};},
  download:async p=>{logs.reads.push(p);const o=objects.get(p);const blob=o&&new Blob([o.bytes]);if(controls.changeDuringVerify&&o){o.version='changed';controls.changeDuringVerify=false;}return {data:blob,error:o?null:{message:'missing'}};},
  remove:async paths=>{logs.remove.push(...paths);paths.forEach(p=>objects.delete(p));return {data:[],error:null};},
  createSignedUrl:async(p,expires)=>{logs.sign.push({bucket,path:p,expires});return controls.signError?error('Signing failed'):{data:{signedUrl:'https://example.test/storage/v1/object/sign/'+bucket+'/'+p+'?token=fixture'},error:null};}
 })},rpc:async(name,args)=>{
  logs.rpc.push([name,args]);
  if(name==='invox_take_rate_limit')return {data:true,error:null};
  if(name==='invox_multipart_cleanup_due')return {data:[],error:null};
  if(name==='invox_installer_history_list')return {data:[],error:null};
  if(name==='invox_storage_status')return {data:{capacityBytes:args.p_budget_bytes,usedBytes:0,reservedBytes:0,availableBytes:args.p_budget_bytes,cleanupPendingBytes:0},error:null};
  if(name==='invox_create_multipart_upload'){
   if(controls.quota||Math.ceil(args.p_size/PART)*PART>args.p_budget_bytes)return error('invox_storage_quota_exceeded');
   let u=[...sessions.values()].find(u=>u.owner===args.p_admin_id&&u.hash===args.p_manifest_sha256&&u.sha256===args.p_sha256&&u.size===args.p_size);
   if(!u){const id=randomUUID();u={id,owner:args.p_admin_id,hash:args.p_manifest_sha256,platform:args.p_platform,fileName:args.p_file_name,size:args.p_size,version:args.p_version,sha256:args.p_sha256,status:'uploading',parts:args.p_parts.map(p=>({...p,path:`uploads/${id}/${String(p.index).padStart(3,'0')}-${p.sha256}.part`}))};sessions.set(id,u);}
   return {data:{uploadId:u.id,status:u.status,completedParts:u.parts.filter(p=>p.verified_at).map(p=>p.index)},error:null};
  }
  if(name==='invox_multipart_part'){const u=owned(args);return u?{data:row(u,args.p_index),error:null}:error('Not owner','42501');}
  if(name==='invox_multipart_upload_ticket'){const u=owned(args);if(!u)return error('Not owner','42501');Object.assign(u.parts[args.p_index],{verified_at:null,verified_sha256:null,verified_object_id:null,verified_object_version:null});return {data:null,error:null};}
  if(name==='invox_confirm_multipart_part'){const u=owned(args),p=u?.parts[args.p_index],o=p&&objects.get(p.path);if(!o||o.id!==args.p_object_id||o.version!==args.p_object_version||p.sha256!==args.p_sha256)return error('Changed','22023');Object.assign(p,{verified_at:'now',verified_sha256:args.p_sha256,verified_object_id:o.id,verified_object_version:o.version});return {data:true,error:null};}
  if(name==='invox_finish_multipart_upload'){const u=owned(args);if(!u)return error('Not owner','42501');if(!complete(u))return error('Incomplete','22023');if(u.status!=='published')u.status='ready';return {data:{kind:'multipart',uploadId:u.id,platform:u.platform,fileName:u.fileName,size:u.size,version:u.version,sha256:u.sha256},error:null};}
  if(name==='invox_publish_release'){settings.version=args.p_version;for(const f of args.p_files){const u=sessions.get(f.uploadId);if(!u||!['ready','published'].includes(u.status)||u.owner!==args.p_admin_id||!complete(u))return error('Incomplete','22023');u.status='published';installers=[{platform:u.platform,path:null,file_name:u.fileName,size:u.size,version:f.version||args.p_version,multipart_upload_id:u.id,sha256:u.sha256}];}return {data:null,error:null};}
  if(name==='invox_update_installer_version'){const item=installers.find(item=>item.platform===args.p_platform);if(!item)return error('Missing','P0002');item.version=args.p_version;return {data:null,error:null};}
  if(name==='invox_mint_multipart_download'){const u=sessions.get(args.p_upload_id);if(!u||!(args.p_preview?u.owner===args.p_admin_id&&u.status==='ready':u.status==='published'))return error('Unavailable','42501');if(args.p_access_generation!==settings.download_access_generation)return error('invox_download_ticket_expired');const expires=controls.now+8*3600000;tickets.set(args.p_token_hash,{uploadId:u.id,generation:settings.download_access_generation,expires,preview:args.p_preview,counted:false});return {data:{kind:'multipart',fileName:u.fileName,size:u.size,sha256:u.sha256,expiresAt:new Date(expires).toISOString(),parts:u.parts.map(({index,size,sha256})=>({index,size,sha256}))},error:null};}
  if(name==='invox_download_multipart_part'){const pair=activeTicket(args);if(!pair)return error('invox_download_ticket_expired');const [t,u]=pair,p=u.parts[args.p_index];return p?{data:{uploadId:u.id,path:p.path,index:p.index,size:p.size,sha256:p.sha256},error:null}:error('Missing','P0002');}
  if(name==='invox_count_multipart_download'){if(controls.countError)return error('SECRET counter failure');const pair=activeTicket(args);if(!pair)return error('invox_download_ticket_expired');const [t]=pair;if(!t.counted&&!t.preview)downloads++;t.counted=true;return {data:true,error:null};}
  if(name==='invox_create_download_session'){privateSessions.set(args.p_token_hash,{token_hash:args.p_token_hash,password_fingerprint:args.p_password_fingerprint,expires_at:'2026-12-17T00:00:00Z'});return {data:'2026-12-17T00:00:00Z',error:null};}
  if(name==='invox_cancel_multipart_upload'){const u=owned(args);if(!u||u.status==='published')return error('Forbidden','42501');u.status='cancelled';return {data:{paths:u.parts.map(p=>p.path),cleanupAfter:'2026-11-18T13:00:00Z'},error:null};}
  if(name==='invox_finish_multipart_cleanup')return {data:{cancelled:true,cleanupPending:true,cleanupAfter:'2026-11-18T13:00:00Z'},error:null};
  throw Error('Unexpected RPC '+name);
 }};
 const handler=context.api.createHandler({service,crypto:webcrypto,rateSecret:'fixture',storageBudgetBytes:options.budget,now:()=>new Date(controls.now).toISOString()});
 async function call(action,body={},auth=true){const r=await handler(new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://jmxxp.github.io',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify({action,...body})}));return {status:r.status,data:await r.json()};}
 function store(id,index,bytes=payload){const p=sessions.get(id).parts[index];objects.set(p.path,{bytes:Buffer.from(bytes),id:randomUUID(),version:'v1'});}
 return {call,controls,logs,sessions,objects,tickets,settings,store,downloads:()=>downloads,installers:()=>installers};
}

module.exports=(async()=>{
 const h=harness(),file=manifest();let r=await h.call('create-multipart-upload',file,false);assert.equal(r.status,401);assert.equal(h.sessions.size,0);
 h.controls.allowed=false;r=await h.call('create-multipart-upload',file);assert.equal(r.status,403);assert.equal(h.sessions.size,0);h.controls.allowed=true;
 for(const changed of [{...file,size:CAP+1},{...file,sha256:'bad'},{...file,parts:[{...file.parts[0],index:1}]},{...file,parts:[{...file.parts[0],size:1}]}]){r=await h.call('create-multipart-upload',changed);assert.equal(r.status,400);assert.equal(h.sessions.size,0);}
 h.controls.quota=true;r=await h.call('create-multipart-upload',{...file,storageBudgetBytes:999999999999});assert.equal(r.status,409);assert.equal(r.data.error.code,'storage_quota_exceeded');assert.equal(h.logs.rpc.findLast(([name])=>name==='invox_create_multipart_upload')[1].p_budget_bytes,1000000000);h.controls.quota=false;
 r=await h.call('create-multipart-upload',file);assert.equal(r.status,200);const id=r.data.uploadId;assert.deepEqual(r.data.completedParts,[]);
 r=await h.call('create-multipart-upload',file);assert.equal(r.data.uploadId,id);assert.equal(h.sessions.size,1);
 h.controls.user=OTHER;r=await h.call('multipart-part-upload',{uploadId:id,index:0});assert.equal(r.status,403);assert.equal(h.logs.upload.length,0);h.controls.user=ADMIN;
 r=await h.call('finish-multipart-upload',{uploadId:id});assert.equal(r.status,400);assert.equal(h.installers()[0].path,'legacy.exe');
 r=await h.call('multipart-part-upload',{uploadId:id,index:0});assert.equal(r.status,200);assert.equal(r.data.completed,false);assert.equal(r.data.bucket,'invox-installer-parts');assert.equal(r.data.path,`uploads/${id}/000-${file.parts[0].sha256}.part`);assert.equal(h.logs.upload[0].opts.upsert,false);
 h.store(id,0,Buffer.alloc(payload.length));r=await h.call('confirm-multipart-part',{uploadId:id,index:0});assert.equal(r.status,400);assert.equal(r.data.error.code,'integrity_error');assert(!h.sessions.get(id).parts[0].verified_at);
 r=await h.call('multipart-part-upload',{uploadId:id,index:0});assert.equal(r.status,200);assert.equal(r.data.completed,false);assert.equal(h.objects.size,0);assert.equal(h.logs.remove.length,1);
 h.store(id,0);h.controls.changeDuringVerify=true;r=await h.call('confirm-multipart-part',{uploadId:id,index:0});assert.equal(r.status,409);assert.equal(r.data.error.code,'upload_changed');assert(!h.sessions.get(id).parts[0].verified_at);
 const signedBefore=h.logs.upload.length;r=await h.call('multipart-part-upload',{uploadId:id,index:0});assert.equal(r.status,200);assert.equal(r.data.completed,true);assert.equal(h.logs.upload.length,signedBefore);
 const readBefore=h.logs.reads.length;r=await h.call('confirm-multipart-part',{uploadId:id,index:0});assert.equal(r.status,200);assert.equal(r.data.verified,true);assert.equal(h.logs.reads.length,readBefore);
 r=await h.call('create-multipart-upload',file);assert.deepEqual(r.data.completedParts,[0]);
 r=await h.call('finish-multipart-upload',{uploadId:id});assert.equal(r.status,200);const descriptor=r.data;assert.equal(descriptor.kind,'multipart');assert.equal(descriptor.sha256,file.sha256);assert(!('path'in descriptor));assert.equal(h.installers()[0].path,'legacy.exe');
 r=await h.call('preview-multipart-upload',{uploadId:id});assert.equal(r.status,200);const preview=r.data;assert.match(preview.ticket,/^[a-f0-9]{64}$/);assert.equal(preview.parts.length,1);assert(!JSON.stringify(preview).includes('uploads/'));
 r=await h.call('download-part',{ticket:preview.ticket,index:0},false);assert.equal(r.status,200);assert.equal(h.downloads(),0);assert.equal(r.data.expiresIn,60);
 r=await h.call('save-release',{version:'9.0.0',releaseNotes:'',files:[{...descriptor,version:'2.0.0'}]});assert.equal(r.status,200);assert.equal(h.installers()[0].multipart_upload_id,id);assert.equal(h.installers()[0].version,'2.0.0');assert.equal(h.settings.version,'9.0.0');assert.equal(h.sessions.get(id).version,file.version);
 const uploadsBeforeVersionEdit=h.logs.upload.length;r=await h.call('update-installer-version',{platform:'windows',version:'2.1.0'});assert.equal(r.status,200);assert.equal(h.installers()[0].version,'2.1.0');assert.equal(h.installers()[0].multipart_upload_id,id);assert.equal(h.installers()[0].sha256,file.sha256);assert.equal(h.sessions.get(id).version,file.version);assert.equal(h.settings.version,'9.0.0');assert.equal(h.logs.upload.length,uploadsBeforeVersionEdit);
 r=await h.call('finish-multipart-upload',{uploadId:id});assert.equal(r.status,200);assert.equal(r.data.version,file.version);const fallback={...r.data};delete fallback.version;
 r=await h.call('save-release',{version:'9.1.0',releaseNotes:'',files:[fallback]});assert.equal(r.status,200);assert.equal(h.installers()[0].version,'9.1.0');assert.equal(h.sessions.get(id).version,file.version);assert.equal(h.logs.upload.length,uploadsBeforeVersionEdit);
 r=await h.call('download',{platform:'windows'},false);assert.equal(r.status,200);const ticket=r.data.ticket;assert.equal(h.downloads(),0);assert.equal(r.data.sha256,file.sha256);assert(!JSON.stringify(r.data).includes('uploads/'));
 h.controls.signError=true;r=await h.call('download-part',{ticket,index:0},false);assert.equal(r.status,503);assert.equal(h.downloads(),0);h.controls.signError=false;
 h.controls.countError=true;r=await h.call('download-part',{ticket,index:0},false);assert.equal(r.status,503);assert(!JSON.stringify(r.data).includes('SECRET'));assert(!JSON.stringify(r.data).includes('signedUrl'));assert.equal(h.downloads(),0);h.controls.countError=false;
 for(let attempt=0;attempt<2;attempt++){r=await h.call('download-part',{ticket,index:0},false);assert.equal(r.status,200);assert.equal(h.downloads(),1);}
 assert(!JSON.stringify([...h.tickets]).includes(ticket));assert(!JSON.stringify(h.logs.rpc).includes(ticket));
 h.settings.download_access_generation++;const before=h.logs.sign.length;r=await h.call('download-part',{ticket,index:0},false);assert.equal(r.status,401);assert.equal(h.logs.sign.length,before);
 h.settings.visibility='private';h.settings.download_password_hash=await context.api.passwordHash('private-password',webcrypto);
 r=await h.call('download',{platform:'windows'},false);assert.equal(r.status,401);r=await h.call('download',{platform:'windows',password:'wrong'},false);assert.equal(r.status,403);
 r=await h.call('download',{platform:'windows',password:'private-password'},false);assert.equal(r.status,200);const grant=r.data.accessSession;assert(grant?.token);const privateTicket=r.data.ticket;
 r=await h.call('download',{platform:'windows',accessToken:grant.token},false);assert.equal(r.status,200);assert.equal(r.data.accessSession.token,grant.token);
 h.controls.now+=2*3600000;r=await h.call('download-part',{ticket:privateTicket,index:0},false);assert.equal(r.status,200);
 h.controls.now+=6*3600000+1;r=await h.call('download-part',{ticket:privateTicket,index:0},false);assert.equal(r.status,401);
 const cap=harness({budget:2000000000});r=await cap.call('create-multipart-upload',manifest(CAP));assert.equal(r.status,200);assert.equal(cap.sessions.values().next().value.parts.length,77);r=await cap.call('create-multipart-upload',manifest(CAP+1));assert.equal(r.status,400);
 const cleanup=harness();r=await cleanup.call('create-multipart-upload',file);const cleanupId=r.data.uploadId;cleanup.store(cleanupId,0);r=await cleanup.call('cleanup-multipart-upload',{uploadId:cleanupId});assert.equal(r.status,200);assert.equal(r.data.cleanupPending,true);assert.equal(cleanup.objects.size,0);assert.equal(cleanup.sessions.get(cleanupId).status,'cancelled');
 console.log('PASS multipart API: real SHA verification/corruption, owner/auth, lost-ack resume, quota/logical cap, private grants, previews, ticket expiry/config binding, signing/count fail-closed, one logical download and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;throw error;});
