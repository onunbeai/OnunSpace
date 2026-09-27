import {t} from '../../lib/i18n';
import {useCallback,useMemo,useRef,useState} from 'react';
import type {CanvasNode,NodeKind,Project} from '../../../shared/project';
import {Icon} from '../../components/Icon';
import {IconButton,Menu,Tooltip} from '../../components/ui';
import {NodeCard} from './NodeCard';
import {AddPanel} from './AddPanel';
import {useViewport} from './useViewport';
import {useCanvasMediaImport} from './useCanvasMediaImport';
import type {CanvasImportPoint} from './mediaImport';
import './canvas.css';
import {edgeCurve} from './edges';
import {portPosition,useConnections} from './useConnections';
interface Props{tourMenuOpen?:boolean;tourFocus?:{id:string;key:string;relatedIds?:string[]};tourAddOpen?:boolean;project:Project;ready:boolean;selected:string|null;onSelect:(id:string|null)=>void;onUpdate:(updater:(p:Project)=>Project,record?:boolean)=>void;onChange:(id:string,patch:Partial<CanvasNode>)=>void;onAction:(id:string,action:string)=>void;onModel:(id:string)=>void;onEdit:(id:string)=>void;onAdd:(kind:NodeKind)=>void;onUpload:()=>void;onImportMedia:(files:File[],point:CanvasImportPoint)=>Promise<void>;onSettings:()=>void;onLibrary:()=>void;undo:()=>void;redo:()=>void;canUndo:boolean;canRedo:boolean;}
export function Canvas(props:Props){
 const {project,selected,onSelect,onUpdate}=props;const{areaRef,view,moving,fit,zoom,pan}=useViewport(project,props.ready,props.tourFocus);const[addOpen,setAddOpen]=useState(false);const[tool,setTool]=useState<'cursor'|'hand'>('cursor');const[dragged,setDragged]=useState<{id:string;x:number;y:number}|null>(null);const movedRef=useRef(dragged);const suppressNodeClick=useRef(false);
 const mediaImport=useCanvasMediaImport(areaRef,view,props.ready,props.onImportMedia);
 const refs=useMemo(()=>new Map(project.nodes.map(n=>[n.id,project.edges.filter(e=>e.target===n.id).map(e=>project.nodes.find(n=>n.id===e.source)).filter(Boolean) as CanvasNode[]])),[project]);
 const nodes=useMemo(()=>project.nodes.map(n=>dragged?.id===n.id?{...n,x:dragged.x,y:dragged.y}:n),[project.nodes,dragged]);
 const onDrag=useCallback((event:React.PointerEvent,id:string)=>{
  if(event.button!==0)return;
  event.stopPropagation();event.preventDefault();onSelect(id);
  const node=project.nodes.find(n=>n.id===id);if(!node)return;
  const startX=event.clientX,startY=event.clientY;
  movedRef.current=null;
  const move=(next:PointerEvent)=>{
   if(Math.hypot(next.clientX-startX,next.clientY-startY)<4&&!movedRef.current)return;
   const position={id,x:node.x+(next.clientX-startX)/view.scale,y:node.y+(next.clientY-startY)/view.scale};
   movedRef.current=position;setDragged(position);
  };
  const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancelDrag);window.removeEventListener('blur',cancelDrag);};
  const cancelDrag=()=>{cleanup();movedRef.current=null;setDragged(null);};
  const end=()=>{
   cleanup();const moved=movedRef.current;
   if(moved){onUpdate(p=>({...p,nodes:p.nodes.map(n=>n.id===id?{...n,x:moved.x,y:moved.y}:n)}));suppressNodeClick.current=true;setTimeout(()=>{suppressNodeClick.current=false;},0);}
   movedRef.current=null;setDragged(null);
  };
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});window.addEventListener('pointercancel',cancelDrag,{once:true});window.addEventListener('blur',cancelDrag,{once:true});
 },[project.nodes,view.scale,onSelect,onUpdate]);
 const {draft,beginConnection,clickPort,cancel}=useConnections({areaRef,nodes,edges:project.edges,view,onUpdate});
 const draftNode=nodes.find(n=>n.id===draft?.nodeId);
 const draftStart=draftNode&&draft?portPosition(draftNode,draft.direction):null;
 const draftPath=draft&&draftStart?(draft.direction==='out'?edgeCurve(draftStart.x,draftStart.y,draft.point.x,draft.point.y):edgeCurve(draft.point.x,draft.point.y,draftStart.x,draftStart.y)):null;
 return <main className={`canvas-area ${tool==='hand'?'hand-mode':''} ${draft?'is-connecting':''} ${moving?'viewport-moving':''}`} ref={areaRef} {...mediaImport.handlers} onClickCapture={event=>{if(suppressNodeClick.current){event.preventDefault();event.stopPropagation();suppressNodeClick.current=false;}}} onPointerDown={e=>{if(!(e.target as HTMLElement).closest('button,input,textarea,.canvas-node,.add-panel')){cancel();onSelect(null);pan(e);}}} style={{backgroundPosition:`${view.x}px ${view.y}px`,backgroundSize:`${Math.max(18,32*view.scale)}px ${Math.max(18,32*view.scale)}px`}}>
 {(mediaImport.dragging||mediaImport.importing)&&<div className={`canvas-import-feedback ${mediaImport.dragging?'is-drop-target':''}`} role="status"><Icon name="upload" size={22}/><span>{t(mediaImport.dragging?"Solte para adicionar ao canvas":"Importando arquivos…")}</span></div>}
 {mediaImport.error&&<div className="canvas-import-error" role="alert">{mediaImport.error}</div>}
 <div className="canvas-world" style={{transform:`translate(${view.x}px,${view.y}px) scale(${view.scale})`}}>
 <svg className="canvas-edges" width="5000" height="3000" aria-label={t("Conexões entre os nós")}>{project.edges.map(edge=>{const source=nodes.find(n=>n.id===edge.source),target=nodes.find(n=>n.id===edge.target);if(!source||!target)return null;const start=portPosition(source,'out'),end=portPosition(target,'in');const d=edgeCurve(start.x,start.y,end.x,end.y);return <g key={edge.id} className={`canvas-edge ${selected===source.id||selected===target.id?'highlighted':''}`}><path className="edge-line" d={d}/><path className="edge-flow" d={d}/><path className="edge-hit" d={d} tabIndex={0} role="button" aria-label={t("Remover conexão")} onClick={()=>onUpdate(p=>({...p,edges:p.edges.filter(e=>e.id!==edge.id)}))} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Delete')onUpdate(p=>({...p,edges:p.edges.filter(e=>e.id!==edge.id)}));}}/></g>;})}{draftPath&&<path className="connection-preview" d={draftPath}/>}</svg>
 {nodes.map(node=><NodeCard tourMenuOpen={props.tourMenuOpen&&selected===node.id?true:undefined} key={node.id} node={node} selected={selected===node.id} references={refs.get(node.id)??[]} onSelect={onSelect} onEdit={props.onEdit} onChange={props.onChange} onAction={props.onAction} onDrag={onDrag} onConnect={clickPort} onConnectStart={beginConnection} connectionDirection={draft?.direction} connectionSource={draft?.nodeId} connectionTarget={draft?.hoveredId} onModel={props.onModel}/>)}
 </div>
 <nav className="canvas-tools" aria-label={t("Ferramentas do canvas")}><IconButton icon={(props.tourAddOpen??addOpen)?'close':'plus'} label={t("Adicionar nó")} onClick={()=>setAddOpen(!addOpen)} active={props.tourAddOpen??addOpen}/><i/><IconButton icon="cursor" label={t("Selecionar")} active={tool==='cursor'} onClick={()=>setTool('cursor')}/><IconButton icon="hand" label={t("Mover canvas")} active={tool==='hand'} onClick={()=>setTool('hand')}/><i/><IconButton icon="text" label={t("Adicionar nota")} onClick={()=>props.onAdd('text')}/><IconButton icon="upload" label={t("Importar referência")} onClick={props.onUpload}/><i/><IconButton icon="undo" label={t("Desfazer")} disabled={!props.canUndo} onClick={props.undo}/><IconButton icon="redo" label={t("Refazer")} disabled={!props.canRedo} onClick={props.redo}/><i/><IconButton icon="settings" label={t("Configurações")} onClick={props.onSettings}/></nav>
 {(props.tourAddOpen??addOpen)&&<AddPanel onClose={()=>setAddOpen(false)} onAdd={kind=>{props.onAdd(kind);setAddOpen(false);}} onUpload={props.onUpload} onLibrary={props.onLibrary}/>}
 <div className="canvas-bottom"><Menu label={t("Páginas do projeto")} className="page-switch" trigger={<><Icon name="canvas" size={16}/><span>Canvas 01</span><Icon name="chevron-down" size={13}/></>} items={[{label:'Canvas 01',value:'current',icon:'check'},{label:t("Adicionar imagem"),value:'image',icon:'plus'},{label:t("Adicionar vídeo"),value:'video',icon:'video'}]} onSelect={kind=>kind!=='current'&&props.onAdd(kind as NodeKind)}/><div className="zoom-controls"><IconButton icon="expand" label={t("Ajustar ao conteúdo")} onClick={fit}/><i/><IconButton icon="minus" label={t("Diminuir zoom")} onClick={()=>zoom(-.1)}/><Tooltip content={t("Ajustar ao conteúdo")}><button className="zoom-number" onClick={fit} aria-label={`${t("Ajustar ao conteúdo")}: ${Math.round(view.scale*100)}%`}>{Math.round(view.scale*100)}%</button></Tooltip><IconButton icon="plus" label={t("Aumentar zoom")} onClick={()=>zoom(.1)}/></div></div>
 </main>;
}
