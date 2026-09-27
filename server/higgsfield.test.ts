import test from 'node:test';
import assert from 'node:assert/strict';
import { HiggsfieldCatalog, buildHiggsfieldInput, describeHiggsfield, identity, selectHiggsfield } from './higgsfield.js';
import { Credentials } from './credentials.js';
import { generationSchema, Providers } from './providers.js';
import { HttpError } from './errors.js';

const {entries}=await new HiggsfieldCatalog().entries();
const entry=(id:string)=>{const found=entries.find(item=>item.id===id);assert.ok(found,id);return found;};
const base={prompt:'A considered composition',aspectRatio:'16:9',resolution:'1K',duration:5,count:1,references:[] as string[]};
const reference='https://example.com/reference.png';
const credentials=()=>new Credentials({HF_KEY:'fake-dashboard-key-for-mocks'});
const errorCode=(code:string)=>(error:unknown)=>error instanceof HttpError&&error.code===code;

test('complete documented catalog is stable, categorized and does not call provider or documentation APIs',async()=>{
 let calls=0;const provider=new Providers(credentials(),async()=>{calls++;throw new Error('No network is allowed');});
 for(let round=0;round<2;round++){
  const image=await provider.models('higgsfield','image');const video=await provider.models('higgsfield','video');
  assert.equal(image.source,'cached');assert.equal(image.models.length,15);assert.equal(video.models.length,66);
  assert.equal(image.models.filter(model=>'supported' in model&&model.supported).length,15);assert.equal(video.models.filter(model=>'supported' in model&&model.supported).length,53);
 }
 assert.equal(calls,0);assert.equal(new Set(entries.map(item=>item.id)).size,81);
 assert.ok(entries.every(item=>item.schema.properties&&item.sourceUrl.startsWith('https://docs.higgsfield.ai/docs/models/')));
 assert.equal(entries.some(item=>/flux|custom-references|soul-id/.test(item.id)),false);
 assert.throws(()=>new HiggsfieldCatalog([{...entries[0],schema:{}}]),/Invalid Higgsfield catalog/);
});

test('canonical families preserve paid quality variants and route all references without truncation',()=>{
 assert.equal(identity(entry('alibaba/qwen-image-3/text-to-image')),identity(entry('alibaba/qwen-image-3/edit')));
 assert.notEqual(identity(entry('lightricks/ltx-2.5/text-to-video/fast')),identity(entry('lightricks/ltx-2.5/text-to-video/pro')));
 assert.notEqual(identity(entry('recraft/v4.1/text-to-image')),identity(entry('recraft/v4.1/pro/text-to-image')));
 assert.equal(selectHiggsfield(entries,'lightricks/ltx-2.5/text-to-video/pro','video',1).id,'lightricks/ltx-2.5/image-to-video/pro');
 assert.equal(selectHiggsfield(entries,'kling-video/v3.0/pro/text-to-video','video',1).id,'kling-video/v3.0/pro/image-to-video');
 assert.equal(selectHiggsfield(entries,'alibaba/happy-horse/text-to-video','video',2).id,'alibaba/happy-horse/reference-to-video');
 assert.equal(selectHiggsfield(entries,'bytedance/seedance-2.5/text-to-video','video',3).id,'bytedance/seedance-2.5/reference-to-video');
 assert.equal(selectHiggsfield(entries,'alibaba/qwen-image-3/edit','image',0).id,'alibaba/qwen-image-3/text-to-image');
 assert.throws(()=>selectHiggsfield(entries,'flux-pro/kontext/max/text-to-image','image',0),errorCode('unsupported_model'));
 assert.throws(()=>selectHiggsfield(entries,'bytedance/seedance-2.5/video-edit','video',0),errorCode('unsupported_model'));
 assert.equal(buildHiggsfieldInput(entry('lightricks/ltx-2.5/text-to-video/pro'),{...base,duration:undefined}).duration,6);
});

test('every supported official schema accepts its documented defaults and required image input',()=>{
 let accepted=0;
 for(const item of entries){
  const info=describeHiggsfield(item);if(!info.supported)continue;
  const properties=item.schema.properties;
  const value=(key:string,fallback:unknown)=>properties[key]?.default??properties[key]?.enum?.[0]??fallback;
  const refs=info.capabilities.requiredInputs.some(name=>info.capabilities.referenceFields.includes(name))?[reference]:[];
  assert.doesNotThrow(()=>buildHiggsfieldInput(item,{...base,aspectRatio:String(value('aspect_ratio','16:9')),resolution:String(value('resolution','1K')),duration:Number(value('duration',5)),references:refs}),item.id);
  accepted++;
 }
 assert.equal(accepted,68);
 assert.equal(describeHiggsfield(entry('bytedance/seedance-2.5/video-edit')).supported,false);
 assert.ok(describeHiggsfield(entry('bytedance/seedance-2.5/reference-to-video')).capabilities.requiredInputs.includes('image_urls'));
 assert.throws(()=>buildHiggsfieldInput(entry('bytedance/seedance-2.5/reference-to-video'),base),errorCode('missing_references'));
});

