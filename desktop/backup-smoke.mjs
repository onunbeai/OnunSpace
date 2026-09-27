import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {_electron as electron} from 'playwright';

const temporary=await mkdtemp(join(tmpdir(),'onun-electron-backup-'));
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const selected=join(temporary,'selected-backups');await mkdir(selected);
const application=await electron.launch({args:[resolve('.')],cwd:resolve('.'),env:{...process.env,ONUN_PORT:String(port),ONUN_DATA_DIR:join(temporary,'runtime')},timeout:30000});
try{
 const window=await application.firstWindow();await window.waitForSelector('#root button',{timeout:30000});
 await application.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async(_window,options)=>{globalThis.__onunPickerOptions=options;return{canceled:false,filePaths:[directory]};};},selected);
 const bridge=await window.evaluate(()=>({keys:Object.keys(window.onunDesktop??{}),hasNode:typeof window.require!=='undefined'}));
 assert.deepEqual(bridge,{keys:['chooseBackupDirectory'],hasNode:false});
 const chosen=await window.evaluate(()=>window.onunDesktop.chooseBackupDirectory('/tmp'));assert.equal(chosen,selected);
 const options=await application.evaluate(()=>globalThis.__onunPickerOptions);assert.deepEqual(options.properties,['openDirectory','createDirectory']);assert.equal(options.defaultPath,'/tmp');
 const invalid=await window.evaluate(async()=>{try{await window.onunDesktop.chooseBackupDirectory('bad\0path');return false;}catch{return true;}});assert.equal(invalid,true);
 await application.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 assert.equal(await window.evaluate(()=>window.onunDesktop.chooseBackupDirectory('/tmp')),null);
 const health=await window.evaluate(async()=>await(await fetch('/api/health')).json());assert.equal(health.status,'ok');
 const artifact=resolve('artifacts/desktop-backup-smoke.json');await writeFile(artifact,JSON.stringify({timestamp:new Date().toISOString(),isolatedRuntime:true,bridge,checks:['Context-isolated preload exposes only folder selection.','Trusted top frame reaches the native folder dialog handler.','Selection returned, cancellation returns null, invalid path rejected.','Runtime started on a separate loopback port with temporary data.'],nativeDialog:'Stubbed Electron dialog return values; no physical directory selection or user data access.'},null,2));
 console.log(artifact);
}finally{await application.close();await rm(temporary,{recursive:true,force:true});}
