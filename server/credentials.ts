import { z } from 'zod';
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';

export const providerSchema = z.enum(['openrouter', 'higgsfield']);
export type Provider = z.infer<typeof providerSchema>;
export const credentialsSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().max(2049).optional(),
  apiSecret: z.string().max(1024).optional(),
  clear: z.boolean().optional(),
});

function tokenPart(value: string) {
  const token = value.replace(/^ +| +$/g, '');
  if (!token || !/^[!-~]+$/.test(token)) throw new HttpError(400, 'Informe uma chave de API válida.', 'invalid_credentials');
  return token;
}

function completeKey(provider: Provider, value: string | undefined, secret?: string) {
  let key = value?.replace(/^ +| +$/g, '') ?? '';
  const prefixed = provider === 'higgsfield' && /^Key +/i.test(key);
  if (prefixed) key = key.replace(/^Key +/i, '');
  key = tokenPart(key);
  if (provider === 'higgsfield' && secret && secret.replace(/^ +| +$/g, '')) {
    const legacySecret = tokenPart(secret);
    // A full credential or pasted Authorization value must never gain a second secret.
    if (!prefixed && !key.includes(':')) key = `${key}:${legacySecret}`;
  }
  if (key.length < 8 || key.length > 2049) throw new HttpError(400, 'Informe uma chave de API válida.', 'invalid_credentials');
  return key;
}

const storedSchema = z.object({
  version: z.literal(1),
  providers: z.object({ openrouter:z.string().max(2049).optional(), higgsfield:z.string().max(2049).optional() }).strict(),
}).strict();

function isMissing(error: unknown) { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function storageError() { return new HttpError(500, 'Não foi possível salvar as chaves no armazenamento privado local.', 'credential_storage_unavailable'); }

export class Credentials {
  private session = new Map<Provider, string>();
  private storageAvailable = true;
  private loadFailed = false;
  constructor(private environment: NodeJS.ProcessEnv = process.env, private storagePath?: string) {
    if (storagePath) {
      try { this.load(); }
      catch { this.storageAvailable = false; this.loadFailed = true; }
    }
  }

  private privateDirectory(create: boolean) {
    const directory=dirname(this.storagePath!);
    if(create)mkdirSync(directory,{recursive:true,mode:0o700});
    let info;
    try { info=lstatSync(directory); } catch(error) { if(!create&&isMissing(error))return false;throw error; }
    if(!info.isDirectory()||info.isSymbolicLink())throw storageError();
    chmodSync(directory,0o700);
    return true;
  }

  private load() {
    if(!this.privateDirectory(false))return;
    let fd:number;
    try { fd=openSync(this.storagePath!,constants.O_RDONLY|constants.O_NOFOLLOW); }
    catch(error) { if(isMissing(error))return;throw error; }
    try {
      const info=fstatSync(fd);
      if(!info.isFile()||info.size>16384)throw storageError();
      fchmodSync(fd,0o600);
      const stored=storedSchema.parse(JSON.parse(readFileSync(fd,'utf8')));
      const loaded=new Map<Provider,string>();
      for(const provider of providerSchema.options){const value=stored.providers[provider];if(value)loaded.set(provider,completeKey(provider,value));}
      this.session=loaded;
    } finally { closeSync(fd); }
  }

  private persist(next:Map<Provider,string>) {
    if(!this.storagePath)return;
    if(this.loadFailed)throw storageError();
    let temporary:string|undefined;let fd:number|undefined;
    try {
      this.privateDirectory(true);
      try { const existing=lstatSync(this.storagePath);if(!existing.isFile()||existing.isSymbolicLink())throw storageError(); }
      catch(error) { if(!isMissing(error))throw error; }
      temporary=join(dirname(this.storagePath),`.credentials-${randomUUID()}.tmp`);
      fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      fchmodSync(fd,0o600);
      writeFileSync(fd,JSON.stringify({version:1,providers:Object.fromEntries(next)},null,2)+'\n');
      fsyncSync(fd);closeSync(fd);fd=undefined;
      renameSync(temporary,this.storagePath);temporary=undefined;
      this.storageAvailable=true;
    } catch { this.storageAvailable=false;throw storageError(); }
    finally {
      if(fd!==undefined)try{closeSync(fd);}catch{/* Preserve the original save failure. */}
      if(temporary)try{unlinkSync(temporary);}catch{/* No secret or filesystem error enters the API response. */}
    }
  }
  private env(provider: Provider) {
    if (provider === 'openrouter') return this.environment.OPENROUTER_API_KEY;
    const complete = this.environment.HF_CREDENTIALS || this.environment.HF_KEY;
    const key = complete || this.environment.HF_API_KEY;
    if (!key) return undefined;
    try { return completeKey(provider, key, complete ? undefined : this.environment.HF_API_SECRET); }
    catch { return undefined; }
  }
  status() {
    const entry = (provider: Provider) => ({ configured: Boolean(this.session.get(provider) || this.env(provider)), source: this.session.has(provider) ? this.storagePath ? 'stored' : 'session' : this.env(provider) ? 'environment' : 'none' });
    return { runtime: 'local', providers: { openrouter: entry('openrouter'), higgsfield: entry('higgsfield') }, credentialStorage: {persistent:Boolean(this.storagePath),available:this.storageAvailable} };
  }
  set(input: unknown) {
    const settings = credentialsSchema.parse(input);
    const next=new Map(this.session);
    if (settings.clear) next.delete(settings.provider);
    else {
      const key = completeKey(settings.provider, settings.apiKey, settings.apiSecret);
      next.set(settings.provider, key);
    }
    this.persist(next);
    this.session=next;
    return this.status();
  }
  header(provider: Provider) {
    const key = this.session.get(provider) || this.env(provider);
    if (!key) throw new HttpError(428, `Conecte ${provider === 'openrouter' ? 'OpenRouter' : 'Higgsfield'} em Configurações para gerar.`, 'provider_not_configured');
    return provider === 'openrouter' ? `Bearer ${key}` : `Key ${key}`;
  }
}
