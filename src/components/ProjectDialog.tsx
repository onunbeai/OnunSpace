import {t} from '../lib/i18n';
import {useEffect,useState} from 'react';
import {Modal} from './ui';
import {Icon} from './Icon';
import {api} from '../lib/api';
import {createEmptyMotionScene} from '../../shared/emptyMotion';
export function ProjectDialog({open,onClose,flush}:{open:boolean;onClose:()=>void;flush:()=>Promise<void>}){
 const[projects,setProjects]=useState<{id:string;name:string}[]>([]);const[error,setError]=useState('');const[name,setName]=useState('');const[busy,setBusy]=useState(false);
 useEffect(()=>{if(open)api<{projects:{id:string;name:string}[]}>('/projects').then(r=>setProjects(r.projects)).catch(e=>setError(e.message));},[open]);
 const openProject=async(id:string)=>{try{await flush();location.href=`/?project=${id}`;}catch(e){setError(e instanceof Error?e.message:t("Não foi possível salvar."));}};
 const create=async()=>{setBusy(true);try{await flush();const id=crypto.randomUUID();await api('/projects',{method:'POST',body:JSON.stringify({id,name:name.trim()||t("Sem título"),nodes:[],edges:[],motion:createEmptyMotionScene(t("Cena sem título"))})});location.href=`/?project=${id}`;}catch(e){setError(e instanceof Error?e.message:t("Não foi possível criar."));}finally{setBusy(false);}};
 return <Modal open={open} onOpenChange={o=>!o&&onClose()} title={t("Projetos")}><div className="project-list">{projects.map(p=><button key={p.id} onClick={()=>void openProject(p.id)}><Icon name="folder" size={18}/><span>{p.name}</span><Icon name="chevron-right" size={14}/></button>)}</div><form className="project-create" onSubmit={e=>{e.preventDefault();void create();}}><input className="text-input" placeholder={t("Nome do projeto")} aria-label={t("Nome do novo projeto")} value={name} onChange={e=>setName(e.target.value)} maxLength={120}/><button className="button" disabled={busy}><Icon name="plus" size={16}/>{t("Novo projeto")}</button></form>{error&&<p className="inline-error">{error}</p>}</Modal>;
}
