const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../supabase/functions/invox-api/index.ts'),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob};
vm.runInNewContext(source+'\nglobalThis.api={createHandler,passwordHash};',context);
const digest=value=>createHash('sha256').update(value).digest('hex');
function harness(hash){
 const now='2026-11-17T12:00:00Z',sessions=new Map();
 const settings={visibility:'private',download_password_hash:hash,version:'1.1.0'};
 const calls={create:[],sign:0,analytics:0,delete:[]};const controls={missing:false,dbError:false,createError:false};
 class Query{constructor(table){this.table=table;this.filters={};this.operation='select';}select(){return this;}eq(k,v){this.filters[k]=v;return this;}delete(){this.operation='delete';return this;}async single(){return {data:settings,error:null};}async maybeSingle(){if(this.table==='invox_download_sessions')return {data:sessions.get(this.filters.token_hash)||null,error:controls.dbError?{message:'SECRET'}:null};return {data:controls.missing?null:{path:'windows/test.exe',file_name:'INVOX.exe'},error:null};}then(resolve,reject){if(this.operation==='delete'){calls.delete.push(this.filters.token_hash);sessions.delete(this.filters.token_hash);}return Promise.resolve({data:null,error:null}).then(resolve,reject);}}
 const service={from:table=>new Query(table),rpc:async(name,args)=>{
   if(name==='invox_take_rate_limit')return {data:true,error:null};
   if(name==='invox_record_analytics'){calls.analytics++;return {data:true,error:null};}
   if(name==='invox_create_download_session'){calls.create.push(args);if(controls.createError)return {data:null,error:{message:'SECRET'}};const expiry=new Date(Date.parse(now)+30*86400000).toISOString();sessions.set(args.p_token_hash,{password_fingerprint:args.p_password_fingerprint,expires_at:expiry});for(const [key,row]of sessions)if(Date.parse(row.expires_at)<=Date.parse(now))sessions.delete(key);return {data:expiry,error:null};}
  },storage:{from:()=>({createSignedUrl:async()=>{calls.sign++;return {data:{signedUrl:'https://example.test/signed'},error:null};}})}};
 const handler=context.api.createHandler({service,rateSecret:'fixture',crypto:webcrypto,now:()=>now,createAuthClient:()=>{throw Error('unused');}});
 async function call(action,body={}){const response=await handler(new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://jmxxp.github.io'},body:JSON.stringify({action,...body})}));return {status:response.status,data:await response.json()};}
 return {settings,sessions,calls,controls,call,now};
}
module.exports=(async()=>{
 const password='fixture-visitor-password',hash=await context.api.passwordHash(password,webcrypto),h=harness(hash);
 let response=await h.call('download',{platform:'windows',password});assert.equal(response.status,200);const first=response.data.accessSession;assert.match(first.token,/^[a-f0-9]{64}$/);assert.equal(Date.parse(first.expiresAt)-Date.parse(h.now),30*86400000);
 assert.equal(h.sessions.size,1);assert(h.sessions.has(digest(first.token)));assert.equal(h.sessions.get(digest(first.token)).password_fingerprint,digest(hash));assert(!JSON.stringify([...h.sessions]).includes(first.token));assert(!JSON.stringify([...h.sessions]).includes(password));
 response=await h.call('download',{platform:'windows',accessToken:first.token});assert.equal(response.status,200);assert.equal(response.data.accessSession.token,first.token);assert.equal(response.data.accessSession.expiresAt,first.expiresAt);assert.equal(h.calls.create.length,1);
 response=await h.call('download',{platform:'windows',accessToken:'bad'});assert.equal(response.data.error.code,'password_required');
 h.sessions.get(digest(first.token)).expires_at='2026-11-16T12:00:00Z';response=await h.call('download',{platform:'windows',accessToken:first.token});assert.equal(response.data.error.code,'password_required');
 response=await h.call('download',{platform:'windows',accessToken:first.token,password});assert.equal(response.status,200);const second=response.data.accessSession;assert.notEqual(second.token,first.token);assert.equal(h.sessions.has(digest(first.token)),false);
 h.settings.download_password_hash=await context.api.passwordHash('changed-fixture-password',webcrypto);response=await h.call('download',{platform:'windows',accessToken:second.token});assert.equal(response.data.error.code,'password_required');response=await h.call('download',{platform:'windows',accessToken:second.token,password});assert.equal(response.data.error.code,'invalid_password');
 response=await h.call('download',{platform:'windows',password:'changed-fixture-password'});assert.equal(response.status,200);const third=response.data.accessSession;
 response=await h.call('download',{platform:'windows',password:'changed-fixture-password'});assert.equal(response.status,200);const fourth=response.data.accessSession;
 response=await h.call('logout-download',{accessToken:third.token});assert.equal(response.status,200);assert.equal(response.data.cleared,true);assert(!h.sessions.has(digest(third.token)));assert(h.sessions.has(digest(fourth.token)));assert.equal(h.calls.delete.at(-1),digest(third.token));
 response=await h.call('download',{platform:'windows',accessToken:third.token});assert.equal(response.data.error.code,'password_required');response=await h.call('download',{platform:'windows',accessToken:fourth.token});assert.equal(response.status,200);
 response=await h.call('logout-download',{accessToken:'invalid'});assert.equal(response.data.cleared,true);response=await h.call('logout-download');assert.equal(response.data.cleared,true);assert(h.sessions.has(digest(fourth.token)));
 h.settings.visibility='public';h.settings.download_password_hash=null;response=await h.call('download',{platform:'windows',accessToken:fourth.token});assert.equal(response.status,200);assert.equal(response.data.accessSession,undefined);
 h.settings.visibility='private';h.settings.download_password_hash=await context.api.passwordHash('changed-fixture-password',webcrypto);response=await h.call('download',{platform:'windows',accessToken:fourth.token});assert.equal(response.data.error.code,'password_required');
 const before=h.calls.create.length;h.controls.missing=true;response=await h.call('download',{platform:'windows',password:'changed-fixture-password'});assert.equal(response.status,404);assert.equal(h.calls.create.length,before);h.controls.missing=false;
 h.controls.createError=true;const metrics=h.calls.analytics;response=await h.call('download',{platform:'windows',password:'changed-fixture-password'});assert.equal(response.status,503);assert.equal(h.calls.analytics,metrics);assert(!JSON.stringify(response.data).includes('SECRET'));h.controls.createError=false;
 h.controls.dbError=true;response=await h.call('download',{platform:'windows',accessToken:fourth.token});assert.equal(response.status,503);assert(!JSON.stringify(response.data).includes('SECRET'));
 response=await h.call('download',{platform:'windows',accessToken:'a'.repeat(65)});assert.equal(response.status,400);
 console.log('PASS visitor sessions: 30-day hashed grants, reuse, expiry, password/visibility revocation, per-token logout, no plaintext storage and fail-closed handling.');
})().catch(error=>{console.error(error);process.exitCode=1;throw error;});
