import './motion.css'
import './motion-workspace.css'
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
import { duplicateMotionLayer, reorderMotionLayer, translateMotionLayer, updateMotionKeyframe } from './motionEditing'
import { deleteKeyframes, easeKeyframes, validSelection, type KeyframeSelection, type LayerPatches } from './timelineSelection'

type SelectionRect = { x: number; y: number; width: number; height: number }
type SelectionSnapshot = { id: string; time: number; source: MessageEventSource | null; rect: SelectionRect; values: Omit<MotionKeyframe, 'time'>; sceneScale: number }

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
  const [selectionSnapshot, setSelectionSnapshot] = useState<SelectionSnapshot>()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const spaceGesture = useRef<{ panned: boolean } | null>(null)
  const panRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null)
  const selectionRequest = useRef<{ requestId: string; id: string; time: number } | null>(null)
  const readyDocument = useRef('')
  const dragRef = useRef<{ id: string; pointerId: number; target: HTMLDivElement; layer: MotionLayer; moved: boolean; cameraScale: number; x: number; y: number; nextX: number; nextY: number; snapshot: SelectionSnapshot } | null>(null)
  const cancelLayerDrag = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const frame = frameRef.current?.contentWindow
    selectionRequest.current = null
    if (frame === drag.snapshot.source) {
      const request = { requestId: crypto.randomUUID(), id: drag.id, time: drag.snapshot.time }
      selectionRequest.current = request
      frame?.postMessage({ type: 'onun:transform', id: drag.id, x: drag.snapshot.values.x, y: drag.snapshot.values.y }, '*')
      frame?.postMessage({ type: 'onun:select', ...request }, '*')
      setSelectionSnapshot(drag.snapshot)
    } else setSelectionSnapshot(undefined)
    if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId)
  }, [])
  const selected = scene.layers.find(layer => layer.id === selectedId)
  const selectedKeyframes = validSelection(scene, keyframeSelection)
  const fitScale = Math.max(.01, Math.min(Math.max(1, viewportSize.width - 72) / scene.width, Math.max(1, viewportSize.height - 150) / scene.height))
  const viewScale = fitScale * view.zoom
  const navigationActive = handTool || spaceHeld
  const playback = useMotionPlayback(scene.duration, scene.fps, 0, scene.id)
  const bounds = selectionSnapshot?.id === selectedId && selectionSnapshot.time === playback.time ? selectionSnapshot.rect : undefined
  const sampledValues = bounds ? selectionSnapshot?.values : undefined
  // Prepare replacements behind the current preview; autosave and font updates never blank the stage.
  const sceneDocument = useMemo(() => buildSceneDocument(scene, gsapSource, fontData), [scene, fontData])
  useEffect(() => { let active = true; fetch('/assets/inter-medium.woff2').then(response => response.blob()).then(blob => { const reader = new FileReader(); reader.onload = () => { if (active) setFontData(String(reader.result)) }; reader.readAsDataURL(blob) }).catch(() => {}); return () => { active = false } }, [])
  useEffect(() => { setRuntimeError(''); cancelLayerDrag() }, [sceneDocument, cancelLayerDrag])
  const seekPreview = useCallback(() => {
    const frame = frameRef.current?.contentWindow
    if (!frame) return
    cancelLayerDrag()
    const request = { requestId: crypto.randomUUID(), id: selectedId, time: playback.time }
    selectionRequest.current = request
    frame.postMessage({ type: 'onun:seek', time: playback.time }, '*')
    frame.postMessage({ type: 'onun:select', ...request }, '*')
  }, [playback.time, selectedId, cancelLayerDrag])
  useEffect(seekPreview, [seekPreview])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type === 'onun:ready') {
        setRuntimeError(event.data.error || '')
        // Document/font loading can finish after the last playhead update.
        seekPreview()
      }
      if (event.data?.type === 'onun:layer' && (event.data.id === '' || scene.layers.some(layer => layer.id === event.data.id))) {
        if (event.data.id !== selectedId) cancelLayerDrag()
        setSelectedId(event.data.id); setKeyframeSelection([]); setInspectorMode('style')
      }
      if (event.data?.type === 'onun:bounds') {
        const request = selectionRequest.current, data = event.data
        if (!request || data.requestId !== request.requestId || data.id !== request.id || data.time !== request.time || dragRef.current) return
        setSelectionSnapshot(data.rect?.width > 0 && data.rect?.height > 0 && data.sceneScale > 0 ? { id: data.id, time: data.time, source: event.source, rect: data.rect, values: data.values, sceneScale: data.sceneScale } : undefined)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [scene.layers, selectedId, seekPreview, cancelLayerDrag])
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
    const blur = () => { cancelLayerDrag(); spaceGesture.current = null; setSpaceHeld(false); panRef.current = null; setPanning(false) }
    const visibility = () => { if (document.hidden) blur() }
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility) }
  }, [playback.toggle, cancelLayerDrag])
  const updateLayer = useCallback((id: string, patch: Partial<MotionLayer>) => {
    onChange({ ...scene, layers: scene.layers.map(layer => {
      if (layer.id !== id) return layer
      const translated = translateMotionLayer(layer, patch.x, patch.y)
      return { ...translated, ...patch, x: translated.x, y: translated.y, keyframes: patch.keyframes ?? translated.keyframes }
    }) })
  }, [scene, onChange])
  const updateLayers = (patches: LayerPatches) => onChange({ ...scene, layers: scene.layers.map(layer => patches[layer.id] ? { ...layer, ...patches[layer.id] } : layer) })
  const selectLayer = (id: string) => { setSelectedId(id); setKeyframeSelection([]); setInspectorMode('style') }
  const addLayer = (type: MotionLayerType) => { if (scene.layers.length >= 200) return; if (scene.customCode) { setCodeOpen(true); return } const layer = createMotionLayer(type, scene); layer.name = t(layer.name); onChange({ ...scene, layers: [...scene.layers, layer] }); setSelectedId(layer.id); setKeyframeSelection([]); setInspectorMode('style'); setInspectorOpen(true) }
  const removeLayer = (id = selectedId) => {
    if (scene.customCode || !scene.layers.some(layer => layer.id === id)) return
    onChange({ ...scene, layers: scene.layers.filter(layer => layer.id !== id) })
    if (selectedId === id) setSelectedId('')
    setKeyframeSelection(current => current.filter(frame => frame.layerId !== id))
    viewportRef.current?.focus({ preventScroll: true })
  }
  const duplicateLayer = (id = selectedId) => {
    const original = scene.layers.find(layer => layer.id === id)
    if (!original) return
    const next = duplicateMotionLayer(scene, id, t('{name} cópia', { name: original.name }))
    if (!next) return
    onChange(next); selectLayer(next.layers[next.layers.length - 1].id)
  }
  const editKeyframe = (patch: Partial<MotionKeyframe>) => {
    if (selectedKeyframes.length !== 1) return
    const result = updateMotionKeyframe(scene, selectedKeyframes[0], patch)
    onChange(result.scene); setKeyframeSelection(result.selection)
    const item = result.selection[0]
    if (item) playback.seek(result.scene.layers.find(layer => layer.id === item.layerId)!.keyframes[item.index].time)
  }
  const moveLayerDrag = (event: { pointerId: number; clientX: number; clientY: number }) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const dxPixels = event.clientX - drag.x, dyPixels = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dxPixels, dyPixels) < 2) return
    drag.moved = true
    const next = translateMotionLayer(drag.layer, drag.layer.x + Math.round(dxPixels / (drag.snapshot.sceneScale * drag.cameraScale)), drag.layer.y + Math.round(dyPixels / (drag.snapshot.sceneScale * drag.cameraScale)))
    drag.nextX = next.x; drag.nextY = next.y
    const dx = next.x - drag.layer.x, dy = next.y - drag.layer.y
    // Paint the outline in the same pointer event; delayed iframe replies cannot move it backwards.
    setSelectionSnapshot({ ...drag.snapshot, rect: { ...drag.snapshot.rect, x: drag.snapshot.rect.x + dx * drag.snapshot.sceneScale, y: drag.snapshot.rect.y + dy * drag.snapshot.sceneScale }, values: { ...drag.snapshot.values, x: drag.snapshot.values.x! + dx, y: drag.snapshot.values.y! + dy } })
    frameRef.current?.contentWindow?.postMessage({ type: 'onun:transform', id: drag.id, x: drag.snapshot.values.x! + dx, y: drag.snapshot.values.y! + dy }, '*')
  }
  const finishLayerDrag = (event: { pointerId: number; clientX: number; clientY: number }) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    moveLayerDrag(event)
    dragRef.current = null
    const request = { requestId: crypto.randomUUID(), id: drag.id, time: drag.snapshot.time }
    selectionRequest.current = request
    frameRef.current?.contentWindow?.postMessage({ type: 'onun:select', ...request }, '*')
    if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId)
    if (drag.moved) updateLayer(drag.id, { x: drag.nextX, y: drag.nextY })
  }
  useEffect(() => { cancelLayerDrag() }, [selectedId, playback.time, playback.playing, viewScale, cancelLayerDrag])
  const addKeyframe = () => {
    if (!selected || scene.customCode) return
    const time = Math.min(scene.duration, Math.round(playback.time * scene.fps) / scene.fps)
    const frame = { time, x: selected.x, y: selected.y, opacity: selected.opacity, rotation: selected.rotation, scale: selected.scale, ...sampledValues }
    const keyframes = [...selected.keyframes.filter(item => Math.abs(item.time - time) > 1 / scene.fps / 2), frame].sort((a, b) => a.time - b.time)
    if (keyframes.length > 100) return
    updateLayer(selected.id, { keyframes })
    setKeyframeSelection([{ layerId: selected.id, index: keyframes.indexOf(frame) }]); setInspectorMode('motion')
  }
  return <div className={`motion-editor ${inspectorOpen ? 'has-mobile-inspector' : ''}`} onKeyDown={event => {
    if (!(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[role="textbox"],[role="menu"],[role="dialog"],[contenteditable]:not([contenteditable="false"])') || event.nativeEvent.isComposing) return
    if (event.defaultPrevented) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) duplicateLayer(); return }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!event.repeat) addKeyframe(); return }
    if (event.key === 'Escape') { cancelLayerDrag(); setKeyframeSelection([]); setInspectorOpen(false) }
    if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault(); event.stopPropagation()
    if (event.repeat || scene.customCode) return
    if (selectedKeyframes.length) { updateLayers(deleteKeyframes(scene, selectedKeyframes)); setKeyframeSelection([]) }
    else if (!event.target.closest('[data-keyframe-index]')) removeLayer()
  }}>
    <aside className="motion-layers"><div className="motion-panel-heading"><span>{t("Camadas")}</span><Menu label={t("Adicionar camada")} trigger={<Icon name="plus" size={15} />} className="motion-icon-button" items={[{ value: 'text', label: t('Texto'), icon: 'text', disabled: !!scene.customCode || scene.layers.length >= 200 }, { value: 'shape', label: t('Forma'), icon: 'square', disabled: !!scene.customCode || scene.layers.length >= 200 }, { value: 'orb', label: t('Esfera'), icon: 'circle', disabled: !!scene.customCode || scene.layers.length >= 200 }]} onSelect={value => addLayer(value as MotionLayerType)} /></div><div className="motion-composition-name"><Icon name="motion" size={15} /><span>{scene.name}</span><span>{scene.layers.length}</span></div>
      <div className="motion-layer-list">{[...scene.layers].reverse().map(layer => <div className={`motion-layer-row ${selectedId === layer.id ? 'is-selected' : ''} ${layer.hidden ? 'is-hidden' : ''}`} key={layer.id}><Tooltip content={layer.name}><button onClick={() => selectLayer(layer.id)} aria-pressed={selectedId === layer.id} className="motion-layer-select"><Icon name={layer.type === 'text' ? 'text' : layer.type === 'orb' ? 'circle' : 'square'} size={14} /><span>{layer.name}</span></button></Tooltip><Tooltip content={layer.hidden ? t('Mostrar {name}', { name: layer.name }) : t('Ocultar {name}', { name: layer.name })}><button aria-label={layer.hidden ? t('Mostrar {name}', { name: layer.name }) : t('Ocultar {name}', { name: layer.name })} className="motion-layer-visibility" onClick={() => updateLayer(layer.id, { hidden: !layer.hidden })}><Icon name={layer.hidden ? 'eye-off' : 'eye'} size={13} /></button></Tooltip><Menu label={t('Ações de {name}', { name: layer.name })} trigger={<Icon name="more" size={14} />} className="motion-layer-menu" align="end" items={[
        { value: 'duplicate', label: t('Duplicar camada'), icon: 'copy', disabled: !!scene.customCode || scene.layers.length >= 200 },
        { value: 'forward', label: t('Trazer para frente'), icon: 'layers', disabled: !!scene.customCode || scene.layers.at(-1)?.id === layer.id },
        { value: 'backward', label: t('Enviar para trás'), icon: 'layers', disabled: !!scene.customCode || scene.layers[0]?.id === layer.id },
        { value: 'delete', label: t('Excluir camada'), icon: 'trash', danger: true, separator: true, disabled: !!scene.customCode },
      ]} onSelect={action => { if (action === 'delete') removeLayer(layer.id); else if (action === 'duplicate') duplicateLayer(layer.id); else onChange(reorderMotionLayer(scene, layer.id, action as 'forward' | 'backward')) }} /></div>)}</div>
      {!scene.layers.length && <div className="motion-layer-empty">{t('Nenhuma camada')}</div>}
    </aside>
    <div className="motion-workspace"><div className="motion-canvas-toolbar"><div className="motion-scene-crumb"><span>{t("Cena 01")}</span><Icon name="chevron-right" size={13} /><span>{scene.name}</span></div><div className="motion-canvas-actions">
        <Menu label={t('Formato da composição')} className="motion-format-trigger" align="end" trigger={<><span>{scene.width} × {scene.height}</span><Icon name="chevron-down" size={11}/></>} items={[
          { value: '1920x1080', label: t('Paisagem · 1920 × 1080'), selected: scene.width === 1920 && scene.height === 1080 },
          { value: '1080x1920', label: t('Vertical · 1080 × 1920'), selected: scene.width === 1080 && scene.height === 1920 },
          { value: '1080x1080', label: t('Quadrado · 1080 × 1080'), selected: scene.width === 1080 && scene.height === 1080 },
          { value: '1080x1350', label: t('Retrato · 1080 × 1350'), selected: scene.width === 1080 && scene.height === 1350 },
        ]} onSelect={value => { const [width, height] = value.split('x').map(Number); onChange({ ...scene, width, height }); setView({ zoom: 1, x: 0, y: 0 }) }}/>
        <Tooltip content={t('Editar código da cena')}><button type="button" className="motion-code-trigger" aria-label={t('Código')} onClick={() => setCodeOpen(true)}><Icon name="code" size={15}/><span>{t('Código')}</span></button></Tooltip>
        {onExport && <Tooltip content={t('Exportar composição')}><button type="button" className="motion-export-trigger" aria-label={t('Exportar composição')} onClick={onExport}><Icon name="export" size={15}/><span>{t('Exportar')}</span></button></Tooltip>}
      </div></div>
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
        if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) frameRef.current?.contentWindow?.postMessage({ type: 'onun:pick', x: (event.clientX - rect.left) / viewScale, y: (event.clientY - rect.top) / viewScale }, '*')
        else { setSelectedId(''); setKeyframeSelection([]) }
      }} onPointerMove={event => { moveLayerDrag(event); const pan = panRef.current; if (pan) { if (spaceGesture.current && Math.hypot(event.clientX - pan.clientX, event.clientY - pan.clientY) >= 3) spaceGesture.current.panned = true; setView(current => ({ ...current, x: pan.x + event.clientX - pan.clientX, y: pan.y + event.clientY - pan.clientY })) } }} onPointerUp={event => { finishLayerDrag(event); if (!panRef.current) return; panRef.current = null; setPanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onLostPointerCapture={event => { if (dragRef.current?.pointerId === event.pointerId) cancelLayerDrag() }} onPointerCancel={() => { cancelLayerDrag(); spaceGesture.current = null; setSpaceHeld(false); panRef.current = null; setPanning(false) }}>
        <div className="motion-stage-stack" style={{ width: scene.width * viewScale, height: scene.height * viewScale, left: '50%', top: '50%', transform: `translate3d(${view.x}px, ${view.y}px, 0) translate(-50%, -50%)` }}><div className="motion-stage-label"><span>{scene.name}</span><span>{scene.width} × {scene.height}</span></div><div className="motion-stage" ref={stageRef}><MotionPreview key={scene.id} document={sceneDocument} title={t("Prévia da cena de motion")} frameRef={frameRef} time={playback.time} width={scene.width} height={scene.height} scale={viewScale} onReady={(error, document) => { readyDocument.current = document; setRuntimeError(error); seekPreview() }}/>{selected && !selected.hidden && playback.time >= selected.start && playback.time <= selected.end && bounds && !scene.customCode && !playback.playing && <div className="motion-selection" style={{ left: bounds.x * viewScale, top: bounds.y * viewScale, width: bounds.width * viewScale, height: bounds.height * viewScale }} onPointerDown={event => {
          const target = viewportRef.current
          if (event.button !== 0 || !target || !selectionSnapshot || !bounds || selectionSnapshot.source !== frameRef.current?.contentWindow || readyDocument.current !== sceneDocument) return
          event.preventDefault(); event.stopPropagation(); target.focus({ preventScroll: true }); setKeyframeSelection([])
          // Capture on the persistent viewport, so re-rendering the outline cannot strand a gesture.
          target.setPointerCapture(event.pointerId)
          dragRef.current = { id: selected.id, pointerId: event.pointerId, target, layer: selected, moved: false, cameraScale: viewScale, x: event.clientX, y: event.clientY, nextX: selected.x, nextY: selected.y, snapshot: selectionSnapshot }
        }}><i /><i /><i /><i /></div>}</div></div>
        {runtimeError && <div className="motion-runtime-error" role="alert">{t('A cena encontrou um erro: {error}', { error: runtimeError })}<Tooltip content={t("Editar código")}><button onClick={() => setCodeOpen(true)}>{t("Editar código")}</button></Tooltip></div>}
        <div className="motion-floating-tools"><Tooltip content={t('Ferramenta de seleção (V)')}><button aria-label={t('Ferramenta de seleção (V)')} aria-pressed={!handTool} onClick={() => setHandTool(false)}><Icon name="cursor" size={17} /></button></Tooltip><Tooltip content={t('Mover visualização (H)')}><button aria-label={t('Mover visualização (H)')} aria-pressed={handTool} onClick={() => setHandTool(value => !value)}><Icon name="hand" size={17} /></button></Tooltip><span /><Menu label={t("Inserir na cena")} trigger={<Icon name="plus" size={18} />} className="motion-icon-button" items={[{ value: 'text', label: t('Texto'), icon: 'text', disabled: !!scene.customCode || scene.layers.length >= 200 }, { value: 'shape', label: t('Forma'), icon: 'square', disabled: !!scene.customCode || scene.layers.length >= 200 }, { value: 'orb', label: t('Esfera'), icon: 'circle', disabled: !!scene.customCode || scene.layers.length >= 200 }]} onSelect={value => addLayer(value as MotionLayerType)} /><span /><Tooltip content={t("Adicionar texto")}><button aria-label={t("Adicionar texto")} disabled={!!scene.customCode || scene.layers.length >= 200} onClick={() => addLayer('text')}><Icon name="text" size={18} /></button></Tooltip><Tooltip content={t("Adicionar forma")}><button aria-label={t("Adicionar forma")} disabled={!!scene.customCode || scene.layers.length >= 200} onClick={() => addLayer('shape')}><Icon name="square" size={18} /></button></Tooltip><Tooltip content={t("Duplicar camada")}><button aria-label={t("Duplicar camada")} disabled={!selected || !!scene.customCode || scene.layers.length >= 200} onClick={() => duplicateLayer()}><Icon name="copy" size={17} /></button></Tooltip><Tooltip content={t("Editar propriedades")}><button className="motion-mobile-properties" aria-label={t("Editar propriedades")} onClick={() => setInspectorOpen(value => !value)}><Icon name="sliders" size={17} /></button></Tooltip><Tooltip content={t("Excluir camada")}><button aria-label={t("Excluir camada")} disabled={!selected || !!scene.customCode} onClick={() => removeLayer()}><Icon name="trash" size={16} /></button></Tooltip></div>
        <div className="motion-zoom-controls"><Tooltip content={t("Diminuir zoom")}><button aria-label={t("Diminuir zoom")} onClick={() => changeZoom(1 / 1.2)}><Icon name="minus" size={13} /></button></Tooltip><span>{Math.round(viewScale * 100)}%</span><Tooltip content={t("Aumentar zoom")}><button aria-label={t("Aumentar zoom")} onClick={() => changeZoom(1.2)}><Icon name="plus" size={13} /></button></Tooltip><Tooltip content={t("Ajustar composição")}><button aria-label={t("Ajustar composição")} onClick={() => setView({ zoom: 1, x: 0, y: 0 })}><Icon name="expand" size={13} /></button></Tooltip></div>
      </div>
    </div>
    <MotionInspector mode={inspectorMode} onModeChange={setInspectorMode} onEditSceneCode={() => setCodeOpen(true)} onClose={() => setInspectorOpen(false)} scene={scene} layer={scene.customCode ? undefined : selected} onChange={onChange} onLayerChange={patch => selected && updateLayer(selected.id, patch)} time={playback.time} onKeyframe={addKeyframe} onKeyframeChange={editKeyframe} onApplyPreset={patch => { if (!selected) return; updateLayer(selected.id, patch); setKeyframeSelection([]); playback.seek(selected.start) }} selection={selectedKeyframes} onClearSelection={() => setKeyframeSelection([])} onSelectionEase={ease => updateLayers(easeKeyframes(scene, selectedKeyframes, ease))} />
    <MotionTimeline loop={playback.loop} onLoopChange={playback.setLoop} onAddLayer={() => addLayer('text')} scene={scene} selectedId={selectedId} time={playback.time} playing={playback.playing} onSelect={setSelectedId} onSeek={playback.seek} onToggle={playback.toggle} onUpdateLayers={updateLayers} selection={selectedKeyframes} onSelectionChange={selection => { setKeyframeSelection(selection); if (selection.length) setInspectorMode('motion') }} />
    <MotionCodeEditor open={codeOpen} onOpenChange={setCodeOpen} scene={scene} onChange={next => { setKeyframeSelection([]); onChange(next) }} />
  </div>
}
