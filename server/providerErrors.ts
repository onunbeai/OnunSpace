import type { Provider } from './credentials.js';

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const fields: Record<string, string> = {
  resolution: 'Qualidade', aspect_ratio: 'Proporção', prompt: 'Prompt', duration: 'Duração',
  n: 'Quantidade', num_images: 'Quantidade', output_format: 'Formato', quality: 'Qualidade',
  image_url: 'Referência', image_urls: 'Referências', input_references: 'Referências',
};

// Only display the provider's error message. Validation input, metadata and raw
// upstream responses can contain credentials, signed URLs or the entire prompt.
function detailOf(payload: unknown): string {
  const body = record(payload);
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) return body.detail.slice(0, 3).map(item => {
    const error = record(item);
    const field = Array.isArray(error.loc) ? error.loc.find(part => typeof part === 'string' && Object.hasOwn(fields, part)) : undefined;
    return typeof error.msg === 'string' ? `${typeof field === 'string' ? `${fields[field]}: ` : ''}${error.msg}` : '';
  }).filter(Boolean).join('; ');
  const error = record(body.error);
  return typeof error.message === 'string' ? error.message : typeof body.error === 'string' ? body.error : '';
}

function safeDetail(detail: string, authorization?: string): string {
  let result = detail.slice(0, 4000);
  const secrets = authorization?.replace(/^(?:Key|Bearer)\s+/i, '').split(':').filter(Boolean) ?? [];
  for (const secret of secrets) result = result.split(secret).join('[oculto]');
  return result
    .replace(/https?:\/\/[^\s<>"']+|data:[^\s<>"']+/gi, '[URL omitida]')
    .replace(/\b(?:Bearer|Key)\s+\S+/gi, '[credencial omitida]')
    .replace(/\b(?:api[_ -]?key|api[_ -]?secret|authorization|access[_ -]?token|token|password|secret)\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[credencial omitida]')
    .replace(/\b(?:sk-|hf_)[\w-]+|\b[A-Za-z0-9_+/=-]{32,}\b/g, '[identificador omitido]')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 360);
}

export function providerErrorMessage(provider: Provider, status: number, payload?: unknown, authorization?: string): string {
  const name = provider === 'higgsfield' ? 'Higgsfield' : 'OpenRouter';
  if (status === 401) return `A chave não foi aceita pelo ${name}. Confira a conexão do provedor.`;
  if (status === 402 || status === 403 && provider === 'higgsfield') return `Saldo insuficiente no ${name}. Confira os créditos da sua conta no provedor.`;
  if (status === 403) return `Sua conta não tem permissão para este recurso do ${name}, ou a solicitação foi bloqueada pelo provedor.`;
  if (status === 404) return `Este modelo ou solicitação não está disponível para esta API ou conta do ${name}.`;
  if (status === 429) return `O ${name} atingiu o limite de solicitações. Aguarde e tente novamente.`;
  if (status === 423 || status === 503) return `O modelo está temporariamente indisponível no ${name}. Aguarde e tente novamente.`;
  const base = `O ${name} recusou a solicitação (HTTP ${status}).`;
  if (![400, 422].includes(status)) return base;
  const detail = safeDetail(detailOf(payload), authorization);
  // These hints are presentation only, never a reason to automatically resubmit
  // a paid generation. Higgsfield uses 400 for concurrency as well as bad input.
  if (/concurren|too many (?:active|pending|running|simultaneous|in.flight)|parallel (?:request|generation)/i.test(detail)) {
    return `O ${name} atingiu o limite de gerações simultâneas. Aguarde as gerações em andamento terminarem e tente novamente.`;
  }
  return detail ? `${base} ${detail}` : `${base} O provedor não informou o motivo. Confira as opções do modelo antes de tentar novamente.`;
}
