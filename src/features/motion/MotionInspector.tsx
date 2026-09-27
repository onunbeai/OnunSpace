import { useId, useRef, type KeyboardEvent } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Tooltip } from '../../components/ui'
import { useI18n } from '../../lib/i18n'
import { motionEases, type MotionKeyframe, type MotionEase, type MotionLayer, type MotionScene } from '../../../shared/motion'
import { Icon } from '../../components/Icon'
import type { KeyframeSelection } from './timelineSelection'
import { ColorField, FontFamilyField, InspectorSelect, NumericField } from './MotionInspectorControls'
import { MotionLayerCode, type MotionLayerDraftCache } from './MotionLayerCode'
import './motion-inspector.css'
import { MotionPresets } from './MotionPresets'
import { motionKeyframeValues } from './motionEditing'

export interface MotionInspectorProps {
  mode: 'style' | 'motion'
  onModeChange: (mode: 'style' | 'motion') => void
  scene: MotionScene
  layer?: MotionLayer
  onChange: (scene: MotionScene) => void
  onLayerChange: (patch: Partial<MotionLayer>) => void
  time: number
  onKeyframe: () => void
  onKeyframeChange?: (patch: Partial<MotionKeyframe>) => void
  onApplyPreset?: (patch: Partial<MotionLayer>) => void
  onClose?: () => void
  selection?: KeyframeSelection[]
  onClearSelection?: () => void
  onSelectionEase?: (ease: MotionEase) => void
  onEditSceneCode?: () => void
}

const easeNames: Record<MotionEase, string> = { none: 'Linear', 'power2.out': 'Saída suave', 'power3.inOut': 'Entrada e saída', 'expo.out': 'Desaceleração forte', 'back.out(1.4)': 'Retorno suave' }

