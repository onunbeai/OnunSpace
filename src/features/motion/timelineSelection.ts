import type { MotionEase, MotionLayer, MotionScene } from '../../../shared/motion'

export interface KeyframeSelection { layerId: string; index: number }
export type LayerPatches = Record<string, Partial<MotionLayer>>
export const keyframeKey = ({ layerId, index }: KeyframeSelection) => `${layerId}:${index}`

export function validSelection(scene: MotionScene, selection: KeyframeSelection[]) {
  const keys = new Set<string>()
  return selection.filter(item => {
    const key = keyframeKey(item)
    if (keys.has(key) || !scene.layers.find(layer => layer.id === item.layerId)?.keyframes[item.index]) return false
    keys.add(key)
    return true
  })
}

export function moveKeyframes(scene: MotionScene, selection: KeyframeSelection[], requestedDelta: number) {
  const selected = validSelection(scene, selection)
  const keys = new Set(selected.map(keyframeKey))
  const times = selected.map(item => scene.layers.find(layer => layer.id === item.layerId)!.keyframes[item.index].time)
  if (!times.length) return { patches: {} as LayerPatches, selection: selected, delta: 0 }
  // Snap the whole group, preserving relative spacing even for imported subframe keys.
  const snapped = Math.round(requestedDelta * scene.fps) / scene.fps
  const delta = Math.max(-Math.min(...times), Math.min(scene.duration - Math.max(...times), snapped))
  const patches: LayerPatches = {}
  const nextSelection: KeyframeSelection[] = []
  for (const layer of scene.layers) {
    if (!selected.some(item => item.layerId === layer.id)) continue
    const sorted = layer.keyframes.map((frame, index) => ({
      frame: keys.has(keyframeKey({ layerId: layer.id, index })) ? { ...frame, time: Math.round((frame.time + delta) * 1e9) / 1e9 } : frame,
      selected: keys.has(keyframeKey({ layerId: layer.id, index })),
    })).sort((a, b) => a.frame.time - b.frame.time)
    patches[layer.id] = { keyframes: sorted.map(item => item.frame) }
    sorted.forEach((item, index) => { if (item.selected) nextSelection.push({ layerId: layer.id, index }) })
  }
  return { patches, selection: nextSelection, delta }
}

export function deleteKeyframes(scene: MotionScene, selection: KeyframeSelection[]): LayerPatches {
  const keys = new Set(validSelection(scene, selection).map(keyframeKey))
  return Object.fromEntries(scene.layers.filter(layer => selection.some(item => item.layerId === layer.id)).map(layer => [layer.id, { keyframes: layer.keyframes.filter((_, index) => !keys.has(keyframeKey({ layerId: layer.id, index }))) }]))
}

export function easeKeyframes(scene: MotionScene, selection: KeyframeSelection[], ease: MotionEase): LayerPatches {
  const keys = new Set(validSelection(scene, selection).map(keyframeKey))
  return Object.fromEntries(scene.layers.filter(layer => selection.some(item => item.layerId === layer.id)).map(layer => [layer.id, { keyframes: layer.keyframes.map((frame, index) => keys.has(keyframeKey({ layerId: layer.id, index })) ? { ...frame, ease } : frame) }]))
}
