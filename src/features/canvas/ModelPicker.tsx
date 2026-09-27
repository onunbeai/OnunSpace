import { t } from '../../lib/i18n';
import { useEffect, useState } from 'react';
import type { CanvasNode } from '../../../shared/project';
import { groupModels, type CatalogModel, type ModelProvider } from '../../../shared/modelCatalog';
import { Modal, Select } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ModelLogo } from '../../components/ModelLogo';
import { loadModelCatalog, providerNames } from '../../lib/modelCatalog';

const searchable = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Official OpenRouter IDs; search aliases do not add provider routes or merge versions.
const searchAliases: Record<string, string> = {
  'google/gemini-2.5-flash-image': 'Nano Banana',
  'google/gemini-3-pro-image': 'Nano Banana Pro',
  'google/gemini-3-pro-image-preview': 'Nano Banana Pro',
  'google/gemini-3.1-flash-image': 'Nano Banana 2',
  'google/gemini-3.1-flash-image-preview': 'Nano Banana 2',
  'google/gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite',
};
export function ModelPicker({ node, onClose, onSelect, onConnect, hasReferences = false }: {
  node: CanvasNode | null; onClose: () => void; onSelect: (model: string, provider: ModelProvider, entry?: CatalogModel) => void; onConnect: () => void; hasReferences?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [connected, setConnected] = useState<ModelProvider[]>([]);
  const [provider, setProvider] = useState<'all' | ModelProvider>('all');
  const [kind, setKind] = useState<'all' | 'image' | 'video'>('all');
  const [customProvider, setCustomProvider] = useState<ModelProvider>('higgsfield');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const currentKind = node?.kind === 'video' ? 'video' : 'image';
  const running = node?.generationStatus === 'running';
  useEffect(() => {
    if (!node) return;
    let active = true;
    setQuery(''); setKind('all'); setProvider('all'); setModels([]); setConnected([]); setLoading(true); setError(false);
    void loadModelCatalog('all').then(catalog => {
      if (!active) return;
      setModels(catalog.models); setConnected(catalog.connected); setIncomplete(catalog.incomplete);
      setCustomProvider(catalog.connected.includes(node.provider) ? node.provider : catalog.connected[0] ?? 'higgsfield');
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [node?.id, attempt]);
  const preferred = node ? { id: node.model, provider: connected.includes(node.provider) ? node.provider : connected[0] ?? node.provider } : undefined;
  const filtered = models.filter(model => provider === 'all' || model.provider === provider);
  const queryKey = searchable(query.trim());
  const crossKindReference = !!node?.media && (node.kind === 'image' || node.kind === 'reference');
  const available = (['image', 'video'] as const).flatMap(type => groupModels(filtered.filter(model => model.kind === type), preferred, type === currentKind ? hasReferences : crossKindReference))
    .filter(group => (kind === 'all' || group.model.kind === kind) && group.routes.some(model => searchable(`${model.canonicalId ?? ''} ${model.name} ${model.id} ${providerNames[model.provider]} ${model.provider === 'openrouter' ? searchAliases[model.id] ?? '' : ''}`).includes(queryKey)))
    .sort((a, b) => Number(a.model.supported === false) - Number(b.model.supported === false) || (a.model.canonicalId || a.model.name).localeCompare(b.model.canonicalId || b.model.name));
  const providersByModel = new Map(groupModels(models).map(group => [group.key, [...new Set(group.routes.map(route => route.provider))]]));
  const connect = () => { onClose(); onConnect(); };
  return <Modal open={!!node} onOpenChange={open => !open && onClose()} title={t('Modelos')} wide>
    <div className="model-search"><Icon name="search" /><input autoFocus aria-label={t('Pesquisar modelos')} placeholder={t('Pesquisar')} value={query} onChange={event => setQuery(event.target.value)} /><button className="catalog-refresh" aria-label={t('Atualizar modelos')} disabled={loading} onClick={() => setAttempt(value => value + 1)}><Icon name="redo" size={16} /></button></div>
    <div className="model-filters"><div className="filter-tabs kind-filter" role="group" aria-label={t('Tipo de modelo')}>{(['all', 'image', 'video'] as const).map(value => <button className={kind === value ? 'active' : ''} aria-pressed={kind === value} key={value} onClick={() => setKind(value)}>{t(value === 'all' ? 'Tudo' : value === 'image' ? 'Imagens' : 'Vídeos')}</button>)}</div><div className="filter-tabs provider-filter" role="group" aria-label={t('Provedor do modelo')}>{(['all', 'higgsfield', 'openrouter'] as const).map(value => <button className={provider === value ? 'active' : ''} aria-pressed={provider === value} key={value} onClick={() => { setProvider(value); if (value !== 'all') setCustomProvider(value); }}>{value === 'all' ? t('Todos os modelos') : providerNames[value]}</button>)}</div></div>
    {!connected.length && !loading && <p className="catalog-provider">{t('Explore e escolha um modelo. Conecte a API quando quiser gerar.')}<button className="button" onClick={connect}>{t('Conectar API')}</button></p>}
    {connected.length === 1 && <p className="catalog-provider"><Icon name="check" size={13} />{t('{provider} conectado', { provider: providerNames[connected[0]] })}</p>}
    {running && <p className="catalog-running" role="status">{t('O modelo deste bloco fica bloqueado durante a geração. Você pode criar outro bloco.')}</p>}
    <div className="model-list" aria-busy={loading}>
      {loading ? <p className="catalog-empty" role="status">{t('Carregando seus modelos…')}</p> : error ? <div className="catalog-empty" role="status"><p>{t('Não foi possível carregar os modelos.')}</p><button className="button" onClick={() => setAttempt(value => value + 1)}>{t('Tentar novamente')}</button></div> : available.length ? available.map(({ key, model, routes }) => {
        const crossKind = model.kind !== currentKind;
        const chosen = !crossKind && routes.some(route => route.id === node?.model && route.provider === node?.provider);
        return <button className={chosen ? 'chosen' : ''} key={key} disabled={model.supported === false || running && !crossKind} title={model.unavailableReason ? t(model.unavailableReason) : undefined} onClick={() => { if (running && !crossKind) return; onSelect(model.id, model.provider, model); onClose(); }}>
          <span className="model-logo"><ModelLogo model={model.id} provider={model.provider} /></span><span className="model-description"><strong>{model.canonicalId || model.name}</strong><span className="model-provider-tags">{(providersByModel.get(key) ?? [model.provider]).map(routeProvider => <span key={routeProvider} className={`model-provider-tag ${routeProvider === model.provider ? 'is-active' : ''}`} title={t(routeProvider === model.provider ? 'A geração usará {provider}' : 'Também disponível via {provider}', { provider: providerNames[routeProvider] })}>{routeProvider === model.provider && <i aria-hidden="true" />}{providerNames[routeProvider]}</span>)}</span>{model.supported === false ? <small>{t(model.unavailableReason || 'Este modelo requer entradas adicionais.')}</small> : crossKind ? <small className="model-row-action">{t(model.kind === 'video' ? 'Criar bloco de vídeo' : 'Criar bloco de imagem')}</small> : chosen ? <small className="model-current">{t('Modelo atual')}</small> : null}</span><em>{model.kind === 'video' ? t('Vídeo') : t('Imagem')}</em>{chosen ? <Icon name="check" size={17} /> : <Icon name={crossKind ? 'plus' : 'chevron-right'} size={17} />}
        </button>;
      }) : <div className="catalog-empty"><p>{t(provider === 'higgsfield' ? 'Nenhum modelo encontrado nesta API. O catálogo pode diferir do site Higgsfield.' : 'Nenhum modelo encontrado.')}</p>{provider === 'higgsfield' && <a href="https://open.higgsfield.ai/explore" target="_blank" rel="noopener noreferrer">{t('Ver catálogo da API')}<Icon name="arrow" size={12} /></a>}</div>}
    </div>
    {!loading && <><p className="catalog-note">{t(incomplete ? 'Parte do catálogo está temporariamente indisponível.' : 'Um modelo, todos os provedores. A tag destacada indica qual será usado.')}</p><details className="custom-model"><summary>{t('Usar um ID de modelo')}</summary><div className="custom-model-fields"><Select label={t('Provedor da geração')} value={customProvider} options={(['higgsfield', 'openrouter'] as const).map(value => ({ value, label: providerNames[value] }))} onChange={value => setCustomProvider(value as ModelProvider)} /><label>{t('ID de outro modelo')}<input className="text-input" placeholder={t('provedor/modelo')} disabled={running} onKeyDown={event => { if (!running && event.key === 'Enter' && event.currentTarget.value.trim()) { onSelect(event.currentTarget.value.trim(), customProvider); onClose(); } }} /></label><small>{t('Insira um ID do provedor e pressione Enter.')}</small></div></details></>}
  </Modal>;
}
