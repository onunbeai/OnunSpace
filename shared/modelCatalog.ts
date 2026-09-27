export type ModelProvider = 'openrouter' | 'higgsfield';
export type CatalogModel = {
  id: string; name: string; provider: ModelProvider; kind: string;
  canonicalId?: string; supported?: boolean; unavailableReason?: string;
  capabilities?: {
    requiredInputs?: string[]; referenceFields?: string[];
    aspectRatios?: string[]; resolutions?: string[]; counts?: number[]; durations?: (number | string)[]; durationRange?: { min?: number; max?: number; step?: number };
    defaults?: { aspectRatio?: string; resolution?: string; count?: number; duration?: number };
  };
};
export type ModelGroup = { key: string; model: CatalogModel; routes: CatalogModel[] };

export function videoDurationChoices(model: CatalogModel): number[] {
  if (model.kind !== 'video') return [];
  const caps = model.capabilities;
  const values = (caps?.durations ?? []).map(Number).filter(value => Number.isFinite(value) && value >= 1 && value <= 30);
  if (values.length) return [...new Set(values)].sort((a,b) => a-b);
  const range = caps?.durationRange;
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
    const step = range.step && range.step > 0 ? range.step : 1;
    const min = Math.max(1, range.min!), max = Math.min(30, range.max!);
    return Array.from({length: Math.min(120, Math.max(0, Math.floor((max-min)/step)+1))}, (_,i) => Number((min+i*step).toFixed(3)));
  }
  const fallback = caps?.defaults?.duration;
  return fallback && fallback >= 1 && fallback <= 30 ? [fallback] : [];
}

export function modelSettings(model: CatalogModel, current: { aspectRatio: string; resolution: string; count: number; duration?: number }) {
  const capabilities = model.capabilities;
  const choices = videoDurationChoices(model);
  const duration = model.kind === 'video' ? choices.includes(current.duration!) ? current.duration : choices.includes(capabilities?.defaults?.duration!) ? capabilities!.defaults!.duration : choices[0] ?? (capabilities?.durations === undefined ? current.duration : undefined) : undefined;
  const durationSetting = duration !== undefined || current.duration !== undefined ? { duration } : {};
  if (!capabilities) return { aspectRatio: current.aspectRatio, resolution: current.resolution, count: current.count, ...durationSetting };
  const choose = <T extends string | number>(choices: T[] | undefined, value: T, fallback: T | undefined, automatic: T): T => {
    // An absent descriptor is unknown; an empty enum explicitly offers no control.
    // Clear values inherited from another provider instead of submitting a hidden, unsupported quality.
    if (choices === undefined) return value;
    if (!choices.length) return fallback ?? automatic;
    return choices.find(choice => String(choice).toLowerCase() === String(value).toLowerCase())
      ?? choices.find(choice => choice === fallback) ?? choices[0];
  };
  return {
    aspectRatio: choose(capabilities.aspectRatios, current.aspectRatio, capabilities.defaults?.aspectRatio, '1:1'),
    resolution: choose(capabilities.resolutions, current.resolution, capabilities.defaults?.resolution, '1K'),
    count: choose(capabilities.counts, current.count, capabilities.defaults?.count, 1),
    ...durationSetting,
  };
}

// Versions and quality variants remain distinct; only presentation differences
// and task suffixes are removed from names supplied by the providers.
export function canonicalModelKey(model: Pick<CatalogModel, 'id' | 'name' | 'kind' | 'canonicalId'>): string {
  const name = model.canonicalId || model.name;
  const normalized = name.toLowerCase()
    .replace(/^(?:openai|google|bytedance(?: seed)?|black forest labs|bfl|higgsfield(?: ai)?|recraft|kling(?: ai)?|kwaivgi|runway|luma|qwen|alibaba(?: cloud)?|xai|spacexai|minimax|pixverse|lightricks|ideogram|krea|sourceful|microsoft(?: ai)?|meta|inclusionai)\s*:\s*/i, '')
    .replace(/^grok imagine image\b/i, 'grok image')
    .replace(/\s*\(?\b(?:text[ -]to[ -](?:image|video)|image[ -]to[ -](?:image|video))\)?$/i, '')
    .replace(/[^a-z0-9]/g, '');
  return `${model.kind}:${normalized || model.id.toLowerCase()}`;
}

export function groupModels(models: CatalogModel[], preferred?: { id: string; provider: ModelProvider }, hasReferences = false): ModelGroup[] {
  const groups = new Map<string, CatalogModel[]>();
  for (const model of models) {
    const key = canonicalModelKey(model);
    const routes = groups.get(key) ?? [];
    if (!routes.some(route => route.provider === model.provider && route.id === model.id)) routes.push(model);
    groups.set(key, routes);
  }
  return [...groups].map(([key, routes]) => {
    const usable = routes.filter(route => route.supported !== false);
    const supported = usable.length ? usable : routes;
    const appropriate = supported.filter(route => hasReferences
      ? Boolean(route.capabilities?.referenceFields?.length)
      : !(route.capabilities?.requiredInputs ?? []).some(input => route.capabilities?.referenceFields?.includes(input)));
    const choices = appropriate.length ? appropriate : supported;
    const model = choices.find(route => route.id === preferred?.id && route.provider === preferred.provider)
      ?? choices.find(route => route.provider === preferred?.provider) ?? choices[0];
    return { key, model, routes };
  }).sort((a, b) => Number(a.model.supported === false) - Number(b.model.supported === false) || a.model.name.localeCompare(b.model.name));
}

export function modelDisplayName(id: string): string {
  const parts = id.split('/');
  const segments = parts.length > 1 ? parts.slice(1) : parts;
  const model = segments.filter(part => !/^(text-to-image|text-to-video|image-to-image|image-to-video|video-to-video|edit|upscale|inpaint|outpaint)$/.test(part)).join(' ') || id;
  return model.replace(/[-_]/g, ' ').replace(/\b\w+/g, word => /^(gpt|flux|ai|xl|hd|sd)$/i.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1));
}
