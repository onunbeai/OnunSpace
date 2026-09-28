import { t } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { CanvasNode, Project } from '../../shared/project';
import { api } from './api';
import { boundedGenerationCall, monitorGeneration, trackingError, type MonitoredJob } from './generationMonitor';

type Job = MonitoredJob & { outputs?: string[] };
type Attempt = {
  projectId: string;
  nodeId: string;
  phase: 'preparing' | 'submitting' | 'watching' | 'cancelling' | 'error';
  baseline: string;
  observedRunning: boolean;
  controller: AbortController;
  job?: Job;
  submission?: Promise<Job>;
};
const generationSnapshot = (node: CanvasNode) => JSON.stringify([node.generationStatus, node.error, node.media, node.outputs]);
const terminal = (job?: Job) => job && ['error', 'failed', 'cancelled'].includes(job.status);

export function useGeneration(project: Project, beforeStart: () => Promise<void>, onComplete: () => Promise<void>, notify: (message: string) => void) {
  const attempts = useRef(new Map<string, Attempt>());
  const currentProject = useRef(project);
  const callbacks = useRef({ beforeStart, onComplete, notify });
  currentProject.current = project;
  callbacks.current = { beforeStart, onComplete, notify };
  const mounted = useRef(true);
  const [local, setLocal] = useState<{ projectId: string; states: Record<string, Partial<CanvasNode>> }>({ projectId: project.id, states: {} });
  const active = (attempt: Attempt) => mounted.current && currentProject.current.id === attempt.projectId && attempts.current.get(attempt.nodeId) === attempt;
  const patch = (attempt: Attempt, change?: Partial<CanvasNode>) => {
    if (!active(attempt)) return;
    setLocal(previous => {
      const states = previous.projectId === attempt.projectId ? { ...previous.states } : {};
      if (change) states[attempt.nodeId] = change;
      else delete states[attempt.nodeId];
      return { projectId: attempt.projectId, states };
    });
  };
  const finish = (attempt: Attempt) => {
    if (!active(attempt)) return;
    patch(attempt);
    attempt.controller.abort();
    attempts.current.delete(attempt.nodeId);
  };
  const fail = (attempt: Attempt, error: unknown) => {
    if (!active(attempt) || attempt.phase === 'cancelling') return;
    attempt.phase = 'error';
    patch(attempt, { generationStatus: 'error', error: t(error instanceof Error ? error.message : String(error)) });
  };
  const watch = async (attempt: Attempt, job: Job) => {
    if (!active(attempt) || attempt.phase === 'cancelling') return;
    attempt.phase = 'watching';
    attempt.job = job;
    patch(attempt, { generationStatus: 'running', error: undefined });
    try {
      await monitorGeneration(job, {
        signal: attempt.controller.signal,
        load: (id, signal) => api<Job>(`/jobs/${id}`, { signal }),
        sync: () => callbacks.current.onComplete(),
        onJob: value => { attempt.job = value; },
      });
      if (!active(attempt) || (attempt.phase as string) === 'cancelling') return;
      finish(attempt);
      callbacks.current.notify(t('Sua criação está pronta.'));
    } catch (error) { fail(attempt, error); }
  };
  const createAttempt = (node: CanvasNode, phase: Attempt['phase']): Attempt => {
    const attempt: Attempt = { projectId: project.id, nodeId: node.id, phase, baseline: generationSnapshot(node), observedRunning: node.generationStatus === 'running', controller: new AbortController() };
    attempts.current.set(node.id, attempt);
    return attempt;
  };
  const recover = async (pending: Attempt[]) => {
    try {
      const result = await boundedGenerationCall(signal => api<{jobs: Job[]}>(`/jobs?projectId=${encodeURIComponent(project.id)}`, { signal }), pending[0].controller.signal);
      for (const attempt of pending) {
        if (!active(attempt) || attempt.phase === 'cancelling') continue;
        const job = result.jobs.filter(item => item.nodeId === attempt.nodeId && item.projectId === attempt.projectId).sort((a,b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
        if (job) { void watch(attempt, job); continue; }
        // Starting the job engine repairs stale nodes; synchronize that repair too.
        await boundedGenerationCall(() => callbacks.current.onComplete(), attempt.controller.signal);
        fail(attempt, new Error(trackingError));
      }
    } catch (error) { for (const attempt of pending) fail(attempt, error); }
  };
  useEffect(() => {
    mounted.current = true;
    setLocal({ projectId: project.id, states: {} });
    const tracked = attempts.current;
    return () => {
      mounted.current = false;
      tracked.forEach(attempt => attempt.controller.abort());
      tracked.clear();
    };
  }, [project.id]);

  useEffect(() => {
    for (const attempt of attempts.current.values()) {
      if (attempt.projectId !== project.id || ['preparing', 'cancelling'].includes(attempt.phase)) continue;
      const node = project.nodes.find(item => item.id === attempt.nodeId);
      if (!node) { finish(attempt); continue; }
      const changed = generationSnapshot(node) !== attempt.baseline;
      if (node.generationStatus === 'running') {
        attempt.observedRunning = true;
      } else if (['complete', 'error', 'idle'].includes(node.generationStatus ?? '') && (changed || attempt.observedRunning)) {
        finish(attempt);
      }
    }
    // Reloading an editor must resume existing jobs, including ones from older versions.
    const pending = project.nodes.filter(node => !node.generatedFrom && node.generationStatus === 'running' && !attempts.current.has(node.id)).map(node => createAttempt(node, 'watching'));
    if (pending.length) void recover(pending);
  }, [project]);

  const generate = async (node: CanvasNode) => {
    const previous = attempts.current.get(node.id);
    if (previous && previous.phase !== 'error') return;
    if (previous?.job && !terminal(previous.job)) {
      // A retry after a connection failure only resumes tracking the same job.
      await watch(previous, previous.job);
      return;
    }
    if (currentProject.current.nodes.find(item => item.id === node.id)?.generationStatus === 'running') {
      if (previous) finish(previous);
      await recover([createAttempt(node, 'watching')]);
      return;
    }
    if (!node.prompt.trim()) { callbacks.current.notify(t('Adicione um prompt.')); return; }
    if (previous) finish(previous);
    const attempt = createAttempt(node, 'preparing');
    patch(attempt, { generationStatus: 'running', error: undefined });
    try {
      await boundedGenerationCall(() => callbacks.current.beforeStart(), attempt.controller.signal);
      if (!active(attempt)) return;
      const latest = currentProject.current;
      const savedNode = latest.nodes.find(item => item.id === node.id);
      if (!savedNode) { finish(attempt); return; }
      attempt.baseline = generationSnapshot(savedNode);
      attempt.phase = 'submitting';
      const references = latest.edges.filter(edge => edge.target === node.id).map(edge => latest.nodes.find(item => item.id === edge.source)?.media).filter((media): media is string => !!media && /^(https:|data:image\/(png|jpeg|webp);base64,|\/api\/(?:space\/)?(?:projects\/[a-zA-Z0-9_-]+\/)?assets\/)/.test(media));
      const requestId = crypto.randomUUID();
      // Retain the id before submission so an interrupted response cannot cause a duplicate charge.
      attempt.job = { id: requestId, status: 'queued', projectId: attempt.projectId, nodeId: node.id };
      let job: Job;
      try {
        attempt.submission = boundedGenerationCall(signal => api<Job>('/generate', { method: 'POST', signal, body: JSON.stringify({ provider: node.provider, kind: node.kind === 'video' ? 'video' : 'image', model: node.model, prompt: node.prompt, aspectRatio: node.aspectRatio, resolution: node.resolution, count: node.count, ...(node.kind === 'video' && node.duration !== undefined ? { duration: node.duration } : {}), ...(node.kind === 'video' && node.generateAudio !== undefined ? { generateAudio: node.generateAudio } : {}), projectId: attempt.projectId, nodeId: node.id, references, requestId }) }), attempt.controller.signal);
        job = await attempt.submission;
      } catch (error) {
        if ([400, 401, 403, 422].includes((error as {status?:number})?.status ?? 0)) attempt.job = undefined;
        throw error;
      }
      if (active(attempt) && (attempt.phase as string) !== 'cancelling') await watch(attempt, job);
    } catch (error) { fail(attempt, error); }
  };
  const cancel = async (node: CanvasNode) => {
    const attempt = attempts.current.get(node.id) ?? createAttempt(node, 'watching');
    if (attempt.phase === 'cancelling') return;
    if (attempt.phase === 'preparing') {
      finish(attempt);
      callbacks.current.notify(t('Geração cancelada.'));
      return;
    }
    attempt.phase = 'cancelling';
    patch(attempt, { generationStatus: 'running', generationCancelling: true, error: undefined });
    try {
      // Wait for the acknowledged job ID, so cancelling during submission cannot
      // send DELETE before the server has created the job or trigger a resubmit.
      if (attempt.submission) await attempt.submission.catch(() => undefined);
      if (!active(attempt)) return;
      attempt.controller.abort();
      attempt.controller = new AbortController();
      if (!attempt.job) {
        const result = await boundedGenerationCall(signal => api<{ jobs: Job[] }>(`/jobs?projectId=${encodeURIComponent(attempt.projectId)}`, { signal }), attempt.controller.signal);
        attempt.job = result.jobs.filter(job => job.nodeId === node.id && job.projectId === attempt.projectId).sort((a,b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
      }
      if (!attempt.job) throw new Error('Não foi possível cancelar. Tente novamente.');
      const job = await boundedGenerationCall(signal => api<Job>(`/jobs/${attempt.job!.id}`, { method: 'DELETE', signal }), attempt.controller.signal);
      attempt.job = job;
      await boundedGenerationCall(() => callbacks.current.onComplete(), attempt.controller.signal);
      if (!active(attempt)) return;
      finish(attempt);
      callbacks.current.notify(t(job.status === 'complete' ? 'Sua criação está pronta.' : job.error || 'Geração cancelada.'));
    } catch (error) {
      if (!active(attempt)) return;
      attempt.phase = 'error';
      patch(attempt, { generationStatus: 'running', generationCancelling: false, error: t(error instanceof Error ? error.message : 'Não foi possível cancelar. Tente novamente.') });
    }
  };
  return { generate, cancel, states: local.projectId === project.id ? local.states : {} };
}
