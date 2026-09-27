import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultScene, validateMotionScene, type MotionLayer } from '../shared/motion'
import { applyMotionPreset, motionPresetRange, motionPresets } from '../src/features/motion/animationPresets'

const layer: MotionLayer = { ...defaultScene.layers[4], start: 1.5, end: 4, x: -100, y: 80, rotation: 42, scale: 1.7, opacity: .6 }

test('all presets replace old frames with editable, valid animation inside the layer interval', () => {
  const original = structuredClone(layer)
  for (const preset of motionPresets) {
    const patch = applyMotionPreset(layer, preset.id, 6, 10)!
    assert.ok(patch.keyframes.length >= 2 && patch.keyframes.length <= 100)
    assert.equal(patch.keyframes[0].time, layer.start)
    assert.equal(patch.keyframes.at(-1)!.time, layer.end)
    assert.ok(patch.keyframes.every((frame, index, frames) => frame.time >= layer.start && frame.time <= layer.end && (index === 0 || frame.time > frames[index - 1].time)))
    validateMotionScene({ ...defaultScene, layers: [{ ...layer, ...patch }] })
  }
  assert.deepEqual(layer, original)
})

test('entrances restore the complete base transform, including non-default opacity and scale', () => {
  for (const preset of ['fade-in', 'slide-up', 'scale-in'] as const) {
    const patch = applyMotionPreset(layer, preset, 6, .75)!
    assert.deepEqual(patch.keyframes.at(-1), { time: 2.25, x: -100, y: 80, scale: 1.7, rotation: 42, opacity: .6 })
    assert.equal(patch.keyframes[0].opacity, 0)
  }
  assert.equal(applyMotionPreset(layer, 'scale-in', 6)!.keyframes[0].scale, 1.7 * .7)
  assert.ok(applyMotionPreset(layer, 'slide-up', 6)!.keyframes[0].y! > layer.y)
})

test('fade out is aligned to the layer end and keeps its base pose until the exit starts', () => {
  const patch = applyMotionPreset(layer, 'fade-out', 6, .5)!
  assert.equal(patch.keyframes[0].time, 3.5)
  assert.equal(patch.keyframes[0].opacity, .6)
  assert.equal(patch.keyframes[1].time, 4)
  assert.equal(patch.keyframes[1].opacity, 0)
  assert.equal(patch.keyframes[1].scale, 1.7)
})

test('tiny intervals never collapse through timestamp rounding or leave scene bounds', () => {
  const tiny = { ...layer, start: 5.999999999, end: 6 }
  for (const preset of motionPresets) {
    const patch = applyMotionPreset(tiny, preset.id, 6, .8)!
    assert.ok(patch.keyframes.length >= 2)
    assert.equal(patch.keyframes[0].time, tiny.start)
    assert.equal(patch.keyframes.at(-1)!.time, tiny.end)
    validateMotionScene({ ...defaultScene, layers: [{ ...tiny, ...patch }] })
  }
  const smallest = { ...layer, start: 1, end: 1 + Number.EPSILON }
  const patch = applyMotionPreset(smallest, 'float', 6)!
  assert.equal(patch.keyframes.length, 2)
  assert.ok(patch.keyframes[1].time > patch.keyframes[0].time)
})

test('zero length, inverted and invalid intervals cannot apply an animation', () => {
  for (const candidate of [{ ...layer, end: layer.start }, { ...layer, end: 1 }, { ...layer, start: Number.NaN }, { ...layer, start: 9, end: 12 }]) {
    assert.equal(applyMotionPreset(candidate, 'fade-in', 6), null)
  }
  assert.equal(motionPresetRange(layer, 0), null)
  assert.equal(motionPresetRange(layer, Number.POSITIVE_INFINITY), null)
})

test('scale and rotation stay valid at their legal boundaries', () => {
  for (const scale of [.001, 100]) {
    const candidate = { ...layer, scale }
    const patch = applyMotionPreset(candidate, 'scale-in', 6)!
    validateMotionScene({ ...defaultScene, layers: [{ ...candidate, ...patch }] })
    assert.equal(patch.keyframes.at(-1)!.scale, scale)
  }
  for (const rotation of [-36000, 35900, 36000]) {
    const candidate = { ...layer, rotation }
    const patch = applyMotionPreset(candidate, 'spin', 6)!
    validateMotionScene({ ...defaultScene, layers: [{ ...candidate, ...patch }] })
    assert.equal(Math.abs(patch.keyframes[1].rotation! - rotation), 360)
  }
})

test('invalid requested durations fall back to a finite duration within the layer', () => {
  for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    const patch = applyMotionPreset(layer, 'fade-in', 6, duration)!
    assert.equal(patch.keyframes.at(-1)!.time, 2.3)
  }
})
