import type {Project} from './project';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identified=(value:unknown):value is Array<Record<string,unknown>&{id:string}>=>Array.isArray(value)&&value.every(item=>record(item)&&typeof item.id==='string');
export function mergeProject(base:Project,local:Project,remote:Project):Project{
 const conflicts:string[]=[];
 function merge(b:unknown,l:unknown,r:unknown,path:string):unknown{
  if(same(l,b))return r;
  if(same(r,b)||same(l,r))return l;
  if(record(b)&&record(l)&&record(r)){const out:Record<string,unknown>={};for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){const value=merge(b[key],l[key],r[key],`${path}.${key}`);if(value!==undefined)out[key]=value;}return out;}
  if(identified(b)&&identified(l)&&identified(r)){const ids=new Set([...r.map(v=>v.id),...l.map(v=>v.id)]);return [...ids].map(id=>merge(b.find(v=>v.id===id),l.find(v=>v.id===id),r.find(v=>v.id===id),`${path}[${id}]`)).filter(v=>v!==undefined);}
  conflicts.push(path);return l;
 }
 const result=merge({...base,revision:0,updatedAt:''},{...local,revision:0,updatedAt:''},{...remote,revision:0,updatedAt:''},'project') as Project;
 if(conflicts.length)throw new Error(`Conflito de edição em ${conflicts.slice(0,3).join(', ')}. Seu rascunho foi preservado; exporte antes de recarregar.`);
 return {...result,revision:remote.revision,updatedAt:remote.updatedAt};
}
