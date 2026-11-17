const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../supabase/functions/invox-api/index.ts'),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
const context={crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob};
vm.runInNewContext(source+'\nglobalThis.makeHandler=createHandler;',context);
const ADMIN='11111111-1111-4111-8111-111111111111',EVENT='22222222-2222-4222-8222-222222222222';
function harness(){
 const calls=[],seen=new Set();let views=0,downloads=0;
 const controls={rate:true,analyticsError:false,signError:false,missing:false,visibility:'public',user:true};
 const service={auth:{getUser:async()=>({data:{user:controls.user?{id:ADMIN,email:'admin@example.test',email_confirmed_at:'now'}:null},error:null})},
  from:table=>{const q={select(){return q;},eq(){return q;},async single(){return {data:{visibility:controls.visibility,download_password_hash:'fixture-private-hash',version:'1.1.0'},error:null};},async maybeSingle(){return {data:table==='invox_admins'?{email:'admin@example.test',user_id:ADMIN,username:'admin',enabled:true}:controls.missing?null:{platform:'windows',path:'test.exe',file_name:'test.exe'},error:null};}};return q;},
  storage:{from:()=>({createSignedUrl:async()=>controls.signError?{data:null,error:{message:'failed'}}:{data:{signedUrl:'https://example.test/signed'},error:null}})},
  rpc:async(name,args)=>{calls.push([name,args]);if(name==='invox_take_rate_limit')return {data:controls.rate,error:null};
   if(controls.analyticsError)return {data:null,error:{message:'SECRET database failure'}};
   if(name==='invox_record_analytics'){if(args.p_kind==='page_view'){if(seen.has(args.p_event_id))return {data:false,error:null};seen.add(args.p_event_id);views++;}else downloads++;return {data:true,error:null};}
   if(name==='invox_analytics_report')return {data:{period:args.p_period,totals:{views,downloads}},error:null};
  }};
 const handler=context.makeHandler({service,rateSecret:'fixture',crypto:webcrypto,createAuthClient:()=>{throw Error('not used');}});
 async function call(action,body={},admin=false){const r=await handler(new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://jmxxp.github.io',...(admin?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify({action,...body})}));return {status:r.status,data:await r.json()};}
 return {call,calls,controls,counts:()=>({views,downloads})};
}
module.exports=(async()=>{
 const h=harness();let r=await h.call('analytics',{period:'week'});assert.equal(r.status,401);assert(!h.calls.some(([n])=>n==='invox_analytics_report'));
 r=await h.call('analytics',{period:'all'},true);assert.equal(r.status,400);assert(!h.calls.some(([n])=>n==='invox_analytics_report'));
 for(const period of ['day','week','month','year']){r=await h.call('analytics',{period},true);assert.equal(r.status,200);assert.equal(r.data.period,period);}
 r=await h.call('track-view',{eventId:'invalid'});assert.equal(r.status,400);assert.equal(h.counts().views,0);
 r=await h.call('track-view',{eventId:EVENT});assert.equal(r.status,200);assert.equal(r.data.recorded,true);
 r=await h.call('track-view',{eventId:EVENT});assert.equal(r.status,200);assert.equal(r.data.recorded,false);assert.equal(h.counts().views,1);
 h.controls.rate=false;r=await h.call('track-view',{eventId:'33333333-3333-4333-8333-333333333333'});assert.equal(r.status,429);assert.equal(h.counts().views,1);h.controls.rate=true;
 r=await h.call('download',{platform:'windows'});assert.equal(r.status,200);assert.equal(h.counts().downloads,1);assert.equal(h.calls.find(([n,a])=>n==='invox_record_analytics'&&a.p_kind==='download')[1].p_platform,'windows');
 h.controls.missing=true;r=await h.call('download',{platform:'windows'});assert.equal(r.status,404);assert.equal(h.counts().downloads,1);h.controls.missing=false;
 h.controls.signError=true;r=await h.call('download',{platform:'windows'});assert.equal(r.status,503);assert.equal(h.counts().downloads,1);h.controls.signError=false;
 h.controls.visibility='private';r=await h.call('download',{platform:'windows'});assert.equal(r.status,401);assert.equal(h.counts().downloads,1);h.controls.visibility='public';
 h.controls.analyticsError=true;r=await h.call('download',{platform:'windows'});assert.equal(r.status,503);assert.equal(h.counts().downloads,1);assert(!JSON.stringify(r.data).includes('SECRET'));
 r=await h.call('analytics',{period:'week'},true);assert.equal(r.status,503);assert(!JSON.stringify(r.data).includes('SECRET'));
 console.log('PASS analytics API: admin-only reports, periods, UUID/dedup, rate limit, successful-download-only counts and failure handling.');
})().catch(error=>{console.error(error);process.exitCode=1;throw error;});
