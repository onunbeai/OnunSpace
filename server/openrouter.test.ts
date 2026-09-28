import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpenRouterInput,describeOpenRouter} from './openrouter.js';
import {Providers,generationSchema} from './providers.js';
import {HttpError} from './errors.js';

const descriptors={resolution:{type:'enum',values:['1K','2K']},aspect_ratio:{type:'enum',values:['1:1','4:3','auto']},n:{type:'range',min:1,max:1},input_references:{type:'range',min:0,max:3},output_format:{type:'enum',values:['png','webp']}};
const model={id:'x-ai/grok-imagine-image-2.0',name:'Grok Image 2.0',supported_parameters:descriptors};
const input=(changes:Record<string,unknown>={})=>generationSchema.parse({provider:'openrouter',kind:'image',model:model.id,prompt:'Synthetic fixture',aspectRatio:'4:3',resolution:'2k',...changes});
function adapter(entry:Record<string,unknown>=model){
 const calls:{url:string;body?:Record<string,unknown>}[]=[];
 const providers=new Providers({header:()=> 'Bearer synthetic-only'},async(url,init)=>{
  const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url:String(url),body});
  if(String(url).endsWith('/images/models')){assert.equal(new Headers(init?.headers).has('Authorization'),false);return Response.json({data:[entry]});}
  assert.equal(String(url),'https://openrouter.ai/api/v1/images');return Response.json({data:[]});
 });
 return{providers,calls,submissions:()=>calls.filter(call=>call.body)};
}

test('official image descriptors expose real enums, count limits and reference requirements',()=>{
 const result=describeOpenRouter(model);
 assert.deepEqual(result.capabilities,{aspectRatios:['1:1','4:3','auto'],resolutions:['1K','2K'],counts:[1],referenceFields:['input_references'],requiredInputs:[]});
 assert.deepEqual(describeOpenRouter({supported_parameters:{input_references:{type:'range',min:1,max:1}}}).capabilities,{aspectRatios:[],resolutions:[],counts:[1],referenceFields:['input_references'],requiredInputs:['input_references']});
 assert.deepEqual(describeOpenRouter({supported_parameters:{input_references:{type:'range',min:0,max:0}}}).capabilities?.referenceFields,[]);
 assert.deepEqual(describeOpenRouter({supported_parameters:{}}).capabilities,{aspectRatios:[],resolutions:[],counts:[1],referenceFields:[],requiredInputs:[]});
});

test('provider submission canonicalizes a case-only tier change using cached public discovery before one POST',async()=>{
 const {providers,calls,submissions}=adapter();
 const catalog=await providers.models('openrouter','image');
 assert.deepEqual((catalog.models[0].capabilities as any).resolutions,['1K','2K']);
 await providers.submit(input(),new AbortController().signal);
 assert.equal(calls.length,2);assert.equal(submissions().length,1);
 assert.deepEqual(submissions()[0].body,{model:model.id,prompt:'Synthetic fixture',resolution:'2K',aspect_ratio:'4:3',n:1,output_format:'png'});
 const description=describeOpenRouter(model);
 assert.equal(buildOpenRouterInput({...input(),aspectRatio:'AUTO'},description.parameters).aspect_ratio,'auto');
});

test('unsupported resolution, ratio, batch and reference count are rejected before any billable POST',async()=>{
 for(const changes of [{resolution:'4K'},{aspectRatio:'21:9'},{count:2},{references:Array(4).fill('https://example.com/reference.png')}]){
  const fixture=adapter();
  await assert.rejects(fixture.providers.submit(input(changes),new AbortController().signal),(error:unknown)=>error instanceof HttpError&&error.status===400);
  assert.equal(fixture.submissions().length,0);
 }
});

test('fixed output models omit automatic dimensions but reject explicit unsupported tiers or references',async()=>{
 const fixture=adapter({...model,supported_parameters:{}});
 await fixture.providers.submit(input({resolution:'1k'}),new AbortController().signal);
 assert.deepEqual(fixture.submissions()[0].body,{model:model.id,prompt:'Synthetic fixture'});
 for(const changes of [{resolution:'2K'},{resolution:'1K',count:2},{resolution:'1K',references:['https://example.com/reference.png']}]){
  await assert.rejects(fixture.providers.submit(input(changes),new AbortController().signal),(error:unknown)=>error instanceof HttpError&&error.status===400);
 }
 assert.equal(fixture.submissions().length,1);
});

test('required references and incompatible output format fail before generation',async()=>{
 for(const supported_parameters of [{...descriptors,input_references:{type:'range',min:1,max:1}},{...descriptors,output_format:{type:'enum',values:['svg']}}]){
  const fixture=adapter({...model,supported_parameters});
  await assert.rejects(fixture.providers.submit(input(),new AbortController().signal),HttpError);
  assert.equal(fixture.submissions().length,0);
 }
});

