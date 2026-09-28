export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'request_failed') {
    super(message);
  }
}

export function publicError(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof Error && error.name === 'ZodError') return { status: 400, body: { error: 'Dados inválidos. Confira os campos e tente novamente.', code: 'validation_error' } };
  return { status: 500, body: { error: 'Não foi possível concluir a operação local.', code: 'internal_error' } };
}

export const transientGenerationError=(error:unknown)=>error instanceof HttpError
  ? ['provider_error','provider_invalid_response','download_failed'].includes(error.code)&&(error.status>=500||error.status===429||error.status===408)
  : error instanceof Error&&['TypeError','TimeoutError','AbortError'].includes(error.name);
