import { createReadStream, createWriteStream } from 'node:fs';
import { access, link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { Zip, ZipPassThrough, Unzip, UnzipInflate } from 'fflate';
import { z } from 'zod';
import { HttpError } from './errors.js';
import { identifier, projectSchema, ProjectStore } from './store.js';

const require = createRequire(import.meta.url);
const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 6000;
const mimeExtensions: Record<string, string> = { 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','video/mp4':'.mp4','video/webm':'.webm','audio/mpeg':'.mp3','audio/wav':'.wav','font/woff':'.woff','font/woff2':'.woff2','font/ttf':'.ttf','font/otf':'.otf','application/font-woff':'.woff','application/octet-stream':'' };
const assetName = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)$/;
const archiveName = /^(project\.json|manifest\.json|assets\/[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif|svg|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)|motion\/(?:scene\.json|index\.html|style\.css|motion\.js|gsap\.min\.js))$/;
const referencePattern = /https:\/\/[^\s"'<>`\\)]+|\/(?:api\/(?:assets\/|projects\/[a-zA-Z0-9_-]+\/assets\/)|assets\/)[^\s"'<>`\\)]+/g;
const entrySchema = z.object({ path:z.string().max(220), bytes:z.number().int().min(0).max(MAX_FILE_BYTES), sha256:z.string().regex(/^[a-f0-9]{64}$/) });
const manifestSchema = z.object({format:z.literal('onun-space-backup'),version:z.literal(1),projectId:identifier,createdAt:z.string(),entries:z.array(entrySchema).max(MAX_FILES)});
export const backupOptionsSchema = z.object({format:z.enum(['onun','zip']).default('zip')}).strict();
export type BackupFormat = z.infer<typeof backupOptionsSchema>['format'];
export interface BackupRecord { id:string; fileName:string; path:string; createdAt:string; bytes:number; downloadUrl:string; format?:BackupFormat }
const recordSchema = z.object({id:identifier,fileName:z.string().max(300).regex(/^[a-zA-Z0-9_.-]+\.(?:onun|zip)$/i),path:z.string().max(4096),createdAt:z.string(),bytes:z.number(),downloadUrl:z.string(),format:z.enum(['onun','zip']).optional()});
const settingsSchema = z.object({destination:z.string().max(4096).optional(),backups:z.array(recordSchema).max(50).default([])});
type ArchiveEntry = {path:string;source?:string;data?:Uint8Array};

function reject(message:string,code='invalid_backup'):never { throw new HttpError(400,message,code); }
function safeChild(root:string,path:string){const child=resolve(root,path);if(!child.startsWith(resolve(root)+sep))reject('Invalid asset path.');return child;}
async function regularFile(path:string,root:string){
 const actual=await realpath(path);if(!actual.startsWith((await realpath(root))+sep))reject('Asset path leaves its project folder.');
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_FILE_BYTES)reject('Asset is missing, unsafe or larger than 256 MB.');return actual;
}
function publicAddress(address:string){
 if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===198&&(p[1]===18||p[1]===19)));}
 const value=address.toLowerCase();return isIP(address)===6&&!/^(::|fc|fd|fe8|fe9|fea|feb|ff)/.test(value)&&!value.includes('::ffff:');
}
async function remoteAsset(urlString:string,destination:string,redirects=0):Promise<string>{
 const url=new URL(urlString);if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||redirects>3)reject('Only public HTTPS assets can be backed up.');
 const addresses=await lookup(url.hostname,{all:true});if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))reject('Private network assets cannot be fetched for a backup.');
 const pinned=addresses[0];
 const response=await new Promise<import('node:http').IncomingMessage>((accept,fail)=>{
  const request=httpsRequest(url,{lookup:(_hostname,options,callback)=>{if(options.all)callback(null,[pinned]);else callback(null,pinned.address,pinned.family);},headers:{Accept:'image/*,video/*,audio/*,font/*,application/octet-stream'},timeout:30000},accept);
  request.on('timeout',()=>request.destroy(new Error('Asset download timed out.')));request.on('error',fail);request.end();
 });
 if([301,302,303,307,308].includes(response.statusCode??0)&&response.headers.location){response.resume();return remoteAsset(new URL(response.headers.location,url).href,destination,redirects+1);}
 if(response.statusCode!==200){response.resume();reject('A referenced online asset could not be downloaded.');}
 const mime=String(response.headers['content-type']??'').split(';')[0];
 const extension=mimeExtensions[mime]??'';const pathExtension=extname(url.pathname).toLowerCase();
 const suffix=extension||(assetName.test('asset'+pathExtension)?pathExtension:'');
 if(!suffix){response.destroy();reject('Unsupported remote asset format.');}
 const path=destination+suffix;const output=await open(path,'wx',0o600);let bytes=0;
 try{for await(const chunk of response){bytes+=chunk.length;if(bytes>MAX_FILE_BYTES)reject('A referenced asset is larger than 256 MB.');await output.write(chunk);}}
 finally{await output.close();response.destroy();}return path;
}

