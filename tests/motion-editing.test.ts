import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultScene, validateMotionScene, type MotionScene } from '../shared/motion'
import { duplicateMotionLayer, motionKeyframeValues, reorderMotionLayer, translateMotionLayer, updateMotionKeyframe } from '../src/features/motion/motionEditing'

const fixture = (): MotionScene => ({ ...structuredClone(defaultScene), layers: [
  { ...structuredClone(defaultScene.layers[0]), id: 'a', x: 100, y: 200, keyframes: [{ time: 0, x: 20, y: 90 }, { time: 1, opacity: .5 }, { time: 2, x: 240, y: 400 }] },
  { ...structuredClone(defaultScene.layers[1]), id: 'b' },
  { ...structuredClone(defaultScene.layers[2]), id: 'c' },
] })

test('duplicating an animated layer offsets its whole path and keeps source data independent', () => {
  const scene = fixture(), before = structuredClone(scene)
  scene.layers[0].customContent = { html: '<strong>Hello</strong>', css: 'strong{color:inherit}' }
  before.layers[0].customContent = structuredClone(scene.layers[0].customContent)
  const next = duplicateMotionLayer(scene, 'a', 'Copy')!
  const layer = next.layers.at(-1)!
  assert.notEqual(layer.id, 'a')
  assert.equal(layer.name, 'Copy')
  assert.equal(layer.x, 130)
  assert.equal(layer.y, 230)
  assert.deepEqual(layer.keyframes, [{ time: 0, x: 50, y: 120 }, { time: 1, opacity: .5 }, { time: 2, x: 270, y: 430 }])
  assert.notEqual(layer.customContent, scene.layers[0].customContent)
  assert.deepEqual(scene, before)
  assert.deepEqual(validateMotionScene(next), next)
})

test('duplicate offsets remain consistent at both base and keyframe schema boundaries', () => {
  const scene = fixture()
  Object.assign(scene.layers[0], { x: 9994, y: 9000, keyframes: [{ time: 0, x: 80, y: 35998 }, { time: 2, x: 9994, y: 9100 }] })
  const next = duplicateMotionLayer(scene, 'a', 'C'.repeat(250))!
  const layer = next.layers.at(-1)!
  assert.equal(layer.name.length, 200)
  assert.equal(layer.x, 10000)
  assert.equal(layer.y, 9002)
  assert.deepEqual(layer.keyframes, [{ time: 0, x: 86, y: 36000 }, { time: 2, x: 10000, y: 9102 }])
  validateMotionScene(next)
})

test('duplicate respects the layer cap and all edits reject custom-code or missing targets', () => {
  const scene = fixture()
  const full = { ...scene, layers: Array.from({ length: 200 }, (_, index) => ({ ...scene.layers[0], id: `layer-${index}` })) }
  assert.equal(duplicateMotionLayer(full, 'layer-0', 'Copy'), null)
  assert.equal(duplicateMotionLayer(scene, 'missing', 'Copy'), null)
  assert.equal(reorderMotionLayer(scene, 'missing', 'forward'), scene)
  assert.deepEqual(updateMotionKeyframe(scene, { layerId: 'a', index: 99 }, { time: 1 }), { scene, selection: [] })
  const custom = { ...scene, customCode: { html: '<b>Scene</b>', css: '', js: '' } }
  assert.equal(duplicateMotionLayer(custom, 'a', 'Copy'), null)
  assert.equal(reorderMotionLayer(custom, 'a', 'forward'), custom)
  assert.deepEqual(updateMotionKeyframe(custom, { layerId: 'a', index: 0 }, { time: 1 }), { scene: custom, selection: [] })
})

test('layer order actions move toward the requested paint order with stable content', () => {
  const scene = fixture()
  const forward = reorderMotionLayer(scene, 'a', 'forward')
  assert.deepEqual(forward.layers.map(layer => layer.id), ['b', 'a', 'c'])
  assert.equal(forward.layers[1], scene.layers[0])
  const backward = reorderMotionLayer(scene, 'b', 'backward')
  assert.deepEqual(backward.layers.map(layer => layer.id), ['b', 'a', 'c'])
  assert.equal(reorderMotionLayer(scene, 'a', 'backward'), scene)
  assert.equal(reorderMotionLayer(scene, 'c', 'forward'), scene)
  assert.deepEqual(scene.layers.map(layer => layer.id), ['a', 'b', 'c'])
})

