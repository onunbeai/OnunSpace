import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Icon } from '../../components/Icon'
import { Tooltip } from '../../components/ui'
import { useI18n } from '../../lib/i18n'

const palette = ['#ff87f7', '#ffffff', '#d3d3d3', '#747474', '#303030', '#111111', '#8a97ff', '#85c7ff', '#66d8bb', '#d9e975', '#ffbd7a', '#ff8282']
const toHex = (rgb: number[]) => '#' + rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')

export function MotionColorPicker({ label, value, onChange, fallback = '#ffffff', originalSwatch }: { label: string; value: string; onChange: (value: string) => void; fallback?: string; originalSwatch?: string }) {
  const { t } = useI18n()
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const skipCommit = useRef(false)
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [hex, setHex] = useState(color.slice(1).toUpperCase())
  useEffect(() => setHex(color.slice(1).toUpperCase()), [color])
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
  const commitHex = () => {
    if (skipCommit.current) { skipCommit.current = false; return }
    const next = '#' + hex.trim().replace(/^#/, '')
    if (/^#[0-9a-f]{6}$/i.test(next)) { if (next.toLowerCase() !== color.toLowerCase()) onChange(next.toLowerCase()) }
    else setHex(color.slice(1).toUpperCase())
  }
  const changeOpen = (next: boolean) => {
    if (next) {
      skipCommit.current = false
      const rect = trigger.current?.getBoundingClientRect()
      if (rect) setPosition({ left: Math.max(12, Math.min(innerWidth - 260, rect.right - 248)), top: Math.max(12, Math.min(innerHeight - 340, rect.bottom + 8)) })
    }
    setOpen(next)
  }
  return <Dialog.Root modal={false} open={open} onOpenChange={changeOpen}><Tooltip content={label}><Dialog.Trigger asChild><button ref={trigger} type="button" className={'motion-style-swatch' + (value === 'transparent' ? ' is-transparent' : '')} aria-label={label} style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(value) ? value : originalSwatch || 'transparent' }}/></Dialog.Trigger></Tooltip><Dialog.Portal><Dialog.Content className="motion-color-popover" style={position} aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); input.current?.select() }} onEscapeKeyDown={event => { event.preventDefault(); skipCommit.current = true; setHex(color.slice(1).toUpperCase()); setOpen(false) }}>
    <div className="motion-color-popover-heading"><Dialog.Title>{label}</Dialog.Title><Tooltip content={t('Fechar')}><Dialog.Close asChild><button type="button" aria-label={t('Fechar')}><Icon name="close" size={14}/></button></Dialog.Close></Tooltip></div>
    <div className="motion-color-preview" style={{ background: color }}/>
    <div className="motion-color-palette" aria-label={t('Cores sugeridas')}>{palette.map(swatch => <Tooltip key={swatch} content={swatch.toUpperCase()}><button type="button" aria-label={swatch.toUpperCase()} aria-pressed={color.toLowerCase() === swatch} style={{ backgroundColor: swatch }} onClick={() => onChange(swatch)}>{color.toLowerCase() === swatch && <Icon name="check" size={14}/>}</button></Tooltip>)}</div>
    <label className="motion-color-hex"><span>HEX</span><input ref={input} aria-label={t('Valor hexadecimal de {name}', { name: label })} value={hex} maxLength={7} onChange={event => setHex(event.target.value)} onBlur={commitHex} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}/></label>
    <div className="motion-color-channels">{(['Vermelho', 'Verde', 'Azul'] as const).map((channel, index) => <label key={channel}><span>{['R', 'G', 'B'][index]}</span><input type="range" min={0} max={255} step={1} value={rgb[index]} aria-label={t(channel)} onChange={event => onChange(toHex(rgb.map((value, i) => i === index ? Number(event.target.value) : value)))}/><output>{rgb[index]}</output></label>)}</div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
