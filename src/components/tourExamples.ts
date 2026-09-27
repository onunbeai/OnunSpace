import type { CanvasNode, Project } from '../../shared/project'
import { estimateNodeHeight, placeCanvasNode } from '../../shared/canvasLayout'
import type { TourStepId } from './GuidedTour'

const referenceImage = new URL('../assets/onboarding-reference.webp', import.meta.url).href

export interface TourExamples { nodes: Project['nodes']; edges: Project['edges'] }
export const emptyTourExamples = (): TourExamples => ({ nodes: [], edges: [] })
export const isTourGenerator = (node: CanvasNode) => (node.kind === 'image' || node.kind === 'video') && !node.generatedFrom && (!node.artwork || node.id === 'generator')

/** Presentation-only examples. These never enter project history, autosave or archives. */
export function prepareTourExamples(project: Project, previous: TourExamples, step: TourStepId, t: (key: string) => string): TourExamples {
  const next = { ...previous, nodes: [...previous.nodes], edges: [...previous.edges] }
  const allNodes = () => [...project.nodes, ...next.nodes]
  const addExample = (kind: 'image' | 'reference') => {
    const node: CanvasNode = { id: `tour-example-${kind}-${crypto.randomUUID()}`, kind, title: t(kind === 'image' ? 'Exemplo · gerar imagem' : 'Exemplo · referência'), x: 120, y: 120, width: kind === 'image' ? 350 : 250, prompt: kind === 'image' ? t('Uma composição com formas orgânicas e luz suave em rosa.') : '', model: 'google/gemini-2.5-flash-image', provider: 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none', ...(kind === 'reference' ? { media: referenceImage, aspectRatio: '7:9' } : {}) }
    const placed = placeCanvasNode(node, allNodes())
    next.nodes.push(placed)
    return placed
  }
  if (['node', 'connections', 'properties', 'models'].includes(step)) {
    const generator = allNodes().find(isTourGenerator) ?? addExample('image')
    if (step === 'connections') {
      const connected = [...project.edges, ...next.edges].some(edge => edge.target === generator.id && allNodes().some(node => node.id === edge.source))
      if (!connected) {
        let reference = allNodes().find(node => node.id !== generator.id && (node.kind === 'reference' || node.kind === 'text' || node.media))
        if (!reference) {
          reference = addExample('reference')
          const x = generator.x - reference.width - 96, y = generator.y
          const height = estimateNodeHeight(reference)
          // References feed from left to right; only place the new demonstration in free space.
          const free = allNodes().filter(node => node.id !== reference!.id).every(node => x + reference!.width + 48 <= node.x || x >= node.x + node.width + 48 || y + height + 48 <= node.y || y >= node.y + estimateNodeHeight(node) + 48)
          if (free) { reference.x = x; reference.y = y }
        }
        next.edges.push({ id: `tour-example-edge-${crypto.randomUUID()}`, source: reference.id, target: generator.id })
      }
    }
  }
  if (step === 'library' && !allNodes().some(node => node.kind !== 'text')) addExample('reference')
  return next
}
