import { useCallback, useEffect, useRef, useState } from 'react'

export function useMotionPlayback(duration: number, fps: number, initialTime = 0, sceneId = '') {
  const [time, setTime] = useState(Math.min(initialTime, duration))
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const timeRef = useRef(time)
  const previousSceneId = useRef(sceneId)
  useEffect(() => {
    if (previousSceneId.current === sceneId) return
    previousSceneId.current = sceneId
    setPlaying(false)
    setTime(Math.min(initialTime, duration))
  }, [sceneId, initialTime, duration])
  useEffect(() => { timeRef.current = time }, [time])
  useEffect(() => { setTime(current => Math.min(current, duration)) }, [duration])
  useEffect(() => {
    if (!playing) return
    const started = performance.now() - (timeRef.current >= duration ? 0 : timeRef.current * 1000)
    let frame = 0
    const tick = (now: number) => {
      const elapsed = (now - started) / 1000
      const next = loop ? elapsed % duration : Math.min(duration, elapsed)
      setTime(Math.min(duration, Math.round(next * fps) / fps))
      if (!loop && next >= duration) setPlaying(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration, fps, loop])
  const seek = useCallback((next: number) => { const value = Math.max(0, Math.min(duration, next)); timeRef.current = value; setPlaying(false); setTime(value) }, [duration])
  const toggle = useCallback(() => setPlaying(value => !value), [])
  return { time, playing, seek, setPlaying, toggle, loop, setLoop }
}
