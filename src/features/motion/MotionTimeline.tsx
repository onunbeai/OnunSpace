import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useI18n } from '../../lib/i18n'
import type { MotionScene } from '../../../shared/motion'
import { Icon } from '../../components/Icon'
import { Menu, Tooltip } from '../../components/ui'
import { deleteKeyframes, keyframeKey, moveKeyframes, validSelection, type KeyframeSelection, type LayerPatches } from './timelineSelection'
import { adjacentKeyframe, stepTimelineFrame, timelineRuler } from './timelineGeometry'
import './motion-timeline.css'

interface TimelineProps {
  scene: MotionScene; selectedId: string; time: number; playing: boolean
  selection: KeyframeSelection[]; onSelectionChange: (selection: KeyframeSelection[]) => void
  onSelect: (id: string) => void; onSeek: (time: number) => void; onToggle: () => void
  onUpdateLayers: (patches: LayerPatches) => void
  loop?: boolean; onLoopChange?: (loop: boolean) => void; onAddLayer?: () => void
}
interface KeyDrag { x: number; scrollLeft: number; width: number; selection: KeyframeSelection[]; anchorTime: number; moved: boolean; delta: number }
interface MarqueeDrag { x: number; y: number; initial: KeyframeSelection[]; layerId: string; moved: boolean }

