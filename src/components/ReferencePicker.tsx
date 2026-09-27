import {t} from '../lib/i18n';
import {useRef,useState} from 'react';
import type {CanvasNode,Project} from '../../shared/project';
import {Artwork} from '../features/canvas/Artwork';
import {Icon} from './Icon';
import {Modal} from './ui';
import './reference-picker.css';

interface Props {
 project:Project;
 target:CanvasNode;
 onClose:()=>void;
 onToggle:(sourceId:string)=>void;
 onImport:(files:File[])=>Promise<void>;
}

export function ReferencePicker({project,target,onClose,onToggle,onImport}:Props){
 const[search,setSearch]=useState('');
 const[importing,setImporting]=useState(false);
 const[error,setError]=useState('');
 const input=useRef<HTMLInputElement>(null);
 const connected=new Set(project.edges.filter(edge=>edge.target===target.id).map(edge=>edge.source));
 const nodes=project.nodes.filter(node=>node.id!==target.id&&`${node.title} ${node.prompt}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const importFiles=async(files:File[])=>{
  if(!files.length)return;
  setImporting(true);setError('');
  try{await onImport(files);}catch(reason){setError(reason instanceof Error?reason.message:t("Não foi possível carregar o arquivo."));}
  finally{setImporting(false);}
 };
 return <Modal open onOpenChange={open=>!open&&onClose()} title={t("Referências")}>
  <div className="reference-picker">
   <div className="reference-picker-tools"><label className="reference-picker-search"><Icon name="search" size={17}/><input aria-label={t("Pesquisar referências")} placeholder={t("Pesquisar no canvas")} value={search} onChange={event=>setSearch(event.target.value)}/></label><button className="button reference-picker-upload" onClick={()=>input.current?.click()} disabled={importing}><Icon name={importing?'clock':'upload'} size={16}/>{importing?t("Carregando…"):t("Carregar")}</button></div>
   <div className="reference-picker-grid" aria-label={t("Nós disponíveis como referências")}>{nodes.map(node=><button type="button" className={`reference-picker-item ${connected.has(node.id)?'is-connected':''}`} key={node.id} aria-pressed={connected.has(node.id)} aria-label={node.title} onClick={()=>onToggle(node.id)}>
    <span className="reference-picker-art">{node.media?(node.kind==='video'?<video src={node.media} preload="metadata" muted/>:<img src={node.media} alt="" draggable={false}/>):node.kind==='text'?<span className="reference-picker-text"><Icon name="text" size={28}/><span>{node.prompt||node.title}</span></span>:<Artwork node={node}/>}</span>
    <span className="reference-picker-item-footer"><span>{node.title}</span><span className="reference-picker-check" aria-hidden="true">{connected.has(node.id)&&<Icon name="check" size={12}/>}</span></span>
   </button>)}</div>
   {!nodes.length&&<div className="reference-picker-empty"><Icon name="image" size={26}/><span>{search?t("Nenhuma referência encontrada."):t("Carregue uma referência para começar.")}</span></div>}
   {error&&<p className="reference-picker-error" role="alert">{error}</p>}
   <div className="reference-picker-footer"><span>{connected.size} {connected.size===1?t("conectada"):t("conectadas")}</span><button className="button" onClick={onClose}>{t("Concluir")}</button></div>
   <input ref={input} type="file" aria-label={t("Carregar arquivos de referência")} accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple hidden onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void importFiles(files);}}/>
  </div>
 </Modal>;
}
