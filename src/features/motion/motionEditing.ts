import { motionEases, type MotionKeyframe, type MotionLayer, type MotionScene } from '../../../shared/motion'
import type { KeyframeSelection } from './timelineSelection'

const transformProperties = ['x', 'y', 'scale', 'rotation', 'opacity'] as const

/** Move the entire animation together, respecting both base and keyframe position limits. */
export function translateMotionLayer(layer: MotionLayer, requestedX?: number, requestedY?: number): MotionLayer {
  const deltaFor = (axis: 'x' | 'y', requested?: number) => {
    if (requested === undefined || !Number.isFinite(requested)) return 0
    const positions = layer.keyframes.flatMap(frame => frame[axis] === undefined ? [] : [frame[axis]!])
    const minimum = Math.max(-10000 - layer[axis], ...positions.map(value => -36000 - value))
    const maximum = Math.min(10000 - layer[axis], ...positions.map(value => 36000 - value))
    return Math.max(minimum, Math.min(maximum, requested - layer[axis]))
  }
  const dx = deltaFor('x', requestedX), dy = deltaFor('y', requestedY)
  if (!dx && !dy) return layer
  return {
    ...layer,
    x: layer.x + dx,
    y: layer.y + dy,
    keyframes: layer.keyframes.map(frame => ({
      ...frame,
      ...(dx && frame.x !== undefined ? { x: frame.x + dx } : {}),
      ...(dy && frame.y !== undefined ? { y: frame.y + dy } : {}),
    })),
  }
}

/** Duplicate the complete animation, including its absolute position keyframes. */
export function duplicateMotionLayer(scene: MotionScene, id: string, name: string): MotionScene | null {
  const source = scene.layers.find(layer => layer.id === id)
  if (scene.customCode || !source || scene.layers.length >= 200) return null
  const offset = (axis: 'x' | 'y') => Math.max(0, Math.min(30, 10000 - source[axis], ...source.keyframes.flatMap(frame => frame[axis] === undefined ? [] : [36000 - frame[axis]!])))
  const dx = offset('x'), dy = offset('y')
  const layer: MotionLayer = {
    ...structuredClone(source),
    id: `layer-${crypto.randomUUID()}`,
    name: name.slice(0, 200),
    x: source.x + dx,
    y: source.y + dy,
    keyframes: source.keyframes.map(frame => ({ ...frame, ...(frame.x === undefined ? {} : { x: frame.x + dx }), ...(frame.y === undefined ? {} : { y: frame.y + dy }) })),
  }
  return { ...scene, layers: [...scene.layers, layer] }
}

/** Scene layers are painted back to front, so a larger index moves forward. */
export function reorderMotionLayer(scene: MotionScene, id: string, direction: 'forward' | 'backward'): MotionScene {
  const index = scene.layers.findIndex(layer => layer.id === id)
  const destination = index + (direction === 'forward' ? 1 : -1)
  if (scene.customCode || index < 0 || destination < 0 || destination >= scene.layers.length) return scene
  const layers = [...scene.layers]
  ;[layers[index], layers[destination]] = [layers[destination], layers[index]]
  return { ...scene, layers }
}

/** Resolve sparse values through the selected keyframe in playback order. */
export function motionKeyframeValues(layer: MotionLayer, index: number): Omit<MotionKeyframe, 'time'> {
  const values: Omit<MotionKeyframe, 'time'> = { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, opacity: layer.opacity, ease: layer.keyframes[index]?.ease ?? layer.ease }
  if (!layer.keyframes[index]) return values
  const ordered = layer.keyframes.map((frame, originalIndex) => ({ frame, originalIndex })).sort((a, b) => a.frame.time - b.frame.time)
  for (const { frame, originalIndex } of ordered) {
    for (const property of transformProperties) if (frame[property] !== undefined) values[property] = frame[property]
    if (originalIndex === index) break
  }
  return values
}

export function updateMotionKeyframe(scene: MotionScene, item: KeyframeSelection, patch: Partial<MotionKeyframe>): { scene: MotionScene; selection: KeyframeSelection[] } {
  const layer = scene.layers.find(candidate => candidate.id === item.layerId)
  const original = layer?.keyframes[item.index]
  if (scene.customCode || !layer || !original) return { scene, selection: [] }
  const frame = { ...original }
  if (patch.time !== undefined && Number.isFinite(patch.time)) frame.time = Math.max(0, Math.min(scene.duration, Math.round(patch.time * scene.fps) / scene.fps))
  for (const property of transformProperties) {
    const value = patch[property]
    if (value === undefined || !Number.isFinite(value)) continue
    const min = property === 'opacity' ? 0 : property === 'scale' ? .001 : -36000
    const max = property === 'opacity' ? 1 : 36000
    frame[property] = Math.max(min, Math.min(max, value))
  }
  if (patch.ease !== undefined && motionEases.includes(patch.ease)) frame.ease = patch.ease
  if (Object.keys(frame).every(key => frame[key as keyof MotionKeyframe] === original[key as keyof MotionKeyframe])) return { scene, selection: [item] }
  const ordered = layer.keyframes.map((candidate, index) => ({ frame: index === item.index ? frame : candidate, selected: index === item.index })).sort((a, b) => a.frame.time - b.frame.time)
  return {
    scene: { ...scene, layers: scene.layers.map(candidate => candidate.id === layer.id ? { ...candidate, keyframes: ordered.map(entry => entry.frame) } : candidate) },
    selection: [{ layerId: layer.id, index: ordered.findIndex(entry => entry.selected) }],
  }
}
