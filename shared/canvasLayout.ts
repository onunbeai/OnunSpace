import type {CanvasNode} from './project';

export function estimateNodeHeight(node:CanvasNode):number{
 if(node.kind==='text')return 200;
 if(node.kind==='motion')return 310;
 if(!node.generatedFrom&&(node.id==='generator'||(!node.artwork&&node.kind!=='reference')))return 660;
 if(node.artwork)return {brand:254,orb:321,poster:396,type:341,motion:310}[node.artwork];
 if(node.media&&!node.generatedFrom)return 321;
 const [w,h]=node.aspectRatio.split(':').map(Number);
 return Math.max(100,node.width*(h||1)/(w||1)+36);
}

export function placeCanvasNode(candidate:CanvasNode,nodes:CanvasNode[],anchorId?:string|null,heightOf:(node:CanvasNode)=>number=estimateNodeHeight):CanvasNode{
 if(!nodes.length)return{...candidate,x:120,y:120};
 const gap=96;
 const anchor=nodes.find(node=>node.id===anchorId)??nodes.at(-1)!;
 const desired={x:anchor.x+anchor.width+gap,y:anchor.y};
 const occupied=nodes.map(node=>({...node,height:heightOf(node)}));
 const height=heightOf(candidate);
 const points=[desired,...occupied.flatMap(node=>[
  {x:node.x+node.width+gap,y:node.y},
  {x:node.x,y:node.y+node.height+gap},
  {x:node.x+node.width+gap,y:node.y+node.height+gap},
 ])];
 points.sort((a,b)=>(Math.abs(a.x-desired.x)+Math.abs(a.y-desired.y))-(Math.abs(b.x-desired.x)+Math.abs(b.y-desired.y)));
 const position=points.find(point=>occupied.every(node=>point.x+candidate.width+48<=node.x||point.x>=node.x+node.width+48||point.y+height+48<=node.y||point.y>=node.y+node.height+48));
 return{...candidate,...(position??{x:Math.max(...occupied.map(node=>node.x+node.width))+gap,y:desired.y})};
}
