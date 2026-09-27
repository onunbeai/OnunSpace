import './motion.css'
import { useI18n } from '../../lib/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import gsapSource from 'gsap/dist/gsap.min.js?raw'
import { createMotionLayer, type MotionKeyframe, type MotionLayer, type MotionLayerType, type MotionScene } from '../../../shared/motion'
import { Icon } from '../../components/Icon'
import { Menu, Tooltip } from '../../components/ui'
import { buildSceneDocument } from './sceneDocument'
import { MotionPreview } from './MotionPreview'
import { useMotionPlayback } from './useMotionPlayback'
import { MotionInspector } from './MotionInspector'
import { MotionTimeline } from './MotionTimeline'
import { MotionCodeEditor } from './MotionCodeEditor'
import { deleteKeyframes, easeKeyframes, validSelection, type KeyframeSelection, type LayerPatches } from './timelineSelection'

export interface MotionEditorProps { scene: MotionScene; onChange: (scene: MotionScene) => void; onExport?: () => void }
export function MotionEditor({ scene, onChange: onSceneChange, onExport }: MotionEditorProps) {
  const { t } = useI18n()
  const [selectedId, setSelectedId] = useState(() => scene.layers.find(layer => layer.id === 'title-pink')?.id ?? scene.layers[0]?.id ?? '')
  const [inspectorMode, setInspectorMode] = useState<'style' | 'motion'>('style')
  const [codeOpen, setCodeOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [keyframeSelection, setKeyframeSelection] = useState<KeyframeSelection[]>([])
  const sceneFingerprint = useMemo(() => JSON.stringify(scene), [scene])
  const previousScene = useRef(sceneFingerprint)
  const committedScene = useRef<string | null>(null)
  const onChange = useCallback((next: MotionScene) => { const fingerprint = JSON.stringify(next); if (fingerprint === sceneFingerprint) return; committedScene.current = fingerprint; onSceneChange(next) }, [onSceneChange, sceneFingerprint])
  useEffect(() => {
    if (previousScene.current === sceneFingerprint) return
    if (committedScene.current !== sceneFingerprint) setKeyframeSelection([])
    previousScene.current = sceneFingerprint
    committedScene.current = null
  }, [sceneFingerprint])
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 900, height: 600 })
  const [handTool, setHandTool] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [runtimeError, setRuntimeError] = useState('')
  const [fontData, setFontData] = useState<string>()
  const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number }>()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const spaceGesture = useRef<{ panned: boolean } | null>(null)
  const panRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number; layerX: number; layerY: number; scale: number; nextX: number; nextY: number } | null>(null)
  const sampledValues = useRef<Omit<MotionKeyframe, 'time'> | undefined>(undefined)
  const selected = scene.layers.find(layer => layer.id === selectedId)
  const selectedKeyframes = validSelection(scene, keyframeSelection)
  const fitScale = Math.max(.01, Math.min(Math.max(1, viewportSize.width - 72) / scene.width, Math.max(1, viewportSize.height - 150) / scene.height))
  const viewScale = fitScale * view.zoom
  const navigationActive = handTool || spaceHeld
  const playback = useMotionPlayback(scene.duration, scene.fps, scene.layers.length || scene.customCode ? 2.8 : 0, scene.id)
  // Prepare replacements behind the current preview; autosave and font updates never blank the stage.
  const sceneDocument = useMemo(() => buildSceneDocument(scene, gsapSource, fontData), [scene, fontData])
  useEffect(() => { let active = true; fetch('/assets/inter-medium.woff2').then(response => response.blob()).then(blob => { const reader = new FileReader(); reader.onload = () => { if (active) setFontData(String(reader.result)) }; reader.readAsDataURL(blob) }).catch(() => {}); return () => { active = false } }, [])
  useEffect(() => { setRuntimeError(''); setBounds(undefined); sampledValues.current = undefined }, [sceneDocument])
  const seekPreview = useCallback(() => { frameRef.current?.contentWindow?.postMessage({ type: 'onun:seek', time: playback.time }, '*'); if (!playback.playing) frameRef.current?.contentWindow?.postMessage({ type: 'onun:select', id: selectedId }, '*') }, [playback.time, playback.playing, selectedId])
  useEffect(seekPreview, [seekPreview])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type === 'onun:ready') {
        setRuntimeError(event.data.error || '')
        // Document/font loading can finish after the last playhead update.
        seekPreview()
      }
      if (event.data?.type === 'onun:layer' && scene.layers.some(layer => layer.id === event.data.id)) { setSelectedId(event.data.id); setKeyframeSelection([]); setInspectorMode('style') }
      if (event.data?.type === 'onun:bounds' && event.data.id === selectedId && event.data.rect?.width > 0 && event.data.rect?.height > 0) { setBounds(event.data.rect); sampledValues.current = event.data.values }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [scene.layers, selectedId, seekPreview])
  useEffect(() => { const observer = new ResizeObserver(seekPreview); if (stageRef.current) observer.observe(stageRef.current); return () => observer.disconnect() }, [seekPreview])
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => setViewportSize(current => current.width === viewport.clientWidth && current.height === viewport.clientHeight ? current : { width: viewport.clientWidth, height: viewport.clientHeight })
    measure(); const observer = new ResizeObserver(measure); observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const changeZoom = useCallback((factor: number, point = { x: 0, y: 0 }) => setView(current => {
    const zoom = Math.max(.1, Math.min(8, current.zoom * factor)), ratio = zoom / current.zoom
    return { zoom, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio }
  }), [])
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('button')) return
      event.preventDefault()
      if (event.shiftKey) { setView(current => ({ ...current, x: current.x - event.deltaY - event.deltaX })); return }
      const rect = viewport.getBoundingClientRect()
      changeZoom(Math.exp(-event.deltaY * .002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 })
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [changeZoom])
  useEffect(() => {
    const blocked = (target: EventTarget | null) => !(target instanceof HTMLElement) || !!target.closest('input,textarea,select,[role=menu],[role=dialog],[contenteditable]:not([contenteditable="false"])')
    const inEditor = (target: HTMLElement) => !!target.closest('.motion-editor') || target === document.body || target === document.documentElement
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || blocked(event.target) || !inEditor(event.target as HTMLElement)) return
      if (event.code === 'Space') {
        // Capture before focused timeline buttons can seek or activate on Space.
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat && !spaceGesture.current) { spaceGesture.current = { panned: false }; setSpaceHeld(true) }
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey) { if (event.key.toLowerCase() === 'h') setHandTool(true); if (event.key.toLowerCase() === 'v') setHandTool(false) }
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const gesture = spaceGesture.current
      spaceGesture.current = null; setSpaceHeld(false)
      if (!gesture) return
      event.preventDefault(); event.stopPropagation()
      if (!gesture.panned && !blocked(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey) playback.toggle()
    }
    const blur = () => { spaceGesture.current = null; setSpaceHeld(false); panRef.current = null; setPanning(false) }
    const visibility = () => { if (document.hidden) blur() }
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility) }
  }, [playback.toggle])
  const updateLayer = useCallback((id: string, patch: Partial<MotionLayer>) => {
    onChange({ ...scene, layers: scene.layers.map(layer => {
      if (layer.id !== id) return layer
      const dx = patch.x === undefined ? 0 : patch.x - layer.x
      const dy = patch.y === undefined ? 0 : patch.y - layer.y
      return { ...layer, ...patch, keyframes: patch.keyframes ?? layer.keyframes.map(frame => ({ ...frame, ...(frame.x !== undefined ? { x: frame.x + dx } : {}), ...(frame.y !== undefined ? { y: frame.y + dy } : {}) })) }
    }) })
  }, [scene, onChange])
  const updateLayers = (patches: LayerPatches) => onChange({ ...scene, layers: scene.layers.map(layer => patches[layer.id] ? { ...layer, ...patches[layer.id] } : layer) })
  const selectLayer = (id: string) => { setSelectedId(id); setKeyframeSelection([]); setInspectorMode('style') }
  const addLayer = (type: MotionLayerType) => { if (scene.customCode) { setCodeOpen(true); return } const layer = createMotionLayer(type, scene); layer.name = t(layer.name); onChange({ ...scene, layers: [...scene.layers, layer] }); setSelectedId(layer.id); setKeyframeSelection([]); setInspectorMode('style'); setInspectorOpen(true) }
  const removeLayer = (id = selectedId) => {
    if (scene.customCode || !scene.layers.some(layer => layer.id === id)) return
    onChange({ ...scene, layers: scene.layers.filter(layer => layer.id !== id) })
    if (selectedId === id) setSelectedId('')
    setKeyframeSelection(current => current.filter(frame => frame.layerId !== id))
    viewportRef.current?.focus({ preventScroll: true })
  }
  const addKeyframe = () => {
    if (!selected) return
    const time = Math.round(playback.time * scene.fps) / scene.fps
    const frame = { time, x: selected.x, y: selected.y, opacity: selected.opacity, rotation: selected.rotation, scale: selected.scale, ...sampledValues.current }
    const keyframes = [...selected.keyframes.filter(item => Math.abs(item.time - time) > 1 / scene.fps / 2), frame].sort((a, b) => a.time - b.time)
    updateLayer(selected.id, { keyframes })
    setKeyframeSelection([{ layerId: selected.id, index: keyframes.indexOf(frame) }]); setInspectorMode('motion')
  }
  return <div className={`motion-editor ${inspectorOpen ? 'has-mobile-inspector' : ''}`} onKeyDown={event => {
    if (!(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[role="textbox"],[role="menu"],[role="dialog"],[contenteditable]:not([contenteditable="false"])') || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') setKeyframeSelection([])
    if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault(); event.stopPropagation()
    if (event.repeat || scene.customCode) return
    if (selectedKeyframes.length) { updateLayers(deleteKeyframes(scene, selectedKeyframes)); setKeyframeSelection([]) }
    else if (!event.target.closest('[data-keyframe-index]')) removeLayer()
  }}>
    <aside className="motion-layers"><div className="motion-panel-heading"><span>{t("Camadas")}</span><Menu label={t("Adicionar camada")} trigger={<Icon name="plus" size={15} />} className="motion-icon-button" items={[{ value: 'text', label: t('Texto'), icon: 'text', disabled: !!scene.customCode }, { value: 'shape', label: t('Forma'), icon: 'square', disabled: !!scene.customCode }, { value: 'orb', label: t('Esfera'), icon: 'circle', disabled: !!scene.customCode }]} onSelect={value => addLayer(value as MotionLayerType)} /></div><div className="motion-composition-name"><Icon name="motion" size={15} /><span>{scene.name}</span><span>{scene.layers.length}</span></div>
      <div className="motion-layer-list">{[...scene.layers].reverse().map(layer => <div className={`motion-layer-row ${selectedId === layer.id ? 'is-selected' : ''} ${layer.hidden ? 'is-hidden' : ''}`} key={layer.id}><Tooltip content={layer.name}><button onClick={() => selectLayer(layer.id)} aria-pressed={selectedId === layer.id} className="motion-layer-select"><Icon name={layer.type === 'text' ? 'text' : layer.type === 'orb' ? 'circle' : 'square'} size={14} /><span>{layer.name}</span></button></Tooltip><Tooltip content={layer.hidden ? t('Mostrar {name}', { name: layer.name }) : t('Ocultar {name}', { name: layer.name })}><button aria-label={layer.hidden ? t('Mostrar {name}', { name: layer.name }) : t('Ocultar {name}', { name: layer.name })} className="motion-layer-visibility" onClick={() => updateLayer(layer.id, { hidden: !layer.hidden })}><Icon name={layer.hidden ? 'eye-off' : 'eye'} size={13} /></button></Tooltip><Tooltip content={t('Excluir camada (Delete / Backspace)')}><button type="button" aria-label={t('Excluir camada {name}', { name: layer.name })} className="motion-layer-delete" disabled={!!scene.customCode} onClick={() => removeLayer(layer.id)}><Icon name="trash" size={13} /></button></Tooltip></div>)}</div>
    </aside>
    <div className="motion-workspace"><div className="motion-canvas-toolbar"><div className="motion-scene-crumb"><span>{t("Cena 01")}</span><Icon name="chevron-right" size={13} /><span>{scene.name}</span></div><div className="motion-canvas-actions"><span>{scene.width} × {scene.height}</span><Tooltip content={t("Código")}><button onClick={() => setCodeOpen(true)}><Icon name="code" size={15} />{t("Código")}</button></Tooltip>{onExport && <Tooltip content={t("Exportar")}><button onClick={onExport}><Icon name="export" size={14} />{t("Exportar")}</button></Tooltip>}</div></div>
      <div className={`motion-stage-area ${navigationActive ? 'is-navigation' : ''} ${panning ? 'is-panning' : ''}`} ref={viewportRef} tabIndex={0} role="region" aria-label={t('Área de composição')} onPointerDownCapture={event => {
        if ((event.target as HTMLElement).closest('button,.motion-floating-tools,.motion-zoom-controls')) return
        if (event.button === 1 || event.button === 0 && navigationActive) {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId)
          panRef.current = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y }; setPanning(true)
        }
      }} onPointerDown={event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button,.motion-floating-tools,.motion-zoom-controls,.motion-selection')) return
        event.currentTarget.focus({ preventScroll: true })
        const rect = stageRef.current?.getBoundingClientRect()
        if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) frameRef.current?.contentWindow?.postMessage({ type: 'onun:pick', x: event.clientX - rect.left, y: event.clientY - rect.top }, '*')
        else { setSelectedId(''); setKeyframeSelection([]) }
      }} onPointerMove={event => { const pan = panRef.current; if (pan) { if (spaceGesture.current && Math.hypot(event.clientX - pan.clientX, event.clientY - pan.clientY) >= 3) spaceGesture.current.panned = true; setView(current => ({ ...current, x: pan.x + event.clientX - pan.clientX, y: pan.y + event.clientY - pan.clientY })) } }} onPointerUp={event => { if (!panRef.current) return; panRef.current = null; setPanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { spaceGesture.current = null; setSpaceHeld(false); panRef.current = null; setPanning(false) }}>
        <div className="motion-stage-stack" style={{ width: scene.width * viewScale, height: scene.height * viewScale, left: `calc(50% + ${view.x}px)`, top: `calc(50% + ${view.y}px)` }}><div className="motion-stage-label"><span>{scene.name}</span><span>{scene.width} × {scene.height}</span></div><div className="motion-stage" ref={stageRef}><MotionPreview key={scene.id} document={sceneDocument} title={t("Prévia da cena de motion")} frameRef={frameRef} time={playback.time} onReady={error => { setRuntimeError(error); seekPreview() }}/>{selected && bounds && !scene.customCode && !playback.playing && <div className="motion-selection" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }} onPointerDown={event => { if (event.button !== 0) return; viewportRef.current?.focus({ preventScroll: true }); setKeyframeSelection([]); event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, layerX: selected.x, layerY: selected.y, nextX: selected.x, nextY: selected.y, scale: (stageRef.current?.clientWidth || scene.width) / scene.width } }} onPointerMove={event => { if (!dragRef.current) return; const drag = dragRef.current; drag.nextX = Math.round(drag.layerX + (event.clientX - drag.x) / drag.scale); drag.nextY = Math.round(drag.layerY + (event.clientY - drag.y) / drag.scale); frameRef.current?.contentWindow?.postMessage({ type: 'onun:transform', id: selected.id, x: drag.nextX, y: drag.nextY }, '*') }} onPointerUp={() => { const drag = dragRef.current; if (drag) updateLayer(selected.id, { x: drag.nextX, y: drag.nextY }); dragRef.current = null }}><i /><i /><i /><i /></div>}</div></div>
        {runtimeError && <div className="motion-runtime-error" role="alert">{t('A cena encontrou um erro: {error}', { error: runtimeError })}<Tooltip content={t("Editar código")}><button onClick={() => setCodeOpen(true)}>{t("Editar código")}</button></Tooltip></div>}
        <div className="motion-floating-tools"><Tooltip content={t('Ferramenta de seleção (V)')}><button aria-label={t('Ferramenta de seleção (V)')} aria-pressed={!handTool} onClick={() => setHandTool(false)}><Icon name="cursor" size={17} /></button></Tooltip><Tooltip content={t('Mover visualização (H)')}><button aria-label={t('Mover visualização (H)')} aria-pressed={handTool} onClick={() => setHandTool(value => !value)}><Icon name="hand" size={17} /></button></Tooltip><span /><Menu label={t("Inserir na cena")} trigger={<Icon name="plus" size={18} />} className="motion-icon-button" items={[{ value: 'text', label: t('Texto'), icon: 'text', disabled: !!scene.customCode }, { value: 'shape', label: t('Forma'), icon: 'square', disabled: !!scene.customCode }, { value: 'orb', label: t('Esfera'), icon: 'circle', disabled: !!scene.customCode }]} onSelect={value => addLayer(value as MotionLayerType)} /><span /><Tooltip content={t("Adicionar texto")}><button aria-label={t("Adicionar texto")} disabled={!!scene.customCode} onClick={() => addLayer('text')}><Icon name="text" size={18} /></button></Tooltip><Tooltip content={t("Adicionar forma")}><button aria-label={t("Adicionar forma")} disabled={!!scene.customCode} onClick={() => addLayer('shape')}><Icon name="square" size={18} /></button></Tooltip><Tooltip content={t("Duplicar camada")}><button aria-label={t("Duplicar camada")} disabled={!selected || !!scene.customCode} onClick={() => { if (!selected) return; const layer = { ...structuredClone(selected), id: `layer-${crypto.randomUUID()}`, name: t('{name} cópia', { name: selected.name }), x: selected.x + 30, y: selected.y + 30 }; onChange({ ...scene, layers: [...scene.layers, layer] }); setSelectedId(layer.id); setKeyframeSelection([]) }}><Icon name="copy" size={17} /></button></Tooltip><Tooltip content={t("Editar propriedades")}><button className="motion-mobile-properties" aria-label={t("Editar propriedades")} onClick={() => setInspectorOpen(value => !value)}><Icon name="sliders" size={17} /></button></Tooltip><Tooltip content={t("Excluir camada")}><button aria-label={t("Excluir camada")} disabled={!selected || !!scene.customCode} onClick={() => removeLayer()}><Icon name="trash" size={16} /></button></Tooltip></div>
        <div className="motion-zoom-controls"><Tooltip content={t("Diminuir zoom")}><button aria-label={t("Diminuir zoom")} onClick={() => changeZoom(1 / 1.2)}><Icon name="minus" size={13} /></button></Tooltip><span>{Math.round(viewScale * 100)}%</span><Tooltip content={t("Aumentar zoom")}><button aria-label={t("Aumentar zoom")} onClick={() => changeZoom(1.2)}><Icon name="plus" size={13} /></button></Tooltip><Tooltip content={t("Ajustar composição")}><button aria-label={t("Ajustar composição")} onClick={() => setView({ zoom: 1, x: 0, y: 0 })}><Icon name="expand" size={13} /></button></Tooltip></div>
      </div>
    </div>
    <MotionInspector mode={inspectorMode} onModeChange={setInspectorMode} onEditSceneCode={() => setCodeOpen(true)} onClose={() => setInspectorOpen(false)} scene={scene} layer={scene.customCode ? undefined : selected} onChange={onChange} onLayerChange={patch => selected && updateLayer(selected.id, patch)} time={playback.time} onKeyframe={addKeyframe} selection={selectedKeyframes} onClearSelection={() => setKeyframeSelection([])} onSelectionEase={ease => updateLayers(easeKeyframes(scene, selectedKeyframes, ease))} />
    <MotionTimeline scene={scene} selectedId={selectedId} time={playback.time} playing={playback.playing} onSelect={setSelectedId} onSeek={playback.seek} onToggle={playback.toggle} onUpdateLayers={updateLayers} selection={selectedKeyframes} onSelectionChange={selection => { setKeyframeSelection(selection); if (selection.length) setInspectorMode('motion') }} />
    <MotionCodeEditor open={codeOpen} onOpenChange={setCodeOpen} scene={scene} onChange={next => { setKeyframeSelection([]); onChange(next) }} />
  </div>
}