function EaseControl({ value, label, onChange, selection = false }: { value: string; label: string; onChange: (ease: MotionEase) => void; selection?: boolean }) {
  const { t } = useI18n()
  return <Dropdown.Root><Tooltip content={label}><Dropdown.Trigger aria-label={label} className={'motion-ease' + (selection ? ' motion-selection-ease' : '')}><span>{t('Curva')}</span><span>{t(easeNames[value as MotionEase] ?? value)}</span><Icon name="chevron-down" size={12}/></Dropdown.Trigger></Tooltip><Dropdown.Portal><Dropdown.Content className="motion-dropdown motion-style-menu" align="end" sideOffset={5}>{motionEases.map(ease => <Dropdown.Item key={ease} onSelect={() => onChange(ease)} className="motion-dropdown-item">{t(easeNames[ease])}{value === ease && <Icon name="check" size={13}/>}</Dropdown.Item>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root>
}

function LayerStyle({ layer, scene, onLayerChange, drafts }: { layer: MotionLayer; scene: MotionScene; onLayerChange: (patch: Partial<MotionLayer>) => void; drafts: MotionLayerDraftCache }) {
  const { t } = useI18n()
  const text = layer.type === 'text' || layer.type === 'label'
  const labelPill = layer.type === 'label' && !!layer.radius
  const fontSize = layer.fontSize ?? 32
  const borderWidth = layer.borderWidth ?? (layer.type === 'shape' ? 1.5 : labelPill ? 1 : 0)
  const background = layer.backgroundColor ?? (labelPill || layer.type === 'orb' ? 'original' : 'transparent')
  const borderColor = layer.borderColor ?? (labelPill ? 'original' : layer.color)
  return <>
    <section><h3>{t('Transformar')}</h3><div className="motion-field-grid">
      <NumericField label="X" value={layer.x} min={-10000} max={10000} onChange={x => onLayerChange({ x })}/><NumericField label="Y" value={layer.y} min={-10000} max={10000} onChange={y => onLayerChange({ y })}/>
      <NumericField label="W" value={layer.width} min={1} max={10000} onChange={width => onLayerChange({ width })}/><NumericField label="H" value={layer.height} min={1} max={10000} onChange={height => onLayerChange({ height })}/>
      <NumericField label="Rotação" value={layer.rotation} min={-36000} max={36000} onChange={rotation => onLayerChange({ rotation })}/><NumericField label="Escala" value={layer.scale} min={.001} max={100} step={.05} onChange={scale => onLayerChange({ scale })}/>
    </div></section>
    {text && <section><h3>{t('Texto')}</h3>{layer.customContent ? <p className="motion-style-note">{t('Conteúdo definido em HTML.')}</p> : <Tooltip content={t('Conteúdo da camada')}><textarea aria-label={t('Conteúdo da camada')} value={layer.text || ''} maxLength={10000} onChange={event => onLayerChange({ text: event.target.value })}/></Tooltip>}
      <div className="motion-typography-controls"><span className="motion-control-label">{t('Tipografia')}</span><FontFamilyField value={layer.fontFamily || 'Inter,Arial,sans-serif'} onChange={fontFamily => onLayerChange({ fontFamily })}/><div className="motion-field-grid">
        <NumericField label="Tamanho" value={fontSize} min={1} max={2000} onChange={fontSize => onLayerChange({ fontSize })}/>
        <InspectorSelect label={t('Peso da fonte')} value={String(layer.fontWeight ?? 400)} options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map(value => ({ value: String(value), label: String(value) }))} onChange={fontWeight => onLayerChange({ fontWeight: Number(fontWeight) })}/>
        <InspectorSelect label={t('Estilo da fonte')} value={layer.fontStyle ?? 'normal'} options={[{ value: 'normal', label: t('Regular') }, { value: 'italic', label: t('Itálico') }]} onChange={fontStyle => onLayerChange({ fontStyle: fontStyle as MotionLayer['fontStyle'] })}/>
        <InspectorSelect label={t('Alinhamento do texto')} value={layer.textAlign ?? (labelPill ? 'center' : 'left')} options={[{ value: 'left', label: t('Esquerda') }, { value: 'center', label: t('Centro') }, { value: 'right', label: t('Direita') }, { value: 'justify', label: t('Justificado') }]} onChange={textAlign => onLayerChange({ textAlign: textAlign as MotionLayer['textAlign'] })}/>
        <NumericField label="Entrelinhas" value={layer.lineHeight ?? (layer.type === 'label' ? 1.1 : 1)} min={.1} max={10} step={.1} onChange={lineHeight => onLayerChange({ lineHeight })}/>
        <NumericField label="Espaçamento" value={layer.letterSpacing ?? (layer.type === 'label' ? .14 : -.045) * fontSize} min={-200} max={1000} step={.1} onChange={letterSpacing => onLayerChange({ letterSpacing })}/>
        <InspectorSelect label={t('Capitalização')} value={layer.textTransform ?? 'none'} options={[{ value: 'none', label: t('Original') }, { value: 'uppercase', label: t('Maiúsculas') }, { value: 'lowercase', label: t('Minúsculas') }, { value: 'capitalize', label: t('Iniciais maiúsculas') }]} onChange={textTransform => onLayerChange({ textTransform: textTransform as MotionLayer['textTransform'] })}/>
        <InspectorSelect label={t('Decoração do texto')} value={layer.textDecoration ?? 'none'} options={[{ value: 'none', label: t('Nenhuma') }, { value: 'underline', label: t('Sublinhado') }, { value: 'line-through', label: t('Riscado') }]} onChange={textDecoration => onLayerChange({ textDecoration: textDecoration as MotionLayer['textDecoration'] })}/>
      </div></div>
    </section>}
    <section><h3>{t('Preenchimento')}</h3><div className="motion-style-section-stack">
      {(text || layer.type === 'orb') && <ColorField label={t(text ? 'Cor do texto' : 'Cor da esfera')} value={layer.color} onChange={color => onLayerChange({ color })}/>}
      <ColorField label={t('Cor de fundo')} value={background} originalSwatch={labelPill ? '#ffffff04' : layer.type === 'orb' ? layer.color : undefined} fallback={layer.type === 'shape' || layer.type === 'orb' ? layer.color : '#ffffff'} allowTransparent onChange={backgroundColor => onLayerChange({ backgroundColor })}/>
      <div className="motion-field-grid"><NumericField label="%" value={layer.opacity * 100} min={0} max={100} onChange={opacity => onLayerChange({ opacity: opacity / 100 })}/>{layer.type !== 'orb' && <NumericField label="Raio" value={layer.radius ?? 0} min={0} max={10000} onChange={radius => onLayerChange({ radius })}/>}</div>
      <NumericField label="Padding" value={layer.padding ?? 0} min={0} max={1000} onChange={padding => onLayerChange({ padding })}/>
    </div></section>
    <section><h3>{t('Borda')}</h3><div className="motion-style-section-stack"><ColorField label={t('Cor da borda')} value={borderColor} fallback={layer.color} originalSwatch={labelPill ? '#ffffff25' : undefined} onChange={borderColor => onLayerChange({ borderColor })}/><div className="motion-field-grid"><NumericField label="Espessura" value={borderWidth} min={0} max={1000} step={.5} onChange={borderWidth => onLayerChange({ borderWidth })}/><InspectorSelect label={t('Estilo da borda')} value={layer.borderStyle ?? 'solid'} options={[{ value: 'solid', label: t('Contínua') }, { value: 'dashed', label: t('Tracejada') }, { value: 'dotted', label: t('Pontilhada') }]} onChange={borderStyle => onLayerChange({ borderStyle: borderStyle as MotionLayer['borderStyle'] })}/></div></div></section>
    {text && <section><h3>{t('Contorno do texto')}</h3><div className="motion-style-section-stack"><ColorField label={t('Cor do contorno')} value={layer.textStrokeColor ?? layer.color} onChange={textStrokeColor => onLayerChange({ textStrokeColor })}/><NumericField label="Espessura do contorno" value={layer.textStrokeWidth ?? 0} min={0} max={100} step={.5} onChange={textStrokeWidth => onLayerChange({ textStrokeWidth })}/></div></section>}
    <MotionLayerCode key={layer.id} layer={layer} scene={scene} onLayerChange={onLayerChange} drafts={drafts}/>
  </>
}

export function MotionInspector({ scene, layer, onChange, onLayerChange, time, onKeyframe, onClose, selection = [], onClearSelection, onSelectionEase, mode = 'style', onModeChange, onEditSceneCode, onKeyframeChange, onApplyPreset }: MotionInspectorProps) {
  const { t } = useI18n()
  const id = useId()
  const draftCache = useRef<{ sceneId: string; drafts: MotionLayerDraftCache }>({ sceneId: scene.id, drafts: new Map() })
  if (draftCache.current.sceneId !== scene.id) draftCache.current = { sceneId: scene.id, drafts: new Map() }
  const frames = selection.flatMap(item => { const selectedLayer = scene.layers.find(candidate => candidate.id === item.layerId); const frame = selectedLayer?.keyframes[item.index]; return selectedLayer && frame ? [{ layer: selectedLayer, frame }] : [] })
  const eases = [...new Set(frames.map(({ layer, frame }) => frame.ease ?? layer.ease))]
  const selectedLayers = [...new Set(frames.map(({ layer }) => layer))]
  const singleValues = frames.length === 1 ? motionKeyframeValues(frames[0].layer, selection[0].index) : undefined
  const times = frames.map(({ frame }) => frame.time)
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'style' : event.key === 'End' ? 'motion' : mode === 'style' ? 'motion' : 'style'
    onModeChange(next)
    document.getElementById(id + '-' + next)?.focus()
  }
  return <aside className="motion-inspector motion-style-inspector" aria-label={t('Propriedades da cena')}>
    <div className="motion-panel-heading"><div className="motion-inspector-tabs" role="tablist" aria-label={t('Propriedades da camada')}>{(['style', 'motion'] as const).map(tab => <button type="button" id={id + '-' + tab} key={tab} role="tab" aria-selected={mode === tab} aria-controls={id + '-panel'} tabIndex={mode === tab ? 0 : -1} onClick={() => onModeChange(tab)} onKeyDown={moveTab}>{t(tab === 'style' ? 'Estilo' : 'Motion')}</button>)}</div>{onClose && <Tooltip content={t('Fechar propriedades')}><button type="button" className="motion-inspector-close" aria-label={t('Fechar propriedades')} onClick={onClose}><Icon name="close" size={15}/></button></Tooltip>}</div>
    <div className="motion-inspector-panel" role="tabpanel" id={id + '-panel'} aria-labelledby={id + '-' + mode}>
      {scene.customCode ? <section className="motion-custom-scene"><h3><Icon name="code" size={15}/>{t('Cena personalizada')}</h3><p className="motion-style-note">{t('Esta cena usa HTML, CSS e GSAP personalizados.')}</p><button type="button" className="motion-inspector-action" onClick={onEditSceneCode}><Icon name="code" size={15}/>{t('Editar código da cena')}</button></section> : layer && <div className="motion-inspector-title"><Icon name={layer.type === 'text' || layer.type === 'label' ? 'text' : 'layers'} size={16}/><Tooltip content={t('Nome da camada')}><input aria-label={t('Nome da camada')} value={layer.name} maxLength={200} onChange={event => onLayerChange({ name: event.target.value })}/></Tooltip></div>}
      <div hidden={mode !== 'style'}>
        {!scene.customCode && (layer ? <LayerStyle layer={layer} scene={scene} onLayerChange={onLayerChange} drafts={draftCache.current.drafts}/> : <div className="motion-no-layer"><Icon name="layers" size={28}/><p>{t('Selecione uma camada para editar suas propriedades.')}</p></div>)}
        <section className="motion-scene-settings"><h3>{t('Cena')}</h3><ColorField label={t('Fundo da cena')} value={scene.background} onChange={background => onChange({ ...scene, background })}/></section>
      </div><div hidden={mode !== 'motion'}>
        {!scene.customCode && frames.length > 0 && <section className="motion-keyframe-properties"><div className="motion-keyframe-heading"><span className="motion-diamond"/><strong>{t(frames.length === 1 ? '1 keyframe' : '{count} keyframes', { count: frames.length })}</strong><Tooltip content={t('Limpar seleção')}><button type="button" aria-label={t('Limpar seleção')} onClick={onClearSelection}><Icon name="close" size={13}/></button></Tooltip></div><div className="motion-keyframe-range"><span>{t(selectedLayers.length === 1 ? '1 camada' : '{count} camadas', { count: selectedLayers.length })}</span><span>{Math.min(...times).toFixed(2)}{times.length > 1 ? '–' + Math.max(...times).toFixed(2) : ''} s</span></div>{frames.length === 1 && singleValues && onKeyframeChange && <div className="motion-keyframe-fields">
          <NumericField label="Tempo do keyframe" value={frames[0].frame.time} min={0} max={scene.duration} step={1 / scene.fps} suffix="s" onChange={time => onKeyframeChange({ time })}/>
          <div className="motion-field-grid">
            <NumericField label="X" value={singleValues.x!} min={-36000} max={36000} onChange={x => onKeyframeChange({ x })}/>
            <NumericField label="Y" value={singleValues.y!} min={-36000} max={36000} onChange={y => onKeyframeChange({ y })}/>
            <NumericField label="Rotação" value={singleValues.rotation!} min={-36000} max={36000} onChange={rotation => onKeyframeChange({ rotation })}/>
            <NumericField label="Escala" value={singleValues.scale!} min={.001} max={100} step={.05} onChange={scale => onKeyframeChange({ scale })}/>
            <NumericField label="%" value={Math.round(singleValues.opacity! * 100)} min={0} max={100} onChange={opacity => onKeyframeChange({ opacity: opacity / 100 })}/>
          </div><p className="motion-style-note">{t('Valores deste keyframe. Use Estilo para editar a camada inteira.')}</p>
        </div>}<EaseControl label={t('Curva da seleção')} value={eases.length === 1 ? eases[0] : t('Misto')} selection onChange={ease => onSelectionEase?.(ease)}/>{frames.length > 1 && <div className="motion-selected-layer-list">{selectedLayers.map(selectedLayer => <div key={selectedLayer.id}><Icon name={selectedLayer.type === 'text' ? 'text' : 'layers'} size={12}/><span>{selectedLayer.name}</span><span>{frames.filter(item => item.layer.id === selectedLayer.id).length}</span></div>)}</div>}</section>}
        {!scene.customCode && layer && <section><h3>{t('Animação')}</h3><div className="motion-field-grid"><NumericField label="Início" value={layer.start} min={0} max={layer.end} step={.1} onChange={start => onLayerChange({ start })}/><NumericField label="Fim" value={layer.end} min={layer.start} max={scene.duration} step={.1} onChange={end => onLayerChange({ end })}/></div><EaseControl label={t('Curva de animação')} value={layer.ease} onChange={ease => onLayerChange({ ease })}/><Tooltip content={t('Adicionar keyframe')}><button type="button" className="motion-keyframe-add" disabled={layer.keyframes.length >= 100 && !layer.keyframes.some(frame => Math.abs(frame.time - time) < .5 / scene.fps)} onClick={onKeyframe}><span className="motion-diamond"/>{t('Adicionar keyframe')}<span>{time.toFixed(2)}s</span></button></Tooltip></section>}
        {!scene.customCode && layer && onApplyPreset && <MotionPresets key={layer.id} layer={layer} sceneDuration={scene.duration} onApply={onApplyPreset}/>}
        {!scene.customCode && !layer && !frames.length && <div className="motion-no-layer"><Icon name="layers" size={28}/><p>{t('Selecione uma camada para editar suas propriedades.')}</p></div>}
        <section className="motion-scene-settings"><h3>{t('Cena')}</h3><div className="motion-field-grid"><NumericField label="Duração" value={scene.duration} min={.1} max={120} step={.5} onChange={duration => onChange({ ...scene, duration, layers: scene.layers.map(item => ({ ...item, start: Math.min(item.start, duration), end: Math.min(item.end, duration), keyframes: item.keyframes.filter(frame => frame.time <= duration) })) })}/><NumericField label="FPS" value={scene.fps} min={1} max={60} onChange={fps => onChange({ ...scene, fps: Math.round(fps) })}/></div></section>
      </div>
    </div>
  </aside>
}
