import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {Credentials} from './credentials.js';
import {Providers,generationSchema} from './providers.js';
import {GenerationJobs} from './jobs.js';
import {ProjectStore} from './store.js';
import {defaultScene} from '../shared/motion.js';
import {estimateNodeHeight} from '../shared/canvasLayout.js';
import type {CanvasNode} from '../shared/project.js';

const generator:CanvasNode={id:'generator',kind:'image',title:'Generator',x:0,y:0,width:285,prompt:'Test composition',provider:'higgsfield',model:'xai/grok-imagine-image-2.0',aspectRatio:'1:1',resolution:'1K',count:1,status:'none'};
const credentials=()=>new Credentials({HF_KEY:'fake-results-test-key'});
const setup=async(nodes:CanvasNode[]=[generator])=>{const directory=await mkdtemp(join(tmpdir(),'onun-results-'));const store=new ProjectStore(join(directory,'projects'));await store.save({id:'project',name:'Test',nodes,edges:[],motion:defaultScene});return{directory,store,assets:join(directory,'assets')};};
const request=()=>generationSchema.parse({...generator,kind:'image',projectId:'project',nodeId:'generator',requestId:randomUUID()});
async function until(check:()=>Promise<boolean>){for(let i=0;i<200;i++){if(await check())return;await pause(5);}throw new Error('Timed out waiting for isolated fake generation');}
const separated=(a:CanvasNode,b:CanvasNode)=>a.x+a.width+48<=b.x||b.x+b.width+48<=a.x||a.y+estimateNodeHeight(a)+48<=b.y||b.y+estimateNodeHeight(b)+48<=a.y;

