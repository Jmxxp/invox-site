const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').resolve(__dirname, '..', "site-oficial/feedback.js"),'utf8');
function node(){return {value:'',disabled:false,textContent:'',dataset:{},events:{},attrs:{},setCustomValidity(value){this.error=value;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.events[k]=fn;},focus(){this.focused=true;}};}
const ids=Object.fromEntries(['feedback-form','feedback-name','feedback-contact','feedback-message','feedback-submit','feedback-status','feedback-count','feedback-website'].map(id=>[id,node()]));
const fields=['feedback-name','feedback-contact','feedback-message'].map(id=>ids[id]);
const form=ids['feedback-form'],status=ids['feedback-status'],button=ids['feedback-submit'];
form.reportValidity=()=>fields.every(field=>!field.error);form.reset=()=>fields.concat(ids['feedback-website']).forEach(field=>field.value='');
const calls=[];let result={id:'fake-id'},failure=null,resolve=null;
const api={sendFeedback:async payload=>{calls.push(payload);if(failure)throw failure;if(resolve==='defer')return new Promise(done=>resolve=done);return result;}};
vm.runInNewContext(source,{document:{getElementById:id=>ids[id]},window:{InvoxBackend:api}});
const submit=()=>form.events.submit({preventDefault(){}});
function fill(){['Jogador teste','teste@example.test','Esta é uma mensagem de teste.'].forEach((value,i)=>fields[i].value='  '+value+'  ');}
(async()=>{
  fields.forEach(field=>field.value='   ');await submit();assert.equal(calls.length,0);assert(fields.every(field=>field.error));
  fill();failure={code:'offline'};await submit();assert.equal(calls.length,1);assert.equal(calls[0].name,'Jogador teste');assert.match(status.textContent,/Não foi possível enviar/);assert.equal(fields[2].value,'Esta é uma mensagem de teste.');assert(!button.disabled);
  failure=null;resolve='defer';const waiting=submit();assert(button.disabled);assert(fields.every(field=>field.disabled));await submit();assert.equal(calls.length,2);resolve({id:'fake-id'});await waiting;assert(fields.every(field=>field.value===''));assert.equal(ids['feedback-count'].textContent,'0 / 2000');assert.equal(status.dataset.tone,'success');assert.match(status.textContent,/Feedback enviado/);assert(!button.disabled);
  fill();failure={code:'rate_limited'};await submit();assert.match(status.textContent,/Aguarde alguns minutos/);assert.equal(status.dataset.tone,'error');assert.equal(fields[0].value,'Jogador teste');
  console.log('PASS public feedback: validation, real API receipt, trimmed payload, failure retains text, loading prevents duplicate sends, success resets, rate-limit message.');
})().catch(error=>{console.error(error);process.exitCode=1;});
