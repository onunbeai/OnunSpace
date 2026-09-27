import { useEffect, useRef, useState } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Icon } from '../../components/Icon'
import { Tooltip } from '../../components/ui'
import { useI18n } from '../../lib/i18n'
import { MotionColorPicker } from './MotionColorPicker'

export function NumericField({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(String(value))
  const skipCommit = useRef(false)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (skipCommit.current) { skipCommit.current = false; return }
    if (!draft.trim() || !Number.isFinite(Number(draft))) { setDraft(String(value)); return }
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(draft)))
    setDraft(String(next))
    if (next !== value) onChange(next)
  }
  const accessibleLabel = ({ X: 'Posição X', Y: 'Posição Y', W: 'Largura', H: 'Altura', '%': 'Opacidade' } as Record<string, string>)[label] || label
  return <label className="motion-value"><span>{t(label)}</span><Tooltip content={t(accessibleLabel)}><input aria-label={t(accessibleLabel)} type="number" value={draft} min={min} max={max} step={step} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); skipCommit.current = true; setDraft(String(value)); event.currentTarget.blur() } }} /></Tooltip>{suffix && <span className="motion-field-unit">{suffix}</span>}</label>
}

export function InspectorSelect({ label, value, options, onChange, className = '' }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; className?: string }) {
  return <Dropdown.Root><Tooltip content={label}><Dropdown.Trigger className={`motion-style-select ${className}`} aria-label={label}><span>{options.find(option => option.value === value)?.label || value}</span><Icon name="chevron-down" size={13}/></Dropdown.Trigger></Tooltip><Dropdown.Portal><Dropdown.Content className="motion-dropdown motion-style-menu" sideOffset={5} collisionPadding={10} align="end"><Dropdown.RadioGroup value={value} onValueChange={onChange}>{options.map(option => <Dropdown.RadioItem key={option.value} value={option.value} className="motion-dropdown-item"><span>{option.label}</span><Dropdown.ItemIndicator><Icon name="check" size={13}/></Dropdown.ItemIndicator></Dropdown.RadioItem>)}</Dropdown.RadioGroup></Dropdown.Content></Dropdown.Portal></Dropdown.Root>
}

export function ColorField({ label, value, onChange, allowTransparent = false, fallback = '#ffffff', originalSwatch }: { label: string; value: string; onChange: (value: string) => void; allowTransparent?: boolean; fallback?: string; originalSwatch?: string }) {
  const { t } = useI18n()
  const valid = /^#[0-9a-f]{6}$/i.test(value)
  const [draft, setDraft] = useState(valid ? value.slice(1).toUpperCase() : '')
  const skipCommit = useRef(false)
  useEffect(() => setDraft(/^#[0-9a-f]{6}$/i.test(value) ? value.slice(1).toUpperCase() : ''), [value])
  const commit = () => {
    if (skipCommit.current) { skipCommit.current = false; return }
    const hex = `#${draft.replace(/^#/, '').trim()}`
    if (/^#[0-9a-f]{6}$/i.test(hex)) { if (hex.toLowerCase() !== value.toLowerCase()) onChange(hex.toLowerCase()) }
    else setDraft(valid ? value.slice(1).toUpperCase() : '')
  }
  return <div className="motion-style-color"><span className="motion-control-label">{label}</span><div className="motion-style-color-control"><MotionColorPicker label={label} value={value} fallback={fallback} originalSwatch={originalSwatch} onChange={onChange}/><input className="motion-hex-input" aria-label={t('Valor hexadecimal de {name}', { name: label })} value={draft} maxLength={7} placeholder={t(value === 'transparent' ? 'Transparente' : 'Original')} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); skipCommit.current = true; setDraft(valid ? value.slice(1).toUpperCase() : ''); event.currentTarget.blur() } }}/>{allowTransparent && <Tooltip content={t('Sem preenchimento')}><button type="button" aria-label={t('Sem preenchimento')} aria-pressed={value === 'transparent'} onClick={() => onChange(value === 'transparent' ? fallback : 'transparent')}><Icon name={value === 'transparent' ? 'eye-off' : 'eye'} size={14}/></button></Tooltip>}</div></div>
}

export function FontFamilyField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(value)
  const skipCommit = useRef(false)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (skipCommit.current) { skipCommit.current = false; return } const next = draft.trim(); if (next && ![...next].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) { if (next !== value) onChange(next) } else setDraft(value) }
  const options = ['Inter,Arial,sans-serif', 'Arial,sans-serif', 'Georgia,serif', 'Times New Roman,serif', 'Courier New,monospace', 'system-ui', 'sans-serif', 'serif', 'monospace']
  return <div className="motion-family-field"><input aria-label={t('Família da fonte')} value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); skipCommit.current = true; setDraft(value); event.currentTarget.blur() } }}/><Dropdown.Root><Tooltip content={t('Escolher fonte')}><Dropdown.Trigger aria-label={t('Escolher fonte')}><Icon name="chevron-down" size={13}/></Dropdown.Trigger></Tooltip><Dropdown.Portal><Dropdown.Content className="motion-dropdown motion-style-menu" sideOffset={5} align="end"><Dropdown.RadioGroup value={value} onValueChange={onChange}>{options.map(font => <Dropdown.RadioItem value={font} key={font} className="motion-dropdown-item"><span style={{ fontFamily: font }}>{font.split(',')[0]}</span><Dropdown.ItemIndicator><Icon name="check" size={13}/></Dropdown.ItemIndicator></Dropdown.RadioItem>)}</Dropdown.RadioGroup></Dropdown.Content></Dropdown.Portal></Dropdown.Root></div>
}
