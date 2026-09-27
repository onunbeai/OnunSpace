import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ProjectStore } from './store.js';
import { Backups } from './backups.js';
import { createApp } from './app.js';
import { defaultScene } from '../shared/motion.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZasAAAAASUVORK5CYII=','base64');
const node={id:'image',kind:'reference' as const,title:'Photo',x:0,y:0,width:300,prompt:'',model:'google/test',provider:'openrouter' as const,aspectRatio:'1:1',resolution:'1K',count:1,status:'none' as const};
const project={id:'backup-test',name:'Backup Test',nodes:[{...node,media:'data:image/png;base64,'+png.toString('base64')},{...node,id:'generated',media:'/api/assets/generated.png',outputs:['/api/assets/generated.png']}],edges:[],motion:{...defaultScene,customCode:{html:'<img src="/api/assets/generated.png">',css:'@font-face{font-family:Custom;src:url(/assets/inter-medium.woff2)}',js:'timeline.to(sceneRoot,{opacity:1});'}}};
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'onun-backup-'));await mkdir(join(directory,'assets'));await writeFile(join(directory,'assets','generated.png'),png);const publicDirectory=join(directory,'public');await mkdir(join(publicDirectory,'assets'),{recursive:true});await writeFile(join(publicDirectory,'assets','inter-medium.woff2'),Buffer.from('test-font'));const store=new ProjectStore(join(directory,'projects'));await store.save(project);return{directory,publicDirectory,store,backups:new Backups(store,directory,publicDirectory)};}
async function* bytes(data:Uint8Array){for(let i=0;i<data.length;i+=37)yield data.subarray(i,i+37);}

