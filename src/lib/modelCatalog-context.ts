import { createContext, useContext } from 'react';
import type { CatalogModel, ModelProvider } from '../../shared/modelCatalog';

export const ModelCatalogContext = createContext<CatalogModel[]>([]);

export function useCatalogModel(node: { model: string; provider: ModelProvider }) {
  return useContext(ModelCatalogContext).find(model => model.id === node.model && model.provider === node.provider);
}
