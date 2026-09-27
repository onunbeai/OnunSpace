import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Tooltip } from '../../components/ui'
import { useI18n } from '../../lib/i18n'
import { validateMotionScene, type MotionLayer, type MotionScene } from '../../../shared/motion'
import { defaultLayerContent } from './sceneDocument'

export type MotionLayerDraftCache = Map<string, { source: string; content: { html: string; css: string }; tab: 'html' | 'css' }>

export function MotionLayerCode({ layer, scene, onLayerChange, drafts }: { layer: MotionLayer; scene: MotionScene; onLayerChange: (patch: Partial<MotionLayer>) => void; drafts: MotionLayerDraftCache }) {
  const { t } = useI18n()
  const id = useId()
  const initial = layer.customContent || defaultLayerContent(layer)
  const source = JSON.stringify([!!layer.customContent, initial.html, initial.css])
  const cached = drafts.get(layer.id)
  if (cached && cached.source !== source) drafts.delete(layer.id)
  const [draft, setDraft] = useState(() => cached?.source === source ? cached.content : initial)
  const [tab, setTab] = useState<'html' | 'css'>(() => cached?.source === source ? cached.tab : 'html')
  const [error, setError] = useState('')
  const previous = useRef({ source, drafts })
  const dirty = draft.html !== initial.html || draft.css !== initial.css
  // Only dirty drafts live in the inspector cache. A changed source means an
  // external edit/undo; that document value takes precedence over a stale draft.
  useEffect(() => {
    if (previous.current.source !== source || previous.current.drafts !== drafts) {
      const entry = drafts.get(layer.id)
      setDraft(entry?.source === source ? entry.content : initial)
      setTab(entry?.source === source ? entry.tab : 'html')
      setError('')
    }
    previous.current = { source, drafts }
  }, [source, drafts, layer.id])
  const updateDraft = (content: { html: string; css: string }) => {
    setDraft(content)
    setError('')
    if (content.html === initial.html && content.css === initial.css) drafts.delete(layer.id)
    else drafts.set(layer.id, { source, content, tab })
  }
  const changeTab = (next: 'html' | 'css') => {
    setTab(next)
    const entry = drafts.get(layer.id)
    if (entry) drafts.set(layer.id, { ...entry, tab: next })
  }
  const apply = () => {
    try {
      validateMotionScene({ ...scene, layers: scene.layers.map(item => item.id === layer.id ? { ...item, customContent: draft } : item) })
      drafts.delete(layer.id)
      onLayerChange({ customContent: { ...draft } })
      setError('')
    } catch (cause) { setError(cause instanceof Error ? t(cause.message) : t('Não foi possível aplicar o código.')) }
  }
  const reset = () => {
    drafts.delete(layer.id)
    setDraft(defaultLayerContent(layer))
    setError('')
    if (layer.customContent) onLayerChange({ customContent: undefined })
  }
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'html' : event.key === 'End' ? 'css' : tab === 'html' ? 'css' : 'html'
    changeTab(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }
  return <details className="motion-layer-code"><summary><Icon name="code" size={15}/><span>{t('HTML/CSS da camada')}</span><Icon name="chevron-down" size={13}/></summary><div className="motion-layer-code-body">
    <p className="motion-style-note">{t('Afeta apenas esta camada. A animação é preservada.')}</p>
    <div className="motion-layer-code-tabs" role="tablist" aria-label={t('HTML/CSS da camada')}>{(['html', 'css'] as const).map(language => <button type="button" key={language} role="tab" id={`${id}-${language}`} aria-selected={tab === language} aria-controls={`${id}-panel`} tabIndex={tab === language ? 0 : -1} onClick={() => changeTab(language)} onKeyDown={moveTab}>{language.toUpperCase()}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}><textarea aria-label={t(tab === 'html' ? 'Código HTML da camada' : 'Código CSS da camada')} spellCheck={false} value={draft[tab]} maxLength={tab === 'html' ? 100_001 : 50_001} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={event => updateDraft({ ...draft, [tab]: event.target.value })}/></div>
    {error && <p className="motion-style-error" id={`${id}-error`} role="alert">{error}</p>}
    <div className="motion-layer-code-actions"><Tooltip content={t('Restaurar conteúdo nativo')}><button type="button" className="motion-inspector-action" onClick={reset} disabled={!dirty && !layer.customContent}>{t('Restaurar')}</button></Tooltip><button type="button" className="motion-inspector-action is-primary" onClick={apply} disabled={!dirty}>{t('Aplicar à camada')}</button></div>
  </div></details>
}
