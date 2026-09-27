import {mkdir,lstat,readdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {z} from 'zod';
import {generationSchema} from './providers.js';
import type {GenerationJob} from './jobs.js';

const jobSchema=z.object({
 version:z.literal(1),id:z.string().uuid(),createdAt:z.string().datetime(),
 status:z.enum(['queued','running','complete','error','cancelled']),
 request:generationSchema,remoteId:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(),
 outputs:z.array(z.string().max(12000)).max(4),materialized:z.boolean().optional(),error:z.string().max(1000).optional(),
});
export type SavedJob=z.infer<typeof jobSchema>;

export class JobJournal{
 private writes=new Map<string,Promise<void>>();
 constructor(readonly directory:string){}
 async load():Promise<SavedJob[]>{
  await mkdir(this.directory,{recursive:true,mode:0o700});
  const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Invalid generation journal directory');
  const names=(await readdir(this.directory)).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name));
  const records:SavedJob[]=[];
  for(const name of names.slice(-200)){
   try{const path=join(this.directory,name),entry=await lstat(path);if(!entry.isFile()||entry.isSymbolicLink()||entry.size>262144)continue;
    const record=jobSchema.parse(JSON.parse(await readFile(path,'utf8')));if(`${record.id}.json`!==name)continue;
    record.request.references=[];records.push(record);
   }catch{/* A damaged record never resubmits a potentially billable request. */}
  }
  return records;
 }
 save(job:GenerationJob):Promise<void>{
  const record=jobSchema.parse({version:1,id:job.id,createdAt:job.createdAt,status:job.status,request:{...job.request,references:[]},remoteId:job.remoteId,outputs:job.outputs,materialized:job.materialized,error:job.error});
  const text=JSON.stringify(record);if(Buffer.byteLength(text)>262144)throw new Error('Generation journal record exceeds its limit');
  const previous=this.writes.get(job.id)??Promise.resolve();
  const pending=previous.catch(()=>{}).then(async()=>{
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const path=join(this.directory,`${job.id}.json`),temporary=join(this.directory,`.${job.id}-${randomUUID()}.tmp`);
   try{
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(text);await file.sync();}finally{await file.close();}
    await rename(temporary,path);
   }finally{await unlink(temporary).catch(()=>{});}
  });
  this.writes.set(job.id,pending);return pending.finally(()=>{if(this.writes.get(job.id)===pending)this.writes.delete(job.id);});
 }
 async migrateLegacy(action:()=>Promise<void>){
  const marker=join(this.directory,'legacy-outputs-v1.json');
  try{await lstat(marker);return;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await action();const file=await open(marker,'wx',0o600);try{await file.writeFile('{"complete":true}');await file.sync();}finally{await file.close();}
 }

 async remove(id:string){if(!z.string().uuid().safeParse(id).success)return;await this.writes.get(id)?.catch(()=>{});await unlink(join(this.directory,`${id}.json`)).catch(()=>{});}
}
