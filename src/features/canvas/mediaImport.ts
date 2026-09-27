import type { CanvasNode } from '../../../shared/project'
import { estimateNodeHeight, placeCanvasNode } from '../../../shared/canvasLayout'

export type CanvasImportPoint = { x: number; y: number }
/** Browser File names can be empty or exceed the project title limit. */
export function importedMediaName(name: string, fallback = 'Imagem colada'): string {
  return name.replace(/[\r\n\x00]/g, '').trim().slice(0, 200) || fallback
}
export function canvasPoint(client: CanvasImportPoint, rect: Pick<DOMRect, 'left' | 'top'>, view: { x: number; y: number; scale: number }): CanvasImportPoint {
  return { x: (client.x - rect.left - view.x) / view.scale, y: (client.y - rect.top - view.y) / view.scale }
}
export function clipboardImages(data: Pick<DataTransfer, 'items' | 'files'>): File[] {
  const files = Array.from(data.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file)
  return files.length ? files : Array.from(data.files ?? []).filter(file => file.type.startsWith('image/'))
}

/** Resolve against the current document when the whole upload batch is ready. */
export function placeImportedNodes(candidates: CanvasNode[], nodes: CanvasNode[], point?: CanvasImportPoint, anchorId?: string | null, heightOf: (node: CanvasNode) => number = estimateNodeHeight): CanvasNode[] {
  const placed: CanvasNode[] = []
  for (const candidate of candidates) {
    const occupied = [...nodes, ...placed]
    if (!point) { placed.push(placeCanvasNode(candidate, occupied, placed.at(-1)?.id ?? anchorId, heightOf)); continue }
    const height = heightOf(candidate)
    const desired = { x: point.x - candidate.width / 2, y: point.y - height / 2 }
    const gap = 64
    const points = [desired, ...occupied.flatMap(node => [
      { x: node.x + node.width + gap, y: desired.y },
      { x: node.x - candidate.width - gap, y: desired.y },
      { x: desired.x, y: node.y + heightOf(node) + gap },
      { x: desired.x, y: node.y - height - gap },
      { x: node.x + node.width + gap, y: node.y },
      { x: node.x, y: node.y + heightOf(node) + gap },
    ])]
    points.sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y))
    const position = points.find(value => occupied.every(node => value.x + candidate.width + 40 <= node.x || value.x >= node.x + node.width + 40 || value.y + height + 40 <= node.y || value.y >= node.y + heightOf(node) + 40))
      ?? { x: Math.max(...occupied.map(node => node.x + node.width), desired.x) + gap, y: desired.y }
    placed.push({ ...candidate, ...position })
  }
  return placed
}
