import {useEffect,useRef,useState} from 'react';
import {api} from '../lib/api';
import {useI18n} from '../lib/i18n';
import {Modal,Select,Tooltip} from './ui';
import {createProjectArchive,restoreProjectArchive,type ArchiveFormat,type ProjectArchive} from '../lib/projectArchives';
import {Icon} from './Icon';
import './backup-dialog.css';

declare global {interface Window {onunDesktop?:{chooseBackupDirectory:(currentPath:string)=>Promise<string|null>}}}
type BackupRecord=ProjectArchive;
interface BackupSettings{destination:string;defaultDestination:string;projectDirectory:string;lastBackup:BackupRecord|null}
interface Props{open:boolean;projectId:string;onClose:()=>void;beforeBackup:()=>Promise<void>;onRestore:(projectId:string)=>void}
export function BackupDialog({open,projectId,onClose,beforeBackup,onRestore}:Props){
 const{t,locale}=useI18n();const[format,setFormat]=useState<ArchiveFormat>('onun');const[settings,setSettings]=useState<BackupSettings|null>(null);const[destination,setDestination]=useState('');const[busy,setBusy]=useState('');const[error,setError]=useState('');const[result,setResult]=useState<BackupRecord|null>(null);const[restored,setRestored]=useState<string|null>(null);const[folderSaved,setFolderSaved]=useState(false);const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!open)return;let active=true;setSettings(null);setFormat('onun');setError('');setResult(null);setRestored(null);setFolderSaved(false);api<BackupSettings>(`/projects/${projectId}/backup-settings`).then(value=>{if(active){setSettings(value);setDestination(value.destination);}}).catch(()=>{if(active)setError(t('O runtime local não está disponível.'));});return()=>{active=false;};},[open,projectId,t]);
 const saveFolder=async(path=destination)=>{const value=await api<BackupSettings>(`/projects/${projectId}/backup-settings`,{method:'PUT',body:JSON.stringify({destination:path})});setSettings(value);setDestination(value.destination);setFolderSaved(true);return value;};
 const rememberFolder=async()=>{setBusy('folder');setError('');try{await saveFolder();}catch{setError('Não foi possível usar esta pasta.');}finally{setBusy('');}};
 const chooseFolder=async()=>{if(!window.onunDesktop)return;setError('');try{const path=await window.onunDesktop.chooseBackupDirectory(destination);if(path){setDestination(path);setBusy('folder');await saveFolder(path);}}catch{setError('Não foi possível usar esta pasta.');}finally{setBusy('');}};
 const create=async()=>{setBusy('backup');setError('');setResult(null);try{await beforeBackup();await saveFolder();const value=await createProjectArchive(projectId,format);setResult(value);setSettings(current=>current?{...current,lastBackup:value}:current);}catch{setError('Não foi possível criar o backup. Confira a pasta e os arquivos do projeto.');}finally{setBusy('');}};
 const restore=async(file?:File)=>{if(!file)return;setBusy('restore');setError('');setRestored(null);try{await beforeBackup();const project=await restoreProjectArchive(file);setRestored(project.id);}catch{setError('Arquivo .onun ou ZIP inválido ou incompleto. Nenhum projeto foi restaurado.');}finally{setBusy('');}};
 return <Modal open={open} onOpenChange={value=>!value&&!busy&&onClose()} title={t('Backup do projeto')}><div className="backup-dialog">
  <label className="backup-destination">{t('Pasta de backup')}<div><input className="text-input" aria-label={t('Pasta de backup')} value={destination} onChange={event=>{setDestination(event.target.value);setFolderSaved(false);}} disabled={!settings||!!busy} spellCheck={false}/>{window.onunDesktop&&<Tooltip content={t('Escolher pasta')}><button className="button" aria-label={t('Escolher pasta')} onClick={()=>void chooseFolder()} disabled={!!busy}><Icon name="folder" size={17}/></button></Tooltip>}</div></label>
  <div className="backup-folder-actions"><span>{folderSaved?t('Pasta lembrada para este projeto'):''}</span><button onClick={()=>void rememberFolder()} disabled={!settings||!!busy||!destination.trim()}>{t('Salvar pasta')}</button></div>
  <fieldset className="backup-format" disabled={!!busy}><legend>{t('Formato do arquivo de projeto')}</legend><Select label={t('Formato do arquivo de projeto')} value={format} options={[{value:'onun',label:'.onun'},{value:'zip',label:'ZIP'}]} onChange={value=>setFormat(value as ArchiveFormat)}/><small>{t('Inclui canvas, Motion e arquivos. Importe a cópia para continuar de onde parou.')}</small></fieldset>
  <button className="button backup-create" disabled={!settings||!!busy||!destination.trim()} onClick={()=>void create()}><Icon name={busy==='backup'?'clock':'export'} size={17}/>{t(busy==='backup'?'Criando backup…':format==='onun'?'Criar arquivo .onun':'Criar backup ZIP')}</button>
  {(result||settings?.lastBackup)&&<div className="backup-result"><Icon name="check" size={18}/><div><strong>{t(result?'Backup salvo':'Último backup')}</strong><span>{(result??settings?.lastBackup)?.path}</span><small>{new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(new Date((result??settings!.lastBackup)!.createdAt))} · {(((result??settings!.lastBackup)!.bytes)/1024/1024).toFixed(2)} MB</small></div><a className="button" href={(result??settings?.lastBackup)?.downloadUrl} download={(result??settings?.lastBackup)?.fileName} aria-label={t('Baixar arquivo')}><Icon name="export" size={16}/></a></div>}
  <div className="backup-restore"><button className="button" disabled={!!busy} onClick={()=>input.current?.click()}><Icon name={busy==='restore'?'clock':'upload'} size={16}/>{t(busy==='restore'?'Restaurando…':'Restaurar projeto')}</button><span>{t('Restaura como um novo projeto.')}</span></div>
  {restored&&<div className="backup-restored" role="status"><span>{t('Backup restaurado')}</span><button className="button" onClick={()=>onRestore(restored)}>{t('Abrir projeto')}</button></div>}
  {error&&<p className="backup-error" role="alert">{t(error)}</p>}
  <input type="file" ref={input} accept=".onun,.zip,application/zip" aria-label={t('Selecionar projeto .onun ou ZIP')} hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';void restore(file);}}/>
 </div></Modal>;
}
