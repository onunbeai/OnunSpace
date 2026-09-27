import { useId, useState, type CSSProperties } from 'react'
import type { MotionLayer } from '../../../shared/motion'
import { useI18n } from '../../lib/i18n'
import { InspectorSelect, NumericField } from './MotionInspectorControls'
import { applyMotionPreset, motionPresetRange, motionPresets, type MotionPresetId, type MotionPresetPatch } from './animationPresets'
import './motion-presets.css'

export interface MotionPresetsProps {
  layer: MotionLayer
  sceneDuration: number
  onApply: (patch: MotionPresetPatch) => void
}

export function MotionPresets({ layer, sceneDuration, onApply }: MotionPresetsProps) {
  const { t } = useI18n()
  const id = useId()
  const [selected, setSelected] = useState<MotionPresetId>('slide-up')
  const [duration, setDuration] = useState(.8)
  const range = motionPresetRange(layer, sceneDuration)
  const effectDuration = Math.min(duration, range?.duration ?? 0)
  const selectedPreset = motionPresets.find(preset => preset.id === selected)!
  const apply = () => {
    const patch = applyMotionPreset(layer, selected, sceneDuration, effectDuration)
    if (patch) onApply(patch)
  }

  return <section className="motion-presets" aria-labelledby={id + '-heading'}>
    <h3 id={id + '-heading'}>{t('Presets de animação')}</h3>
    <InspectorSelect label={t('Escolher animação')} value={selected} options={motionPresets.map(preset => ({ value: preset.id, label: t(preset.name) }))} onChange={value => setSelected(value as MotionPresetId)}/>
    <p className="motion-preset-description">
      <span className="motion-preset-preview" aria-hidden="true" style={{ '--motion-preset-duration': `${Math.max(.01, effectDuration)}s` } as CSSProperties}><span key={`${selected}-${effectDuration}`} className={`motion-preset-sample motion-preset-${selected}`}/></span>
      <span>{t(selectedPreset.description)}</span>
    </p>
    {range ? <div className="motion-preset-duration"><NumericField label="Duração do efeito" value={effectDuration} min={Math.min(.01, range.duration)} max={range.duration} step={.1} suffix="s" onChange={setDuration}/></div> : <p className="motion-preset-unavailable" role="status">{t('Aumente o intervalo da camada para animar.')}</p>}
    <button type="button" className="motion-inspector-action" disabled={!range} aria-describedby={id + '-note'} onClick={apply}>{t('Aplicar animação')}</button>
    <p className="motion-preset-note" id={id + '-note'}>{t('Substitui os keyframes desta camada. Você pode desfazer.')}</p>
  </section>
}
