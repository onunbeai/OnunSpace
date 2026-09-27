import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasPoint, clipboardImages, placeImportedNodes } from '../src/features/canvas/mediaImport'
import { estimateNodeHeight } from '../shared/canvasLayout'
import type { CanvasNode } from '../shared/project'
const node = (id: string, x = 0, y = 0): CanvasNode => ({ id, x, y, width:250, kind:'reference', title:id, prompt:'', model:'', provider:'openrouter', aspectRatio:'1:1', resolution:'1K', count:1, status:'none', generationStatus:'idle', media:'data:image/png;base64,AA==' })
const overlaps = (a:CanvasNode,b:CanvasNode) => a.x < b.x+b.width && a.x+a.width>b.x && a.y<b.y+estimateNodeHeight(b)&&a.y+estimateNodeHeight(a)>b.y

test('drop coordinates follow both pan and zoom, including the canvas screen offset', () => {
 assert.deepEqual(canvasPoint({x:640,y:440},{left:100,top:60},{x:-60,y:80,scale:.5}),{x:1200,y:600})
})
test('an empty canvas preserves the requested drop point as the image center', () => {
 const [placed] = placeImportedNodes([node('a')],[],{x:500,y:400})
 assert.equal(placed.x+placed.width/2,500)
 assert.equal(placed.y+estimateNodeHeight(placed)/2,400)
})
test('batch imports avoid existing nodes and each other without changing those nodes', () => {
 const existing = [node('existing',375,240),node('already-uploaded',700,240)]
 const original = structuredClone(existing)
 const added = placeImportedNodes(Array.from({length:12},(_,i)=>node(`new-${i}`)),existing,{x:500,y:400})
 assert.deepEqual(existing,original)
 for(const [i,a] of added.entries()) for(const b of [...existing,...added.slice(0,i)]) assert.equal(overlaps(a,b),false,`${a.id} overlaps ${b.id}`)
})
test('pasting text returns no images, while clipboard image items are not duplicated by the files list', () => {
 const image = new File(['image'],'pasted.png',{type:'image/png'})
 const text = {kind:'string',type:'text/plain',getAsFile:()=>null} as DataTransferItem
 const item = {kind:'file',type:'image/png',getAsFile:()=>image} as DataTransferItem
 assert.deepEqual(clipboardImages({items:[text] as unknown as DataTransferItemList,files:[] as unknown as FileList}),[])
 assert.deepEqual(clipboardImages({items:[text,item] as unknown as DataTransferItemList,files:[image] as unknown as FileList}),[image])
})
