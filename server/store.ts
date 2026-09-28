import { link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './errors.js';
import { validateMotionScene } from '../shared/motion.js';

export const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/);
const nodeSchema = z.object({
  id: identifier, kind: z.enum(['reference', 'image', 'video', 'motion', 'text']), title: z.string().max(200),
  x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), width: z.number().min(1).max(10000),
  prompt: z.string().max(20000), model: z.string().max(200), provider: z.enum(['openrouter', 'higgsfield']), aspectRatio: z.string().max(20), resolution: z.string().max(20), count: z.number().int().min(1).max(4), duration: z.number().finite().min(1).max(30).optional(), generateAudio: z.boolean().optional(),
  status: z.enum(['none', 'review', 'progress', 'approved', 'rejected']), generatedFrom: identifier.optional(), media: z.string().max(12_000_000).optional(), artwork: z.enum(['brand', 'orb', 'poster', 'type', 'motion']).optional(),
  outputs: z.array(z.string().max(12_000_000)).max(4).optional(), generationStatus: z.enum(['idle', 'running', 'complete', 'error']).optional(), error: z.string().max(1000).optional(),
});
const motionSchema = z.unknown().transform((value, context) => {
  try { return validateMotionScene(value); } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Cena inválida.' }); return z.NEVER; }
});
export const projectSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(200),
  nodes: z.array(nodeSchema).max(1000).default([]),
  edges: z.array(z.object({ id: identifier, source: identifier, target: identifier })).max(4000).default([]),
  motion: motionSchema,
  revision: z.number().int().min(0).optional(),
  updatedAt: z.string().optional(),
}).superRefine((project, context) => {
  const nodeIds = new Set(project.nodes.map(node => node.id));
  const edgeIds = new Set(project.edges.map(edge => edge.id));
  if (nodeIds.size !== project.nodes.length || edgeIds.size !== project.edges.length) context.addIssue({ code: 'custom', message: 'IDs do canvas precisam ser únicos.' });
  if (project.edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target)) context.addIssue({ code: 'custom', message: 'Conexões precisam de dois nós existentes e diferentes.' });
});
export type ProjectDocument = z.infer<typeof projectSchema>;

export class ProjectStore {
  private writes = new Map<string, Promise<unknown>>();
  constructor(readonly directory: string) {}

  projectDirectory(id: string) { return join(this.directory, identifier.parse(id)); }

  async ensureDirectory(id: string) {
    const directory = this.projectDirectory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new HttpError(400, 'Pasta de projeto inválida.', 'invalid_project_directory');
    return directory;
  }

  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const ids = new Set(entries.flatMap(entry => entry.isDirectory() && identifier.safeParse(entry.name).success ? [entry.name] : entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.json$/.test(entry.name) ? [entry.name.slice(0, -5)] : []));
    const projects = await Promise.all([...ids].map(async id => {
      const project = await this.get(id).catch(error => { if(error instanceof HttpError && error.status===404)return null; throw error; });
      if(!project)return null;
      return { id: project.id, name: project.name, revision: project.revision, updatedAt: project.updatedAt };
    }));
    return projects.filter(project=>project!==null).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async get(id: string): Promise<ProjectDocument> {
    identifier.parse(id);
    const path = join(this.projectDirectory(id), 'project.json');
    const readDocument = async (file: string) => {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 20_000_000) throw new HttpError(400, 'Arquivo de projeto inválido.', 'invalid_project_file');
      const project = projectSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (project.id !== id) throw new HttpError(400, 'ID do projeto não corresponde à pasta.', 'id_mismatch');
      return project;
    };
    try {
      const folder = await lstat(this.projectDirectory(id));
      if (folder.isSymbolicLink()) throw new HttpError(400, 'Pasta de projeto inválida.', 'invalid_project_directory');
      return await readDocument(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    let legacy: ProjectDocument;
    try { legacy = await readDocument(join(this.directory, `${id}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Projeto não encontrado.', 'project_not_found'); throw error; }
    await this.ensureDirectory(id);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(legacy, null, 2), { mode: 0o600, flag: 'wx' });
      await readDocument(temporary);
      try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      // Keep the legacy source intact; an existing migrated document always wins.
      return await readDocument(path);
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async save(input: unknown, expectedRevision?: number, createOnly = false): Promise<ProjectDocument> {
    const project = projectSchema.parse(input);
    const previousWrite = this.writes.get(project.id) ?? Promise.resolve();
    const nextWrite = previousWrite.catch(() => undefined).then(async () => {
      const previous = await this.get(project.id).catch(error => {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      });
      if (createOnly && previous) throw new HttpError(409, 'Já existe um projeto com este identificador.', 'project_exists');
      if (expectedRevision !== undefined && expectedRevision !== (previous?.revision ?? 0)) {
        throw new HttpError(409, 'O projeto foi alterado em outra janela ou pelo MCP. Recarregue antes de salvar.', 'revision_conflict');
      }
      const saved = { ...project, revision: (previous?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
      const serialized = JSON.stringify(saved, null, 2);
      if (Buffer.byteLength(serialized) > 20_000_000) throw new HttpError(413, 'O projeto ultrapassou 20 MB.', 'payload_too_large');
      const directory = await this.ensureDirectory(project.id);
      const path = join(directory, 'project.json');
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
      finally { await unlink(temporary).catch(() => undefined); }
      return saved;
    });
    this.writes.set(project.id, nextWrite);
    try { return await nextWrite; } finally { if (this.writes.get(project.id) === nextWrite) this.writes.delete(project.id); }
  }

  async mutate(id: string, change: (project: ProjectDocument) => ProjectDocument) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const project = await this.get(id);
      try { return await this.save(change(project), project.revision); } catch (error) {
        if (!(error instanceof HttpError && error.code === 'revision_conflict') || attempt === 2) throw error;
      }
    }
    throw new HttpError(409, 'Projeto ocupado. Tente novamente.', 'revision_conflict');
  }
}
