export type MonitoredJob = { id: string; status: string; error?: string; createdAt?: string; nodeId?: string; projectId?: string; materialized?: boolean };
export const trackingError = 'Não foi possível acompanhar a geração. Reabra o projeto para recuperar o resultado antes de gerar novamente.';
export const resultSyncError = 'A geração terminou, mas o resultado ainda não foi sincronizado. Reabra o projeto para recuperá-lo.';

export async function boundedGenerationCall<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => { controller.abort(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) { stop(); return; }
    timer = setTimeout(() => { controller.abort(); reject(new Error(trackingError)); }, timeoutMs);
  });
  try { return await Promise.race([interrupted, Promise.resolve().then(() => { signal.throwIfAborted(); return run(controller.signal); })]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

export async function monitorGeneration<T extends MonitoredJob>(initial: T, options: {
  signal: AbortSignal;
  load: (id: string, signal: AbortSignal) => Promise<T>;
  sync: () => Promise<void>;
  onJob?: (job: T) => void;
  intervalMs?: number;
  requestTimeoutMs?: number;
  maxFailures?: number;
  maxWaitMs?: number;
}) {
  const { signal } = options;
  const started = Date.now();
  let job = initial, failures = 0;
  const pause = () => new Promise<void>((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, options.intervalMs ?? 2000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  while (true) {
    signal.throwIfAborted();
    if (Date.now() - started > (options.maxWaitMs ?? 31 * 60 * 1000)) throw new Error(trackingError);
    options.onJob?.(job);
    if (['error', 'failed', 'cancelled'].includes(job.status)) throw new Error(job.error || 'Geração cancelada.');
    const complete = ['complete', 'completed'].includes(job.status);
    try {
      if (complete && job.materialized !== false) {
        await boundedGenerationCall(() => options.sync(), signal, options.requestTimeoutMs);
        return job;
      }
      if (complete) {
        await pause();
        job = await boundedGenerationCall(child => options.load(job.id, child), signal, options.requestTimeoutMs);
        if (job.materialized === false) throw new Error(resultSyncError);
        continue;
      }
      if (!['queued', 'running', 'pending', 'processing'].includes(job.status)) throw Object.assign(new Error(trackingError), { status: 422 });
      await pause();
      job = await boundedGenerationCall(child => options.load(job.id, child), signal, options.requestTimeoutMs);
      failures = 0;
    } catch (error) {
      signal.throwIfAborted();
      const status = (error as { status?: number })?.status;
      const permanent = status != null && status >= 400 && status < 500 && ![408, 429].includes(status);
      if (permanent || ++failures >= (options.maxFailures ?? 4)) throw new Error(complete ? resultSyncError : trackingError);
      // Retry synchronization or status lookup only; never submit another paid generation.
      if (complete) await pause();
    }
  }
}
