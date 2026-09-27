export function edgeCurve(x1:number,y1:number,x2:number,y2:number){
 const distance=Math.abs(x2-x1);const bend=Math.max(70,Math.min(260,distance*.48+Math.abs(y2-y1)*.12));
 return `M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`;
}
