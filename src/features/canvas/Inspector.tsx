import { modelDisplayName, modelSettings, videoDurationChoices } from '../../../shared/modelCatalog';
import { useCatalogModel } from '../../lib/modelCatalog-context';
import { t } from '../../lib/i18n';
import { Icon } from '../../components/Icon';
import type { CanvasNode, ReviewStatus } from '../../../shared/project';
import { IconButton, Select } from '../../components/ui';
import { AspectRatioSelect } from '../../components/AspectRatioSelect';
import { AudioToggle } from '../../components/AudioToggle';
import { ModelLogo } from '../../components/ModelLogo';
import { Artwork } from './Artwork';
import { statusLabels } from './NodeCard';

export function Inspector({ node, references, onClose, onChange, onModel, onGenerate, onCancel }: { node: CanvasNode; references: CanvasNode[]; onClose: () => void; onChange: (patch: Partial<CanvasNode>) => void; onModel: () => void; onGenerate: () => void; onCancel: () => void }) {
  const model = useCatalogModel(node);
  const capabilities = model?.capabilities;
  const settings = model ? modelSettings(model, node) : node;
  const aspectRatios = capabilities ? capabilities.aspectRatios ?? [] : undefined;
  const resolutions = capabilities?.resolutions ?? [];
    const durations = model ? videoDurationChoices(model) : [];
  const counts = capabilities?.counts ?? [];
  const result = 'generatedFrom' in node && typeof node.generatedFrom === 'string' && Boolean(node.generatedFrom);
  const generation = !result && (node.kind === 'image' || node.kind === 'video');
  const showAspectRatio = !capabilities || Boolean(aspectRatios?.length);
  return <aside className="node-inspector" aria-label={t('Propriedades do nó')}>
    <div className="inspector-heading"><span>{node.title}</span><IconButton icon="close" label={t('Fechar propriedades')} onClick={onClose} /></div>
    <div className="inspector-scroll">
      <label className="form-field">{t('Nome')}<input className="text-input" value={node.title} onChange={event => onChange({ title: event.target.value })} /></label>
      {!result && node.kind !== 'text' && node.kind !== 'reference' && <><span className="section-label">{t('MODELO')}</span><button className="inspector-model" onClick={onModel}><ModelLogo model={node.model} provider={node.provider} /><span>{node.model ? (model?.canonicalId || model?.name || modelDisplayName(node.model)) : t('Escolher modelo')}</span><Icon name="chevron-down" size={15} /></button></>}
      {!result && <><div className="inspector-section-title"><span className="section-label">{t('REFERÊNCIAS')}</span><span>{references.length} {t('conectadas')}</span></div>
      <div className="inspector-references">{references.map(reference => <div key={reference.id} title={reference.title}><Artwork node={reference} /></div>)}{!references.length && <p>{t('Conecte a saída de uma referência à entrada deste nó.')}</p>}</div>
      <label className="form-field">{node.kind === 'text' ? t('Texto') : 'Prompt'}<textarea className="text-input" rows={7} value={node.prompt} onChange={event => onChange({ prompt: event.target.value })} placeholder={t('Descreva a sua ideia, os detalhes e a direção visual…')} /></label></>}
      {generation && (showAspectRatio || resolutions.length > 0) && <div className="form-row">
        {showAspectRatio && <label className="form-field">{t('Proporção')}<AspectRatioSelect label={t('Proporção da geração')} value={settings.aspectRatio} options={aspectRatios} onChange={aspectRatio => onChange({ aspectRatio })} /></label>}
        {resolutions.length > 0 && <label className="form-field">{t('Resolução')}<Select label={t('Resolução da geração')} value={settings.resolution} options={resolutions.map(value => ({ value, label: value }))} onChange={resolution => onChange({ resolution })} /></label>}
      </div>}
      {generation && node.kind === 'video' && (durations.length > 0 || capabilities?.audio) && <div className="inspector-video-options">
        {durations.length > 0 && <label className="form-field">{t('Duração')}<fieldset className="quality-select" disabled={node.generationStatus === 'running'}><Select label={t('Duração do vídeo')} value={String(settings.duration ?? durations[0])} options={durations.map(value => ({ value: String(value), label: `${value}s` }))} onChange={duration => onChange({ duration: Number(duration) })}/></fieldset></label>}
        {capabilities?.audio && <AudioToggle enabled={settings.generateAudio ?? true} disabled={node.generationStatus === 'running'} onChange={generateAudio => onChange({generateAudio})}/>}
      </div>}
      {generation && counts.length > 1 && <label className="form-field">{t('Quantidade')}<Select label={t('Quantidade da geração')} value={String(settings.count)} options={counts.map(value => ({ value: String(value), label: String(value) }))} onChange={count => onChange({ count: Number(count) })} /></label>}
      <label className="form-field">Status<Select label={t('Status do nó')} value={node.status} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label: t(label) }))} onChange={status => onChange({ status: status as ReviewStatus })} /></label>
      {node.error && <p className="inline-error" role="alert">{node.error}</p>}
    </div>
    {!result && !['text', 'reference'].includes(node.kind) && <div className="inspector-footer"><button className="button primary" disabled={node.generationCancelling} onClick={node.generationStatus === 'running' ? onCancel : onGenerate}><Icon name={node.generationStatus === 'running' ? 'close' : 'motion'} size={16} />{node.generationCancelling ? t('Cancelando geração…') : node.generationStatus === 'running' ? t('Cancelar geração') : node.kind === 'motion' ? t('Abrir Motion Studio') : t('Iniciar geração')}</button><small>{node.kind === 'motion' ? t('Preview e renderização no seu computador.') : t('A geração usa os créditos do seu provedor.')}</small></div>}
  </aside>;
}
