import { z } from 'zod';
import { providerSchema, type Provider } from './credentials.js';
import { HttpError } from './errors.js';
import {HiggsfieldCatalog,buildHiggsfieldInput,selectHiggsfield} from './higgsfield.js';
import {buildOpenRouterInput,describeOpenRouter,type OpenRouterParameters} from './openrouter.js';
import {providerErrorMessage} from './providerErrors.js';

export const generationSchema = z.object({
  provider: providerSchema,
  kind: z.enum(['image', 'video', 'motion']),
  model: z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/).refine(value => !value.includes('..') && !value.includes('://')),
  prompt: z.string().trim().min(1).max(20000),
  aspectRatio: z.string().regex(/^(?:\d{1,2}:\d{1,2}|auto|adaptive)$/).default('16:9'),
  resolution: z.string().max(20).default('1K'),
  duration: z.number().finite().min(1).max(30).optional(),
  count: z.number().int().min(1).max(4).default(1),
  references: z.array(z.string().max(12_000_000).refine(value => /^https:\/\//.test(value) || /^data:image\/(png|jpeg|webp);base64,/.test(value) || /^\/api\/(?:projects\/[a-zA-Z0-9_-]+\/)?assets\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/.test(value))).max(8).default([]),
  projectId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/).optional(),
  nodeId: z.string().max(100).optional(),
  requestId: z.string().uuid().optional(),
});
export type GenerationRequest = z.infer<typeof generationSchema>;
export interface ProviderAuthorization { header(provider: Provider): string }
export type Model = { id: string; name: string; provider: Provider; kind: GenerationRequest['kind']; canonicalId?:string; supported?:boolean; unavailableReason?:string; capabilities?: unknown };
type Json = Record<string, unknown>;

const curatedModels: Model[] = [
  { id: 'openai/gpt-image-1', name: 'GPT Image 1', provider: 'openrouter', kind: 'image' },
  { id: 'bytedance-seed/seedream-4.5', name: 'Seedream 4.5', provider: 'openrouter', kind: 'image' },
  { id: 'google/veo-3.1', name: 'Veo 3.1', provider: 'openrouter', kind: 'video' },
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', provider: 'openrouter', kind: 'motion' },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', provider: 'openrouter', kind: 'motion' },
];