test('Nano Banana Pro preview and GA preserve 2K and omit unsupported image options',async()=>{
 for(const id of ['google/gemini-3-pro-image-preview','google/gemini-3-pro-image']){
  const entry={id,name:'Google: Nano Banana Pro',supported_parameters:{resolution:{type:'enum',values:['1K','2K','4K']},aspect_ratio:{type:'enum',values:['1:1','2:1','1:2','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9']},n:{type:'range',min:1,max:1},input_references:{type:'range',min:0,max:14}}};
  const fixture=adapter(entry);
  await fixture.providers.submit(input({model:id,resolution:'2k'}),new AbortController().signal);
  assert.deepEqual(fixture.submissions()[0].body,{model:id,prompt:'Synthetic fixture',resolution:'2K',aspect_ratio:'4:3',n:1});
  for(const changes of [{aspectRatio:'auto'},{count:2}])await assert.rejects(fixture.providers.submit(input({model:id,...changes}),new AbortController().signal),HttpError);
  assert.equal(fixture.submissions().length,1);
 }
});

test('JPEG-only and WebP-only models choose their documented raster format',async()=>{
 for(const format of ['jpeg','webp']){
  const fixture=adapter({...model,supported_parameters:{...descriptors,output_format:{type:'enum',values:[format]}}});
  await fixture.providers.submit(input(),new AbortController().signal);
  assert.equal(fixture.submissions()[0].body?.output_format,format);
 }
});

test('legacy arrays and unavailable discovery preserve compatibility without inventing descriptor constraints',async()=>{
 const legacy=describeOpenRouter({supported_parameters:['resolution'],supported_resolutions:['1K','2K'],supported_aspect_ratios:['4:3']});
 assert.equal(legacy.parameters,undefined);
 assert.equal(buildOpenRouterInput(input(),legacy.parameters,legacy.capabilities).resolution,'2K');
 assert.throws(()=>buildOpenRouterInput(input({resolution:'4K'}),undefined,legacy.capabilities),HttpError);
 assert.deepEqual(describeOpenRouter({supported_parameters:['resolution']}),{});
 assert.deepEqual(describeOpenRouter({supported_parameters:{resolution:{type:'future-descriptor'}}}),{});
 let submissions=0;
 const providers=new Providers({header:()=> 'Bearer synthetic-only'},async(url,init)=>{
  if(String(url).endsWith('/images/models'))throw new TypeError('Synthetic catalog outage');
  submissions++;assert.equal(JSON.parse(String(init?.body)).resolution,'2K');return Response.json({data:[]});
 });
 await providers.submit(input(),new AbortController().signal);assert.equal(submissions,1);
});

test('aborted discovery never proceeds to a generation POST',async()=>{
 const controller=new AbortController();let submissions=0;
 const providers=new Providers({header:()=> 'Bearer synthetic-only'},async(url)=>{
  if(String(url).endsWith('/images/models')){controller.abort();return Response.json({data:[model]});}
  submissions++;return Response.json({data:[]});
 });
 await assert.rejects(providers.submit(input(),controller.signal),{name:'AbortError'});
 assert.equal(submissions,0);
});

test('video catalog audio support and first/last-frame references become native request parameters',()=>{
 const catalog=describeOpenRouter({generate_audio:true,supported_resolutions:['720p'],supported_aspect_ratios:['16:9'],supported_durations:[5,10],supported_frame_images:['first_frame','last_frame']});
 assert.equal(catalog.capabilities?.audio,true);
 for(const generateAudio of [true,false]){
  const result=buildOpenRouterInput(input({kind:'video',resolution:'720p',aspectRatio:'16:9',duration:10,count:1,generateAudio,references:['https://example.com/first.png','https://example.com/last.png']}),undefined,catalog.capabilities);
  assert.equal(result.generate_audio,generateAudio);
  assert.deepEqual(result.frame_images,[{type:'image_url',image_url:{url:'https://example.com/first.png'},frame_type:'first_frame'},{type:'image_url',image_url:{url:'https://example.com/last.png'},frame_type:'last_frame'}]);
  assert.equal('input_references' in result,false);
 }
 const silent=describeOpenRouter({generate_audio:false});
 assert.equal(silent.capabilities?.audio,false);
 assert.equal('generate_audio' in buildOpenRouterInput(input({kind:'video',generateAudio:true}),undefined,silent.capabilities),false);
 const descriptor=describeOpenRouter({supported_parameters:{generate_audio:{type:'boolean'}}});
 assert.equal(buildOpenRouterInput(input({kind:'video',resolution:'1K',generateAudio:false}),descriptor.parameters,descriptor.capabilities).generate_audio,false);
});
