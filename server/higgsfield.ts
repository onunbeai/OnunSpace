import {Ajv2020, type ValidateFunction} from 'ajv/dist/2020.js';
import {readFileSync} from 'node:fs';
import {HttpError} from './errors.js';

type Json = Record<string, any>;
export interface HiggsfieldEntry {id:string;name:string;kind:'image'|'video';sourceUrl:string;schema:Json;canonicalId?:string;family?:string}
const validators=new WeakMap<Json,ValidateFunction>();
const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:false,allowUnionTypes:true});
const imageArrays=['image_urls','reference_image_urls','reference_images','input_images'];
const imageSingles=['image_url','image','input_image','reference_image','image_reference_url','start_image_url','first_frame_url','first_frame_image','end_image_url','last_frame_url','last_frame_image','last_image_url'];
const basicInputs=new Set(['prompt','aspect_ratio','resolution','duration','num_images','num_outputs','n','batch_size','generate_audio','sound']);
const docsOrigin='https://docs.higgsfield.ai';


function property(schema:Json):Json {const variants=schema.anyOf??schema.oneOf;return Array.isArray(variants)?{...schema,...variants.find(item=>item.type!=='null')}:schema;}
function validator(schema:Json){let result=validators.get(schema);if(!result){result=ajv.compile(schema);validators.set(schema,result);}return result;}
function strings(value:unknown):string[]{return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}
function defaultValue(schema:Json){return schema.const!==undefined?schema.const:schema.default;}
function isImageField(name:string,schema:Json){const p=property(schema);return(imageSingles.includes(name)&&p.type==='string')||(imageArrays.includes(name)&&p.type==='array'&&property(p.items??{}).type==='string');}
export function identity(entry:HiggsfieldEntry){
 if(entry.canonicalId)return entry.canonicalId;
 const [base,...variants]=entry.name.split(' — ');
 const variant=variants.join(' ').replace(/\b(?:text to image|image to image|text to video|image to video|reference to video|generate and edit|generate|edit images?|video edit|video extend|first(?: and)? last frames?|image reference|video reference)\b/gi,'').replace(/[·—]+/g,' ').replace(/\s+/g,' ').trim();
 return [entry.family??base,variant].filter(Boolean).join(' ').replace(/\s+API$/i,'').trim();
}

