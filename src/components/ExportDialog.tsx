import {CanvasExportDialog, type ExportDialogProps} from './CanvasExportDialog';
import {t} from '../lib/i18n';
import {useEffect,useState} from 'react';
import type {Project} from '../../shared/project';
import {api,downloadFile} from '../lib/api';
import {Modal,Select} from './ui';
import {Icon} from './Icon';
type RenderJob={id:string;status:string;progress:number;frame:number;totalFrames:number;downloadUrl?:string;error?:string};
function MotionExportDialog({open,onClose,project}:{open:boolean;onClose:()=>void;project:Project}){
 const[format,setFormat]=useState('mp4');const[quality,setQuality]=useState('high');const[job,setJob]=useState<RenderJob|null>(null);const[error,setError]=useState('');const[busy,setBusy]=useState(false);
 useEffect(()=>{if(!job||['completed','failed','cancelled'].includes(job.status))return;const timer=setTimeout(()=>api<RenderJob>(`/renders/${job.id}`).then(setJob).catch(e=>setError(e.message)),1000);return()=>clearTimeout(timer);},[job]);
 const render=async()=>{setBusy(true);setError('');try{setJob(await api<RenderJob>('/renders',{method:'POST',body:JSON.stringify({scene:project.motion,options:{format,quality}})}));}catch(e){setError(e instanceof Error?e.message:t("Não foi possível renderizar."));}finally{setBusy(false);}};
 const pending=job&&!['completed','failed','cancelled'].includes(job.status);
 return <Modal open={open} onOpenChange={o=>!o&&onClose()} title={t("Exportar")}><div className="form-stack"><div className="form-row"><label>{t("Formato")}<Select label={t("Formato de exportação")} value={format} options={[{value:'mp4',label:'MP4 · H.264'},{value:'webm',label:'WebM · VP9'}]} onChange={setFormat}/></label><label>{t("Qualidade")}<Select label={t("Qualidade da exportação")} value={quality} options={[{value:'high',label:t("Alta · resolução original")},{value:'draft',label:t("Prévia · até 960px")}]} onChange={setQuality}/></label></div><p className="muted" style={{fontSize:12}}>{project.motion.width} × {project.motion.height} · {project.motion.fps} fps · {project.motion.duration}{t("s · render local")}</p>{pending&&<><div className="render-progress"><span style={{width:`${job.progress}%`}}/></div><p className="muted" style={{fontSize:12}}>{job.status==='encoding'?t("Codificando vídeo…"):t('Renderizando quadro {frame} de {total}',{frame:job.frame,total:job.totalFrames})}</p><button className="button" onClick={async()=>setJob(await api(`/renders/${job.id}`,{method:'DELETE'}))}>{t("Cancelar render")}</button></>}{job?.status==='completed'&&<a className="button primary" href={job.downloadUrl} download><Icon name="export" size={16}/>{t("Baixar vídeo")}</a>}{job?.status==='cancelled'&&<p className="muted">{t("Render cancelado.")}</p>}{(error||job?.error)&&<p className="inline-error" role="alert">{error||job?.error}</p>}<button className="button primary" onClick={render} disabled={busy||!!pending}><Icon name="video" size={16}/>{busy?t("Preparando…"):t("Renderizar vídeo")}</button><button className="button" onClick={()=>downloadFile(`${project.name}.onun.json`,JSON.stringify(project,null,2))}><Icon name="export" size={16}/>{t("Salvar projeto .onun")}</button></div></Modal>;
}

export function ExportDialog(props: ExportDialogProps) {
 return props.mode === 'motion' ? <MotionExportDialog {...props}/> : <CanvasExportDialog {...props}/>;
}