test('schema validation preserves explicit output choices and rejects unsupported values before billing',()=>{
 const soul=entry('higgsfield-ai/soul/standard');
 assert.ok(describeHiggsfield(soul).capabilities.referenceFields.includes('image_reference_url'));
 assert.equal(buildHiggsfieldInput(soul,{...base,references:[reference]}).image_reference_url,reference);
 assert.equal(buildHiggsfieldInput(entry('alibaba/qwen-image-3/text-to-image'),base).resolution,'1k');
 assert.equal(generationSchema.parse({provider:'higgsfield',kind:'image',model:'ideogram/v4.0',prompt:base.prompt,aspectRatio:'auto'}).aspectRatio,'auto');
 assert.equal(buildHiggsfieldInput(soul,base).resolution,'720p'); // Legacy automatic 1K choice.
 assert.throws(()=>buildHiggsfieldInput(soul,{...base,count:2}),errorCode('invalid_model_input'));
 assert.throws(()=>buildHiggsfieldInput(soul,{...base,aspectRatio:'8:1'}),errorCode('invalid_model_input'));
 assert.throws(()=>buildHiggsfieldInput(soul,{...base,resolution:'4K'}),errorCode('invalid_model_input'));
 assert.throws(()=>buildHiggsfieldInput(entry('lightricks/ltx-2.5/text-to-video/fast'),base),errorCode('invalid_model_input'));
 assert.throws(()=>buildHiggsfieldInput(entry('alibaba/qwen-image-3/edit'),{...base,references:Array(4).fill(reference)}),errorCode('invalid_model_input'));
 assert.throws(()=>buildHiggsfieldInput(entry('recraft/v4.1/text-to-image'),{...base,count:2}),errorCode('unsupported_count'));
});

test('local image upload uses signed storage headers without API credentials, then submits the native reference variant',async()=>{
 const calls:{url:string;method:string;headers:Headers;body:unknown}[]=[];
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(3000)]);
 const providers=new Providers(credentials(),async(url,init)=>{
  calls.push({url:String(url),method:init?.method??'GET',headers:new Headers(init?.headers),body:init?.body});
  if(String(url).endsWith('/files/generate-upload-url'))return Response.json({upload_url:'https://storage.example/upload',public_url:reference,upload_headers:{'Content-Type':'image/png','x-amz-server-side-encryption':'AES256'}});
  if(String(url)==='https://storage.example/upload')return new Response(null,{status:200});
  return Response.json({request_id:'fake-request-id',status:'queued'});
 });
 await providers.submit(generationSchema.parse({provider:'higgsfield',kind:'image',model:'alibaba/qwen-image-3/text-to-image',prompt:base.prompt,references:[`data:image/png;base64,${png.toString('base64')}`]}),new AbortController().signal);
 assert.equal(calls.length,3);
 assert.equal(calls[0].headers.get('Authorization'),'Key fake-dashboard-key-for-mocks');
 assert.equal(calls[1].method,'PUT');assert.equal(calls[1].headers.has('Authorization'),false);assert.equal(calls[1].headers.get('x-amz-server-side-encryption'),'AES256');
 assert.equal(calls[2].url,'https://api.higgsfield.ai/alibaba/qwen-image-3/edit');
 assert.deepEqual(JSON.parse(String(calls[2].body)).image_urls,[reference]);
 // SOUL has maxLength 2083 on its public URL; the larger transient data URI must upload first.
 calls.length=0;
 await providers.submit(generationSchema.parse({provider:'higgsfield',kind:'image',model:'higgsfield-ai/soul/standard',prompt:base.prompt,references:[`data:image/png;base64,${png.toString('base64')}`]}),new AbortController().signal);
 assert.equal(calls.length,3);assert.equal(JSON.parse(String(calls[2].body)).image_reference_url,reference);
});

test('unknown endpoints and invalid explicit options do not upload or submit; failed storage upload never generates',async()=>{
 let calls=0;const providers=new Providers(credentials(),async()=>{calls++;throw new Error('Must not contact API');});
 for(const changes of [{model:'flux-pro/kontext/max/text-to-image'},{model:'higgsfield-ai/soul/standard',resolution:'4K'},{model:'higgsfield-ai/soul/standard',count:2}]){
  await assert.rejects(providers.submit(generationSchema.parse({provider:'higgsfield',kind:'image',prompt:base.prompt,...changes}),new AbortController().signal));
 }
 assert.equal(calls,0);
 const failure=new Providers(credentials(),async(url)=>{
  calls++;if(String(url).endsWith('/files/generate-upload-url'))return Response.json({upload_url:'https://storage.example/upload',public_url:reference});
  return new Response(null,{status:403});
 });
 const png=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
 await assert.rejects(failure.submit(generationSchema.parse({provider:'higgsfield',kind:'image',model:'higgsfield-ai/soul/standard',prompt:base.prompt,references:[`data:image/png;base64,${png}`]}),new AbortController().signal),errorCode('upload_failed'));
 assert.equal(calls,2);
});

test('provider denial distinguishes credits from authentication and empty accepted cancellation succeeds',async()=>{
 for(const status of [401,403,404]){
  const provider=new Providers(credentials(),async()=>new Response(null,{status}));
  await assert.rejects(provider.json('higgsfield','/requests/fake/status'),error=>error instanceof HttpError&&error.status===status&&error.message.includes(status===403?'Saldo insuficiente':status===404?'API ou conta':'chave'));
 }
 const cancelled=new Providers(credentials(),async()=>new Response(null,{status:202}));
 assert.deepEqual(await cancelled.cancelHiggsfield('fake-request'),{});
});

test('OpenRouter parameter names are not mistaken for authoritative output options',async()=>{
 const provider=new Providers(new Credentials({}),async()=>Response.json({data:[
  {id:'example/no-options',supported_parameters:['aspect_ratio','resolution']},
  {id:'example/with-options',supported_parameters:['resolution'],supported_resolutions:['1K','2K'],supported_aspect_ratios:['1:1','16:9'],supported_durations:['5',10,'invalid']},
 ]}));
 const catalog=await provider.models('openrouter','image');
 assert.equal('capabilities' in catalog.models[0],false);
 assert.deepEqual(catalog.models[1].capabilities,{aspectRatios:['1:1','16:9'],resolutions:['1K','2K'],durations:[5,10]});
});