function requirements(schema:Json,referenceFields:string[]){
 const required=new Set(strings(schema.required));
 const defaults=Object.fromEntries(Object.entries(schema.properties??{}).map(([name,p])=>[name,defaultValue(property(p as Json))]).filter(([,value])=>value!==undefined));
 const visit=(part:Json)=>{
  if(part.if){
   const imageAlternative=strings(part.if.required).filter(name=>referenceFields.includes(name));
   if(imageAlternative.length&&part.else)for(const name of imageAlternative)required.add(name);
   else{const branch=validator(part.if)(defaults)?part.then:part.else;if(branch){for(const name of strings(branch.required))required.add(name);visit(branch);}}
  }
  if(Array.isArray(part.allOf))for(const child of part.allOf)visit(child);
 };
 visit(schema);return[...required];
}
function audioControl(properties:Record<string,Json>){
 if(property(properties.generate_audio??{}).type==='boolean')return{field:'generate_audio',on:true,off:false};
 const sound=property(properties.sound??{});
 if(sound.enum?.includes('on')&&sound.enum.includes('off'))return{field:'sound',on:'on',off:'off'};
 return undefined;
}
export function describeHiggsfield(entry:HiggsfieldEntry){
 const properties=(entry.schema?.properties??{})as Record<string,Json>;const referenceFields=Object.keys(properties).filter(name=>isImageField(name,properties[name]));
 let requiredInputs=strings(entry.schema?.required);let unavailableReason:string|undefined;
 try{requiredInputs=requirements(entry.schema,referenceFields);validator(entry.schema);}catch{unavailableReason='O schema oficial deste modelo ainda não está disponível.';}
 const unsupported=requiredInputs.filter(name=>!basicInputs.has(name)&&!referenceFields.includes(name)&&defaultValue(property(properties[name]??{}))===undefined);
 if(unsupported.length)unavailableReason='Este fluxo exige entradas que o editor ainda não oferece.';
 if(/(?:\/train(?:ing)?|soul-id)/i.test(entry.id))unavailableReason='Este fluxo é de treinamento, não de geração de mídia.';
 if(!entry.schema?.properties)unavailableReason='O schema oficial deste modelo ainda não está disponível.';
 const values=(field:string)=>property(properties[field]??{}).enum??[];
 const countField=['num_images','num_outputs','n','batch_size'].find(name=>properties[name]);const countSchema=property(properties[countField??'']??{});const durationSchema=property(properties.duration??{});
 const audioField=entry.kind==='video'?audioControl(properties):undefined;const audio=!!audioField;
 const defaults={...(audio?{generateAudio:defaultValue(property(properties[audioField!.field]))===undefined?true:defaultValue(property(properties[audioField!.field]))===audioField!.on}:{}),aspectRatio:defaultValue(property(properties.aspect_ratio??{})),resolution:defaultValue(property(properties.resolution??{})),duration:defaultValue(durationSchema)!==undefined?Number(defaultValue(durationSchema)):undefined,count:countField?defaultValue(countSchema)??1:1};
 const counts=countField?(Array.isArray(countSchema.enum)?countSchema.enum.filter((n:unknown)=>typeof n==='number'&&n>=1&&n<=4):[1,2,3,4].filter(n=>n>=(countSchema.minimum??1)&&n<=(countSchema.maximum??4))):[1];
 return{id:entry.id,name:entry.name,provider:'higgsfield' as const,kind:entry.kind,canonicalId:identity(entry),supported:!unavailableReason,...(unavailableReason?{unavailableReason}:{}),capabilities:{...(entry.kind==='video'?{audio}:{}),requiredInputs,referenceFields,aspectRatios:values('aspect_ratio'),resolutions:values('resolution'),durations:values('duration').map(Number).filter(Number.isFinite),durationRange:properties.duration?{min:durationSchema.minimum,max:durationSchema.maximum}:undefined,counts,defaults,sourceUrl:entry.sourceUrl}};
}

function preferred(schema:Json,value:unknown,field:string){const p=property(schema);const choices=Array.isArray(p.enum)?p.enum:undefined;let candidate=value;
 if(p.type==='string'&&typeof candidate==='number')candidate=String(candidate);
 if(choices){const match=choices.find(item=>typeof item==='string'&&typeof candidate==='string'?item.toLowerCase()===candidate.toLowerCase():item===candidate);if(match!==undefined)return match;
  // 1K is the legacy editor's automatic size. Other explicit values must pass
  // the official schema; never silently downgrade a requested paid output.
  if(field==='resolution'&&String(candidate).toLowerCase()==='1k'&&defaultValue(p)!==undefined)return defaultValue(p);
 }
 return candidate;
}