export async function limitedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new HttpError(502, 'A resposta do provedor ultrapassou o limite local.', 'provider_response_too_large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export class Providers {
  private cache = new Map<string, { expires: number; models: Model[] }>();
  private openRouterParameters = new Map<string,OpenRouterParameters>();
  private higgsfield:HiggsfieldCatalog;
  constructor(private credentials: ProviderAuthorization, private request: typeof fetch = fetch) {this.higgsfield=new HiggsfieldCatalog();}

  async json(provider: Provider, path: string, method = 'GET', body?: unknown, signal?: AbortSignal, authenticated = true): Promise<Json> {
    const origin = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.higgsfield.ai';
    const authorization = authenticated ? this.credentials.header(provider) : undefined;
    const response = await this.request(`${origin}${path}`, {
      method, redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}), ...(provider === 'openrouter' ? { 'X-Title': 'Onun Space' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      let errorBody: unknown;
      try { errorBody = JSON.parse((await limitedBody(response, 16_384)).toString('utf8')); } catch { /* Keep the original HTTP status if the error body is invalid or too large. */ }
      const message = providerErrorMessage(provider, response.status, errorBody, authorization);
      throw new HttpError(response.status >= 500 ? 502 : response.status, message, 'provider_error');
    }
    try { const data=await limitedBody(response,60_000_000); if(!data.length&&method==='POST'&&/^\/requests\/[^/]+\/cancel$/.test(path)&&[202,204].includes(response.status))return {}; return JSON.parse(data.toString('utf8')) as Json; }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(502, 'Resposta inválida do provedor.', 'provider_invalid_response'); }
  }

  async models(provider: Provider, kind: GenerationRequest['kind']) {
    if(provider==='higgsfield')return this.higgsfield.models(kind);
    const key = `${provider}:${kind}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return { models: cached.models, source: 'live' };
    if (provider === 'openrouter') {
      try {
        const path = kind === 'image' ? '/images/models' : kind === 'video' ? '/videos/models' : '/models';
        const result = await this.json(provider, path, 'GET', undefined, undefined, false);
        if (!Array.isArray(result.data)) throw new Error('Missing model catalog');
        const models = result.data.slice(0, 1000).filter((item): item is Json => Boolean(item && typeof item === 'object')).filter(item => {
          if (typeof item.id !== 'string') return false;
          if (kind !== 'motion') return true;
          const architecture = item.architecture as { output_modalities?: string[] } | undefined;
          return architecture?.output_modalities?.includes('text') ?? false;
        }).map(item => {
          const {capabilities,parameters}=describeOpenRouter(item);
          const parameterKey=`${kind}:${String(item.id)}`;
          if(parameters)this.openRouterParameters.set(parameterKey,parameters);else this.openRouterParameters.delete(parameterKey);
          return {id:String(item.id),name:String(item.name??item.id),provider,kind,...(capabilities?{capabilities}:{})};
        });
        this.cache.set(key, { expires: Date.now() + 300_000, models });
        return { models, source: 'live' };
      } catch { /* Catalog fallback remains explicitly labeled. */ }
    }
    return { models: curatedModels.filter(model => model.provider === provider && model.kind === kind), source: 'curated', warning: 'Catálogo ao vivo indisponível. Modelos abaixo são referências da documentação, sem disponibilidade confirmada.' };
  }

  assertConfigured(provider: Provider) { this.credentials.header(provider); }

  async submit(input: GenerationRequest, signal: AbortSignal) {
    if (input.kind === 'motion') {
      if (input.provider !== 'openrouter') throw new HttpError(400, 'Use OpenRouter ou um agente MCP para criar cenas de motion.', 'unsupported_provider');
      return this.json('openrouter', '/chat/completions', 'POST', {
        model: input.model, max_tokens: 12000, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a senior motion designer. Return ONLY a JSON MotionScene with id, name, width:1920, height:1080, fps:30, duration (seconds 1-30), background (CSS hex color), layers (1-40). Every layer has id, name, type (text|shape|orb|label), x,y,width,height,rotation:0,opacity:1,scale:1,color (hex), text optional, fontSize optional, fontWeight optional, radius optional, start:0, end:duration, ease (power2.out|power3.inOut|expo.out|none), keyframes [{time:0,x,y,scale,rotation,opacity},{time:duration,...}]. All numbers finite. Compose art-directed typography, tasteful gradients via orbs, precise timing, rich staggered choreography, readable contrast and polished transitions. Use a dark background and vibrant Onun pink #ff87f7. Use no external URLs, scripts, customCode, HTML or executable content. The engine will convert the declarative scene into HTML/CSS/GSAP and render locally.' },
          { role: 'user', content: input.prompt },
        ],
      }, signal);
    }
    if (input.provider === 'openrouter') {
      const catalog=await this.models('openrouter',input.kind);
      signal.throwIfAborted();
      const model=catalog.models.find(item=>item.id===input.model);
      const parameters=catalog.source==='live'&&model?this.openRouterParameters.get(`${input.kind}:${input.model}`):undefined;
      const body=buildOpenRouterInput(input,parameters,model?.capabilities as Parameters<typeof buildOpenRouterInput>[2]);
      return this.json('openrouter', input.kind === 'image' ? '/images' : '/videos', 'POST', body, signal);
    }
    const catalog=await this.higgsfield.entries();
    const model=selectHiggsfield(catalog.entries,input.model,input.kind,input.references.length);
    buildHiggsfieldInput(model,{...input,references:input.references.map((reference,index)=>reference.startsWith('data:')?`https://upload.higgsfield.ai/reference-${index}.png`:reference)}); // Validate structure before uploading; data URLs become public URLs.
    const uploaded=new Map<string,Promise<string>>();
    const publicReferences=await Promise.all(input.references.map(reference=>{let pending=uploaded.get(reference);if(!pending){pending=this.higgsfieldReference(reference,signal);uploaded.set(reference,pending);}return pending;}));
    const body=buildHiggsfieldInput(model,{...input,references:publicReferences});
    return this.json('higgsfield', `/${model.id}`, 'POST', body, signal);
  }

  private async higgsfieldReference(reference:string,signal:AbortSignal){
    if(reference.startsWith('https://'))return reference;
    const data=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(reference);
    if(!data)throw new HttpError(400,'A referência precisa ser uma imagem PNG, JPEG ou WebP.','invalid_reference');
    const bytes=Buffer.from(data[2],'base64');
    const signature=data[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!signature||bytes.length>9_000_000)throw new HttpError(400,'Referência inválida ou maior que 9 MB.','invalid_reference');
    const result=await this.json('higgsfield','/files/generate-upload-url','POST',{content_type:data[1]},signal);
    const validUrl=(value:unknown)=>{try{const url=new URL(String(value));return url.protocol==='https:'&&!url.username&&!url.password&&url.hostname!=='localhost'&&!url.hostname.endsWith('.local')?url.href:null;}catch{return null;}};
    const uploadUrl=validUrl(result.upload_url),publicUrl=validUrl(result.public_url);
    if(!uploadUrl||!publicUrl)throw new HttpError(502,'O provedor não retornou uma URL de upload válida.','invalid_upload');
    const headers=new Headers({'Content-Type':data[1]});
    for(const[name,value]of Object.entries((result.upload_headers??{})as Record<string,unknown>)){
      if(/^(authorization|proxy-authorization|cookie|host)$/i.test(name)||typeof value!=='string')throw new HttpError(502,'O provedor retornou cabeçalhos de upload inválidos.','invalid_upload');
      headers.set(name,value);
    }
    if(headers.get('Content-Type')!==data[1])throw new HttpError(502,'O formato do upload não corresponde à referência.','invalid_upload');
    const response=await this.request(uploadUrl,{method:'PUT',headers,body:bytes,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
    await response.body?.cancel();if(!response.ok)throw new HttpError(502,'Não foi possível carregar a referência no provedor.','upload_failed');
    return publicUrl;
  }

  poll(provider: Provider, remoteId: string, signal: AbortSignal) {
    return this.json(provider, provider === 'openrouter' ? `/videos/${encodeURIComponent(remoteId)}` : `/requests/${encodeURIComponent(remoteId)}/status`, 'GET', undefined, signal);
  }
  cancelHiggsfield(remoteId: string) { return this.json('higgsfield', `/requests/${encodeURIComponent(remoteId)}/cancel`, 'POST'); }
  async videoContent(remoteId: string, signal: AbortSignal, limit = 250_000_000) {
    const response = await this.request(`https://openrouter.ai/api/v1/videos/${encodeURIComponent(remoteId)}/content?index=0`, { headers: { Authorization: this.credentials.header('openrouter') }, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error' });
    if (!response.ok) throw new HttpError(502, 'Não foi possível baixar o vídeo gerado.', 'download_failed');
    return limitedBody(response, limit);
  }
}
