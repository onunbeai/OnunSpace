import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type {CanvasNode} from '../../shared/project';
import {Artwork} from '../features/canvas/Artwork';
import {Icon} from './Icon';
import {IconButton} from './ui';
import './media-preview.css';
import {useI18n} from '../lib/i18n';

const artworkHeight={brand:218,orb:285,type:305,motion:231,poster:360};

export function MediaPreview({node,onClose}:{node:CanvasNode;onClose:()=>void}){
 const{t}=useI18n();
 const viewportRef=useRef<HTMLDivElement>(null);
 const center=useRef({x:.5,y:.5});
 const[viewport,setViewport]=useState({width:800,height:600});
 const[size,setSize]=useState(node.media?{width:1600,height:900}:{width:node.width,height:node.artwork?artworkHeight[node.artwork]:300});
 const[zoom,setZoom]=useState(1);
 const[failed,setFailed]=useState(false);
 const fit=Math.max(.01,Math.min(Math.max(1,viewport.width-64)/size.width,Math.max(1,viewport.height-64)/size.height));
 const scale=fit*zoom;
 const width=Math.max(1,Math.floor(size.width*scale*1000)/1000),height=Math.max(1,Math.floor(size.height*scale*1000)/1000);

 const observeStage=useCallback((element:HTMLDivElement|null)=>{
  if(!element)return;
  const measure=()=>{
   const bounds=element.getBoundingClientRect();
   const width=Math.floor(bounds.width),height=Math.floor(bounds.height);
   setViewport(current=>current.width===width&&current.height===height?current:{width,height});
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(element);
  return()=>observer.disconnect();
 },[]);
 useLayoutEffect(()=>{
  const element=viewportRef.current;if(!element)return;
  element.scrollLeft=Math.max(0,center.current.x*element.scrollWidth-element.clientWidth/2);
  element.scrollTop=Math.max(0,center.current.y*element.scrollHeight-element.clientHeight/2);
 },[width,height,viewport.width,viewport.height]);
 const changeZoom=(next:number)=>{
  const element=viewportRef.current;
  if(element)center.current={x:(element.scrollLeft+element.clientWidth/2)/element.scrollWidth,y:(element.scrollTop+element.clientHeight/2)/element.scrollHeight};
  setZoom(Math.min(8,Math.max(.25,next)));
 };
 const fitView=()=>{
  center.current={x:.5,y:.5};setZoom(1);
  const element=viewportRef.current;if(element){element.scrollLeft=(element.scrollWidth-element.clientWidth)/2;element.scrollTop=(element.scrollHeight-element.clientHeight)/2;}
 };
 return <Dialog.Root open onOpenChange={open=>!open&&onClose()}><Dialog.Portal>
  <Dialog.Overlay className="media-preview-overlay"/>
  <Dialog.Content className="media-preview" aria-describedby={undefined} onKeyDown={event=>{if(event.target instanceof HTMLVideoElement)return;if(event.key==='+'||event.key==='='){event.preventDefault();changeZoom(zoom*1.25);}if(event.key==='-'){event.preventDefault();changeZoom(zoom/1.25);}if(event.key==='0'){event.preventDefault();fitView();}}}>
   <header className="media-preview-heading"><Dialog.Title>{node.title}</Dialog.Title><Dialog.Close asChild><button className="icon-button" aria-label={t("Fechar visualização")}><Icon name="close" size={19}/></button></Dialog.Close></header>
   <div className="media-preview-stage" ref={observeStage}>
   <div className="media-preview-viewport" ref={viewportRef} tabIndex={0} role="region" aria-label={t("Área de visualização")}>
    <div className="media-preview-surface" style={{width:Math.max(viewport.width,width+64),height:Math.max(viewport.height,height+64)}}>
     {failed?<div className="media-preview-error" role="alert"><Icon name={node.kind==='video'?'video':'image'} size={30}/><span>{node.kind==='video'?t("Vídeo indisponível"):t("Imagem indisponível")}</span></div>:<div className="media-preview-frame" style={{width,height}}>
      {node.media?(node.kind==='video'?<video src={node.media} controls preload="metadata" aria-label={node.title} onLoadedMetadata={event=>{const video=event.currentTarget;if(video.videoWidth&&video.videoHeight)setSize({width:video.videoWidth,height:video.videoHeight});}} onError={()=>setFailed(true)}/>:<img src={node.media} alt={node.title} draggable={false} onLoad={event=>setSize({width:event.currentTarget.naturalWidth||1,height:event.currentTarget.naturalHeight||1})} onError={()=>setFailed(true)}/>):<div className="media-preview-artwork" style={{width:size.width,height:size.height,transform:`scale(${scale})`}}>{node.kind==='text'?<div className="media-preview-note">{node.prompt}</div>:<Artwork node={node}/>}</div>}
     </div>}
    </div>
   </div>
   </div>
   <footer className="media-preview-footer"><div className="media-preview-controls" role="group" aria-label={t("Zoom da visualização")}><IconButton icon="minus" label={t("Diminuir visualização")} onClick={()=>changeZoom(zoom/1.25)} disabled={zoom<=.25}/><output aria-label={t("Ampliação da visualização")}>{Math.round(scale*100)}%</output><IconButton icon="plus" label={t("Ampliar visualização")} onClick={()=>changeZoom(zoom*1.25)} disabled={zoom>=8}/><i/><IconButton icon="fit" label={t("Ajustar visualização")} onClick={fitView}/></div></footer>
  </Dialog.Content>
 </Dialog.Portal></Dialog.Root>;
}
