import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultScene, validateMotionScene, type MotionScene } from '../shared/motion'
import { deleteKeyframes, easeKeyframes, moveKeyframes, validSelection } from '../src/features/motion/timelineSelection'

const fixture = (): MotionScene => ({ ...structuredClone(defaultScene), layers: [
  { ...structuredClone(defaultScene.layers[0]), id: 'a', keyframes: [{ time: .35, x: 1 }, { time: 1.65, x: 2 }, { time: 4, x: 3 }] },
  { ...structuredClone(defaultScene.layers[1]), id: 'b', keyframes: [{ time: .1, y: 1 }, { time: 3, y: 2 }, { time: 5.5, y: 3 }] },
] })

test('group movement clamps to scene bounds and preserves cross-layer relative spacing', () => {
  const scene = fixture(), selection = [{ layerId: 'a', index: 0 }, { layerId: 'b', index: 1 }]
  const right = moveKeyframes(scene, selection, 100)
  assert.equal(right.delta, 3)
  assert.equal(right.patches.a.keyframes![1].time, 3.35)
  assert.equal(right.patches.b.keyframes![2].time, 6)
  const left = moveKeyframes(scene, selection, -100)
  assert.equal(left.delta, -.35)
  assert.equal(left.patches.a.keyframes![0].time, 0)
  assert.equal(left.patches.b.keyframes![1].time, 2.65)
  assert.equal(scene.layers[0].keyframes[0].time, .35)
})
test('moving across another keyframe remaps the selected indices and preserves values', () => {
  const moved = moveKeyframes(fixture(), [{ layerId: 'a', index: 1 }], 3)
  assert.deepEqual(moved.selection, [{ layerId: 'a', index: 2 }])
  assert.deepEqual(moved.patches.a.keyframes, [{ time: .35, x: 1 }, { time: 4, x: 3 }, { time: 4.65, x: 2 }])
})
test('delete and easing affect only selected keys across layers', () => {
  const scene = fixture(), selection = [{ layerId: 'a', index: 1 }, { layerId: 'b', index: 0 }]
  const removed = deleteKeyframes(scene, selection)
  assert.deepEqual(removed.a.keyframes?.map(frame => frame.time), [.35, 4])
  assert.deepEqual(removed.b.keyframes?.map(frame => frame.time), [3, 5.5])
  const eased = easeKeyframes(scene, selection, 'expo.out')
  assert.equal(eased.a.keyframes![1].ease, 'expo.out')
  assert.equal(eased.b.keyframes![0].ease, 'expo.out')
  assert.equal(eased.a.keyframes![0].ease, undefined)
})
test('stale and duplicate selection entries are discarded', () => {
  assert.deepEqual(validSelection(fixture(), [{ layerId: 'a', index: 0 }, { layerId: 'a', index: 0 }, { layerId: 'a', index: 99 }, { layerId: 'missing', index: 0 }]), [{ layerId: 'a', index: 0 }])
})
test('keyframe easing is optional, persisted, and restricted to supported GSAP curves', () => {
  const scene = fixture()
  const patches = easeKeyframes(scene, [{ layerId: 'b', index: 1 }], 'power2.out')
  scene.layers = scene.layers.map(layer => ({ ...layer, ...patches[layer.id] }))
  assert.equal(validateMotionScene(scene).layers[1].keyframes[1].ease, 'power2.out')
  const invalid = structuredClone(scene)
  Object.assign(invalid.layers[1].keyframes[1], { ease: 'invalid' })
  assert.throws(() => validateMotionScene(invalid), /keyframe/)
})
