import { modelDisplayName, modelSettings, videoDurationChoices } from '../../../shared/modelCatalog';
import { useCatalogModel } from '../../lib/modelCatalog-context';
import { useI18n } from '../../lib/i18n';
import { memo, useState } from 'react';
import type { CanvasNode, ReviewStatus } from '../../../shared/project';
import { Icon, type IconName } from '../../components/Icon';
import { Menu, Select, Tooltip } from '../../components/ui';
import { AspectRatioSelect } from '../../components/AspectRatioSelect';
import { AudioToggle } from '../../components/AudioToggle';
import { ModelLogo } from '../../components/ModelLogo';
import { Artwork } from './Artwork';
import './node-compose.css';
import './review-status.css';
export const statusLabels: Record<ReviewStatus, string> = { none: 'Sem status', review: 'Precisa de revisão', progress: 'Em andamento', approved: 'Aprovado', rejected: 'Rejeitado' };
export const statusIcons: Record<ReviewStatus, IconName> = { none: 'status-none', review: 'status-review', progress: 'clock', approved: 'status-approved', rejected: 'status-rejected' };
export const kindIcons: Record<CanvasNode['kind'], IconName> = { reference: 'image', image: 'generate-image', video: 'video', motion: 'motion', text: 'text' };
interface Props {
    tourMenuOpen?:boolean;
    node: CanvasNode;
    selected: boolean;
    references: CanvasNode[];
    onSelect: (id: string) => void;
    onEdit: (id: string) => void;
    onChange: (id: string, patch: Partial<CanvasNode>) => void;
    onAction: (id: string, action: string) => void;
    onDrag: (event: React.PointerEvent, id: string) => void;
    onConnect: (id: string, direction: 'in' | 'out') => void;
    onConnectStart: (event: React.PointerEvent<HTMLButtonElement>, id: string, direction: 'in' | 'out') => void;
    connectionDirection?: 'in' | 'out';
    connectionSource?: string;
    connectionTarget?: string | null;
    onModel: (id: string) => void;
}
export const NodeCard = memo(function NodeCard({ tourMenuOpen,node, selected, references, onSelect, onEdit, onChange, onAction, onDrag, onConnect, onConnectStart, connectionDirection, connectionSource, connectionTarget, onModel }: Props) {
    const { t } = useI18n();
    const model = useCatalogModel(node);
    const capabilities = model?.capabilities;
    const settings = model ? modelSettings(model, node) : node;
    const aspectRatios = capabilities ? capabilities.aspectRatios ?? [] : undefined;
    const resolutions = capabilities?.resolutions ?? [];
    const durations = model ? videoDurationChoices(model) : [];
    const showResolution = resolutions.length > 0;
    const showCount = node.kind === 'video' ? settings.count > 1 : !capabilities || Boolean(capabilities.counts?.length);
    const outputLabel = t(node.kind === 'video' ? settings.count === 1 ? 'Vídeo' : 'Vídeos' : settings.count === 1 ? 'imagem' : 'Imagens').toLowerCase();
    const running = node.generationStatus === 'running';
    const [contextOpen, setContextOpen] = useState(false);
    const result = 'generatedFrom' in node && typeof node.generatedFrom === 'string' && Boolean(node.generatedFrom);
    const generator = !result && (node.id === 'generator' || (!node.artwork && node.kind !== 'reference' && node.kind !== 'text' && node.kind !== 'motion'));
    return <section className={`canvas-node ${selected ? 'selected' : ''} kind-${node.kind} ${generator ? 'generator-node' : ''}`} style={{ left: node.x, top: node.y, width: node.width }} data-node-id={node.id} onContextMenu={e => { e.preventDefault(); onSelect(node.id); setContextOpen(true); }} onPointerDown={e => { e.stopPropagation(); onSelect(node.id); if (!(e.target as HTMLElement).closest('button,input,textarea,video,[role=menuitem]'))
        onDrag(e, node.id); }}>
  <div className="node-title" onPointerDown={e => onDrag(e, node.id)}><Icon name={kindIcons[node.kind]} size={14}/><button onClick={() => onEdit(node.id)}>{node.title}</button>{node.kind === 'motion' && <span className="node-local">LOCAL</span>}</div>
  {selected && <div className="node-toolbar" onPointerDown={e => e.stopPropagation()}><Tooltip content={result ? t("Abrir visualização") : node.kind === 'motion' ? t("Abrir motion") : t("Gerar")}><button aria-label={result ? t("Abrir visualização") : node.kind === 'motion' ? t("Abrir motion") : t("Gerar")} onClick={() => onAction(node.id, result ? 'preview' : 'run')} disabled={!result && node.generationStatus === 'running'}><Icon name="play" size={17}/></button></Tooltip><span /><Tooltip content={t("Editar nó")}><button aria-label={t("Editar nó")} onClick={() => onEdit(node.id)}><Icon name="sliders" size={17}/></button></Tooltip><Tooltip content={t("Ampliar")}><button aria-label={t("Ampliar")} onClick={() => onAction(node.id, 'preview')}><Icon name="expand" size={17}/></button></Tooltip><span /><Tooltip content={t("Duplicar nó")}><button aria-label={t("Duplicar nó")} onClick={() => onAction(node.id, 'duplicate')}><Icon name="copy" size={17}/></button></Tooltip><Tooltip content={t("Baixar nó")}><button aria-label={t("Baixar nó")} onClick={() => onAction(node.id, 'download')}><Icon name="export" size={17}/></button></Tooltip><Menu label={t("Opções do nó")} open={tourMenuOpen??contextOpen} onOpenChange={setContextOpen} align="end" className="toolbar-menu" trigger={<Icon name="more" size={18}/>} items={[...(result ? [] : running ? [{ label: t("Cancelar geração"), value: 'cancel', icon: 'close' as const }] : [{ label: t("Iniciar"), value: 'run', icon: 'play' as const }]), { label: t("Abrir visualização"), value: 'preview', icon: 'expand', hint: 'A' }, { label: t("Editar"), value: 'edit', icon: 'sliders' }, { label: t("Criar variação"), value: 'variation', icon: 'generate-image' }, { label: t("Copiar"), value: 'copy-menu', icon: 'copy', children: [{ label: 'Prompt', value: 'copy-prompt', icon: 'text' }, { label: t("Nó como JSON"), value: 'copy-json', icon: 'code' }] }, { label: t("Histórico"), value: 'history', icon: 'clock' }, { label: t("Abrir na biblioteca"), value: 'library', icon: 'folder' }, { label: t("Alterar status"), value: 'status', icon: statusIcons[node.status], children: Object.entries(statusLabels).map(([value, label]) => ({ label: t(label), value: `status:${value}`, icon: statusIcons[value as ReviewStatus], selected: node.status === value, className: `menu-status-${value}` })) }, { label: t("Copiar link para o nó"), value: 'copy-link', icon: 'link', separator: true }, { label: t("Duplicar"), value: 'duplicate', icon: 'copy', hint: '⌘D', separator: true }, { label: t("Excluir"), value: 'delete', icon: 'trash', danger: true, hint: '⌫' }, { label: t("Baixar"), value: 'download', icon: 'export', separator: true }]} onSelect={action => action.startsWith('status:') ? onChange(node.id, { status: action.split(':')[1] as ReviewStatus }) : onAction(node.id, action)}/></div>}
  <div className="node-card" onDoubleClick={() => onEdit(node.id)}>
  {node.kind === 'text' ? <textarea aria-label={t("Texto da nota")} value={node.prompt} onChange={e => onChange(node.id, { prompt: e.target.value })} onPointerDown={e => { e.stopPropagation(); onSelect(node.id); }}/> : <><div className="node-visual" onDragStart={event => event.preventDefault()} onDoubleClick={event => { event.stopPropagation(); onAction(node.id, 'preview'); }}><Artwork node={node}/><Tooltip content={t("Ampliar imagem")}><button className="node-preview-button" aria-label={t('Ampliar {name}', { name: node.title })} onClick={() => onAction(node.id, 'preview')}><Icon name="expand" size={16}/></button></Tooltip>{node.kind !== 'reference' && <div className="node-badges"><Menu label={t("Alterar status")} className={`status-badge status-${node.status}`} trigger={<><Icon name={statusIcons[node.status]} size={12}/>{t(statusLabels[node.status])}</>} items={Object.entries(statusLabels).map(([value, label]) => ({ value, label: t(label), icon: statusIcons[value as ReviewStatus], selected: node.status === value, className: `menu-status-${value}` }))} onSelect={value => onChange(node.id, { status: value as ReviewStatus })}/></div>}</div>
  {generator && <div className="node-compose"><div className="node-references"><Tooltip content={t("Adicionar referências")}><button className="reference-add" aria-label={t("Adicionar referências")} onClick={() => onAction(node.id, 'references')}><Icon name="plus" size={20}/></button></Tooltip>{references.slice(0, 4).map(ref => <span key={ref.id}><Artwork node={ref}/></span>)}<small>{references.length} {t("referências")}</small></div><textarea aria-label={node.kind === 'video' ? 'Prompt' : t("Prompt da imagem")} value={node.prompt} placeholder={t("Descreva o que você imagina…")} onChange={e => onChange(node.id, { prompt: e.target.value })} onPointerDown={e => e.stopPropagation()}/><div className="node-options"><Tooltip content={t("Modelos")}><button className="model-trigger" onClick={() => onModel(node.id)}><ModelLogo model={node.model} provider={node.provider}/><span>{node.model ? (model?.canonicalId || model?.name || modelDisplayName(node.model)) : t('Escolher modelo')}</span><Icon name="chevron-down" size={13}/></button></Tooltip>{(!capabilities || Boolean(aspectRatios?.length)) && <AspectRatioSelect compact label={t("Proporção")} value={settings.aspectRatio} options={aspectRatios} onChange={aspectRatio => onChange(node.id, { aspectRatio })}/>}</div><div className="node-compose-footer"><div className="resolution-label">{showResolution && <fieldset className="quality-select" disabled={node.generationStatus === 'running'}><Select label={t("Qualidade da geração")} value={settings.resolution} options={resolutions.map(value => ({ value, label: value }))} onChange={resolution => { if (node.generationStatus !== 'running') onChange(node.id, { resolution }); }}/></fieldset>}{node.kind === 'video' && durations.length > 0 && <fieldset className="quality-select duration-select" disabled={running}><Select label={t("Duração do vídeo")} value={String(settings.duration ?? durations[0])} options={durations.map(value => ({ value: String(value), label: `${value}s` }))} onChange={duration => { if (!running) onChange(node.id, { duration: Number(duration) }); }}/></fieldset>}{node.kind === 'video' && capabilities?.audio && <AudioToggle enabled={settings.generateAudio ?? true} disabled={running} onChange={generateAudio => onChange(node.id, {generateAudio})}/>} {showResolution && showCount && <span>·</span>}{showCount && <>{settings.count} {outputLabel}</>}</div><button className={`generate-button${running ? ' cancel-generation-button' : ''}`} disabled={node.generationCancelling} aria-label={running ? t("Cancelar geração") : t("Gerar")} onClick={() => onAction(node.id, running ? 'cancel' : 'run')}><Icon name={running ? 'close' : 'motion'} size={15}/>{node.generationCancelling ? t("Cancelando geração…") : running ? t("Cancelar") : t("Gerar")}</button></div>{node.error && <p className="inline-error" role="alert">{node.error}</p>}</div>}
  {node.kind === 'motion' && <button className="open-motion" onClick={() => onAction(node.id, 'run')}>{t("Abrir no Motion Studio")}<Icon name="arrow" size={17}/></button>}
  </>}
  </div>
  {node.kind !== 'reference' && <Tooltip content={t("Arraste para conectar uma entrada.")}><button className={`port port-in ${connectionDirection === 'out' && connectionSource !== node.id ? 'is-connectable' : ''} ${connectionTarget === node.id && connectionDirection === 'out' ? 'is-drop-target' : ''}`} aria-label={t('Conectar entrada de {name}', { name: node.title })} data-port="in" data-node={node.id} onPointerDown={event => onConnectStart(event, node.id, 'in')} onClick={() => onConnect(node.id, 'in')}>{references.length ? <span className="port-count">{references.length}</span> : <Icon name={kindIcons[node.kind]} size={17}/>}</button></Tooltip>}
  <Tooltip content={t("Arraste para conectar uma saída.")}><button className={`port port-out ${connectionDirection === 'in' && connectionSource !== node.id ? 'is-connectable' : ''} ${connectionTarget === node.id && connectionDirection === 'in' ? 'is-drop-target' : ''}`} aria-label={t('Conectar saída de {name}', { name: node.title })} data-port="out" data-node={node.id} onPointerDown={event => onConnectStart(event, node.id, 'out')} onClick={() => onConnect(node.id, 'out')}><Icon name={kindIcons[node.kind]} size={17}/></button></Tooltip>
 </section>;
});
