import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {CanvasNode,Project} from '../shared/project.js';
import {placeCanvasNode} from '../shared/canvasLayout.js';
import {JobJournal} from './jobJournal.js';
import { validateMotionScene } from '../shared/motion.js';
import { HttpError } from './errors.js';
import { generationSchema, type GenerationRequest, Providers } from './providers.js';
import { ProjectStore } from './store.js';

export function rasterOutput(bytes:Uint8Array,declaredType?:string){
 const at=(offset:number,value:string)=>[...value].every((character,index)=>bytes[offset+index]===character.charCodeAt(0));
 const actual=[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)?{contentType:'image/png',extension:'png'}
  :bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?{contentType:'image/jpeg',extension:'jpg'}
  :bytes.length>=20&&at(0,'RIFF')&&at(8,'WEBP')&&['VP8 ','VP8L','VP8X'].some(chunk=>at(12,chunk))?{contentType:'image/webp',extension:'webp'}:undefined;
 const mime=declaredType?.split(';')[0].trim().toLowerCase().replace(/^image\/jpg$/,'image/jpeg');
 if(mime&&!['image/png','image/jpeg','image/webp'].includes(mime))throw new HttpError(502,'O provedor retornou um formato de imagem não compatível. Use um modelo com saída PNG, JPEG ou WebP.','unsupported_output');
 if(!actual||mime&&mime!==actual.contentType)throw new HttpError(502,'O formato da imagem retornada pelo provedor não corresponde ao arquivo.','invalid_output');
 return actual;
}

export interface GenerationJob {
  id: string;
  kind: GenerationRequest['kind'];
  provider: GenerationRequest['provider'];
  status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
  createdAt: string;
  outputs: string[];
  scene?: ReturnType<typeof validateMotionScene>;
  error?: string;
  remoteId?: string;
  request: GenerationRequest;
  controller: AbortController;
  lastPoll: number;
  materialized?:boolean;
  pollFailures?:number;
  submission?: Promise<void>;
  polling?: Promise<void>;
  cancellation?: Promise<void>;
}

function withOutputs(project:Project,sourceId:string,outputs:string[],request:GenerationRequest,resultKey:string):Project{
 const source=project.nodes.find(node=>node.id===sourceId);const nodes=[...project.nodes],edges=[...project.edges];
 for(const [index,media]of outputs.entries()){
  const id=`output-${resultKey}-${index}`;if(nodes.some(node=>node.id===id))continue;
  const suffix=` · ${index+1}`;
  const title=`${(source?.title??(request.kind==='video'?'Video':'Image')).slice(0,200-suffix.length)}${suffix}`;
  const candidate:CanvasNode={id,kind:request.kind==='video'?'video':'image',title,generatedFrom:sourceId,media,x:0,y:0,width:285,prompt:request.prompt,provider:request.provider,model:request.model,aspectRatio:request.aspectRatio,resolution:request.resolution,count:1,status:'none',generationStatus:'complete'};
  nodes.push(placeCanvasNode(candidate,nodes,sourceId));
  if(source)edges.push({id:`edge-${resultKey}-${index}`,source:sourceId,target:id});
 }
 return{...project,nodes,edges};
}

export class GenerationJobs {
  private jobs = new Map<string, GenerationJob>();
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private journal:JobJournal;
  private ready:Promise<void>;
  private storageUnavailable=false;
  private disposed=false;
  private pollInterval:number;
  private cancelTimeout:number;
  constructor(private providers: Providers, private projects: ProjectStore, readonly assetDirectory: string,options:{pollIntervalMs?:number;cancelTimeoutMs?:number}={}) {
    this.pollInterval=options.pollIntervalMs??15000;
    this.cancelTimeout=options.cancelTimeoutMs??5000;
    this.journal=new JobJournal(join(dirname(assetDirectory),'jobs'));
    this.ready=this.restore().catch(()=>{this.storageUnavailable=true;});
  }

