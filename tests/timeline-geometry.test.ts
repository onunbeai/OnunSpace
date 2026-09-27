import test from 'node:test'
import assert from 'node:assert/strict'
import { adjacentKeyframe, stepTimelineFrame, timelineRuler } from '../src/features/motion/timelineGeometry'

test('frame stepping reaches adjacent frames from subframe positions and clamps at composition edges', () => {
  assert.equal(stepTimelineFrame(.051, 1, 30, 6), 2 / 30)
  assert.equal(stepTimelineFrame(.051, -1, 30, 6), 1 / 30)
  assert.equal(stepTimelineFrame(1, 1, 30, 6), 31 / 30)
  assert.equal(stepTimelineFrame(1, -1, 30, 6, 10), 20 / 30)
  assert.equal(stepTimelineFrame(0, -1, 60, 6), 0)
  assert.equal(stepTimelineFrame(5.99, 1, 30, 6), 6)
})

test('keyframe navigation skips the current time and handles duplicates and missing neighbors', () => {
  const times = [6, 1.2, 0, 1.2, 2.3]
  assert.equal(adjacentKeyframe(times, 1.2, -1), 0)
  assert.equal(adjacentKeyframe(times, 1.2, 1), 2.3)
  assert.equal(adjacentKeyframe(times, 0, -1), undefined)
  assert.equal(adjacentKeyframe([], 0, 1), undefined)
})

test('ruler stays frame aligned at all supported frame rates and reveals more detail when zooming', () => {
  for (const fps of [1, 24, 25, 30, 60]) {
    const wide = timelineRuler(6, fps, 1600)
    const narrow = timelineRuler(6, fps, 400)
    assert.ok(wide.interval <= narrow.interval)
    for (const tick of wide.ticks) assert.ok(Math.abs(tick.time * fps - Math.round(tick.time * fps)) < 1e-7)
    assert.equal(wide.ticks[0].label, '0s')
    assert.equal(wide.ticks.at(-1)?.label, '6s')
    for (const tick of narrow.ticks.filter(tick => tick.label && tick.time > 0 && tick.time < 6)) assert.ok((6 - tick.time) / 6 * 400 >= 48)
  }
  assert.equal(timelineRuler(5.75, 30, 800).ticks.at(-1)?.label, '5.75s')
})
