import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { GenerationJobs } from './jobs.js';
import { Providers, generationSchema } from './providers.js';
import { ProjectStore } from './store.js';
import { createEmptyMotionScene } from '../shared/emptyMotion.js';

function deferred<T>() {
  let resolve!: (value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
async function until(check:()=>boolean|Promise<boolean>){
  for(let i=0;i<200;i++){if(await check())return;await sleep(5);}
  assert.fail('Timed out waiting for mock job');
}
async function promptly<T>(action:Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([action,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cancel/status blocked on a provider response')),300);})]);}
  finally{if(timer)clearTimeout(timer);}
}
async function fixture(overrides:Partial<Pick<Providers,'submit'|'poll'|'cancelHiggsfield'|'videoContent'>>={}){
  const directory=await mkdtemp(join(tmpdir(),'onun-cancel-'));
  const projects=new ProjectStore(join(directory,'projects'));
  await projects.save({id:'project',name:'Cancellation test',nodes:[{id:'source',kind:'image',title:'Image',x:0,y:0,width:300,prompt:'Test',provider:'higgsfield',model:'higgsfield/test',aspectRatio:'1:1',resolution:'1K',count:1,status:'none'}],edges:[],motion:createEmptyMotionScene('Blank')});
  const calls={submit:0,poll:0,cancel:[] as string[]};
  const providers={
    assertConfigured(){},
    async submit(...args:Parameters<Providers['submit']>){calls.submit++;return overrides.submit?.(...args)??{request_id:'remote-test',status:'queued'};},
    async poll(...args:Parameters<Providers['poll']>){calls.poll++;return overrides.poll?.(...args)??{status:'running'};},
    async cancelHiggsfield(id:string){calls.cancel.push(id);return overrides.cancelHiggsfield?.(id)??{};},
    async videoContent(...args:Parameters<Providers['videoContent']>){return overrides.videoContent?.(...args)??new Uint8Array([1,2]);},
  } as unknown as Providers;
  const jobs=new GenerationJobs(providers,projects,join(directory,'assets'),{pollIntervalMs:5,cancelTimeoutMs:40});
  const request=generationSchema.parse({provider:'higgsfield',kind:'image',model:'higgsfield/test',prompt:'Test',projectId:'project',nodeId:'source',requestId:crypto.randomUUID()});
  return {jobs,projects,calls,request,async close(){await jobs.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('cancelling before a Higgsfield submission returns keeps its ID and cancels it once',async()=>{
  const submission=deferred<Record<string,unknown>>();let signal:AbortSignal|undefined;
  const f=await fixture({submit:async(_request,currentSignal)=>{signal=currentSignal;return submission.promise;}});
  try{
    const started=await f.jobs.create(f.request);await until(()=>!!signal);
    const stopped=await promptly(f.jobs.cancel(started.id));
    assert.equal(stopped.status,'cancelled');assert.match(stopped.error!,/pode continuar processando e cobrando/);
    assert.equal(signal!.aborted,false);assert.equal(f.calls.cancel.length,0);
    await f.jobs.cancel(started.id);
    submission.resolve({request_id:'late-remote-id',status:'completed',images:[{url:'https://provider.test/result.png'}]});
    await until(()=>f.calls.cancel.length===1);
    await until(async()=>/pedido de cancelamento/.test((await f.jobs.get(started.id)).error??''));
    const result=await f.jobs.get(started.id);
    assert.equal(result.status,'cancelled');assert.deepEqual(result.outputs,[]);
    assert.deepEqual(f.calls.cancel,['late-remote-id']);assert.equal(f.calls.submit,1);
    assert.equal((await f.projects.get('project')).nodes.length,1);
    await f.jobs.create(f.request);assert.equal(f.calls.submit,1);
  }finally{submission.resolve({request_id:'late-remote-id'});await f.close();}
});

test('cancellation returns promptly while a poll and remote cancellation are pending; late output stays cancelled',async()=>{
  const poll=deferred<Record<string,unknown>>(),remote=deferred<Record<string,unknown>>();
  const f=await fixture({poll:async()=>poll.promise,cancelHiggsfield:async()=>remote.promise});
  try{
    const started=await f.jobs.create(f.request);await until(()=>f.calls.poll===1);
    assert.equal((await promptly(f.jobs.cancel(started.id))).status,'cancelled');
    assert.equal((await promptly(f.jobs.get(started.id))).status,'cancelled');
    await f.jobs.cancel(started.id);assert.equal(f.calls.cancel.length,1);
    poll.resolve({status:'completed',images:[{url:'https://provider.test/late.png'}]});
    await until(async()=>/Não foi possível confirmar/.test((await f.jobs.get(started.id)).error??''));
    remote.resolve({});await sleep(20);
    const result=await f.jobs.get(started.id);assert.equal(result.status,'cancelled');assert.deepEqual(result.outputs,[]);
    const project=await f.projects.get('project');assert.equal(project.nodes[0].generationStatus,'idle');assert.equal(project.nodes.length,1);
    assert.equal(f.calls.submit,1);assert.equal(f.calls.poll,1);assert.equal(f.calls.cancel.length,1);
  }finally{poll.resolve({status:'running'});remote.resolve({});await f.close();}
});

test('cancelling after completion preserves the output and does not send a remote cancel',async()=>{
  const f=await fixture({submit:async()=>({request_id:'complete-id',status:'completed',images:[{url:'https://provider.test/ready.png'}]})});
  try{
    const started=await f.jobs.create(f.request);await until(async()=>(await f.jobs.get(started.id)).status==='complete');
    const before=await f.jobs.get(started.id),result=await f.jobs.cancel(started.id);
    assert.equal(result.status,'complete');assert.deepEqual(result.outputs,before.outputs);assert.equal(result.outputs.length,1);
    assert.equal(f.calls.cancel.length,0);assert.equal((await f.projects.get('project')).nodes.length,2);
  }finally{await f.close();}
});

test('a late video download cannot publish after tracking was cancelled',async()=>{
  const download=deferred<Buffer>();let downloading=false;
  const f=await fixture({poll:async()=>({status:'completed'}),videoContent:async()=>{downloading=true;return download.promise;}});
  try{
    const started=await f.jobs.create({...f.request,provider:'openrouter',kind:'video'});await until(()=>downloading);
    const result=await promptly(f.jobs.cancel(started.id));assert.equal(result.status,'cancelled');
    download.resolve(Buffer.from([1,2,3]));await sleep(30);
    const final=await f.jobs.get(started.id);assert.equal(final.status,'cancelled');assert.deepEqual(final.outputs,[]);
    assert.equal(f.calls.cancel.length,0);assert.equal(f.calls.poll,1);assert.equal((await f.projects.get('project')).nodes.length,1);
  }finally{download.resolve(Buffer.alloc(0));await f.close();}
});


test('a late cancellation acknowledgement cannot reset a newer generation on the same node',async()=>{
  const remote=deferred<Record<string,unknown>>();let submissions=0;
  const f=await fixture({submit:async()=>({request_id:'remote-'+(++submissions),status:'queued'}),cancelHiggsfield:async()=>remote.promise});
  try{
    const first=await f.jobs.create(f.request);await until(()=>f.calls.poll>0);
    await f.jobs.cancel(first.id);
    const next=await f.jobs.create({...f.request,requestId:crypto.randomUUID()});
    await until(async()=>(await f.projects.get('project')).nodes[0].generationStatus==='running');
    remote.resolve({});
    await until(async()=>/pedido de cancelamento/.test((await f.jobs.get(first.id)).error??''));
    assert.equal((await f.jobs.get(next.id)).status,'running');
    assert.equal((await f.projects.get('project')).nodes[0].generationStatus,'running');
    assert.equal(f.calls.submit,2);assert.deepEqual(f.calls.cancel,['remote-1']);
  }finally{remote.resolve({});await f.close();}
});