  private async projectIds(){
    const entries=await readdir(this.projects.directory,{withFileTypes:true}).catch(()=>[]);
    return [...new Set(entries.flatMap(entry=>entry.isDirectory()&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(entry.name)?[entry.name]:entry.isFile()&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.json$/.test(entry.name)?[entry.name.slice(0,-5)]:[]))];
  }
  private async restore(){
    const saved=await this.journal.load();
    for(const record of saved){
      const job:GenerationJob={id:record.id,kind:record.request.kind,provider:record.request.provider,status:record.status,createdAt:record.createdAt,outputs:record.outputs,materialized:record.materialized,error:record.error,remoteId:record.remoteId,request:record.request,controller:new AbortController(),lastPoll:0};
      this.jobs.set(job.id,job);
      if(['queued','running'].includes(job.status)){
        if(job.remoteId){job.status='running';this.schedule(job);}
        else{job.status='error';job.error='O acompanhamento foi interrompido antes de receber o identificador remoto. Confira o histórico do provedor antes de gerar novamente.';await this.journal.save(job);await this.updateNode(job).catch(()=>{});}
      }else if(job.status==='complete'&&job.outputs.length&&!job.materialized){await this.updateNode(job).then(()=>{job.materialized=true;return this.journal.save(job);}).catch(()=>{});}
    }
    for(const id of await this.projectIds()){
      const project=await this.projects.get(id).catch(()=>null);if(!project)continue;
      const orphaned=project.nodes.filter(node=>!node.generatedFrom&&node.generationStatus==='running'&&![...this.jobs.values()].some(job=>job.request.projectId===project.id&&job.request.nodeId===node.id&&['queued','running'].includes(job.status)));
      if(orphaned.length)await this.projects.mutate(project.id,current=>({...current,nodes:current.nodes.map(node=>orphaned.some(orphan=>orphan.id===node.id)?{...node,generationStatus:'error',error:'O acompanhamento local desta geração foi perdido. Consulte o histórico do provedor antes de gerar novamente.'}:node)})).catch(()=>{});
    }
    // Upgrade already completed generations from the earlier single-card UI.
    await this.journal.migrateLegacy(async()=>{for(const id of await this.projectIds()){
      const project=await this.projects.get(id).catch(()=>null);if(!project)continue;
      const sources=project.nodes.filter(node=>!node.generatedFrom&&node.generationStatus==='complete'&&node.outputs?.some(media=>!project.nodes.some(result=>result.generatedFrom===node.id&&result.media===media))); 
      if(!sources.length)continue;
      await this.projects.mutate(project.id,current=>{
        let next:Project=current;
        for(const source of sources){
          for(const [index,media]of (source.outputs??[]).entries()){
            if(next.nodes.some(node=>node.generatedFrom===source.id&&node.media===media))continue;
            const key='legacy-'+createHash('sha256').update(`${project.id}\0${source.id}\0${index}\0${media}`).digest('hex').slice(0,24);
            const parsed=generationSchema.safeParse({...source,kind:source.kind==='video'?'video':'image',projectId:project.id,nodeId:source.id,prompt:source.prompt||'Generated output'});if(!parsed.success)continue;
            next=withOutputs(next,source.id,[media],parsed.data,key);
          }
        }
        return next;
      }).catch(()=>{});
    }}).catch(()=>{});
  }