test('editing a frame snaps its time and tracks the same keyframe after sorting', () => {
  const scene = fixture(), original = structuredClone(scene)
  const result = updateMotionKeyframe(scene, { layerId: 'a', index: 0 }, { time: 2.511, x: 77, ease: 'expo.out' })
  assert.deepEqual(result.selection, [{ layerId: 'a', index: 2 }])
  assert.deepEqual(result.scene.layers[0].keyframes[2], { time: 75 / 30, x: 77, y: 90, ease: 'expo.out' })
  assert.deepEqual(result.scene.layers[0].keyframes.slice(0, 2), scene.layers[0].keyframes.slice(1))
  assert.equal(result.scene.layers[1], scene.layers[1])
  assert.deepEqual(scene, original)
  validateMotionScene(result.scene)
})

test('frame edits clamp legal values, ignore non-finite input and preserve equal-time identity', () => {
  const scene = fixture()
  const capped = updateMotionKeyframe(scene, { layerId: 'a', index: 0 }, { time: 999, opacity: 2, scale: 0, x: -99999, rotation: Infinity })
  assert.deepEqual(capped.scene.layers[0].keyframes.at(-1), { time: 6, x: -36000, y: 90, opacity: 1, scale: .001 })
  validateMotionScene(capped.scene)
  const start = updateMotionKeyframe(scene, { layerId: 'a', index: 2 }, { time: -5 })
  assert.equal(start.scene.layers[0].keyframes[1].time, 0)
  assert.deepEqual(start.selection, [{ layerId: 'a', index: 1 }])
  assert.equal(start.scene.layers[0].keyframes[1].x, 240)
  assert.equal(updateMotionKeyframe(scene, { layerId: 'a', index: 0 }, { time: NaN, x: Infinity }).scene, scene)
})

test('sparse keyframe values inherit prior transforms in temporal order and their own easing', () => {
  const scene = fixture(), layer = scene.layers[0]
  layer.keyframes = [{ time: 2, x: 240, ease: 'expo.out' }, { time: 0, x: 20, y: 90, ease: 'none' }, { time: 1, opacity: .5 }]
  assert.deepEqual(motionKeyframeValues(layer, 2), { x: 20, y: 90, scale: layer.scale, rotation: layer.rotation, opacity: .5, ease: layer.ease })
  assert.deepEqual(motionKeyframeValues(layer, 0), { x: 240, y: 90, scale: layer.scale, rotation: layer.rotation, opacity: .5, ease: 'expo.out' })
})

test('whole-layer translation clamps the group at keyframe boundaries and preserves path spacing', () => {
  const scene = fixture(), layer = scene.layers[0]
  layer.keyframes = [{ time: 0, x: 35998, y: -35999 }, { time: 1, opacity: .5 }, { time: 2, x: 240, y: 400 }]
  const original = structuredClone(layer)
  const moved = translateMotionLayer(layer, 500, -200)
  assert.equal(moved.x, 102)
  assert.equal(moved.y, 199)
  assert.deepEqual(moved.keyframes, [{ time: 0, x: 36000, y: -36000 }, { time: 1, opacity: .5 }, { time: 2, x: 242, y: 399 }])
  assert.equal(moved.keyframes[0].x! - moved.keyframes[2].x!, layer.keyframes[0].x! - layer.keyframes[2].x!)
  assert.deepEqual(layer, original)
  validateMotionScene({ ...scene, layers: [moved] })
})

test('translation respects base bounds, ignores unspecified axes and does not invent sparse values', () => {
  const scene = fixture(), layer = scene.layers[0]
  const moved = translateMotionLayer(layer, -20000)
  assert.equal(moved.x, -10000)
  assert.equal(moved.y, layer.y)
  assert.deepEqual(moved.keyframes, [{ time: 0, x: -10080, y: 90 }, { time: 1, opacity: .5 }, { time: 2, x: -9860, y: 400 }])
  const vertical = translateMotionLayer(layer, undefined, 20000)
  assert.equal(vertical.x, layer.x)
  assert.equal(vertical.y, 10000)
  assert.equal(vertical.keyframes[0].x, layer.keyframes[0].x)
  assert.equal(translateMotionLayer(layer), layer)
  assert.equal(translateMotionLayer(layer, NaN, Infinity), layer)
  validateMotionScene({ ...scene, layers: [moved, { ...vertical, id: 'vertical' }] })
})
