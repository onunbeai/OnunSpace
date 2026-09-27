import { useI18n } from '../../lib/i18n'
import { useEffect, useState } from 'react'
import { Modal, Tooltip } from '../../components/ui'
import type { MotionScene } from '../../../shared/motion'

const initialCode = { html: '<div class="title">Make it move.</div>', css: '.title { position: absolute; inset: 0; display: grid; place-items: center; color: #ff87f7; font-size: 150px; letter-spacing: -.06em; }', js: "timeline.from('.title', { opacity: 0, y: 100, duration: 1.5, ease: 'expo.out' }, 0);\ntimeline.to('.title', { scale: 1.15, duration: 4, ease: 'none' }, 1.5);" }
export function MotionCodeEditor({ open, onOpenChange, scene, onChange }: { open: boolean; onOpenChange: (open: boolean) => void; scene: MotionScene; onChange: (scene: MotionScene) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(scene.customCode || initialCode)
  const [tab, setTab] = useState<'html' | 'css' | 'js'>('html')
  useEffect(() => { if (open) setDraft(scene.customCode || initialCode) }, [open, scene.customCode])
  return <Modal open={open} onOpenChange={onOpenChange} title={t("Código da cena")} wide>
    <div className="motion-code-tabs" role="tablist" aria-label={t("Arquivos da cena")}>{(['html', 'css', 'js'] as const).map(language => <Tooltip content={language === 'js' ? 'JavaScript / GSAP' : language.toUpperCase()} key={language}><button id={`code-tab-${language}`} role="tab" aria-selected={tab === language} tabIndex={tab === language ? 0 : -1} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const languages = ['html', 'css', 'js'] as const; const index = languages.indexOf(tab); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(languages[next]); document.getElementById(`code-tab-${languages[next]}`)?.focus() }} aria-controls="motion-code-panel" key={language} onClick={() => setTab(language)}>{language === 'js' ? 'JavaScript / GSAP' : language.toUpperCase()}</button></Tooltip>)}</div>
    <div role="tabpanel" id="motion-code-panel" aria-labelledby={`code-tab-${tab}`}><Tooltip content={t('Código {language}', { language: tab })}><textarea className="motion-code-input" spellCheck={false} aria-label={t('Código {language}', { language: tab })} value={draft[tab]} onChange={event => setDraft({ ...draft, [tab]: event.target.value })} /></Tooltip></div>
    <p className="motion-code-note">{t("Anime usando timeline. Recursos externos não são carregados.")}</p>
    <div className="motion-code-actions">{scene.customCode && <Tooltip content={t("Voltar às camadas")}><button onClick={() => { onChange({ ...scene, customCode: undefined }); onOpenChange(false) }}>{t("Voltar às camadas")}</button></Tooltip>}<Tooltip content={t("Aplicar à cena")}><button className="motion-primary" onClick={() => { onChange({ ...scene, customCode: draft }); onOpenChange(false) }}>{t("Aplicar à cena")}</button></Tooltip></div>
  </Modal>
}