export function MotionTimeline({ scene, selectedId, time, playing, selection, onSelectionChange, onSelect, onSeek, onToggle, onUpdateLayers, loop = true, onLoopChange, onAddLayer }: TimelineProps) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const keyDrag = useRef<KeyDrag | null>(null)
  const marqueeDrag = useRef<MarqueeDrag | null>(null)
  const suppressClick = useRef(false)
  const [dragDelta, setDragDelta] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rulerWidth, setRulerWidth] = useState(720)
  const [labelWidth, setLabelWidth] = useState(212)
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const selected = validSelection(scene, selection)
  const selectedKeys = new Set(selected.map(keyframeKey))
  const ruler = timelineRuler(scene.duration, scene.fps, rulerWidth)
  const navigationLayer = scene.layers.find(layer => layer.id === selectedId)
  const keyTimes = (navigationLayer ? [navigationLayer] : scene.layers).flatMap(layer => layer.keyframes.map(frame => frame.time))
  const previousKey = adjacentKeyframe(keyTimes, time, -1), nextKey = adjacentKeyframe(keyTimes, time, 1)
  const hasKeyframes = scene.layers.some(layer => layer.keyframes.length > 0)

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (rulerRef.current) setRulerWidth(rulerRef.current.clientWidth)
      if (labelRef.current) setLabelWidth(labelRef.current.clientWidth)
    })
    if (rulerRef.current) observer.observe(rulerRef.current)
    if (labelRef.current) observer.observe(labelRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current, rulerElement = rulerRef.current
    if (!scroll || !rulerElement || keyDrag.current || marqueeDrag.current) return
    const viewport = scroll.getBoundingClientRect(), bounds = rulerElement.getBoundingClientRect()
    const position = bounds.left + time / scene.duration * bounds.width
    const left = viewport.left + labelWidth + 14, right = viewport.right - 24
    if (position < left) scroll.scrollLeft -= left - position
    else if (position > right) scroll.scrollLeft += position - right
  }, [time, scene.duration, labelWidth])

  const seek = (value: number) => onSeek(Math.max(0, Math.min(scene.duration, value)))
  const toggleSelection = (item: KeyframeSelection, additive: boolean) => {
    const key = keyframeKey(item)
    const next = additive ? selectedKeys.has(key) ? selected.filter(frame => keyframeKey(frame) !== key) : [...selected, item] : [item]
    onSelectionChange(next)
    onSelect(item.layerId)
    return next
  }
  const removeSelection = () => {
    if (scene.customCode || !selected.length) return
    onUpdateLayers(deleteKeyframes(scene, selected)); onSelectionChange([])
  }
  const moveSelection = (delta: number, fallback?: KeyframeSelection) => {
    if (scene.customCode) return
    const items = selected.length ? selected : fallback ? [fallback] : []
    const result = moveKeyframes(scene, items, delta)
    if (!result.delta) return
    onUpdateLayers(result.patches)
    onSelectionChange(result.selection)
    const first = result.selection[0]
    if (first) seek(result.patches[first.layerId].keyframes![first.index].time)
  }
  const startKeyDrag = (event: PointerEvent<HTMLButtonElement>, item: KeyframeSelection, frameTime: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    suppressClick.current = false
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    const next = additive ? toggleSelection(item, true) : selectedKeys.has(keyframeKey(item)) ? selected : toggleSelection(item, false)
    onSelect(item.layerId)
    if (scene.customCode || !next.some(frame => keyframeKey(frame) === keyframeKey(item))) return
    event.currentTarget.setPointerCapture(event.pointerId)
    keyDrag.current = { x: event.clientX, scrollLeft: scrollRef.current?.scrollLeft ?? 0, width: event.currentTarget.parentElement!.clientWidth, selection: next, anchorTime: frameTime, moved: false, delta: 0 }
  }
  const scrollNearEdge = (clientX: number) => {
    const scroll = scrollRef.current
    if (!scroll) return
    const bounds = scroll.getBoundingClientRect()
    if (clientX > bounds.right - 28) scroll.scrollLeft += 14
    else if (clientX < bounds.left + labelWidth + 14) scroll.scrollLeft -= 14
  }
  const marqueePoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const firstTrack = event.currentTarget.querySelector('.motion-track')?.getBoundingClientRect()
    return { x: Math.max((firstTrack?.left ?? bounds.left) - bounds.left, Math.min(bounds.width - 22, event.clientX - bounds.left)), y: Math.max(32, Math.min(bounds.height, event.clientY - bounds.top)) }
  }
  const resetDrag = () => { keyDrag.current = null; setDragDelta(0) }
  const resetMarquee = () => { marqueeDrag.current = null; setMarquee(null) }
  const navigateKey = (direction: -1 | 1) => {
    const target = direction > 0 ? nextKey : previousKey
    if (target !== undefined) seek(target)
  }

  return <section className="motion-timeline motion-timeline-enhanced" aria-label={t('Linha do tempo')} tabIndex={0} onKeyDown={event => {
    if (!(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[role="textbox"],[role="menu"],[role="dialog"],[contenteditable]:not([contenteditable="false"])') || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onSelectionChange([]); resetDrag(); resetMarquee() }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); onSelectionChange(scene.layers.flatMap(layer => layer.keyframes.map((_, index) => ({ layerId: layer.id, index })))) }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const focused = event.target.closest<HTMLElement>('[data-keyframe-index]')
      const targets = selected.length ? selected : focused ? validSelection(scene, [{ layerId: focused.dataset.layerId!, index: Number(focused.dataset.keyframeIndex) }]) : []
      if (event.repeat || targets.length || focused) {
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat && !scene.customCode && targets.length) { onUpdateLayers(deleteKeyframes(scene, targets)); onSelectionChange([]) }
      }
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.metaKey && !event.ctrlKey) {
      const direction = event.key === 'ArrowRight' ? 1 : -1
      event.preventDefault(); event.stopPropagation()
      if (event.altKey) { navigateKey(direction); return }
      const button = event.target.closest<HTMLElement>('[data-keyframe-index]')
      const fallback = button ? { layerId: button.dataset.layerId!, index: Number(button.dataset.keyframeIndex) } : undefined
      if (selected.length || fallback) moveSelection(direction * (event.shiftKey ? 10 : 1) / scene.fps, fallback)
      else seek(stepTimelineFrame(time, direction, scene.fps, scene.duration, event.shiftKey ? 10 : 1))
    }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); event.stopPropagation(); seek(event.key === 'Home' ? 0 : scene.duration) }
  }}>
    <div className="motion-timeline-toolbar">
      <div className="motion-transport">
        <Tooltip content={t('Ir ao início')}><button className="motion-boundary-control" aria-label={t('Ir ao início')} disabled={time <= 0} onClick={() => seek(0)}><Icon name="skip-back" size={14} /></button></Tooltip>
        <Tooltip content={t('Quadro anterior')}><button aria-label={t('Quadro anterior')} disabled={time <= 0} onClick={() => seek(stepTimelineFrame(time, -1, scene.fps, scene.duration))}><Icon name="chevron-left" size={15} /></button></Tooltip>
        <Tooltip content={playing ? t('Pausar animação') : t('Reproduzir animação')}><button className="motion-play-button" aria-label={playing ? t('Pausar animação') : t('Reproduzir animação')} onClick={onToggle}><Icon name={playing ? 'pause' : 'play'} size={15} /></button></Tooltip>
        <Tooltip content={t('Próximo quadro')}><button aria-label={t('Próximo quadro')} disabled={time >= scene.duration} onClick={() => seek(stepTimelineFrame(time, 1, scene.fps, scene.duration))}><Icon name="chevron-right" size={15} /></button></Tooltip>
        <Tooltip content={t('Ir ao fim')}><button className="motion-boundary-control" aria-label={t('Ir ao fim')} disabled={time >= scene.duration} onClick={() => seek(scene.duration)}><Icon name="skip-forward" size={14} /></button></Tooltip>
      </div>
      <span className="motion-timecode">{time.toFixed(2)} <span>/ {scene.duration.toFixed(2)} s</span></span>
      {onLoopChange && <Tooltip content={t('Repetir reprodução')}><button className={`motion-loop-button ${loop ? 'is-active' : ''}`} aria-label={t('Repetir reprodução')} aria-pressed={loop} onClick={() => onLoopChange(!loop)}><Icon name="redo" size={14} /></button></Tooltip>}
      <div className="motion-keyframe-navigation">
        <Tooltip content={t('Keyframe anterior')}><button aria-label={t('Keyframe anterior')} disabled={previousKey === undefined} onClick={() => navigateKey(-1)}><Icon name="chevron-left" size={12} /></button></Tooltip>
        <Tooltip content={navigationLayer ? t('Keyframes de {name}', { name: navigationLayer.name }) : t('Keyframes da composição')}><span className="motion-keyframe-navigation-label"><span className="motion-diamond" /></span></Tooltip>
        <Tooltip content={t('Próximo keyframe')}><button aria-label={t('Próximo keyframe')} disabled={nextKey === undefined} onClick={() => navigateKey(1)}><Icon name="chevron-right" size={12} /></button></Tooltip>
      </div>
      <span className="motion-timeline-selection-count" aria-live="polite">{selected.length > 0 && <><span className="motion-diamond" />{t('{count} selecionados', { count: selected.length })}</>}</span>
      <div className="motion-timeline-spacer" />
      <div className="motion-timeline-zoom">
        <Tooltip content={t('Diminuir zoom da timeline')}><button aria-label={t('Diminuir zoom da timeline')} disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><Icon name="minus" size={13} /></button></Tooltip>
        <Tooltip content={t('Ajustar timeline')}><button className="motion-timeline-zoom-value" aria-label={t('Ajustar timeline')} onClick={() => { setZoom(1); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }}>{Math.round(zoom * 100)}%</button></Tooltip>
        <Tooltip content={t('Ampliar timeline')}><button aria-label={t('Ampliar timeline')} disabled={zoom >= 8} onClick={() => setZoom(value => Math.min(8, value + .5))}><Icon name="plus" size={13} /></button></Tooltip>
      </div>
      <Menu label={t('Opções da timeline')} className="motion-timeline-menu" align="end" trigger={<Icon name="more" size={16} />} items={[
        { label: t('Keyframe anterior'), value: 'previous-key', icon: 'chevron-left', disabled: previousKey === undefined },
        { label: t('Próximo keyframe'), value: 'next-key', icon: 'chevron-right', disabled: nextKey === undefined },
        ...(onLoopChange ? [{ label: t('Repetir reprodução'), value: 'loop', icon: loop ? 'check' as const : 'redo' as const }] : []),
        { label: t('Selecionar todos os keyframes'), value: 'select-all', icon: 'layers', hint: '⌘/Ctrl A', disabled: !hasKeyframes },
        { label: t('Limpar seleção'), value: 'clear', hint: 'Esc', disabled: !selected.length },
        { label: t('Remover keyframes selecionados'), value: 'delete', icon: 'trash', hint: '⌫', danger: true, disabled: !selected.length || !!scene.customCode },
        { label: t('Ajustar timeline'), value: 'fit', icon: 'fit', separator: true },
      ]} onSelect={action => {
        if (action === 'previous-key') navigateKey(-1)
        if (action === 'next-key') navigateKey(1)
        if (action === 'loop') onLoopChange?.(!loop)
        if (action === 'select-all') onSelectionChange(scene.layers.flatMap(layer => layer.keyframes.map((_, index) => ({ layerId: layer.id, index }))))
        if (action === 'clear') onSelectionChange([])
        if (action === 'delete') removeSelection()
        if (action === 'fit') { setZoom(1); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }
      }} />
    </div>
    <div className="motion-timeline-scroll" ref={scrollRef}><div className="motion-timeline-content" style={{ width: `calc(${zoom * 100}% - ${(zoom - 1) * labelWidth}px)`, '--motion-track-grid': `${ruler.interval / scene.duration * 100}%` } as CSSProperties} onPointerDown={event => {
      if (event.button !== 0 || !(event.target as HTMLElement).classList.contains('motion-track')) return
      const point = marqueePoint(event)
      const initial = event.shiftKey || event.metaKey || event.ctrlKey ? selected : []
      marqueeDrag.current = { ...point, initial, layerId: (event.target as HTMLElement).dataset.layerId!, moved: false }
      onSelectionChange(initial)
      event.currentTarget.focus({ preventScroll: true })
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={event => {
      const drag = marqueeDrag.current
      if (!drag) return
      scrollNearEdge(event.clientX)
      const point = marqueePoint(event)
      if (!drag.moved && Math.abs(point.x - drag.x) < 3 && Math.abs(point.y - drag.y) < 3) return
      drag.moved = true
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
      if (!drag.moved) {
        onSelect(drag.layerId)
        const track = [...event.currentTarget.querySelectorAll<HTMLElement>('.motion-track')].find(element => element.dataset.layerId === drag.layerId)
        if (track) { const bounds = track.getBoundingClientRect(); seek(Math.round((event.clientX - bounds.left) / bounds.width * scene.duration * scene.fps) / scene.fps) }
      }
      resetMarquee()
    }} onPointerCancel={resetMarquee} onLostPointerCapture={resetMarquee} tabIndex={-1}>
      <div className="motion-ruler-row"><span className="motion-ruler-label" ref={labelRef}><Icon name="layers" size={13} />{t('Camadas')}<span>{scene.layers.length}</span></span><div className="motion-ruler" ref={rulerRef}><div className="motion-ruler-ticks">{ruler.ticks.map(tick => <span key={tick.time} className={tick.major ? 'is-major' : 'is-minor'} style={{ left: `${tick.time / scene.duration * 100}%` }}>{tick.label}</span>)}</div><Tooltip content={t('Posição na linha do tempo')}><input aria-label={t('Posição na linha do tempo')} aria-valuetext={t('{time} segundos', { time: time.toFixed(2) })} type="range" min="0" max={scene.duration} step={1 / scene.fps} value={time} onChange={event => seek(Number(event.target.value))} /></Tooltip><span className="motion-ruler-playhead" style={{ left: `${time / scene.duration * 100}%` }} /></div></div>
      {[...scene.layers].reverse().map((layer, layerIndex) => <div className={`motion-track-row ${selectedId === layer.id ? 'is-selected' : ''} ${selected.some(item => item.layerId === layer.id) ? 'has-keyframe-selection' : ''} ${layer.hidden ? 'is-hidden' : ''}`} key={layer.id}>
        <Tooltip content={layer.name}><button className="motion-track-label" onClick={() => { onSelect(layer.id); onSelectionChange([]) }}><span className="motion-track-index">{String(layerIndex + 1).padStart(2, '0')}</span><Icon name={layer.type === 'text' || layer.type === 'label' ? 'text' : 'layers'} size={13} /><span>{layer.name}</span><small>{layer.keyframes.length}</small></button></Tooltip>
        <div className="motion-track" data-layer-id={layer.id}>
          <div className="motion-track-bar" aria-hidden="true" style={{ left: `${layer.start / scene.duration * 100}%`, width: `${(layer.end - layer.start) / scene.duration * 100}%` }} />
          {layer.keyframes.map((keyframe, index) => {
            const item = { layerId: layer.id, index }, active = selectedKeys.has(keyframeKey(item))
            const dragging = keyDrag.current?.selection.some(frame => keyframeKey(frame) === keyframeKey(item))
            return <Tooltip content={t('Keyframe em {time}s', { time: (keyframe.time + (dragging ? dragDelta : 0)).toFixed(2) })} key={`${layer.id}-${index}`}><button className={`motion-keyframe ${active ? 'is-keyframe-selected' : ''}`} data-layer-id={layer.id} data-keyframe-index={index} aria-pressed={active} aria-label={t('{name}: keyframe {time} segundos. Delete para remover.', { name: layer.name, time: keyframe.time.toFixed(2) })} style={{ left: `${(keyframe.time + (dragging ? dragDelta : 0)) / scene.duration * 100}%` }} onFocus={() => onSelect(layer.id)} onPointerDown={event => startKeyDrag(event, item, keyframe.time)} onPointerMove={event => {
              const drag = keyDrag.current
              if (!drag) return
              if (Math.abs(event.clientX - drag.x) < 3 && !drag.moved) return
              drag.moved = true
              scrollNearEdge(event.clientX)
              const requestedDelta = (event.clientX - drag.x + (scrollRef.current?.scrollLeft ?? 0) - drag.scrollLeft) / drag.width * scene.duration
              const result = moveKeyframes(scene, drag.selection, requestedDelta)
              drag.delta = requestedDelta; setDragDelta(result.delta)
            }} onPointerUp={() => {
              const drag = keyDrag.current
              if (!drag) return
              if (drag.moved) { const result = moveKeyframes(scene, drag.selection, drag.delta); if (result.delta) onUpdateLayers(result.patches); onSelectionChange(result.selection); seek(drag.anchorTime + result.delta); suppressClick.current = true }
              resetDrag()
            }} onPointerCancel={resetDrag} onLostPointerCapture={resetDrag} onClick={event => {
              if (suppressClick.current) { suppressClick.current = false; return }
              if (!event.shiftKey && !event.metaKey && !event.ctrlKey) seek(keyframe.time)
            }} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleSelection(item, event.shiftKey || event.metaKey || event.ctrlKey); seek(keyframe.time) }
            }} /></Tooltip>
          })}
          <div className="motion-track-playhead" style={{ left: `${time / scene.duration * 100}%` }} />
        </div>
      </div>)}
      {!scene.layers.length && <div className="motion-timeline-empty">
        {scene.customCode ? <div><strong>{t('Composição com código')}</strong><p>{t('Use a régua para explorar a animação. Edite os movimentos no código da cena.')}</p></div> : <p>{t('Adicione uma camada para começar.')}</p>}
        {!scene.customCode && onAddLayer && <button onClick={onAddLayer}><Icon name="plus" size={13} />{t('Adicionar camada')}</button>}
      </div>}
      {marquee && <div className="motion-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
    </div></div>
  </section>
}