export class Backups {
 private active = new Set<string>();
 constructor(private projects:ProjectStore,private dataDirectory:string,private publicDirectory:string=resolve('public')){}
 private async readSettings(id:string){await this.projects.get(id);try{return settingsSchema.parse(JSON.parse(await readFile(join(this.projects.projectDirectory(id),'backup.json'),'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return settingsSchema.parse({});throw error;}}
 private async writeSettings(id:string,value:z.infer<typeof settingsSchema>){const folder=await this.projects.ensureDirectory(id);const path=join(folder,'backup.json');const temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});await rename(temp,path);}finally{await unlink(temp).catch(()=>undefined);}}
 async settings(id:string){const settings=await this.readSettings(id);return{destination:settings.destination??join(this.dataDirectory,'backups',id),defaultDestination:join(this.dataDirectory,'backups',id),projectDirectory:this.projects.projectDirectory(id),lastBackup:settings.backups.at(-1)??null};}
 async setDestination(id:string,input:unknown){
  const raw=z.string().trim().min(1).max(4096).parse(input);if(/[\0\r\n]/.test(raw))reject('Invalid backup folder.','invalid_backup_destination');
  const expanded=raw==='~'?homedir():raw.startsWith('~/')?join(homedir(),raw.slice(2)):raw;
  if(!isAbsolute(expanded))reject('Enter an absolute folder path.','invalid_backup_destination');
  const destination=resolve(expanded);await this.projects.get(id);
  try{await mkdir(destination,{recursive:true,mode:0o700});const info=await stat(destination);if(!info.isDirectory())reject('Backup destination must be a folder.','invalid_backup_destination');await access(destination,constants.W_OK);}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'The backup folder is unavailable or not writable.','invalid_backup_destination');}
  const settings=await this.readSettings(id);await this.writeSettings(id,{...settings,destination:await realpath(destination)});return this.settings(id);
 }
 async download(id:string,backupId:string){const settings=await this.readSettings(id);const backup=settings.backups.find(item=>item.id===backupId);if(!backup)throw new HttpError(404,'Backup not found.','backup_not_found');const info=await lstat(backup.path).catch(()=>null);if(!info?.isFile()||info.isSymbolicLink())throw new HttpError(404,'Backup file is unavailable.','backup_not_found');return backup.path;}
 async create(id:string,options:unknown={}){
  const {format}=backupOptionsSchema.parse(options);
  if(this.active.has(id))throw new HttpError(409,'A backup is already being created for this project.','backup_busy');this.active.add(id);
  let staging='';let temporary='';
  try{
   const project=await this.projects.get(id);const settings=await this.settings(id);await this.setDestination(id,settings.destination);
   await mkdir(join(this.dataDirectory,'.backup-work'),{recursive:true,mode:0o700});staging=await mkdtemp(join(this.dataDirectory,'.backup-work','create-'));
   const entries:ArchiveEntry[]=[];const replacements=new Map<string,string>();const portable=structuredClone(project);
   const capture=async(reference:string):Promise<string>=>{
    if(replacements.has(reference))return replacements.get(reference)!;
    const data=/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(reference);
    let source:string|undefined,bytes:Uint8Array|undefined,suffix='';
    if(data){suffix=mimeExtensions[data[1]]??'';if(!suffix)reject('Unsupported embedded asset format.');bytes=Buffer.from(data[2],'base64');if(bytes.length>MAX_FILE_BYTES)reject('Embedded asset is larger than 256 MB.');}
    else if(reference.startsWith('/api/assets/')){const name=reference.slice(12);if(!assetName.test(name))reject('Invalid local asset reference.');source=await regularFile(join(this.dataDirectory,'assets',name),join(this.dataDirectory,'assets'));suffix=extname(name);}
    else if(/^\/api\/projects\/[^/]+\/assets\//.test(reference)){const match=/^\/api\/projects\/([a-zA-Z0-9_-]+)\/assets\/([^/]+)$/.exec(reference);if(!match||!assetName.test(match[2]))reject('Invalid project asset reference.');const root=join(this.projects.projectDirectory(match[1]),'assets');source=await regularFile(join(root,match[2]),root);suffix=extname(match[2]);}
    else if(reference.startsWith('/assets/')){const path=safeChild(this.publicDirectory,reference.slice(1));source=await regularFile(path,this.publicDirectory);suffix=extname(path);if(!assetName.test('asset'+suffix))reject('Unsupported bundled asset format.');}
    else if(reference.startsWith('https://')){source=await remoteAsset(reference,join(staging,randomUUID()));suffix=extname(source);}
    else reject('A referenced asset is not portable. Import it into the project first.');
    const name=`assets/${randomUUID()}${suffix}`;entries.push({path:name,source,data:bytes});replacements.set(reference,name);return name;
   };
   for(const node of portable.nodes){if(node.media)node.media=await capture(node.media);if(node.outputs)node.outputs=await Promise.all(node.outputs.map(capture));}
   if(portable.motion.customCode)for(const key of ['html','css','js'] as const){let code=portable.motion.customCode[key];for(const reference of new Set(code.match(referencePattern)??[])){const replacement=await capture(reference);code=code.split(reference).join(replacement);}portable.motion.customCode[key]=code;}
   const font=join(this.publicDirectory,'assets','inter-medium.woff2');if(await stat(font).then(info=>info.isFile()).catch(()=>false))await capture('/assets/inter-medium.woff2');
   const encoded=(value:unknown)=>Buffer.from(JSON.stringify(value,null,2));
   entries.unshift({path:'project.json',data:encoded(portable)},{path:'motion/scene.json',data:encoded(portable.motion)});
   const code=portable.motion.customCode??{html:'',css:'',js:''};for(const[key,name]of [['html','index.html'],['css','style.css'],['js','motion.js']]as const)entries.push({path:'motion/'+name,data:Buffer.from(code[key])});
   entries.push({path:'motion/gsap.min.js',source:require.resolve('gsap/dist/gsap.min.js')});
   if(entries.length>MAX_FILES)reject('The backup contains too many files.');
   const backupId=randomUUID();const createdAt=new Date().toISOString();const suffix=format==='onun'?'.onun':'.onun.zip';const fileName=`${id}-${createdAt.replace(/[:.]/g,'-')}-${backupId.slice(0,8)}${suffix}`;const path=join(settings.destination,fileName);temporary=path+'.tmp';
   const output=createWriteStream(temporary,{flags:'wx',mode:0o600});const done=finished(output);void done.catch(()=>undefined);let error:Error|undefined;let backpressure=false;let total=0;
   const zip=new Zip((reason,chunk,final)=>{if(reason){error=reason;output.destroy(reason);return;}if(!output.write(chunk))backpressure=true;if(final)output.end();});
   const manifest:z.infer<typeof manifestSchema>={format:'onun-space-backup',version:1,projectId:id,createdAt,entries:[]};
   try{
    for(const entry of entries){const stream=new ZipPassThrough(entry.path);zip.add(stream);const hash=createHash('sha256');let count=0;const chunks=entry.data?[entry.data]:createReadStream(entry.source!,{highWaterMark:65536});
     for await(const chunk of chunks){count+=chunk.length;total+=chunk.length;if(count>MAX_FILE_BYTES||total>MAX_BYTES)reject('Backup exceeds the 1 GB total or 256 MB per-file limit.');hash.update(chunk);stream.push(chunk);if(error)throw error;if(backpressure){await once(output,'drain');backpressure=false;}}
     stream.push(new Uint8Array(),true);manifest.entries.push({path:entry.path,bytes:count,sha256:hash.digest('hex')});
    }
    const manifestEntry=new ZipPassThrough('manifest.json');zip.add(manifestEntry);manifestEntry.push(encoded(manifest),true);zip.end();await done;
   }catch(reason){zip.terminate();output.destroy();await done.catch(()=>undefined);throw reason;}
   const handle=await open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}
   await link(temporary,path);await unlink(temporary);temporary='';
   const bytes=(await stat(path)).size;const backup:BackupRecord={id:backupId,fileName,path,createdAt,bytes,format,downloadUrl:`/api/projects/${id}/backups/${backupId}/file`};
   const latest=await this.readSettings(id);await this.writeSettings(id,{...latest,backups:[...latest.backups,backup].slice(-50)});return backup;
  }catch(error){if(error instanceof HttpError||error instanceof z.ZodError)throw error;throw new HttpError(400,'Backup could not be completed. Check the folder and referenced files.','backup_failed');}
  finally{if(temporary)await unlink(temporary).catch(()=>undefined);if(staging)await rm(staging,{recursive:true,force:true});this.active.delete(id);}
 }
 async restore(chunks:AsyncIterable<Uint8Array>,fileName?:string){
  if(fileName!==undefined&&(fileName.length>300||/[\\/]/.test(fileName)||[...fileName].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)||!/^.+\.(?:onun|zip)$/i.test(fileName)))reject('Choose an .onun or .zip project archive.');
  await mkdir(join(this.dataDirectory,'.backup-work'),{recursive:true,mode:0o700});const staging=await mkdtemp(join(this.dataDirectory,'.backup-work','restore-'));await mkdir(join(staging,'assets'));await mkdir(join(staging,'motion'));
  const files=new Map<string,{bytes:number;sha256:string;complete:boolean}>();const writers:ReturnType<typeof createWriteStream>[]=[];const completions:Promise<void>[]=[];const drains:Promise<unknown>[]=[];let total=0,compressed=0;let tail=Buffer.alloc(0);let failure:Error|undefined;
  const unzip=new Unzip(file=>{
   if(failure)return;
   if(!archiveName.test(file.name)||files.has(file.name)||files.size>=MAX_FILES+1){failure=new Error('Invalid or repeated ZIP path.');return;}
   if(file.originalSize!==undefined&&file.originalSize>MAX_FILE_BYTES){failure=new Error('ZIP entry is too large.');return;}
   const metadata={bytes:0,sha256:'',complete:false};files.set(file.name,metadata);const hash=createHash('sha256');const writer=createWriteStream(join(staging,file.name),{flags:'wx',mode:0o600});writers.push(writer);const done=finished(writer);completions.push(done);void done.catch(error=>{failure=error;});
   file.ondata=(error,data,final)=>{if(error){failure=error;writer.destroy(error);return;}if(failure)return;metadata.bytes+=data.length;total+=data.length;if(metadata.bytes>MAX_FILE_BYTES||total>MAX_BYTES){failure=new Error('ZIP expansion limit exceeded.');file.terminate();writer.destroy(failure);return;}hash.update(data);if(!writer.write(data)&&!final)drains.push(once(writer,'drain'));if(final){metadata.sha256=hash.digest('hex');metadata.complete=true;writer.end();}};file.start();
  });unzip.register(UnzipInflate);
  try{
   for await(const chunk of chunks){tail=Buffer.concat([tail,Buffer.from(chunk)]).subarray(-66000);compressed+=chunk.length;if(compressed>MAX_BYTES+10_000_000)reject('Backup ZIP is larger than 1 GB.');unzip.push(chunk);if(failure)throw failure;await Promise.all(drains.splice(0));}
   const footer=tail.lastIndexOf(Buffer.from([80,75,5,6]));if(footer<0||footer+22>tail.length||footer+22+tail.readUInt16LE(footer+20)!==tail.length)reject('Incomplete ZIP archive.');unzip.push(new Uint8Array(),true);if(failure)throw failure;await Promise.all(completions);if([...files.values()].some(file=>!file.complete))reject('Incomplete ZIP archive.');
   const manifest=manifestSchema.parse(JSON.parse(await readFile(join(staging,'manifest.json'),'utf8')));if(manifest.entries.length!==files.size-1)reject('ZIP contents do not match the manifest.');const seen=new Set<string>();
   for(const expected of manifest.entries){const actual=files.get(expected.path);if(seen.has(expected.path)||!actual||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)reject('Backup integrity check failed.');seen.add(expected.path);}
   if((files.get('project.json')?.bytes??MAX_BYTES)>20_000_000)reject('Project exceeds 20 MB.');
   const portable=projectSchema.parse(JSON.parse(await readFile(join(staging,'project.json'),'utf8')));if(portable.id!==manifest.projectId)reject('Project ID does not match the backup manifest.');
   const id=`${portable.id.slice(0,65)}-restored-${randomUUID().slice(0,8)}`;
   const local=(reference:string)=>{if(!reference.startsWith('assets/')||!files.has(reference))reject('Backup contains a missing or external asset.');return `/api/projects/${id}/${reference}`;};
   for(const node of portable.nodes){if(node.media)node.media=local(node.media);if(node.outputs)node.outputs=node.outputs.map(local);}
   if(portable.motion.customCode)for(const key of ['html','css','js']as const){portable.motion.customCode[key]=portable.motion.customCode[key].replace(/assets\/[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif|svg|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)/g,local);}
   portable.id=id;portable.revision=0;const folder=this.projects.projectDirectory(id);await mkdir(folder,{mode:0o700});
   try{await rename(join(staging,'assets'),join(folder,'assets'));await rename(join(staging,'motion'),join(folder,'motion'));return await this.projects.save(portable,undefined,true);}catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  }catch(error){for(const writer of writers)writer.destroy();await Promise.allSettled(completions);if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid or incomplete backup ZIP. No project was restored.','invalid_backup');}
  finally{await rm(staging,{recursive:true,force:true});}
 }
}
