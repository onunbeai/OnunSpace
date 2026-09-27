import type {CanvasNode} from '../../../shared/project';
import {estimateNodeHeight,placeCanvasNode} from '../../../shared/canvasLayout';

export function nodeHeight(node:CanvasNode):number{
 if(typeof document!=='undefined'){
  const element=document.querySelector<HTMLElement>(`.canvas-node[data-node-id="${CSS.escape(node.id)}"]`);
  if(element?.offsetHeight)return element.offsetHeight;
 }
 return estimateNodeHeight(node);
}

export function placeNode(candidate:CanvasNode,nodes:CanvasNode[],anchorId?:string|null):CanvasNode{
 return placeCanvasNode(candidate,nodes,anchorId,nodeHeight);
}