export function buildHiggsfieldInput(entry:HiggsfieldEntry,input:{prompt:string;aspectRatio:string;resolution:string;duration?:number;generateAudio?:boolean;count:number;references:string[]}){
 const description=describeHiggsfield(entry);if(!description.supported)throw new HttpError(400,description.unavailableReason!,'unsupported_model');
 const properties=entry.schema.properties as Record<string,Json>;const body:Json={};
 for(const[name,schema]of Object.entries(properties)){const value=defaultValue(property(schema));if(value!==undefined)body[name]=structuredClone(value);}
 const proposed:Json={prompt:input.prompt,aspect_ratio:input.aspectRatio,resolution:input.resolution,duration:input.duration,num_images:input.count,num_outputs:input.count,n:input.count,batch_size:input.count};
 for(const[name,value]of Object.entries(proposed))if(value!==undefined&&properties[name]){const selected=preferred(properties[name],value,name);if(selected!==undefined)body[name]=selected;}
 const audio=entry.kind==='video'?audioControl(properties):undefined;
 if(audio&&input.generateAudio!==undefined)body[audio.field]=input.generateAudio?audio.on:audio.off;
 const fields=description.capabilities.referenceFields;
 if(input.count>1&&!['num_images','num_outputs','n','batch_size'].some(name=>properties[name]))throw new HttpError(400,'Este modelo gera uma saída por solicitação.','unsupported_count');
 if(!input.references.length&&description.capabilities.requiredInputs.some(name=>fields.includes(name)))throw new HttpError(400,'Conecte uma referência de imagem para usar este modelo.','missing_references');
 if(input.references.length){
  const array=imageArrays.find(name=>fields.includes(name));
  if(array)body[array]=input.references;
  else{const first=imageSingles.find(name=>fields.includes(name)&&!/(?:end|last)/.test(name));const last=imageSingles.find(name=>fields.includes(name)&&/(?:end|last)/.test(name));
   if(!first||input.references.length>(last?2:1))throw new HttpError(400,'Este fluxo não aceita esta quantidade de referências.','unsupported_references');
   body[first]=input.references[0];if(last&&input.references[1])body[last]=input.references[1];
  }
 }
 const validate=validator(entry.schema);if(!validate(body)){
  const missing=(validate.errors??[]).filter(error=>error.keyword==='required').map(error=>String(error.params.missingProperty));
  if(missing.some(name=>fields.includes(name)))throw new HttpError(400,'Conecte uma referência de imagem para usar este modelo.','missing_references');
  throw new HttpError(400,'As opções ou referências não atendem ao schema deste modelo.','invalid_model_input');
 }
 return body;
}

export function selectHiggsfield(entries:HiggsfieldEntry[],id:string,kind:'image'|'video',references:number|boolean){
 const selected=entries.find(entry=>entry.id===id&&entry.kind===kind);if(!selected)throw new HttpError(400,'Selecione um modelo do catálogo Higgsfield.','unsupported_model');
 const initial=describeHiggsfield(selected);if(!initial.supported)throw new HttpError(400,initial.unavailableReason!,'unsupported_model');
 const count=typeof references==='number'?references:references?1:0;
 const suitable=(entry:HiggsfieldEntry)=>{
  const info=describeHiggsfield(entry);if(!info.supported)return false;
  const fields=info.capabilities.referenceFields;
  if(!count)return!info.capabilities.requiredInputs.some(name=>fields.includes(name));
  const array=imageArrays.find(name=>fields.includes(name));
  if(array){const p=property(entry.schema.properties[array]);return count>=(p.minItems??0)&&count<=(p.maxItems??Infinity);}
  const first=imageSingles.some(name=>fields.includes(name)&&!/(?:end|last)/.test(name));const last=imageSingles.some(name=>fields.includes(name)&&/(?:end|last)/.test(name));
  return first&&count<=(last?2:1);
 };
 if(suitable(selected))return selected;
 return entries.find(entry=>entry.kind===kind&&identity(entry)===identity(selected)&&suitable(entry))??selected;
}

// The documented snapshot is reviewed as a unit. Never replace it with a partial
// crawl of documentation navigation links, which can cross model categories.
export class HiggsfieldCatalog{
 private cache:{entries:HiggsfieldEntry[];source:'cached';verifiedAt:string};
 constructor(seed?:HiggsfieldEntry[]){
  const snapshot=seed?{models:seed,verifiedAt:new Date().toISOString()}:JSON.parse(readFileSync(new URL('./higgsfield-catalog.json',import.meta.url),'utf8'));
  const entries=snapshot.models as HiggsfieldEntry[];
  if(!Array.isArray(entries)||new Set(entries.map(entry=>entry.id)).size!==entries.length||entries.some(entry=>!entry.schema?.properties||!['image','video'].includes(entry.kind)))throw new Error('Invalid Higgsfield catalog snapshot');
  this.cache={entries,source:'cached',verifiedAt:snapshot.verifiedAt};
 }
 async entries(){return this.cache;}
 async models(kind:'image'|'video'|'motion'){return{models:this.cache.entries.filter(entry=>entry.kind===kind).map(describeHiggsfield),source:this.cache.source,verifiedAt:this.cache.verifiedAt,sourceUrl:docsOrigin+'/docs/models',scope:'public-documentation'};}
}