for(const count of [2,4])test(`${count} Higgsfield outputs become durable collision-free adjacent nodes without a browser polling`,async()=>{
 const fixture=await setup([{...generator,title:'G'.repeat(200)},{...generator,id:'obstruction',kind:'reference',aspectRatio:'16:9',x:381,media:'https://example.com/reference.png'}]);let submissions=0;
 const providers=new Providers(credentials(),async(_url,init)=>{
  if(init?.method==='POST'){submissions++;return Response.json({request_id:'fake-remote',status:'queued'});}
  return Response.json({request_id:'fake-remote',status:'completed',images:Array.from({length:count},(_,i)=>({url:`https://example.com/generated-${i}.png`}))});
 });
 const jobs=new GenerationJobs(providers,fixture.store,fixture.assets,{pollIntervalMs:10});
 try{
  const submitted=await jobs.create(request());
  // No GET /jobs drives this wait: only the project's persisted document is read.
  await until(async()=> (await fixture.store.get('project')).nodes.filter(n=>n.generatedFrom==='generator').length===count);
  const result=await jobs.get(submitted.id);assert.equal(result.status,'complete');assert.equal(submissions,1);
  const project=await fixture.store.get('project');const outputs=project.nodes.filter(n=>n.generatedFrom==='generator');
  assert.equal(project.nodes.find(n=>n.id==='generator')?.outputs?.length,count);
  assert.equal(outputs.length,count);assert.equal(project.edges.filter(e=>e.source==='generator').length,count);
  for(const [index,node]of outputs.entries()){
   assert.equal(node.id,`output-${submitted.id}-${index}`);assert.equal(node.media,`https://example.com/generated-${index}.png`);assert.equal(node.kind,'image');assert.equal(node.generationStatus,'complete');assert.equal(node.title.length,200);assert.ok(node.title.endsWith(` · ${index+1}`));
   assert.ok(node.x>=generator.x+generator.width+48);assert.ok(project.nodes.filter(other=>other.id!==node.id).every(other=>separated(node,other)));
  }
  for(let i=0;i<3;i++)await jobs.get(submitted.id);
  assert.equal((await fixture.store.get('project')).nodes.length,count+2);
  assert.equal((await new ProjectStore(join(fixture.directory,'projects')).get('project')).nodes.length,count+2);
 }finally{await jobs.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});

test('runtime restart resumes only remote polling and retains all results without resubmission or resurrecting deleted nodes',async()=>{
 const fixture=await setup();let submits=0,polls=0;
 const first=new GenerationJobs(new Providers(credentials(),async()=>{submits++;return Response.json({request_id:'fake-recoverable-id',status:'queued'});}),fixture.store,fixture.assets,{pollIntervalMs:60000});
 let resumed:GenerationJobs|undefined;let again:GenerationJobs|undefined;
 try{
  const input=request();input.references=['https://example.com/private-reference.png'];
  const submitted=await first.create(input);const path=join(fixture.directory,'jobs',`${submitted.id}.json`);
  await until(async()=>JSON.parse(await readFile(path,'utf8')).remoteId==='fake-recoverable-id');
  await first.dispose();
  const saved=await readFile(path,'utf8');assert.equal(saved.includes('fake-results-test-key'),false);assert.equal(saved.includes('private-reference.png'),false);assert.deepEqual(JSON.parse(saved).request.references,[]);
  const provider=new Providers(credentials(),async(_url,init)=>{assert.equal(init?.method,'GET');polls++;return Response.json({request_id:'fake-recoverable-id',status:'completed',images:[{url:'https://example.com/recovered.png'}]});});
  resumed=new GenerationJobs(provider,fixture.store,fixture.assets,{pollIntervalMs:10});
  await until(async()=> (await fixture.store.get('project')).nodes.some(n=>n.generatedFrom==='generator'));
  assert.equal((await resumed.get(submitted.id)).status,'complete');assert.equal(submits,1);assert.equal(polls,1);
  await resumed.dispose();
  await fixture.store.mutate('project',p=>({...p,nodes:p.nodes.filter(n=>!n.generatedFrom),edges:[]}));
  again=new GenerationJobs(provider,fixture.store,fixture.assets,{pollIntervalMs:10});await again.list();await pause(20);
  assert.equal((await fixture.store.get('project')).nodes.length,1);assert.equal(polls,1);assert.equal(submits,1);
 }finally{await first.dispose();await resumed?.dispose();await again?.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});

test('a pending record without remote ID is never resubmitted after an uncertain shutdown',async()=>{
 const fixture=await setup();const input=request();let network=0;
 await mkdir(join(fixture.directory,'jobs'));await writeFile(join(fixture.directory,'jobs',`${input.requestId}.json`),JSON.stringify({version:1,id:input.requestId,createdAt:new Date().toISOString(),status:'queued',request:input,outputs:[]}));
 const jobs=new GenerationJobs(new Providers(credentials(),async()=>{network++;throw new Error('Must not generate');}),fixture.store,fixture.assets,{pollIntervalMs:10});
 try{const result=await jobs.get(input.requestId!);assert.equal(result.status,'error');assert.match(result.error??'',/identificador remoto/);assert.equal(network,0);assert.equal((await fixture.store.get('project')).nodes.length,1);}
 finally{await jobs.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});

test('legacy completed outputs materialize once with stable IDs and remain removable across restarts',async()=>{
 const fixture=await setup([{...generator,media:'https://example.com/legacy.png',outputs:['https://example.com/legacy.png'],generationStatus:'complete'}]);
 const providers=new Providers(credentials(),async()=>{throw new Error('Migration cannot contact providers');});
 const first=new GenerationJobs(providers,fixture.store,fixture.assets);
 let second:GenerationJobs|undefined;
 try{
  await first.list();let project=await fixture.store.get('project');const output=project.nodes.find(n=>n.generatedFrom==='generator');assert.ok(output);assert.match(output.id,/^output-legacy-/);assert.equal(project.edges[0].target,output.id);
  await first.dispose();second=new GenerationJobs(providers,fixture.store,fixture.assets);await second.list();assert.equal((await fixture.store.get('project')).nodes.length,2);await second.dispose();
  await fixture.store.mutate('project',p=>({...p,nodes:p.nodes.filter(n=>!n.generatedFrom),edges:[]}));second=new GenerationJobs(providers,fixture.store,fixture.assets);await second.list();project=await fixture.store.get('project');assert.equal(project.nodes.length,1);
 }finally{await first.dispose();await second?.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});


test('temporary polling errors retry reads without resubmission and completion is checked before an old deadline',async()=>{
 const fixture=await setup();let posts=0,reads=0;
 const providers=new Providers(credentials(),async(_url,init)=>{
  if(init?.method==='POST'){posts++;return Response.json({request_id:'fake-delayed',status:'queued'});}
  reads++;return reads===1?new Response(null,{status:503}):Response.json({request_id:'fake-delayed',status:'completed',images:[{url:'https://example.com/retried.png'}]});
 });
 const jobs=new GenerationJobs(providers,fixture.store,fixture.assets,{pollIntervalMs:10});
 try{const submitted=await jobs.create(request());await until(async()=>(await fixture.store.get('project')).nodes.some(n=>n.generatedFrom));assert.equal((await jobs.get(submitted.id)).status,'complete');assert.equal(posts,1);assert.equal(reads,2);}
 finally{await jobs.dispose();await rm(fixture.directory,{recursive:true,force:true});}
 const old=await setup();const input=request();await mkdir(join(old.directory,'jobs'));await writeFile(join(old.directory,'jobs',`${input.requestId}.json`),JSON.stringify({version:1,id:input.requestId,createdAt:new Date(Date.now()-3600000).toISOString(),status:'running',request:input,remoteId:'fake-old-completed',outputs:[]}));
 const recovered=new GenerationJobs(new Providers(credentials(),async(_url,init)=>{assert.equal(init?.method,'GET');return Response.json({request_id:'fake-old-completed',status:'completed',images:[{url:'https://example.com/old-completed.png'}]});}),old.store,old.assets,{pollIntervalMs:10});
 try{await until(async()=>(await old.store.get('project')).nodes.some(n=>n.generatedFrom));assert.equal((await recovered.get(input.requestId!)).status,'complete');}
 finally{await recovered.dispose();await rm(old.directory,{recursive:true,force:true});}
});

test('legacy running nodes without a recoverable job become explicit tracking errors without network calls',async()=>{
 const fixture=await setup([{...generator,generationStatus:'running'}]);let calls=0;
 const jobs=new GenerationJobs(new Providers(credentials(),async()=>{calls++;throw new Error('Do not resubmit');}),fixture.store,fixture.assets);
 try{await jobs.list();const node=(await fixture.store.get('project')).nodes[0];assert.equal(node.generationStatus,'error');assert.match(node.error??'',/histórico do provedor/);assert.equal(calls,0);}
 finally{await jobs.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});

test('terminal provider failures end tracking after one poll and are never retried as transport errors',async()=>{
 const fixture=await setup();let polls=0;
 const jobs=new GenerationJobs(new Providers(credentials(),async(_url,init)=>{
  if(init?.method==='POST')return Response.json({request_id:'fake-terminal',status:'queued'});
  polls++;return Response.json({request_id:'fake-terminal',status:'failed'});
 }),fixture.store,fixture.assets,{pollIntervalMs:10});
 try{const submitted=await jobs.create(request());await until(async()=>(await jobs.get(submitted.id)).status==='error');await pause(60);assert.equal(polls,1);assert.equal((await fixture.store.get('project')).nodes.length,1);}
 finally{await jobs.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});

test('a completed output survives a project write failure and reconciles on restart without another provider request',async()=>{
 const fixture=await setup();let failProjection=false,posts=0,polls=0;
 const mutate=fixture.store.mutate.bind(fixture.store);
 fixture.store.mutate=async(...args)=>{if(failProjection)throw new Error('Isolated simulated project write failure');return mutate(...args);};
 const providers=new Providers(credentials(),async(_url,init)=>{
  if(init?.method==='POST'){posts++;return Response.json({request_id:'fake-completed',status:'queued'});}
  polls++;failProjection=true;return Response.json({request_id:'fake-completed',status:'completed',images:[{url:'https://example.com/saved-completion.png'}]});
 });
 const first=new GenerationJobs(providers,fixture.store,fixture.assets,{pollIntervalMs:10});let recovered:GenerationJobs|undefined;
 try{
  const submitted=await first.create(request());await until(async()=>(await first.get(submitted.id)).status==='complete');
  const saved=JSON.parse(await readFile(join(fixture.directory,'jobs',`${submitted.id}.json`),'utf8'));assert.equal(saved.status,'complete');assert.equal(saved.outputs.length,1);assert.equal(saved.materialized,false);
  await first.dispose();failProjection=false;recovered=new GenerationJobs(providers,fixture.store,fixture.assets,{pollIntervalMs:10});await recovered.list();
  assert.equal((await fixture.store.get('project')).nodes.filter(n=>n.generatedFrom).length,1);assert.equal(posts,1);assert.equal(polls,1);
 }finally{await first.dispose();await recovered?.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});

test('invalid legacy model data and an unreadable project do not block unrelated new generations',async()=>{
 const fixture=await setup([generator,{...generator,id:'legacy-invalid',model:'',generationStatus:'complete',outputs:['https://example.com/old.png']}]);
 await mkdir(join(fixture.directory,'projects','broken'));await writeFile(join(fixture.directory,'projects','broken','project.json'),'{broken');
 const jobs=new GenerationJobs(new Providers(credentials(),async()=>Response.json({request_id:'fake-valid',status:'completed',images:[{url:'https://example.com/new.png'}]})),fixture.store,fixture.assets,{pollIntervalMs:10});
 try{const submitted=await jobs.create(request());await until(async()=>(await jobs.get(submitted.id)).status==='complete');const project=await fixture.store.get('project');assert.equal(project.nodes.filter(n=>n.generatedFrom==='generator').length,1);assert.equal(project.nodes.filter(n=>n.generatedFrom==='legacy-invalid').length,0);}
 finally{await jobs.dispose();await rm(fixture.directory,{recursive:true,force:true});}
});
