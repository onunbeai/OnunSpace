import type { CatalogModel, ModelProvider } from '../../shared/modelCatalog';
import { api } from './api';
export type ProviderSettings = { providers: Record<ModelProvider, { configured: boolean; source: string }> };
export const providerNames: Record<ModelProvider, string> = { higgsfield: 'Higgsfield', openrouter: 'OpenRouter' };
export async function loadModelCatalog(kind: string = 'all') {
  const providers = ['higgsfield', 'openrouter'] as const;
  const settings = await api<ProviderSettings>('/settings').catch(() => null);
  const connected = providers.filter(provider => settings?.providers[provider]?.configured);
  const requests = providers.flatMap(provider => (kind === 'all' ? ['image', 'video'] : [kind]).map(kind => ({ provider, kind })));
  const results = await Promise.allSettled(requests.map(({ provider, kind }) => api<{ models: CatalogModel[]; source: string }>(`/models?provider=${provider}&kind=${kind}`)));
  const models = results.flatMap((result, index) => result.status === 'fulfilled'
    ? result.value.models.filter(model => model.kind === requests[index].kind).map(model => ({ ...model, provider: requests[index].provider })) : []);
  return { connected, models, incomplete: results.some(result => result.status === 'rejected' || result.value.source === 'curated') };
}
