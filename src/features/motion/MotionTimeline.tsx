import { useRef, useState, type PointerEvent } from 'react'
import { useI18n } from '../../lib/i18n'
import type { MotionScene } from '../../../shared/motion'
import { Icon } from '../../components/Icon'
import { Tooltip } from '../../components/ui'
import { deleteKeyframes, keyframeKey, moveKeyframes, validSelection, type KeyframeSelection, type LayerPatches } from './timelineSelection'

interface TimelineProps {
  scene: MotionScene; selectedId: string; time: number; playing: boolean
  selection: KeyframeSelection[]; onSelectionChange: (selection: KeyframeSelection[]) => void
  onSelect: (id: string) => void; onSeek: (time: number) => void; onToggle: () => void
  onUpdateLayers: (patches: LayerPatches) => void
}
interface KeyDrag { x: number; width: number; selection: KeyframeSelection[]; anchorTime: number; moved: boolean; delta: number }
interface MarqueeDrag { x: number; y: number; initial: KeyframeSelection[]; layerId: string }

export function MotionTimeline({ scene, selectedId, time, playing, selection, onSelectionChange, onSelect, onSeek, onToggle, onUpdateLayers }: TimelineProps) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const keyDrag = useRef<KeyDrag | null>(null)
  const marqueeDrag = useRef<MarqueeDrag | null>(null)
  const suppressClick = useRef(false)
  const [dragDelta, setDragDelta] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const selected = validSelection(scene, selection)
  const selectedKeys = new Set(selected.map(keyframeKey))
  const divisions = Math.round(12 * zoom)
  const steps = Array.from({ length: divisions + 1 }, (_, index) => index * scene.duration / divisions)
  const toggleSelection = (item: KeyframeSelection, additive: boolean) => {
    const key = keyframeKey(item)
    const next = additive ? selectedKeys.has(key) ? selected.filter(frame => keyframeKey(frame) !== key) : [...selected, item] : [item]
    onSelectionChange(next)
    onSelect(item.layerId)
    return next
  }
  const moveSelection = (delta: number, fallback?: KeyframeSelection) => {
    const items = selected.length ? selected : fallback ? [fallback] : []
    const result = moveKeyframes(scene, items, delta)
    if (!result.delta) return
    onUpdateLayers(result.patches)
    onSelectionChange(result.selection)
    const first = result.selection[0]
    if (first) onSeek(result.patches[first.layerId].keyframes![first.index].time)
  }
  const startKeyDrag = (event: PointerEvent<HTMLButtonElement>, item: KeyframeSelection, frameTime: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    const next = additive ? toggleSelection(item, true) : selectedKeys.has(keyframeKey(item)) ? selected : toggleSelection(item, false)
    onSelect(item.layerId)
    if (!next.some(frame => keyframeKey(frame) === keyframeKey(item))) return
    event.currentTarget.setPointerCapture(event.pointerId)
    keyDrag.current = { x: event.clientX, width: event.currentTarget.parentElement!.clientWidth, selection: next, anchorTime: frameTime, moved: false, delta: 0 }
  }
  const marqueePoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const firstTrack = event.currentTarget.querySelector('.motion-track')?.getBoundingClientRect()
    return { x: Math.max((firstTrack?.left ?? bounds.left) - bounds.left, Math.min(bounds.width - 18, event.clientX - bounds.left)), y: Math.max(32, Math.min(bounds.height, event.clientY - bounds.top)) }
  }
  return <section className="motion-timeline" aria-label={t('Linha do tempo')} onKeyDown={event => {
    if (!(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[role="textbox"],[role="menu"],[role="dialog"],[contenteditable]:not([contenteditable="false"])') || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onSelectionChange([]); keyDrag.current = null; marqueeDrag.current = null; setDragDelta(0); setMarquee(null) }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); onSelectionChange(scene.layers.flatMap(layer => layer.keyframes.map((_, index) => ({ layerId: layer.id, index })))) }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const focused = event.target.closest<HTMLElement>('[data-keyframe-index]')
      const targets = selected.length ? selected : focused ? validSelection(scene, [{ layerId: focused.dataset.layerId!, index: Number(focused.dataset.keyframeIndex) }]) : []
      if (event.repeat || targets.length || focused) {
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat && !scene.customCode && targets.length) { onUpdateLayers(deleteKeyframes(scene, targets)); onSelectionChange([]) }
      }
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-keyframe-index]')
      const fallback = button ? { layerId: button.dataset.layerId!, index: Number(button.dataset.keyframeIndex) } : undefined
      if (selected.length || fallback) { event.preventDefault(); event.stopPropagation(); moveSelection((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1) / scene.fps, fallback) }
    }
  }}>
    <div className="motion-timeline-toolbar">
      <div className="motion-transport">
        <Tooltip content={t('Ir ao início')}><button aria-label={t('Ir ao início')} onClick={() => onSeek(0)}><Icon name="skip-back" size={15} /></button></Tooltip>
        <Tooltip content={playing ? t('Pausar animação') : t('Reproduzir animação')}><button className="motion-play-button" aria-label={playing ? t('Pausar animação') : t('Reproduzir animação')} onClick={onToggle}><Icon name={playing ? 'pause' : 'play'} size={15} /></button></Tooltip>
        <Tooltip content={t('Ir ao fim')}><button aria-label={t('Ir ao fim')} onClick={() => onSeek(scene.duration)}><Icon name="skip-forward" size={15} /></button></Tooltip>
      </div>
      <span className="motion-timecode">{time.toFixed(2)} <span>/ {scene.duration.toFixed(2)} s</span></span>
      <span className="motion-timeline-selection-count" aria-live="polite">{selected.length > 0 && <><span className="motion-diamond" />{t('{count} selecionados', { count: selected.length })}</>}</span>
      <div className="motion-timeline-spacer" /><span className="motion-muted">{scene.fps} fps</span>
      <div className="motion-timeline-zoom">
        <Tooltip content={t('Diminuir zoom da timeline')}><button aria-label={t('Diminuir zoom da timeline')} disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><Icon name="minus" size={13} /></button></Tooltip>
        <Tooltip content={t('Ajustar timeline')}><button className="motion-timeline-zoom-value" aria-label={t('Ajustar timeline')} onClick={() => { setZoom(1); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }}>{Math.round(zoom * 100)}%</button></Tooltip>
        <Tooltip content={t('Ampliar timeline')}><button aria-label={t('Ampliar timeline')} disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .5))}><Icon name="plus" size={13} /></button></Tooltip>
      </div>
    </div>
    <div className="motion-timeline-scroll" ref={scrollRef}><div className="motion-timeline-content" style={{ width: `${zoom * 100}%` }} onPointerDown={event => {
      if (event.button !== 0 || !(event.target as HTMLElement).classList.contains('motion-track')) return
      const point = marqueePoint(event)
      const initial = event.shiftKey || event.metaKey || event.ctrlKey ? selected : []
      marqueeDrag.current = { ...point, initial, layerId: (event.target as HTMLElement).dataset.layerId! }
      onSelectionChange(initial)
      event.currentTarget.setPointerCapture(event.pointerId)
      setMarquee({ ...point, width: 0, height: 0 })
    }} onPointerMove={event => {
      const drag = marqueeDrag.current
      if (!drag) return
      const point = marqueePoint(event)
      const rectangle = { x: Math.min(drag.x, point.x), y: Math.min(drag.y, point.y), width: Math.abs(point.x - drag.x), height: Math.abs(point.y - drag.y) }
      setMarquee(rectangle)
      const bounds = event.currentTarget.getBoundingClientRect()
      const items = [...drag.initial]
      event.currentTarget.querySelectorAll<HTMLElement>('.motion-keyframe').forEach(element => {
        const keyBounds = element.getBoundingClientRect()
        const x = keyBounds.left + keyBounds.width / 2 - bounds.left, y = keyBounds.top + keyBounds.height / 2 - bounds.top
        if (x >= rectangle.x && x <= rectangle.x + rectangle.width && y >= rectangle.y && y <= rectangle.y + rectangle.height) items.push({ layerId: element.dataset.layerId!, index: Number(element.dataset.keyframeIndex) })
      })
      onSelectionChange(validSelection(scene, items))
    }} onPointerUp={event => {
      const drag = marqueeDrag.current
      if (!drag) return
      const point = marqueePoint(event)
      if (Math.abs(point.x - drag.x) < 3 && Math.abs(point.y - drag.y) < 3) onSelect(drag.layerId)
      marqueeDrag.current = null; setMarquee(null)
    }} onPointerCancel={() => { marqueeDrag.current = null; setMarquee(null) }}>
      <div className="motion-ruler-row"><span className="motion-ruler-label"><Icon name="layers" size={13} />{t('Camadas')}<span>{scene.layers.length}</span></span><div className="motion-ruler"><div className="motion-ruler-ticks">{steps.map((step, index) => <span key={step} style={{ left: `${index / (steps.length - 1) * 100}%` }}>{step.toFixed(1)}s</span>)}</div><Tooltip content={t('Posição na linha do tempo')}><input aria-label={t('Posição na linha do tempo')} type="range" min="0" max={scene.duration} step={1 / scene.fps} value={time} onChange={event => onSeek(Number(event.target.value))} /></Tooltip><span className="motion-ruler-playhead" style={{ left: `${time / scene.duration * 100}%` }} /></div></div>
      {[...scene.layers].reverse().map((layer, layerIndex) => <div className={`motion-track-row ${selectedId === layer.id ? 'is-selected' : ''} ${selection.some(item => item.layerId === layer.id) ? 'has-keyframe-selection' : ''}`} key={layer.id}>
        <Tooltip content={layer.name}><button className="motion-track-label" onClick={() => { onSelect(layer.id); onSelectionChange([]) }}><span className="motion-track-index">{String(layerIndex + 1).padStart(2, '0')}</span><Icon name={layer.type === 'text' ? 'text' : 'layers'} size={13} /><span>{layer.name}</span></button></Tooltip>
        <div className="motion-track" data-layer-id={layer.id}>
          <div className="motion-track-bar" aria-hidden="true" style={{ left: `${layer.start / scene.duration * 100}%`, width: `${(layer.end - layer.start) / scene.duration * 100}%` }} />
          {layer.keyframes.map((keyframe, index) => {
            const item = { layerId: layer.id, index }, active = selectedKeys.has(keyframeKey(item))
            const dragging = keyDrag.current?.selection.some(frame => keyframeKey(frame) === keyframeKey(item))
            return <Tooltip content={t('Keyframe em {time}s', { time: keyframe.time.toFixed(2) })} key={`${layer.id}-${index}`}><button className={`motion-keyframe ${active ? 'is-keyframe-selected' : ''}`} data-layer-id={layer.id} data-keyframe-index={index} aria-pressed={active} aria-label={t('{name}: keyframe {time} segundos. Delete para remover.', { name: layer.name, time: keyframe.time.toFixed(2) })} style={{ left: `${(keyframe.time + (dragging ? dragDelta : 0)) / scene.duration * 100}%` }} onFocus={() => onSelect(layer.id)} onPointerDown={event => startKeyDrag(event, item, keyframe.time)} onPointerMove={event => {
              const drag = keyDrag.current
              if (!drag) return
              if (Math.abs(event.clientX - drag.x) < 3 && !drag.moved) return
              drag.moved = true
              const requestedDelta = (event.clientX - drag.x) / drag.width * scene.duration
              const result = moveKeyframes(scene, drag.selection, requestedDelta)
              drag.delta = requestedDelta; setDragDelta(result.delta)
            }} onPointerUp={() => {
              const drag = keyDrag.current
              if (!drag) return
              if (drag.moved) { const result = moveKeyframes(scene, drag.selection, drag.delta); if (result.delta) onUpdateLayers(result.patches); onSelectionChange(result.selection); onSeek(drag.anchorTime + result.delta); suppressClick.current = true }
              keyDrag.current = null; setDragDelta(0)
            }} onPointerCancel={() => { keyDrag.current = null; setDragDelta(0) }} onClick={event => {
              if (suppressClick.current) { suppressClick.current = false; return }
              if (!event.shiftKey && !event.metaKey && !event.ctrlKey) onSeek(keyframe.time)
            }} onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); toggleSelection(item, event.shiftKey || event.metaKey || event.ctrlKey); onSeek(keyframe.time) }
            }} /></Tooltip>
          })}
          <div className="motion-track-playhead" style={{ left: `${time / scene.duration * 100}%` }} />
        </div>
      </div>)}
      {marquee && <div className="motion-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
    </div></div>
  </section>
}
