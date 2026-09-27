import type {GenerationRequest} from './providers.js';
import {HttpError} from './errors.js';

type Descriptor = {type:'enum';values:(string|number)[]} | {type:'range';min:number;max:number} | {type:'boolean'};
export type OpenRouterParameters = Record<string,Descriptor>;
type Capabilities = {aspectRatios?:string[];resolutions?:string[];counts?:number[];durations?:number[];referenceFields?:string[];requiredInputs?:string[]};
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];

// The image API uses descriptors, not the general chat API's parameter-name array.
export function describeOpenRouter(item:Record<string,unknown>):{capabilities?:Capabilities;parameters?:OpenRouterParameters}{
 let parameters:OpenRouterParameters|undefined;
 if(record(item.supported_parameters)){
  const parsed:OpenRouterParameters={};let valid=true;
  for(const [key,value] of Object.entries(item.supported_parameters)){
   if(!record(value)){valid=false;break;}
   if(value.type==='enum'&&Array.isArray(value.values)&&value.values.length&&value.values.every(option=>typeof option==='string'||typeof option==='number'&&Number.isFinite(option)))parsed[key]={type:'enum',values:value.values};
   else if(value.type==='range'&&typeof value.min==='number'&&typeof value.max==='number'&&Number.isFinite(value.min)&&Number.isFinite(value.max)&&value.min<=value.max)parsed[key]={type:'range',min:value.min,max:value.max};
   else if(value.type==='boolean')parsed[key]={type:'boolean'};
   else{valid=false;break;}
  }
  if(valid)parameters=parsed;
 }
 if(parameters){
  const options=(key:string)=>parameters[key]?.type==='enum'?strings(parameters[key].values):[];
  const numbers=(key:string,max:number)=>{
   const value=parameters[key];
   if(value?.type==='range')return Array.from({length:max},(_,index)=>index+1).filter(number=>number>=value.min&&number<=value.max);
   if(value?.type==='enum')return value.values.map(Number).filter(number=>Number.isInteger(number)&&number>=1&&number<=max);
   return [];
  };
  const references=parameters.input_references;
  const acceptsReferences=Boolean(references&&(references.type!=='range'||references.max>0));
  return{parameters,capabilities:{aspectRatios:options('aspect_ratio'),resolutions:options('resolution'),counts:parameters.n?numbers('n',4):[1],...(parameters.duration?{durations:numbers('duration',30)}:{}),referenceFields:acceptsReferences?['input_references']:[],requiredInputs:references?.type==='range'&&references.min>0?['input_references']:[]}};
 }
 // Older catalogs still expose these arrays. A string[] of parameter names alone
 // cannot be used to infer allowable values or unsupported fields.
 const aspectRatios=strings(item.supported_aspect_ratios),resolutions=strings(item.supported_resolutions);
 const durations=Array.isArray(item.supported_durations)?item.supported_durations.filter(value=>typeof value==='number'||typeof value==='string').map(Number).filter(value=>Number.isFinite(value)&&value>0):[];
 const capabilities={...(aspectRatios.length?{aspectRatios}:{}),...(resolutions.length?{resolutions}:{}),...(durations.length?{durations}:{})};
 return Object.keys(capabilities).length?{capabilities}:{};
}

const normalizedResolution=(value:string)=>/^(?:1|2|4)k$/i.test(value)?value.toUpperCase():value;
const invalid=(message:string,code='invalid_model_input'):never=>{throw new HttpError(400,message,code);};
function canonical(descriptor:Descriptor|undefined,value:string|number,message:string){
 if(descriptor?.type==='enum'){
  const choice=descriptor.values.find(option=>typeof option==='string'&&typeof value==='string'?option.toLowerCase()===value.toLowerCase():option===value);
  if(choice===undefined)return invalid(message);
  return choice;
 }
 if(descriptor?.type==='range'&&(typeof value!=='number'||!Number.isInteger(value)||value<descriptor.min||value>descriptor.max))return invalid(message);
 return value;
}

export function buildOpenRouterInput(input:GenerationRequest,parameters?:OpenRouterParameters,capabilities?:Capabilities){
 const body:Record<string,unknown>={model:input.model,prompt:input.prompt};
 const references=input.references.map(url=>({type:'image_url',image_url:{url}}));
 const resolution=normalizedResolution(input.resolution);
 const invalidResolution='Esta resolução não é aceita pelo modelo selecionado. Escolha uma resolução disponível.';
 const invalidAspect='Esta proporção não é aceita pelo modelo selecionado. Escolha uma proporção disponível.';
 if(parameters){
  if(parameters.resolution)body.resolution=canonical(parameters.resolution,resolution,invalidResolution);
  else if(resolution!=='1K')invalid(invalidResolution);
  // Models with a fixed output size have no dimension controls. 1K is the
  // editor's legacy automatic value, so omit it rather than inventing a tier.
  if(parameters.aspect_ratio)body.aspect_ratio=canonical(parameters.aspect_ratio,input.aspectRatio,invalidAspect);
  if(input.kind==='image'){
   if(parameters.n)body.n=canonical(parameters.n,input.count,'Esta quantidade de imagens não é aceita pelo modelo selecionado.');
   else if(input.count!==1)invalid('Este modelo gera uma saída por solicitação.','unsupported_count');
   if(parameters.output_format){
    const descriptor=parameters.output_format;
    const format=descriptor.type==='enum'?['png','jpeg','jpg','webp'].map(preferred=>descriptor.values.find(value=>typeof value==='string'&&value.toLowerCase()===preferred)).find(value=>value!==undefined):'png';
    if(format===undefined)invalid('Este modelo não oferece uma saída PNG, JPEG ou WebP compatível com o editor.');
    body.output_format=format;
   }
  }else if(parameters.duration)body.duration=canonical(parameters.duration,input.duration??5,'Esta duração não é aceita pelo modelo selecionado.');
  if(parameters.input_references){
   canonical(parameters.input_references,references.length,'A quantidade de referências não é aceita pelo modelo selecionado.');
   if(references.length)body.input_references=references;
  }else if(references.length)invalid('Este modelo não aceita referências de imagem.','unsupported_references');
  return body;
 }
 const enumFor=(values?:string[]):Descriptor|undefined=>values?.length?{type:'enum',values}:undefined;
 body.resolution=canonical(enumFor(capabilities?.resolutions),resolution,invalidResolution);
 body.aspect_ratio=canonical(enumFor(capabilities?.aspectRatios),input.aspectRatio,invalidAspect);
 if(input.kind==='image'){body.n=input.count;body.output_format='png';}
 else body.duration=canonical(capabilities?.durations?.length?{type:'enum',values:capabilities.durations}:undefined,input.duration??5,'Esta duração não é aceita pelo modelo selecionado.');
 if(references.length)body.input_references=references;
 return body;
}
