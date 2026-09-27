import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultScene, frameTimestamps, validateMotionScene } from '../shared/motion'
import { resolveRenderSettings } from '../server/render'
import { buildSceneDocument } from '../src/features/motion/sceneDocument'

test('frame times are deterministic, begin at zero and exclude the terminal duplicate frame', () => {
  const timestamps = frameTimestamps(1, 30)
  assert.equal(timestamps.length, 30)
  assert.equal(timestamps[0], 0)
  assert.equal(timestamps[29], 29 / 30)
  assert.deepEqual(frameTimestamps(1, 30), timestamps)
  assert.throws(() => frameTimestamps(121, 30))
  assert.throws(() => frameTimestamps(1, 29.5))
})
test('scene validation rejects oversized workloads, duplicate IDs and non-finite frame properties', () => {
  const scene = validateMotionScene(defaultScene)
  assert.notEqual(scene.layers, defaultScene.layers)
  assert.throws(() => validateMotionScene({ ...scene, width: 4096, height: 4096 }))
  assert.throws(() => validateMotionScene({ ...scene, layers: [scene.layers[0], scene.layers[0]] }))
  const invalid = structuredClone(scene)
  invalid.layers[0].keyframes[0].opacity = NaN
  assert.throws(() => validateMotionScene(invalid))
})
test('renderer respects finite even resolution and produces proportional draft settings', () => {
  assert.deepEqual(resolveRenderSettings(defaultScene, { quality: 'draft' }), { width: 960, height: 540, fps: 30, quality: 'draft', format: 'mp4' })
  assert.throws(() => resolveRenderSettings(defaultScene, { width: 1001 }))
  assert.throws(() => resolveRenderSettings(defaultScene, { fps: 120 }))
})
test('scene data cannot escape inline script and generated document disallows network access', () => {
  const scene = structuredClone(defaultScene)
  scene.layers[0].text = '</script><img src="https://example.com">'
  const html = buildSceneDocument(scene, '')
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /\\u003c\/script\\u003e/)
  assert.doesNotMatch(html, /<img src="https:\/\/example.com">/)
  assert.match(html, /__ONUN_MOTION__/)
})
