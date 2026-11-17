const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('site-oficial/analytics.js','utf8');
function harness(options={}){
 const calls=[],events={},timers=new Map();let timerId=0;
 const document={visibilityState:options.visibility||'visible',addEventListener(name,fn){events[name]=fn;}};
 Object.defineProperty(document,'cookie',{get(){throw Error('Cookies must not be read');}});
 const location={hostname:options.host||'jmxxp.github.io',protocol:options.protocol||'https:'};
 for(const key of ['search','hash','href'])Object.defineProperty(location,key,{get(){throw Error('Full URL must not be collected');}});
 const responses=options.responses||[{recorded:true}];
 const window={crypto:options.fallback?{getRandomValues:bytes=>webcrypto.getRandomValues(bytes)}:webcrypto,
  addEventListener(name,fn){events[name]=fn;},
  InvoxBackend:{async trackView(id){calls.push(id);const response=responses.shift();if(response instanceof Error)throw response;return await response;}}
 };
 const context=vm.createContext({window,document,location,Uint8Array,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(source,context);
 return {calls,events,timers,document,rerun:()=>vm.runInContext(source,context)};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
(async()=>{
 for(const options of [{host:'localhost'},{host:'127.0.0.1'},{host:'[::1]'},{protocol:'file:'}]){
  const h=harness(options);await flush();assert.equal(h.calls.length,0,'Local development must not inflate analytics');
 }
 {
  const h=harness();await flush();assert.equal(h.calls.length,1);assert.match(h.calls[0],/^[a-f0-9-]{36}$/);
  h.events.visibilitychange();h.events.online();h.rerun();await flush();assert.equal(h.calls.length,1,'One document load must count once');
 }
 {
  const h=harness({visibility:'hidden',fallback:true});await flush();assert.equal(h.calls.length,0);
  h.document.visibilityState='visible';h.events.visibilitychange();await flush();assert.equal(h.calls.length,1);assert.match(h.calls[0],/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 }
 {
  let release;const pending=new Promise(resolve=>{release=resolve;});const h=harness({responses:[pending]});
  h.events.visibilitychange();h.events.online();assert.equal(h.calls.length,1,'No concurrent duplicate event');
  release({recorded:true});await flush();h.events.online();await flush();assert.equal(h.calls.length,1);
 }
 {
  const offline=Object.assign(Error('network'),{code:'offline'});const h=harness({responses:[offline,{recorded:false}]});await flush();
  assert.equal(h.timers.size,1);[...h.timers.values()][0]();await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[0],h.calls[1],'Retries must reuse event ID');
  h.events.online();await flush();assert.equal(h.calls.length,2,'Duplicate receipt is a completed delivery');
 }
 {
  const h=harness({responses:[Object.assign(Error('rate limit'),{code:'rate_limited'})]});await flush();assert.equal(h.timers.size,0);
 }
 console.log('PASS public analytics: published-only, once per visible document, concurrent guard, UUID fallback, same-ID retry, no cookies or full URLs.');
})().catch(error=>{console.error(error);process.exitCode=1;});
