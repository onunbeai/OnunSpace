export class ApiError extends Error { constructor(message:string,readonly status:number){super(message);} }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Onun-Client': 'studio', ...init?.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error?.message ?? body?.error ?? `Não foi possível concluir (${response.status}).`,response.status);
  return body as T;
}
export function downloadFile(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