test('legacy projects migrate by validated copy, preserve original bytes and never replace a newer folder document',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'onun-migrate-'));
 try{const legacy={...project,nodes:[],revision:7,updatedAt:'2026-01-01T00:00:00Z'};const original=JSON.stringify(legacy);await writeFile(join(directory,'backup-test.json'),original);const store=new ProjectStore(directory);
  assert.equal((await store.list()).length,1);assert.deepEqual(await store.get('backup-test'),legacy);assert.equal(await readFile(join(directory,'backup-test.json'),'utf8'),original);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'backup-test','project.json'),'utf8')),legacy);
  await store.save({...legacy,name:'Newer'},7);assert.equal((await store.get('backup-test')).name,'Newer');assert.equal(await readFile(join(directory,'backup-test.json'),'utf8'),original);assert.equal((await store.list()).length,1);
  await writeFile(join(directory,'bad.json'),'{broken');await assert.rejects(store.get('bad'));assert.equal((await readdir(directory)).includes('bad'),false);
  await rm(join(directory,'bad.json'));await mkdir(join(directory,'incomplete-restore'));assert.equal((await store.list()).length,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('ZIP backup contains portable media, scene sources and fonts; destination and real downloads survive runtime restart',async()=>{
 const f=await fixture();
 try{const destination=join(f.directory,'chosen-folder');await f.backups.setDestination(project.id,destination);const first=await f.backups.create(project.id);const second=await f.backups.create(project.id);assert.notEqual(first.path,second.path);assert.ok(first.bytes>0);assert.equal((await readdir(destination)).length,2);
  const files=unzipSync(await readFile(first.path));const portable=JSON.parse(Buffer.from(files['project.json']).toString());assert.match(portable.nodes[0].media,/^assets\//);assert.deepEqual(Buffer.from(files[portable.nodes[0].media]),png);assert.deepEqual(Buffer.from(files[portable.nodes[1].media]),png);assert.ok(files['motion/scene.json']);assert.ok(files['motion/index.html']);assert.ok(files['motion/style.css']);assert.ok(files['motion/motion.js']);assert.ok(files['motion/gsap.min.js']);assert.equal(Object.values(files).some(value=>Buffer.from(value).equals(Buffer.from('test-font'))),true);assert.ok(!JSON.stringify(portable).includes('/api/assets/'));
  const restarted=new Backups(new ProjectStore(join(f.directory,'projects')),f.directory,f.publicDirectory);assert.equal((await restarted.settings(project.id)).destination,await realpath(destination));assert.equal((await restarted.settings(project.id)).lastBackup?.id,second.id);assert.equal(await restarted.download(project.id,first.id),first.path);
  const restored=await restarted.restore(createReadStream(first.path));assert.notEqual(restored.id,project.id);assert.match(restored.nodes[0].media!,new RegExp(`^/api/projects/${restored.id}/assets/`));assert.equal((await f.store.get(project.id)).name,project.name);assert.deepEqual(await readFile(join(f.store.projectDirectory(restored.id),'assets',restored.nodes[0].media!.split('/').at(-1)!)),png);assert.ok(restored.motion.customCode!.css.includes(`/api/projects/${restored.id}/assets/`));assert.equal((await f.store.list()).length,2);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test('.onun projects are portable ZIP containers with assets and motion; format and destination persist without replacing ZIP backups',async()=>{
 const f=await fixture();
 try{
  const destination=join(f.directory,'onun-projects');await f.backups.setDestination(project.id,destination);
  const legacy=await f.backups.create(project.id);const native=await f.backups.create(project.id,{format:'onun'});const second=await f.backups.create(project.id,{format:'onun'});
  assert.match(legacy.fileName,/\.onun\.zip$/);assert.equal(legacy.format,'zip');assert.match(native.fileName,/\.onun$/);assert.equal(native.path,join(await realpath(destination),native.fileName));assert.equal(native.format,'onun');assert.notEqual(native.path,second.path);
  const archive=await readFile(native.path);assert.equal(archive.subarray(0,4).toString('hex'),'504b0304');const files=unzipSync(archive);const manifest=JSON.parse(Buffer.from(files['manifest.json']).toString());const portable=JSON.parse(Buffer.from(files['project.json']).toString());
  assert.equal(manifest.format,'onun-space-backup');assert.deepEqual(Buffer.from(files[portable.nodes[0].media]),png);assert.ok(files['motion/gsap.min.js']);assert.ok(files['motion/motion.js']);assert.equal(Object.values(files).some(value=>Buffer.from(value).equals(Buffer.from('test-font'))),true);
  const restarted=new Backups(new ProjectStore(join(f.directory,'projects')),f.directory,f.publicDirectory);const settings=await restarted.settings(project.id);assert.equal(settings.destination,await realpath(destination));assert.deepEqual(settings.lastBackup,second);assert.equal(await restarted.download(project.id,legacy.id),legacy.path);assert.equal(await restarted.download(project.id,native.id),native.path);
  const restored=await restarted.restore(createReadStream(native.path),native.fileName);assert.notEqual(restored.id,project.id);assert.deepEqual(await readFile(join(f.store.projectDirectory(restored.id),'assets',restored.nodes[0].media!.split('/').at(-1)!)),png);
  const settingsPath=join(f.store.projectDirectory(project.id),'backup.json');const stored=JSON.parse(await readFile(settingsPath,'utf8'));delete stored.backups[0].format;await writeFile(settingsPath,JSON.stringify(stored));assert.equal(await restarted.download(project.id,legacy.id),legacy.path);
  await assert.rejects(restarted.create(project.id,{format:'json'}));assert.equal((await readdir(destination)).length,3);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test('restoration rejects traversal, broken integrity, duplicates and truncated ZIP without creating a project',async()=>{
 const f=await fixture();
 try{const backup=await f.backups.create(project.id);const data=await readFile(backup.path);const files=unzipSync(data);const count=(await f.store.list()).length;
  await assert.rejects(f.backups.restore(bytes(zipSync({'../escape.txt':new Uint8Array([1]),...files}))));
  const asset=Object.keys(files).find(path=>path.startsWith('assets/'))!;await assert.rejects(f.backups.restore(bytes(zipSync({...files,[asset]:new Uint8Array([1,2,3])}))));
  const duplicate=Buffer.from(zipSync({'assets/a.png':png,'assets/b.png':png})).toString('latin1').replaceAll('assets/b.png','assets/a.png');await assert.rejects(f.backups.restore(bytes(Buffer.from(duplicate,'latin1'))));
  await assert.rejects(f.backups.restore(bytes(data.subarray(0,data.length-22))));assert.equal((await f.store.list()).length,count);assert.equal((await readdir(join(f.directory,'.backup-work'))).length,0);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test('invalid backup destination and missing asset fail without a successful archive',async()=>{
 const f=await fixture();
 try{await assert.rejects(f.backups.setDestination(project.id,'relative/folder'));await assert.rejects(f.backups.setDestination(project.id,'/bad\0path'));const file=join(f.directory,'not-a-folder');await writeFile(file,'file');await assert.rejects(f.backups.setDestination(project.id,file));await rm(join(f.directory,'assets','generated.png'));await assert.rejects(f.backups.create(project.id));const settings=await f.backups.settings(project.id);assert.equal(settings.lastBackup,null);assert.deepEqual(await readdir(settings.destination),[]);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test('backup HTTP routes return a real ZIP, restore a new project, and serve restored media',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'onun-backup-api-'));const app=createApp({dataDirectory:directory});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base=`http://127.0.0.1:${(app.server.address()as AddressInfo).port}`;const headers={'Content-Type':'application/json','X-Onun-Client':'studio'};
 try{await app.projects.save({...project,nodes:[project.nodes[0]],motion:defaultScene});const config=await fetch(`${base}/api/projects/${project.id}/backup-settings`);assert.equal(config.status,200);const created=await fetch(`${base}/api/projects/${project.id}/backups`,{method:'POST',headers,body:'{}'});assert.equal(created.status,201);const record=await created.json();const download=await fetch(base+record.downloadUrl);assert.equal(download.headers.get('content-type'),'application/zip');const buffer=await download.arrayBuffer();assert.ok(buffer.byteLength>0);const restored=await fetch(`${base}/api/backups/restore`,{method:'POST',headers:{...headers,'Content-Type':'application/zip'},body:buffer});assert.equal(restored.status,201);const doc=await restored.json();assert.notEqual(doc.id,project.id);assert.equal((await fetch(base+doc.nodes[0].media)).status,200);
 }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});

test('.onun HTTP export downloads the actual extension and imports either supported MIME with validated filename and archive content',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'onun-native-api-'));const app=createApp({dataDirectory:directory});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base=`http://127.0.0.1:${(app.server.address()as AddressInfo).port}`;const headers={'Content-Type':'application/json','X-Onun-Client':'studio'};
 try{
  await app.projects.save({...project,nodes:[project.nodes[0]],motion:defaultScene});
  const created=await fetch(`${base}/api/projects/${project.id}/backups`,{method:'POST',headers,body:JSON.stringify({format:'onun'})});assert.equal(created.status,201);const record=await created.json();assert.equal(record.format,'onun');assert.match(record.fileName,/\.onun$/);
  const download=await fetch(base+record.downloadUrl);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/zip');assert.equal(download.headers.get('content-disposition'),`attachment; filename="${record.fileName}"`);const buffer=await download.arrayBuffer();assert.deepEqual(Buffer.from(buffer),await readFile(record.path));
  const config=await fetch(`${base}/api/projects/${project.id}/backup-settings`);assert.deepEqual((await config.json()).lastBackup,record);
  for(const mime of ['application/zip','application/x-onun-project']){
   const restored=await fetch(`${base}/api/backups/restore`,{method:'POST',headers:{...headers,'Content-Type':mime,'X-Onun-Filename':record.fileName},body:buffer});assert.equal(restored.status,201);const doc=await restored.json();assert.notEqual(doc.id,project.id);assert.equal((await fetch(base+doc.nodes[0].media)).status,200);
  }
  const before=(await app.projects.list()).length;
  for(const fileName of ['../outside.onun','folder\\outside.zip','project.json','/tmp/project.onun']){
   const rejected=await fetch(`${base}/api/backups/restore`,{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-Onun-Filename':fileName},body:buffer});assert.equal(rejected.status,400);
  }
  const renamedJson=await fetch(`${base}/api/backups/restore`,{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-Onun-Filename':'renamed.onun'},body:JSON.stringify(project)});assert.equal(renamedJson.status,400);
  const invalidFormat=await fetch(`${base}/api/projects/${project.id}/backups`,{method:'POST',headers,body:JSON.stringify({format:'html'})});assert.equal(invalidFormat.status,400);assert.equal((await app.projects.list()).length,before);
 }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
