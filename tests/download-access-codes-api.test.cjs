const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash,createHmac,randomUUID}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/invox-api/index.ts'),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob};
vm.runInNewContext(source+'\nglobalThis.api={createHandler,passwordHash};',context);
const ADMIN='11111111-1111-4111-8111-111111111111',UPLOAD='22222222-2222-4222-8222-222222222222';
const digest=value=>createHash('sha256').update(value).digest('hex');
function harness(){
 const settings={visibility:'private',download_universal_enabled:false,download_password_hash:null,download_access_generation:1,download_mode_generation:1,version:'1.1.0',release_notes:''};
 const codes=new Map(),attempts=new Map(),batches=new Map(),logs={rpc:[],sign:[]};
 const controls={authorized:true,signError:false,rpcError:null,multipart:false,missing:false,badPath:false,shortCollisions:0,batchCollisions:0};
 const legacy={platform:'windows',path:'windows/1.1.0/setup.exe',file_name:'INVOX.exe',size:1024,version:'1.1.0',multipart_upload_id:null,sha256:null};
 const multipart={...legacy,path:null,multipart_upload_id:UPLOAD,sha256:'a'.repeat(64)};
 const now='2026-11-17T12:00:00Z',expiry='2026-11-17T20:00:00Z';
 const error=(message,code='P0001')=>({data:null,error:{message,code}});
 const list=()=>[...codes.values()].map(row=>({id:row.id,label:row.label,maxUses:row.maxUses,usedCount:row.usedCount,remainingUses:row.maxUses-row.usedCount,createdAt:row.createdAt||now,expiresAt:row.expiresAt||null,revokedAt:row.revokedAt,codeFormat:row.format===1?'short':'legacy',status:row.revokedAt?'revoked':row.expiresAt&&row.expiresAt<=now?'expired':row.usedCount===row.maxUses?'exhausted':'active'}));
 const metadata=id=>{const row=codes.get(id);return {entry:list().find(item=>item.id===id),formatVersion:row.format||0,nonce:row.nonce||0,hash:row.hash};};
 const params=args=>JSON.stringify({label:args.p_label,count:args.p_count,maxUses:args.p_max_uses,hours:args.p_valid_for_hours});
 const valid=()=>list().filter(row=>row.codeFormat==='short'&&row.usedCount===0&&row.status==='active').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const service={auth:{getUser:async()=>({data:{user:{id:ADMIN,email:'admin@example.test',email_confirmed_at:'now'}},error:null})},from:table=>{
  let update=null;const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},update(value){update=value;return q;},single:async()=>{if(update)Object.assign(settings,update);return {data:{...settings},error:null};},maybeSingle:async()=>({data:table==='invox_admins'?(controls.authorized?{user_id:ADMIN,email:'admin@example.test',username:'admin',enabled:true}:null):table==='invox_installers'?{...(controls.multipart?multipart:legacy)}:null,error:null}),then(resolve,reject){return Promise.resolve({data:table==='invox_installers'?[{...(controls.multipart?multipart:legacy)}]:[],error:null}).then(resolve,reject);}};return q;
 },storage:{from:bucket=>({createSignedUrl:async filePath=>{logs.sign.push({bucket,path:filePath});return controls.signError?error('SECRET storage failure'):{data:{signedUrl:'https://example.test/storage/v1/object/sign/'+bucket+'/'+filePath+'?token=fixture'},error:null};}})},rpc:async(name,args)=>{
  logs.rpc.push([name,args]);if(controls.rpcError?.name===name)return error(controls.rpcError.message,controls.rpcError.code);
  if(name==='invox_take_rate_limit'||name==='invox_record_analytics'||name==='invox_authorize_universal_legacy')return {data:true,error:null};
  if(name==='invox_multipart_cleanup_due'||name==='invox_installer_history_list')return {data:[],error:null};
  if(name==='invox_storage_status')return {data:{},error:null};
  if(name==='invox_download_codes_list')return {data:list(),error:null};
  if(name==='invox_admin_code_pool'){
   const rows=list(),partition={valid:valid(),used:rows.filter(row=>row.codeFormat==='short'&&row.usedCount>0),inactive:rows.filter(row=>row.codeFormat==='short'&&row.usedCount===0&&row.status!=='active'),legacy:rows.filter(row=>row.codeFormat==='legacy')};
   return {data:{...Object.fromEntries(Object.entries(partition).map(([key,rows])=>[key,key==='legacy'?rows.slice(0,100):rows.slice(0,100).map(row=>metadata(row.id))])),totals:Object.fromEntries(Object.entries(partition).map(([key,rows])=>[key,rows.length])),evaluatedAt:now},error:null};
  }
  if(name==='invox_select_copy_download_codes'){const eligible=valid(),available=eligible.filter(row=>!args.p_exclude_ids.includes(row.id));return {data:{metadata:available.slice(0,args.p_count).map(row=>metadata(row.id)),availableCount:available.length,totalEligible:eligible.length,evaluatedAt:now},error:null};}
  if(name==='invox_lookup_code_creation'){
   const old=codes.get(args.p_id);if(!old)return {data:{found:false},error:null};
   if(old.label!==args.p_label||old.maxUses!==args.p_max_uses||old.hours!==args.p_valid_for_hours)return error('invox_code_creation_conflict');
   return {data:{found:true,metadata:metadata(old.id)},error:null};
  }
  if(name==='invox_lookup_code_batch'){
   const old=batches.get(args.p_id);if(!old)return {data:{found:false},error:null};
   if(old.params!==params(args))return error('invox_code_creation_conflict');
   return {data:{found:true,metadata:old.ids.map(metadata)},error:null};
  }
  if(name==='invox_issue_universal_session')return {data:'2026-12-17T12:00:00Z',error:null};
  if(name==='invox_create_short_codes'){
   const old=batches.get(args.p_id);
   if(old&&old.params!==params(args))return error('invox_code_creation_conflict');
   if(!old){
    if(controls.batchCollisions-->0)return error('invox_code_collision');
    if(args.p_codes.some(item=>codes.has(item.id)))return error('invox_code_creation_conflict');
    if(args.p_codes.some(item=>[...codes.values()].some(row=>row.hash===item.hash)))return error('invox_code_collision');
    for(const item of args.p_codes)codes.set(item.id,{id:item.id,hash:item.hash,label:args.p_label,maxUses:args.p_max_uses,hours:args.p_valid_for_hours,usedCount:0,revokedAt:null,format:1,nonce:item.nonce});
    batches.set(args.p_id,{params:params(args),ids:args.p_codes.map(item=>item.id)});
   }
   return {data:{metadata:batches.get(args.p_id).ids.map(metadata),downloadCodes:list()},error:null};
  }
  if(name==='invox_create_short_code'){
   const old=codes.get(args.p_id),row={id:args.p_id,hash:args.p_code_hash,label:args.p_label,maxUses:args.p_max_uses,hours:args.p_valid_for_hours,usedCount:0,revokedAt:null,format:1,nonce:args.p_nonce};
   if(old&&(old.label!==row.label||old.maxUses!==row.maxUses||old.hours!==row.hours))return error('invox_code_creation_conflict');
   if(!old){if(controls.shortCollisions-->0||[...codes.values()].some(item=>item.hash===row.hash))return error('invox_code_collision');codes.set(row.id,row);}
   return {data:{metadata:metadata(row.id),downloadCodes:list()},error:null};
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
 return {settings,codes,attempts,batches,logs,controls,call};
}
module.exports=(async()=>{
 const h=harness(),id=randomUUID();let r=await h.call('create-download-code',{id});assert.equal(r.status,401);assert.equal(h.codes.size,0);
 h.controls.authorized=false;r=await h.call('create-download-code',{id},true);assert.equal(r.status,403);h.controls.authorized=true;
 for(const invalid of [{id:'bad'},{id,maxUses:0},{id,maxUses:1001},{id,validForHours:0},{id,validForHours:8761},{id,label:'x'.repeat(81)}])assert.equal((await h.call('create-download-code',invalid,true)).status,400);
 r=await h.call('create-download-code',{id},true);assert.equal(r.status,200);const code=r.data.code;assert.match(code,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(r.data.entry.maxUses,1);assert.equal(r.data.entry.expiresAt,null);assert.equal(h.codes.get(id).hash,digest(code));assert(!JSON.stringify([...h.codes]).includes(code));
 r=await h.call('create-download-code',{id},true);assert.equal(r.data.code,code);assert.equal(h.codes.size,1);r=await h.call('create-download-code',{id,maxUses:2},true);assert.equal(r.status,409);assert.equal(r.data.error.code,'code_creation_conflict');
 r=await h.call('admin-state',{},true);assert.equal(r.status,200);assert.equal(r.data.downloadCodes.length,1);assert.equal(r.data.codePool.valid[0].code,code);assert(!JSON.stringify(r.data.downloadCodes).includes(code));assert(!r.text.includes(digest(code)));assert.equal(r.data.settings.universalEnabled,false);
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
 const b=harness(),batchId=randomUUID();assert.equal((await b.call('create-download-codes',{id:batchId,count:3})).status,401);
 for(const invalid of [{id:batchId},{id:batchId,count:0},{id:batchId,count:101},{id:batchId,count:1.5},{id:batchId,count:3,maxUses:0}])assert.equal((await b.call('create-download-codes',invalid,true)).status,400);
 r=await b.call('create-download-codes',{id:batchId,count:3,label:'Test batch'},true);assert.equal(r.status,200);assert.equal(r.data.codes.length,3);assert.equal(r.data.entries.length,3);assert.equal(new Set(r.data.codes).size,3);assert.equal(new Set(r.data.entries.map(entry=>entry.id)).size,3);const firstBatch=r.data;
 for(let index=0;index<3;index++){assert.match(firstBatch.codes[index],/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(b.codes.get(firstBatch.entries[index].id).hash,digest(firstBatch.codes[index]));assert.equal(firstBatch.entries[index].maxUses,1);assert(!JSON.stringify([...b.codes]).includes(firstBatch.codes[index]));}
 r=await b.call('create-download-codes',{id:batchId,count:3,label:'Test batch'},true);assert.deepEqual(r.data.codes,firstBatch.codes);assert.deepEqual(r.data.entries,firstBatch.entries);assert.equal(b.codes.size,3);assert.equal(b.batches.size,1);r=await b.call('create-download-codes',{id:batchId,count:2,label:'Test batch'},true);assert.equal(r.status,409);assert.equal(b.codes.size,3);
 assert.equal(b.logs.rpc.filter(([name])=>name==='invox_create_download_code').length,0,'batch uses one atomic RPC, not single-item RPCs');assert(!JSON.stringify(b.logs.rpc).includes(firstBatch.codes[0]));
 const unifiedBody={platform:'windows',accessCode:firstBatch.codes[0],requestId:randomUUID(),accessToken:'a'.repeat(64)};r=await b.call('download',unifiedBody);assert.equal(r.status,200);assert.equal(r.data.accessMethod,'code');assert.equal(r.data.accessSession,undefined);r=await b.call('download',unifiedBody);assert.equal(r.status,200);assert.equal(b.codes.get(firstBatch.entries[0].id).usedCount,1);
 const u=harness(),key='INVOX-'+'A'.repeat(64);u.settings.download_universal_enabled=true;u.settings.download_password_hash=await context.api.passwordHash(key,webcrypto);
 r=await u.call('download',{platform:'windows',accessCode:key,requestId:randomUUID()});assert.equal(r.status,200);assert.equal(r.data.accessMethod,'universal');assert(r.data.accessSession?.token);assert(!u.logs.rpc.some(([name])=>name==='invox_prepare_code_download'),'valid universal key retains precedence over token-shaped text');
 r=await u.call('download',{platform:'windows',accessCode:'incorrect'});assert.equal(r.status,403);assert.equal(r.data.error.code,'invalid_password');r=await u.call('download',{platform:'windows',accessCode:{invalid:true}});assert.equal(r.status,400);
 r=await u.call('create-download-code',{id:randomUUID()},true);const unifiedCode=r.data.code;r=await u.call('download',{platform:'windows',accessCode:unifiedCode,requestId:randomUUID()});assert.equal(r.status,200);assert.equal(r.data.accessMethod,'code');assert.equal(r.data.accessSession,undefined);
 const max=harness();r=await max.call('create-download-codes',{id:randomUUID(),count:100,maxUses:1000,validForHours:24},true);assert.equal(r.status,200);assert.equal(r.data.codes.length,100);assert.equal(max.logs.rpc.filter(([name])=>name==='invox_create_short_codes').length,1);
 const poolHarness=harness();r=await poolHarness.call('create-download-codes',{id:randomUUID(),count:5,maxUses:2},true);const poolCodes=r.data.codes,poolEntries=r.data.entries;
 poolHarness.codes.get(poolEntries[0].id).usedCount=1;poolHarness.codes.get(poolEntries[1].id).revokedAt='2026-11-17T11:00:00Z';poolHarness.codes.get(poolEntries[2].id).expiresAt='2026-11-17T11:00:00Z';
 assert.equal((await poolHarness.call('download-code-pool')).status,401);assert.equal((await poolHarness.call('select-copy-download-codes',{count:1})).status,401);
 r=await poolHarness.call('download-code-pool',{},true);assert.equal(r.status,200);assert.equal(r.data.valid.length,2);assert.equal(r.data.used.length,1);assert.equal(r.data.used[0].code,poolCodes[0]);assert.equal(r.data.used[0].remainingUses,1);assert.equal(r.data.inactive.length,2);assert(!r.text.includes('formatVersion'));assert(!r.text.includes('nonce'));assert(!r.text.includes(digest(poolCodes[0])));
 const expected=r.data.valid.map(row=>row.id),selected=await poolHarness.call('select-copy-download-codes',{count:1},true);assert.equal(selected.status,200);assert.equal(selected.data.availableCount,2);assert.equal(selected.data.totalEligible,2);assert.equal(selected.data.entries[0].id,expected[0]);assert.match(selected.data.codes[0],/^[A-HJ-NP-Z2-9]{6}$/);
 r=await poolHarness.call('select-copy-download-codes',{count:100,excludeIds:[expected[0]]},true);assert.equal(r.data.codes.length,1);assert.equal(r.data.entries[0].id,expected[1]);assert.equal(r.data.availableCount,1);assert.equal(r.data.totalEligible,2);
 r=await poolHarness.call('select-copy-download-codes',{count:100,excludeIds:expected},true);assert.deepEqual(r.data.codes,[]);assert.equal(r.data.availableCount,0);assert([...poolHarness.codes.values()].filter(row=>row.usedCount===0).length===4,'copy never spends a use');
 for(const invalid of [{count:0},{count:101},{count:1,excludeIds:['bad']},{count:1,excludeIds:Array(501).fill(randomUUID())}])assert.equal((await poolHarness.call('select-copy-download-codes',invalid,true)).status,400);
 r=await poolHarness.call('state');assert(!r.text.includes(poolCodes[0]));r=await poolHarness.call('game-state');assert(!r.text.includes(poolCodes[0]));
 const collision=harness(),collisionId=randomUUID();collision.controls.shortCollisions=1;r=await collision.call('create-download-code',{id:collisionId},true);assert.equal(r.status,200);assert.equal(collision.codes.get(collisionId).nonce,1);const collisionCode=r.data.code;r=await collision.call('create-download-code',{id:collisionId},true);assert.equal(r.data.code,collisionCode);assert.equal(collision.logs.rpc.filter(([name])=>name==='invox_create_short_code').length,2);
 const batchCollision=harness(),collisionBatchId=randomUUID();batchCollision.controls.batchCollisions=2;r=await batchCollision.call('create-download-codes',{id:collisionBatchId,count:3},true);assert.equal(r.status,200);assert([...batchCollision.codes.values()].every(row=>row.nonce===2));const saved=r.data.codes;r=await batchCollision.call('create-download-codes',{id:collisionBatchId,count:3},true);assert.deepEqual(r.data.codes,saved);assert.equal(batchCollision.logs.rpc.filter(([name])=>name==='invox_create_short_codes').length,3,'lost-ack recovery reads persisted manifest before regenerating');
 const bounded=harness();bounded.controls.shortCollisions=100;r=await bounded.call('create-download-code',{id:randomUUID()},true);assert.equal(r.status,503);assert.equal(bounded.codes.size,0);assert.equal(bounded.logs.rpc.filter(([name])=>name==='invox_create_short_code').length,32);
 const old=harness(),oldId=randomUUID(),legacyCode='INVOX-'+createHmac('sha256','dedicated-access-fixture').update('invox-code:v1:'+oldId).digest('hex').toUpperCase();
 old.codes.set(oldId,{id:oldId,hash:digest(legacyCode),label:'legacy',maxUses:1,hours:null,usedCount:0,revokedAt:null,format:0,nonce:0});r=await old.call('create-download-code',{id:oldId,label:'legacy'},true);assert.equal(r.data.code,legacyCode);assert.equal(r.data.entry.codeFormat,'legacy');
 r=await old.call('download',{platform:'windows',accessCode:legacyCode,requestId:randomUUID()});assert.equal(r.status,200);assert.equal(r.data.accessMethod,'code');r=await old.call('download-code-pool',{},true);assert.equal(r.data.valid.length,0);assert.equal(r.data.legacy.length,1);assert(!r.text.includes(legacyCode));
 const corrupt=harness();r=await corrupt.call('create-download-code',{id:randomUUID()},true);corrupt.codes.values().next().value.hash='f'.repeat(64);r=await corrupt.call('download-code-pool',{},true);assert.equal(r.status,503);assert(!r.text.includes('hash'));
 console.log('PASS six-character tokens: collision retry and stable recovery, atomic batches, admin-only recoverable pool, unused fresh copy groups/exclusions, used and inactive partitions, legacy compatibility, no plaintext storage/public leakage and one logical consumption.');
})().catch(error=>{console.error(error);process.exitCode=1;throw error;});
