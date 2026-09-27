/** Timeline positions remain in seconds; ruler marks and transport steps align to frames. */
export function stepTimelineFrame(time: number, direction: -1 | 1, fps: number, duration: number, count = 1) {
  const frame = direction > 0 ? Math.floor(time * fps + 1e-7) : Math.ceil(time * fps - 1e-7)
  return Math.max(0, Math.min(duration, (frame + direction * count) / fps))
}

export function adjacentKeyframe(times: number[], time: number, direction: -1 | 1) {
  const candidates = times.filter(value => Number.isFinite(value) && (direction > 0 ? value > time + 1e-7 : value < time - 1e-7))
  return candidates.length ? (direction > 0 ? Math.min(...candidates) : Math.max(...candidates)) : undefined
}

export function timelineRuler(duration: number, fps: number, width: number) {
  const targetFrames = duration * fps / Math.max(1, width / 84)
  const candidates = [...new Set([1, 2, 5, 10, 15, ...[.5, 1, 2, 5, 10, 15, 30, 60, 120].map(seconds => Math.round(seconds * fps))])].filter(value => value > 0).sort((a, b) => a - b)
  const majorFrames = candidates.find(value => value >= targetFrames) ?? Math.ceil(targetFrames)
  const divisions = [5, 4, 2].find(value => majorFrames % value === 0 && width * majorFrames / (duration * fps * value) >= 10) ?? 1
  const minorFrames = majorFrames / divisions
  const ticks: { time: number; major: boolean; label: string }[] = []
  const format = (seconds: number) => `${Number(seconds.toFixed(2))}s`
  for (let frame = 0; frame <= duration * fps + 1e-7; frame += minorFrames) {
    const major = frame % majorFrames === 0
    ticks.push({ time: frame / fps, major, label: major ? format(frame / fps) : '' })
  }
  // Show the exact composition end while keeping its label clear of the last major mark.
  const end = ticks.find(tick => Math.abs(tick.time - duration) < 1e-7)
  if (end) { end.major = true; end.label = format(duration) }
  else ticks.push({ time: duration, major: true, label: format(duration) })
  ticks.forEach(tick => { if (tick.time > 0 && tick.time < duration && (duration - tick.time) / duration * width < 48) tick.label = '' })
  return { ticks, interval: majorFrames / fps }
}
