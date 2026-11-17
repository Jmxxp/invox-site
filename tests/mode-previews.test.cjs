const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../site-oficial/modes.js'),'utf8');
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
class Events{
 constructor(){this.events=new Map();}
 addEventListener(name,callback){const list=this.events.get(name)||[];list.push(callback);this.events.set(name,list);}
 emit(name,event={}){for(const callback of this.events.get(name)||[])callback(event);}
}
class Video extends Events{
 constructor(){super();this.paused=true;this.readyState=0;this.playCalls=0;this.result='resolve';this.classes=new Set();this.figure={classList:{add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)}};}
 closest(){return this.figure;}
 play(){this.playCalls++;if(this.result==='throw')throw Error('Media failure');if(this.result==='reject')return Promise.reject(Error('Autoplay blocked'));this.paused=false;if(this.result==='pending')return new Promise(resolve=>{this.resolvePlay=resolve;});return Promise.resolve();}
 pause(){this.paused=true;this.emit('pause');}
 playing(){this.paused=false;this.readyState=4;this.emit('playing');}
 showsVideo(){return this.classes.has('is-playing');}
}
function harness(options={}){
 const videos=[new Video(),new Video()],document=new Events(),window=new Events(),motion=new Events();
 document.hidden=Boolean(options.hidden);document.querySelectorAll=()=>videos;motion.matches=Boolean(options.reduced);window.matchMedia=()=>motion;
 let observer;
 class Observer{constructor(callback){this.callback=callback;observer=this;}observe(){}}
 const context={window,document};if(!options.noObserver)context.IntersectionObserver=Observer;
 vm.runInNewContext(source,context);
 return{videos,document,window,
  intersect(index,visible,ratio=visible?1:0){observer.callback([{target:videos[index].figure,isIntersecting:visible,intersectionRatio:ratio}]);},
  visibility(hidden){document.hidden=hidden;document.emit('visibilitychange');},
  reduced(value){motion.matches=value;motion.emit('change');}
 };
}
function staticImage(video,message){assert.equal(video.paused,true,message);assert.equal(video.showsVideo(),false,message);}
(async()=>{
 {
  const h=harness();assert(h.videos.every(video=>video.playCalls===0),'Offscreen previews do not start');
  h.intersect(0,true);await flush();assert.equal(h.videos[0].playCalls,1);assert.equal(h.videos[1].playCalls,0,'One visible card does not start the others');
  assert.equal(h.videos[0].showsVideo(),false,'The image stays visible before the first playing frame');
  h.videos[0].playing();assert.equal(h.videos[0].showsVideo(),true);
  h.intersect(0,false);staticImage(h.videos[0],'Leaving the viewport restores the image');
  h.videos[0].playing();staticImage(h.videos[0],'Late playing cannot resume an offscreen card');
  h.intersect(1,true,0);assert.equal(h.videos[1].playCalls,0,'An empty intersection stays static');
 }
 {
  const h=harness({hidden:true});h.intersect(0,true);assert.equal(h.videos[0].playCalls,0,'Hidden pages do not request playback');
  h.visibility(false);await flush();h.videos[0].playing();assert.equal(h.videos[0].showsVideo(),true);
  h.visibility(true);staticImage(h.videos[0],'Hiding the page pauses the preview');
  h.videos[0].playing();staticImage(h.videos[0],'Late playing cannot resume a hidden page');
 }
 {
  const h=harness({reduced:true});h.intersect(0,true);assert.equal(h.videos[0].playCalls,0,'Reduced motion starts with a static image');
  h.reduced(false);await flush();h.videos[0].playing();assert.equal(h.videos[0].showsVideo(),true);
  h.reduced(true);staticImage(h.videos[0],'Changing to reduced motion restores the image');
  h.videos[0].playing();staticImage(h.videos[0],'Late events respect the new motion preference');
 }
 for(const result of ['reject','throw']){
  const h=harness();h.videos[0].result=result;h.intersect(0,true);await flush();staticImage(h.videos[0],`${result} keeps the image fallback`);
  h.videos[0].playing();staticImage(h.videos[0],'A stale event cannot expose a rejected playback');
 }
 {
  const h=harness();h.intersect(0,true);await flush();h.videos[0].playing();h.videos[0].emit('error');staticImage(h.videos[0],'A media error restores the image');
  const calls=h.videos[0].playCalls;h.visibility(true);h.visibility(false);h.intersect(0,true);h.videos[0].playing();
  assert.equal(h.videos[0].playCalls,calls,'A failed media source is not retried in a network loop');staticImage(h.videos[0],'Failed media stays static');
 }
 for(const stop of [h=>h.intersect(0,false),h=>h.visibility(true),h=>h.reduced(true)]){
  const h=harness();h.videos[0].result='pending';h.intersect(0,true);stop(h);h.videos[0].resolvePlay();await flush();
  staticImage(h.videos[0],'An old play promise cannot restore a suspended preview');h.videos[0].playing();staticImage(h.videos[0],'A delayed playing event cannot restore it either');
 }
 {
  const h=harness();h.intersect(0,true);await flush();h.videos[0].playing();h.window.emit('pagehide');h.videos[0].playing();
  staticImage(h.videos[0],'pagehide remains suspended until pageshow even before document.hidden updates');
  h.window.emit('pageshow');await flush();h.videos[0].playing();assert.equal(h.videos[0].showsVideo(),true,'A restored visible page resumes');
 }
 {
  const h=harness({noObserver:true});h.visibility(true);h.visibility(false);h.reduced(false);h.window.emit('pageshow');
  assert(h.videos.every(video=>video.playCalls===0&&!video.showsVideo()),'Without IntersectionObserver the image remains usable');
 }
 console.log('PASS mode previews: visible-only playback, offscreen/hidden pause, reduced motion, static fallback, errors, late promises/events and page lifecycle.');
})().catch(error=>{console.error(error);process.exitCode=1;});
