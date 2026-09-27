import {useCallback,useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent,RefObject} from 'react';
import type {CanvasNode,Project} from '../../../shared/project';

type Direction='in'|'out';
type Port={nodeId:string;direction:Direction};
type Point={x:number;y:number};
export type ConnectionDraft=Port&{point:Point;hoveredId:string|null;dragging:boolean};

export function portPosition(node:CanvasNode,direction:Direction):Point{
 return {x:direction==='out'?node.x+node.width+23:node.x-23,y:node.y+125};
}

export function useConnections({areaRef,nodes,edges,view,onUpdate}:{
 areaRef:RefObject<HTMLDivElement|null>;
 nodes:CanvasNode[];
 edges:Project['edges'];
 view:{x:number;y:number;scale:number};
 onUpdate:(updater:(project:Project)=>Project)=>void;
}){
 const[draft,setDraft]=useState<ConnectionDraft|null>(null);
 const active=useRef<ConnectionDraft|null>(null);
 const pressed=useRef<(Port&{x:number;y:number;pointerId:number;moved:boolean})|null>(null);
 const suppressClick=useRef(false);
 const clickReset=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const latest=useRef({nodes,edges,view,onUpdate});latest.current={nodes,edges,view,onUpdate};
 const display=useCallback((next:ConnectionDraft|null)=>{active.current=next;setDraft(next);},[]);
 const cancel=useCallback(()=>{pressed.current=null;display(null);},[display]);
 const valid=useCallback((from:Port,to:Port)=>{
  if(from.nodeId===to.nodeId||from.direction===to.direction)return false;
  const source=from.direction==='out'?from.nodeId:to.nodeId;
  const target=from.direction==='in'?from.nodeId:to.nodeId;
  return latest.current.nodes.some(n=>n.id===source)&&latest.current.nodes.some(n=>n.id===target&&n.kind!=='reference');
 },[]);
 const commit=useCallback((from:Port,to:Port)=>{
  if(!valid(from,to))return;
  const source=from.direction==='out'?from.nodeId:to.nodeId;
  const target=from.direction==='in'?from.nodeId:to.nodeId;
  if(latest.current.edges.some(edge=>edge.source===source&&edge.target===target))return;
  latest.current.onUpdate(project=>({...project,edges:[...project.edges,{id:crypto.randomUUID(),source,target}]}));
 },[valid]);
 const hitPort=useCallback((x:number,y:number):Port|null=>{
  const element=document.elementFromPoint(x,y)?.closest<HTMLButtonElement>('.port[data-port][data-node]');
  if(!element||!areaRef.current?.contains(element))return null;
  const direction=element.dataset.port;
  return element.dataset.node&&(direction==='in'||direction==='out')?{nodeId:element.dataset.node,direction}:null;
 },[areaRef]);
 const beginConnection=useCallback((event:ReactPointerEvent<HTMLButtonElement>,nodeId:string,direction:Direction)=>{
  if(event.button!==0)return;
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
  pressed.current={nodeId,direction,x:event.clientX,y:event.clientY,pointerId:event.pointerId,moved:false};
 },[]);
 const clickPort=useCallback((nodeId:string,direction:Direction)=>{
  if(suppressClick.current){suppressClick.current=false;return;}
  const port={nodeId,direction};
  if(active.current&&active.current.direction!==direction){commit(active.current,port);cancel();return;}
  if(active.current?.nodeId===nodeId&&active.current.direction===direction){cancel();return;}
  const node=latest.current.nodes.find(n=>n.id===nodeId);
  if(node)display({...port,point:portPosition(node,direction),hoveredId:null,dragging:false});
 },[cancel,commit,display]);
 useEffect(()=>{
  const move=(event:PointerEvent)=>{
   const down=pressed.current;
   if(down&&event.pointerId!==down.pointerId)return;
   if(down&&!down.moved){if(Math.hypot(event.clientX-down.x,event.clientY-down.y)<4)return;down.moved=true;}
   const from=down??active.current;
   if(!from)return;
   const bounds=areaRef.current?.getBoundingClientRect();
   if(!bounds)return;
   const {view:camera,nodes:currentNodes}=latest.current;
   const hit=hitPort(event.clientX,event.clientY);
   const target=hit&&valid(from,hit)?currentNodes.find(n=>n.id===hit.nodeId):undefined;
   const point=target&&hit?portPosition(target,hit.direction):{x:(event.clientX-bounds.left-camera.x)/camera.scale,y:(event.clientY-bounds.top-camera.y)/camera.scale};
   display({nodeId:from.nodeId,direction:from.direction,point,hoveredId:target?.id??null,dragging:!!down});
  };
  const up=(event:PointerEvent)=>{
   const down=pressed.current;
   if(!down||event.pointerId!==down.pointerId)return;
   pressed.current=null;
   if(!down.moved)return;
   suppressClick.current=true;
   clearTimeout(clickReset.current);
   clickReset.current=setTimeout(()=>{suppressClick.current=false;},0);
   const hit=hitPort(event.clientX,event.clientY);
   if(hit)commit(down,hit);
   display(null);
  };
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')cancel();};
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',cancel);
  window.addEventListener('blur',cancel);
  window.addEventListener('keydown',escape);
  return()=>{
   window.removeEventListener('pointermove',move);
   window.removeEventListener('pointerup',up);
   window.removeEventListener('pointercancel',cancel);
   window.removeEventListener('blur',cancel);
   window.removeEventListener('keydown',escape);
   clearTimeout(clickReset.current);
  };
 },[areaRef,cancel,commit,display,hitPort,valid]);
 return {draft,beginConnection,clickPort,cancel};
}
