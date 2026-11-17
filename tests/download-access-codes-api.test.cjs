const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash,randomUUID}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/invox-api/index.ts'),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob};
vm.runInNewContext(source+'\nglobalThis.api={createHandler};',context);
const ADMIN='11111111-1111-4111-8111-111111111111',UPLOAD='22222222-2222-4222-8222-222222222222';
const digest=value=>createHash('sha256').update(value).digest('hex');
function harness(){
 const settings={visibility:'private',download_universal_enabled:false,download_password_hash:null,download_access_generation:1,download_mode_generation:1,version:'1.1.0',release_notes:''};
 const codes=new Map(),attempts=new Map(),logs={rpc:[],sign:[]};
 const controls={authorized:true,signError:false,rpcError:null,multipart:false,missing:false,badPath:false};
 const legacy={platform:'windows',path:'windows/1.1.0/setup.exe',file_name:'INVOX.exe',size:1024,version:'1.1.0',multipart_upload_id:null,sha256:null};
 const multipart={...legacy,path:null,multipart_upload_id:UPLOAD,sha256:'a'.repeat(64)};
 const now='2026-11-17T12:00:00Z',expiry='2026-11-17T20:00:00Z';
 const error=(message,code='P0001')=>({data:null,error:{message,code}});
 const list=()=>[...codes.values()].map(row=>({id:row.id,label:row.label,maxUses:row.maxUses,usedCount:row.usedCount,remainingUses:row.maxUses-row.usedCount,createdAt:now,expiresAt:null,revokedAt:row.revokedAt,status:row.revokedAt?'revoked':row.usedCount===row.maxUses?'exhausted':'active'}));
 const service={auth:{getUser:async()=>({data:{user:{id:ADMIN,email:'admin@example.test',email_confirmed_at:'now'}},error:null})},from:table=>{
  let update=null;const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},update(value){update=value;return q;},single:async()=>{if(update)Object.assign(settings,update);return {data:{...settings},error:null};},maybeSingle:async()=>({data:table==='invox_admins'?(controls.authorized?{user_id:ADMIN,email:'admin@example.test',username:'admin',enabled:true}:null):table==='invox_installers'?{...(controls.multipart?multipart:legacy)}:null,error:null}),then(resolve,reject){return Promise.resolve({data:table==='invox_installers'?[{...(controls.multipart?multipart:legacy)}]:[],error:null}).then(resolve,reject);}};return q;
 },storage:{from:bucket=>({createSignedUrl:async filePath=>{logs.sign.push({bucket,path:filePath});return controls.signError?error('SECRET storage failure'):{data:{signedUrl:'https://example.test/storage/v1/object/sign/'+bucket+'/'+filePath+'?token=fixture'},error:null};}})},rpc:async(name,args)=>{
  logs.rpc.push([name,args]);if(controls.rpcError?.name===name)return error(controls.rpcError.message,controls.rpcError.code);
  if(name==='invox_take_rate_limit'||name==='invox_record_analytics'||name==='invox_authorize_universal_legacy')return {data:true,error:null};
  if(name==='invox_multipart_cleanup_due'||name==='invox_installer_history_list')return {data:[],error:null};
  if(name==='invox_storage_status')return {data:{},error:null};
  if(name==='invox_download_codes_list')return {data:list(),error:null};
  if(name==='invox_create_download_code'){
   const old=codes.get(args.p_id),row={id:args.p_id,hash:args.p_code_hash,label:args.p_label,maxUses:args.p_max_uses,hours:args.p_valid_for_hours,usedCount:0,revokedAt:null};
   if(old&&(old.hash!==row.hash||old.label!==row.label||old.maxUses!==row.maxUses||old.hours!==row.hours))return error('invox_code_creation_conflict');
   if(!old)codes.set(row.id,row);return {data:{entry:list().find(item=>item.id===row.id),downloadCodes:list()},error:null};
  }
  if(name==='invox_revoke_download_code'){codes.get(args.p_id).revokedAt=now;return {data:{downloadCodes:list()},error:null};}
  if(name==='invox_prepare_code_download'){
   const code=[...codes.values()].find(row=>row.hash===args.p_code_hash),prior=attempts.get(args.p_request_id);
   if(!code)return error('invox_invalid_code');
   if(prior&&(prior.codeId!==code.id||prior.platform!==args.p_platform))return error('invox_code_attempt_conflict');
   if(!prior){if(code.revokedAt)return error('invox_code_revoked');if(code.usedCount>=code.maxUses)return error('invox_code_exhausted');if(controls.missing)return error('Missing','P0002');}
   const installer=prior?.installer||{...(controls.multipart?multipart:legacy)};
   return {data:{committed:Boolean(prior),codeId:code.id,requestId:args.p_request_id,modeGeneration:1,installer,ticketHash:prior?.ticketHash||null,expiresAt:prior?expiry:null,firstPart:installer.multipart_upload_id?{index:0,size:1024,sha256:'b'.repeat(64),path:controls.badPath?'../foreign':`uploads/${UPLOAD}/000-${'b'.repeat(64)}.part`}:null},error:null};
  }
  if(name==='invox_commit_code_download'){
   const code=[...codes.values()].find(row=>row.hash===args.p_code_hash);let prior=attempts.get(args.p_request_id);
   if(!prior){code.usedCount++;prior={codeId:code.id,platform:args.p_platform,installer:args.p_installer,ticketHash:args.p_ticket_hash};attempts.set(args.p_request_id,prior);}
   return {data:prior.installer.multipart_upload_id?{kind:'multipart',fileName:prior.installer.file_name,size:prior.installer.size,sha256:prior.installer.sha256,expiresAt:expiry,parts:[{index:0,size:1024,sha256:'b'.repeat(64)}]}:{kind:'legacy',fileName:prior.installer.file_name,expiresAt:expiry},error:null};
  }
  throw Error('Unexpected RPC '+name);
 }};
 const handler=context.api.createHandler({service,crypto:webcrypto,rateSecret:'rate-fixture',accessCodeSecret:'dedicated-access-fixture',now:()=>now});
 async function call(action,body={},auth=false){const response=await handler(new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://jmxxp.github.io',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify({action,...body})}));const text=await response.text();return {status:response.status,data:JSON.parse(text),text};}
 return {settings,codes,attempts,logs,controls,call};
}
module.exports=(async()=>{
 const h=harness(),id=randomUUID();let r=await h.call('create-download-code',{id});assert.equal(r.status,401);assert.equal(h.codes.size,0);
 h.controls.authorized=false;r=await h.call('create-download-code',{id},true);assert.equal(r.status,403);h.controls.authorized=true;
 for(const invalid of [{id:'bad'},{id,maxUses:0},{id,maxUses:1001},{id,validForHours:0},{id,validForHours:8761},{id,label:'x'.repeat(81)}])assert.equal((await h.call('create-download-code',invalid,true)).status,400);
 r=await h.call('create-download-code',{id},true);assert.equal(r.status,200);const code=r.data.code;assert.match(code,/^INVOX-[A-F0-9]{64}$/);assert.equal(r.data.entry.maxUses,1);assert.equal(r.data.entry.expiresAt,null);assert.equal(h.codes.get(id).hash,digest(code));assert(!JSON.stringify([...h.codes]).includes(code));
 r=await h.call('create-download-code',{id},true);assert.equal(r.data.code,code);assert.equal(h.codes.size,1);r=await h.call('create-download-code',{id,maxUses:2},true);assert.equal(r.status,409);assert.equal(r.data.error.code,'code_creation_conflict');
 r=await h.call('admin-state',{},true);assert.equal(r.status,200);assert.equal(r.data.downloadCodes.length,1);assert(!r.text.includes(code));assert(!r.text.includes(digest(code)));assert.equal(r.data.settings.universalEnabled,false);
 r=await h.call('save-access',{visibility:'private',universalEnabled:false},true);assert.equal(r.status,200);assert.equal(r.data.hasPassword,false);assert.equal((await h.call('download',{platform:'windows',password:'anything'})).data.error.code,'universal_disabled');
 const requestId=randomUUID(),body={platform:'windows',code:code.toLowerCase(),requestId,password:'ignored',accessToken:{invalid:'ignored'}};
 assert.equal((await h.call('download',{platform:'windows',code})).status,400);assert.equal((await h.call('download',{...body,code:'invalid'})).data.error.code,'invalid_code');
 h.controls.signError=true;r=await h.call('download',body);assert.equal(r.status,503);assert.equal(h.codes.get(id).usedCount,0);assert.equal(h.attempts.size,0);assert(!r.text.includes('SECRET'));h.controls.signError=false;
 h.controls.missing=true;r=await h.call('download',body);assert.equal(r.status,404);assert.equal(h.codes.get(id).usedCount,0);h.controls.missing=false;
 r=await h.call('download',body);assert.equal(r.status,200);assert.equal(r.data.accessSession,undefined);assert(r.data.url);assert.equal(h.codes.get(id).usedCount,1);
 r=await h.call('download',body);assert.equal(r.status,200);assert.equal(h.codes.get(id).usedCount,1);r=await h.call('download',{...body,requestId:randomUUID()});assert.equal(r.data.error.code,'code_exhausted');
 await h.call('revoke-download-code',{id},true);r=await h.call('download',body);assert.equal(r.status,200);assert.equal(h.codes.get(id).usedCount,1);
 const before=h.logs.rpc.filter(([name])=>name==='invox_prepare_code_download').length;h.settings.visibility='public';r=await h.call('download',{platform:'windows',code:'invalid',requestId:'invalid'});assert.equal(r.status,200);assert.equal(h.logs.rpc.filter(([name])=>name==='invox_prepare_code_download').length,before);
 const m=harness(),mid=randomUUID();m.controls.multipart=true;r=await m.call('create-download-code',{id:mid,maxUses:2,validForHours:24},true);const mpBody={platform:'windows',code:r.data.code,requestId:randomUUID()};
 m.controls.badPath=true;r=await m.call('download',mpBody);assert.equal(r.status,503);assert.equal(m.codes.get(mid).usedCount,0);assert.equal(m.logs.sign.length,0);m.controls.badPath=false;
 r=await m.call('download',mpBody);assert.equal(r.status,200);const ticket=r.data.ticket;assert.match(ticket,/^[a-f0-9]{64}$/);assert.equal(r.data.kind,'multipart');assert.equal(r.data.accessSession,undefined);assert(!r.text.includes('uploads/'));assert.equal(m.codes.get(mid).usedCount,1);assert.equal(m.logs.sign[0].bucket,'invox-installer-parts');assert(!JSON.stringify(m.logs.rpc).includes(ticket));
 m.settings.download_universal_enabled=true;m.settings.download_access_generation++;r=await m.call('download',mpBody);assert.equal(r.status,200);assert.equal(r.data.ticket,ticket);assert.equal(m.codes.get(mid).usedCount,1);
 m.controls.rpcError={name:'invox_commit_code_download',message:'invox_download_changed'};r=await m.call('download',{...mpBody,requestId:randomUUID()});assert.equal(r.status,409);assert.equal(r.data.error.code,'download_changed');assert.equal(m.codes.get(mid).usedCount,1);assert(!r.text.includes('signedUrl'));
 console.log('PASS bounded download codes API: admin auth/defaults/idempotence, hash-only metadata, sign-before-consume, explicit-code isolation, stable logical retries, multipart grants, public no-consume and safe failures.');
})().catch(error=>{console.error(error);process.exitCode=1;throw error;});