  private schedule(job:GenerationJob){
    if(this.disposed||job.status!=='running'||!job.remoteId||this.timers.has(job.id))return;
    const timer=setTimeout(()=>{this.timers.delete(job.id);void this.pollJob(job);},Math.min(60000,this.pollInterval*2**Math.min(job.pollFailures??0,4)));timer.unref();this.timers.set(job.id,timer);
  }
  private async pollJob(job:GenerationJob){
    if(this.disposed||job.status!=='running'||!job.remoteId||job.submission||job.polling)return;
    job.lastPoll=Date.now();
    job.polling=(async()=>{
      try{
        const result=await this.providers.poll(job.provider,job.remoteId!,job.controller.signal);
        if(this.isActive(job)){
          await this.applyRemote(job,result);
          if(this.isCancelled(job)||job.controller.signal.aborted)return;
          job.pollFailures=0;job.error=undefined;
          if(job.status==='running'&&Date.now()-Date.parse(job.createdAt)>1800000)throw new HttpError(408,'Tempo de acompanhamento encerrado. Consulte o resultado na conta do provedor.','poll_timeout');
          await this.journal.save(job);await this.updateNode(job);if(job.status==='complete'){job.materialized=true;await this.journal.save(job);}
        }
      }catch(error){
        if(!this.isActive(job))return;
        const transient=error instanceof HttpError?(['provider_error','provider_invalid_response','download_failed'].includes(error.code)&&(error.status===429||error.status>=500)):error instanceof Error&&['TimeoutError','AbortError','TypeError'].includes(error.name);
        if(transient&&Date.now()-Date.parse(job.createdAt)<=1800000){job.pollFailures=(job.pollFailures??0)+1;job.error='O provedor demorou para responder. O acompanhamento continuará automaticamente.';await this.journal.save(job).catch(()=>{});}
        else await this.fail(job,error);
      }
    })();
    await job.polling;job.polling=undefined;this.schedule(job);
  }
  async dispose(){
    this.disposed=true;await this.ready;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();
    for(const job of this.jobs.values())job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].flatMap(job=>[job.submission,job.polling].filter((item):item is Promise<void>=>!!item)));
  }

  public(job: GenerationJob) {
    return { id: job.id, projectId:job.request.projectId, nodeId:job.request.nodeId, kind: job.kind, provider: job.provider, status: job.status, createdAt: job.createdAt, outputs: job.outputs, ...(job.error ? { error: job.error } : {}), ...(job.scene ? { scene: job.scene } : {}) };
  }

  async create(request: GenerationRequest) {
    await this.ready;if(this.storageUnavailable)throw new HttpError(500,'Não foi possível abrir o histórico local de gerações.','generation_storage_unavailable');
    this.providers.assertConfigured(request.provider);
    if (request.projectId) {
      const project = await this.projects.get(request.projectId);
      if (request.nodeId && !project.nodes.some(node => node.id === request.nodeId)) throw new HttpError(404, 'Nó não encontrado.', 'node_not_found');
    }
    if (request.requestId) {
      const existing = this.jobs.get(request.requestId);
      if (existing) return this.public(existing);
    }
    request = { ...request, references: await Promise.all(request.references.map(async reference => {
      if (!reference.startsWith('/api/')) return reference;
      const match = /^\/api\/(?:projects\/([a-zA-Z0-9_-]+)\/)?assets\/([a-zA-Z0-9_-]+\.(?:png|jpe?g|webp))$/.exec(reference);
      if (!match) throw new HttpError(400, 'Referência local inválida.', 'invalid_reference');
      if (match[1]) await this.projects.get(match[1]);
      const name = match[2];
      const directory = match[1] ? join(this.projects.projectDirectory(match[1]), 'assets') : this.assetDirectory;
      const path = join(directory, name);
      const info = await lstat(path).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink() || info.size > 9_000_000 || (await realpath(path)) !== join(await realpath(directory), name)) throw new HttpError(400, 'Referência não encontrada ou maior que 9 MB.', 'invalid_reference');
      const mime = /\.jpe?g$/.test(name) ? 'jpeg' : name.endsWith('.webp') ? 'webp' : 'png';
      return `data:image/${mime};base64,${(await readFile(path)).toString('base64')}`;
    })) };
    if ([...this.jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 4) throw new HttpError(429, 'Há quatro gerações ativas. Aguarde antes de iniciar outra.', 'queue_full');
    if (this.jobs.size >= 200) {
      const completed = [...this.jobs.values()].find(job => !['queued', 'running'].includes(job.status));
      if (completed) {this.jobs.delete(completed.id);await this.journal.remove(completed.id);}
    }
    const job: GenerationJob = { id: request.requestId ?? randomUUID(), provider: request.provider, kind: request.kind, request, status: 'queued', createdAt: new Date().toISOString(), outputs: [], controller: new AbortController(), lastPoll: 0 };
    await this.journal.save(job);
    this.jobs.set(job.id, job);
    job.submission = this.run(job).finally(() => { job.submission = undefined;this.schedule(job); });
    return this.public(job);
  }

  private async updateNode(job: GenerationJob) {
    if (!job.request.projectId) return;
    await this.projects.mutate(job.request.projectId, project => {
      const updated:Project={...project,...(job.scene?{motion:job.scene}:{}),nodes:project.nodes.map(node=>node.id===job.request.nodeId?{...node,generationStatus:job.status==='complete'?'complete':job.status==='error'?'error':job.status==='cancelled'?'idle':'running',...(job.outputs.length?{media:job.outputs[0],outputs:job.outputs}:{}),...(job.error?{error:job.error}:{error:undefined})}:node)};
      return job.status==='complete'&&job.outputs.length&&job.request.nodeId?withOutputs(updated,job.request.nodeId,job.outputs,job.request,job.id):updated;
    });
  }

  private async run(job: GenerationJob) {
    try {
      job.status = 'running';
      await this.updateNode(job);
      if(!this.isActive(job))return;
      const result = await this.providers.submit(job.request, job.controller.signal);
      // Keep the single in-flight Higgsfield submission long enough to receive its ID.
      // Cancelling tracking must not lose the only way to request a remote cancellation.
      if(this.isCancelled(job)&&job.provider==='higgsfield'){
        const remoteId=String(result.request_id??result.id??'');
        if(/^[a-zA-Z0-9_-]{1,200}$/.test(remoteId)){
          job.remoteId=remoteId;
          this.cancelRemote(job);
          await this.journal.save(job);
        }
        job.controller.abort();
        return;
      }
      if (!this.isActive(job)) return;
      if (job.kind === 'motion') {
        const choices = result.choices as { message?: { content?: string } }[] | undefined;
        const content = choices?.[0]?.message?.content;
        if (!content) throw new HttpError(502, 'O modelo não retornou uma cena.', 'invalid_scene');
        job.scene = validateMotionScene(JSON.parse(content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
        job.status = 'complete';
      } else if (job.provider === 'openrouter' && job.kind === 'image') {
        const data = result.data as { b64_json?: string; media_type?: string }[] | undefined;
        if (!data?.length) throw new HttpError(502, 'O provedor não retornou imagens.', 'missing_output');
        await mkdir(this.assetDirectory, { recursive: true, mode: 0o700 });
        const outputs:string[]=[];
        for (const [index, item] of data.slice(0, 4).entries()) {
          if(!this.isActive(job))return;
          if (!item.b64_json || !/^[A-Za-z0-9+/=\s]+$/.test(item.b64_json)) throw new HttpError(502, 'Imagem inválida retornada pelo provedor.', 'invalid_output');
          const bytes = Buffer.from(item.b64_json, 'base64');
          const output=rasterOutput(bytes,item.media_type);
          const filename = `${job.id}-${index}.${output.extension}`;
          await writeFile(join(this.assetDirectory, filename), bytes, { mode: 0o600 });
          outputs.push(`/api/assets/${filename}`);
        }
        if(!this.isActive(job))return;
        job.outputs=outputs;
        job.status = 'complete';
      } else {
        job.remoteId = String(result.request_id ?? result.id ?? '');
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(job.remoteId)) throw new HttpError(502, 'O provedor não retornou um identificador válido.', 'invalid_job');
        await this.journal.save(job);
        await this.applyRemote(job, result);
      }
      if(this.isCancelled(job)||job.controller.signal.aborted)return;
      await this.journal.save(job);
      await this.updateNode(job);
      if(job.status==='complete'){job.materialized=true;await this.journal.save(job);}
    } catch (error) { await this.fail(job, error); }
    finally { job.request.references = []; }
  }

  private async fail(job: GenerationJob, error: unknown) {
    if (job.controller.signal.aborted||job.status==='cancelled') return;
    if(job.status==='complete'&&job.outputs.length){
      job.materialized=false;job.error='A geração foi concluída, mas não foi possível atualizar o projeto. O resultado permanece salvo no histórico local.';
      await this.journal.save(job).catch(()=>{});return;
    }
    job.status = 'error';
    job.error = error instanceof HttpError ? error.message : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'O provedor demorou para responder. Confira sua conta antes de tentar novamente.' : 'A geração não pôde ser concluída. Verifique o modelo e tente novamente.';
    await this.journal.save(job).catch(()=>{});
    try { await this.updateNode(job); } catch { job.error = `${job.error} Não foi possível atualizar o projeto.`; }
  }

  private async applyRemote(job: GenerationJob, result: Record<string, unknown>) {
    if(!this.isActive(job))return;
    const status = String(result.status);
    if (['failed', 'nsfw', 'expired', 'cancelled', 'canceled'].includes(status)) throw new HttpError(502, 'O provedor encerrou a geração sem um resultado. Consulte o histórico da sua conta.', 'generation_failed');
    if (status !== 'completed') return;
    let outputs:string[];
    if (job.provider === 'openrouter') {
      const data = await this.providers.videoContent(job.remoteId!, job.controller.signal);
      if(!this.isActive(job))return;
      await mkdir(this.assetDirectory, { recursive: true, mode: 0o700 });
      const filename = `${job.id}.mp4`;
      await writeFile(join(this.assetDirectory, filename), data, { mode: 0o600 });
      outputs = [`/api/assets/${filename}`];
    } else {
      const images = result.images as { url?: string }[] | undefined;
      const video = result.video as { url?: string } | undefined;
      outputs = [...(images ?? []).map(item => item.url), video?.url].filter((url): url is string => typeof url === 'string' && url.startsWith('https://')).slice(0, 4);
      if (!outputs.length) throw new HttpError(502, 'A geração terminou sem mídia disponível.', 'missing_output');
    }
    if(!this.isActive(job))return;
    job.outputs=outputs;
    job.status = 'complete';
  }

  async get(id: string) {
    await this.ready;
    const job=this.jobs.get(id);if(!job)throw new HttpError(404,'Geração não encontrada.','job_not_found');
    if(job.submission&&['complete','error'].includes(job.status))await job.submission;
    if(job.polling&&job.status!=='cancelled')await job.polling;
    return this.public(job);
  }
  async list(projectId?:string){await this.ready;return[...this.jobs.values()].filter(job=>!projectId||job.request.projectId===projectId).map(job=>this.public(job));}

  private isCancelled(job:GenerationJob){return job.status==='cancelled';}

  private isActive(job:GenerationJob){
    return !this.disposed&&!job.controller.signal.aborted&&['queued','running'].includes(job.status);
  }

  private cancelRemote(job:GenerationJob){
    if(this.disposed||job.cancellation||job.provider!=='higgsfield'||!job.remoteId)return;
    const remoteId=job.remoteId;
    job.cancellation=(async()=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        await Promise.race([
          this.providers.cancelHiggsfield(remoteId),
          new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cancellation timeout')),this.cancelTimeout);}),
        ]);
        if(this.disposed||job.status!=='cancelled')return;
        job.error='Acompanhamento cancelado. O pedido de cancelamento foi enviado ao provedor. Confira o status e a cobrança na sua conta.';
      }catch{
        if(this.disposed||job.status!=='cancelled')return;
        job.error='Acompanhamento cancelado. Não foi possível confirmar o cancelamento no provedor; ele pode continuar processando e cobrando esta solicitação.';
      }finally{if(timer)clearTimeout(timer);}
      // Persist the acknowledgement in this job only. A new generation may already
      // be using the same source node by the time the provider responds.
      await this.journal.save(job);
    })().catch(()=>{});
  }

  async cancel(id: string) {
    await this.ready;
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, 'Geração não encontrada.', 'job_not_found');
    // Commit the local terminal state before yielding: poll/download completion cannot win later.
    // A result which already completed is kept and never erased by a late cancel click.
    if (!['queued', 'running'].includes(job.status)) return this.public(job);
    job.status = 'cancelled';
    const timer=this.timers.get(job.id);if(timer)clearTimeout(timer);this.timers.delete(job.id);
    job.error='Acompanhamento cancelado. O provedor pode continuar processando e cobrando esta solicitação.';
    if(job.provider!=='higgsfield'||job.remoteId||!job.submission)job.controller.abort();
    if(!job.submission)job.request.references=[];
    this.cancelRemote(job);
    await this.journal.save(job);
    await this.updateNode(job);
    return this.public(job);
  }
}
