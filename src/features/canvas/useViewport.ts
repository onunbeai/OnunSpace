import {useCallback,useEffect,useRef,useState} from 'react';
import type {CanvasNode,Project} from '../../../shared/project';
import {nodeHeight} from './layout';
export function useViewport(project:Project,ready:boolean,focusTarget?:{id:string;key:string;relatedIds?:string[]}){
 const areaRef=useRef<HTMLDivElement>(null);
 const fittedProject=useRef<string|null>(null);
 const knownNodes=useRef<{projectId:string;ids:Set<string>}|null>(null);
 const animationTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [moving,setMoving]=useState(false);
 const [view,setView]=useState({x:0,y:0,scale:.7});
 const fit=useCallback(()=>{const box=areaRef.current?.getBoundingClientRect();if(!box)return;const nodes=project.nodes;const left=nodes.length?Math.min(...nodes.map(n=>n.x)):100;const top=nodes.length?Math.min(...nodes.map(n=>n.y)):100;const right=nodes.length?Math.max(...nodes.map(n=>n.x+n.width)):1000;const bottom=nodes.length?Math.max(...nodes.map(n=>n.y+nodeHeight(n))):700;const w=right-left+50,h=bottom-top+30;const scale=Math.max(.25,Math.min((box.width-145)/w,(box.height-90)/h,1.2));setView({x:85+(box.width-145-w*scale)/2-left*scale,y:45+(box.height-90-h*scale)/2-top*scale,scale});},[project.nodes]);
 useEffect(()=>{if(!ready||fittedProject.current===project.id)return;fit();fittedProject.current=project.id;},[ready,project.id,fit]); // Fit the loaded project once, preserving the viewport on later edits.
 const reveal=useCallback((target:CanvasNode|CanvasNode[])=>{
  const nodes=Array.isArray(target)?target:[target];if(!nodes.length)return;
  const box=areaRef.current?.getBoundingClientRect();if(!box)return;
  const inspector=document.querySelector('.node-inspector')?.getBoundingClientRect();
  const availableWidth=inspector?Math.min(box.width,Math.max(260,inspector.left-box.left)):box.width;
  const left=Math.min(...nodes.map(node=>node.x)),top=Math.min(...nodes.map(node=>node.y));
  const width=Math.max(...nodes.map(node=>node.x+node.width))-left;
  const height=Math.max(...nodes.map(node=>node.y+nodeHeight(node)))-top;
  setMoving(true);clearTimeout(animationTimer.current);
  setView(current=>{
   const scale=Math.max(.2,Math.min(current.scale,(availableWidth-160)/(width+80),(box.height-160)/height));
   return{scale,x:80+(availableWidth-80)/2-(left+width/2)*scale,y:box.height/2-(top+height/2)*scale};
  });
  animationTimer.current=setTimeout(()=>setMoving(false),320);
 },[]);
 useEffect(()=>{
  if(!ready)return;
  const previous=knownNodes.current;
  knownNodes.current={projectId:project.id,ids:new Set(project.nodes.map(node=>node.id))};
  if(!previous||previous.projectId!==project.id)return;
  const added=project.nodes.filter(node=>!previous.ids.has(node.id));
  const sources=new Set(added.flatMap(node=>node.generatedFrom?[node.generatedFrom]:[]));
  if(added.length)reveal([...added,...project.nodes.filter(node=>sources.has(node.id)&&!added.includes(node))]);
 },[ready,project.id,project.nodes,reveal]);
 useEffect(()=>{
  if(!ready||!focusTarget)return;
  const node=project.nodes.find(node=>node.id===focusTarget.id);
  if(node)reveal([node,...project.nodes.filter(item=>focusTarget.relatedIds?.includes(item.id))]);
 },[ready,focusTarget,project.nodes,reveal]);
 useEffect(()=>()=>clearTimeout(animationTimer.current),[]);

 const zoom=(delta:number)=>{setMoving(false);setView(v=>{const rect=areaRef.current?.getBoundingClientRect();const scale=Math.min(2,Math.max(.2,v.scale+delta));const cx=(rect?.width??1200)/2,cy=(rect?.height??800)/2;return {scale,x:cx-(cx-v.x)*scale/v.scale,y:cy-(cy-v.y)*scale/v.scale};});};
 const pan=(e:React.PointerEvent)=>{setMoving(false);if(e.button!==0&&e.button!==1)return;const start={...view};const target=e.currentTarget;target.setPointerCapture(e.pointerId);const move=(ev:PointerEvent)=>setView({scale:start.scale,x:start.x+(ev.clientX-e.clientX),y:start.y+(ev.clientY-e.clientY)});const end=()=>{target.removeEventListener('pointermove',move as EventListener);target.removeEventListener('pointerup',end);};target.addEventListener('pointermove',move as EventListener);target.addEventListener('pointerup',end,{once:true});};
 useEffect(()=>{const el=areaRef.current;if(!el)return;const wheel=(e:WheelEvent)=>{setMoving(false);e.preventDefault();if(e.ctrlKey||e.metaKey){const box=el.getBoundingClientRect();setView(v=>{const scale=Math.min(2,Math.max(.2,v.scale*Math.exp(-e.deltaY*.006)));const x=e.clientX-box.left,y=e.clientY-box.top;return {scale,x:x-(x-v.x)*scale/v.scale,y:y-(y-v.y)*scale/v.scale};});}else{setView(v=>({...v,x:v.x-e.deltaX,y:v.y-e.deltaY}));}};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
 return {areaRef,view,moving,setView,fit,zoom,pan};
}
