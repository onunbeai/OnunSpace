import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { defaultScene } from '../shared/motion.js';
import { createEmptyMotionScene } from '../shared/emptyMotion.js';
import { generationSchema } from './providers.js';
import { identifier, projectSchema, type ProjectDocument } from './store.js';
import { batchSchema } from './operations.js';

const runtime = process.env.ONUN_RUNTIME_URL ?? 'http://127.0.0.1:4318';
const runtimeUrl = new URL(runtime);
if (!['127.0.0.1', 'localhost'].includes(runtimeUrl.hostname) || runtimeUrl.protocol !== 'http:') throw new Error('O MCP só aceita o runtime HTTP local.');

async function requestRuntime(base: string, path: string, method = 'GET', body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Onun-Client': 'studio' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(130_000), redirect: 'error' });
  } catch { throw new Error('Runtime Onun indisponível. Inicie npm run dev ou npm start no projeto.'); }
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? `Falha no runtime (HTTP ${response.status}).`);
  return result;
}

export function createMcpServer(base = runtime) {
  const destination = new URL(base);
  if (!['127.0.0.1', 'localhost'].includes(destination.hostname) || destination.protocol !== 'http:') throw new Error('O MCP só aceita o runtime HTTP local.');
  const api = (path: string, method = 'GET', body?: unknown) => requestRuntime(base, path, method, body);
  const updateProject = async (id: string, change: (project: ProjectDocument) => ProjectDocument) => {
    const project = projectSchema.parse(await api(`/api/projects/${id}`));
    return api(`/api/projects/${id}`, 'PUT', { project: change(project), expectedRevision: project.revision });
  };
  const server = new McpServer({ name: 'onun-space', version: '0.1.0' });
  const register = <T extends z.ZodRawShape>(name: string, description: string, inputSchema: T, run: (input: z.infer<z.ZodObject<T>>) => Promise<unknown>, readOnly = false) => {
    server.registerTool(name, { description, inputSchema: z.object(inputSchema), annotations: { readOnlyHint: readOnly, destructiveHint: name.endsWith('_remove'), idempotentHint: readOnly, openWorldHint: name.startsWith('generation') || name === 'models_list' || name === 'project_backup_create' } }, async (input: unknown) => {
      try { return { content: [{ type: 'text' as const, text: JSON.stringify(await run(z.object(inputSchema).parse(input)), null, 2) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Falha ao executar ferramenta.' }] }; }
    });
  };
  register('runtime_status', 'Check the local runtime, renderer and persistence. Never returns API secrets.', {}, () => api('/api/health'), true);
  register('projects_list', 'List local Onun projects with their revisions.', {}, () => api('/api/projects'), true);
  register('project_get', 'Read the complete canvas graph, motion scene and revision before editing.', { projectId: identifier }, input => api(`/api/projects/${input.projectId}`), true);
  register('project_create', 'Create a local editable project with an empty canvas and an empty motion scene.', { name: z.string().min(1).max(200), projectId: identifier.optional() }, input => api('/api/projects', 'POST', { id: input.projectId ?? randomUUID(), name: input.name, nodes: [], edges: [], motion: createEmptyMotionScene() }));
  register('project_update', 'Replace a project using its expected revision. A stale revision returns a conflict; read the current project before retrying.', { project: projectSchema, expectedRevision: z.number().int().min(0) }, input => api(`/api/projects/${input.project.id}`, 'PUT', input));
  register('project_batch', 'Apply up to 200 graph, layer, keyframe and code operations atomically in one revision. All operations are validated before writing; any invalid operation rejects the entire batch. Use expectedRevision from project_get.', { projectId: identifier, ...batchSchema.shape }, input => api(`/api/projects/${input.projectId}/batch`, 'POST', input));
  register('project_validate', 'Validate a complete project without saving it. Checks IDs, graph references, layer bounds, keyframes, colors, duration and schema.', { project: projectSchema }, input => api('/api/validate', 'POST', input.project), true);
  register('project_export', 'Return the project JSON including canvas and scene source. Local asset URLs reference this runtime. Use project_backup_create for a portable ZIP containing the actual asset files.', { projectId: identifier }, input => api(`/api/projects/${input.projectId}`), true);
  register('project_backup_info', 'Read the project folder, remembered backup destination and latest real ZIP backup. Does not return credentials.', { projectId: identifier }, input => api(`/api/projects/${input.projectId}/backup-settings`), true);
  register('project_backup_create', 'Create a unique portable ZIP with the project, referenced media, motion source and fonts. Waits for the actual file to finish, then returns its path, bytes and download URL. Optional absolute destination is remembered for this project. Referenced public HTTPS media is downloaded; missing assets fail the backup. Never overwrites an existing backup.', { projectId: identifier, destination: z.string().min(1).max(4096).optional() }, async input => {
    if (input.destination) await api(`/api/projects/${input.projectId}/backup-settings`, 'PUT', { destination: input.destination });
    return api(`/api/projects/${input.projectId}/backups`, 'POST', {});
  });
  register('assets_list', 'List up to 1000 assets stored in the local project runtime. No arbitrary filesystem access.', {}, () => api('/api/assets'), true);
  register('asset_import', 'Import a PNG, JPEG or WebP data URL into the local asset directory. Returns an asset URL for canvas nodes. Maximum encoded payload 16 MB; format signature checked.', { dataUrl: z.string().max(16000000) }, input => api('/api/assets', 'POST', input));
  register('scene_get', 'Read the current HTML/CSS/GSAP motion composition, layers and keyframes.', { projectId: identifier }, input => api(`/api/projects/${input.projectId}/scene`), true);
  register('scene_upsert', 'Replace the primary motion scene. Read the onun://motion-contract resource first. Validation enforces finite bounds, colors and supported easing.', { projectId: identifier, scene: z.record(z.string(), z.unknown()) }, input => api(`/api/projects/${input.projectId}/scene`, 'PUT', input.scene));
  register('layer_update', 'Update a layer by ID. Supports position, dimensions, typography, color, opacity, scale, rotation, visibility, timing, easing and keyframes.', { projectId: identifier, layerId: identifier, patch: z.record(z.string(), z.unknown()) }, input => api(`/api/projects/${input.projectId}/layers/${input.layerId}`, 'PUT', input.patch));
  register('layer_add', 'Append a complete validated motion layer. Layer IDs must be unique.', { projectId: identifier, layer: z.record(z.string(), z.unknown()) }, input => updateProject(input.projectId, project => ({ ...project, motion: { ...project.motion, layers: [...project.motion.layers, input.layer as unknown as ProjectDocument['motion']['layers'][number]] } })));
  register('layer_remove', 'Remove one motion layer by ID.', { projectId: identifier, layerId: identifier }, input => updateProject(input.projectId, project => ({ ...project, motion: { ...project.motion, layers: project.motion.layers.filter(layer => layer.id !== input.layerId) } })));
  register('timeline_update', 'Replace keyframes for selected tracks and optionally adjust duration/FPS. Times use seconds; update layer end values before shortening a scene.', { projectId: identifier, duration: z.number().min(.1).max(120).optional(), fps: z.number().int().min(1).max(60).optional(), tracks: z.array(z.object({ layerId: identifier, keyframes: z.array(z.record(z.string(), z.unknown())).max(100) })).max(200) }, input => api(`/api/projects/${input.projectId}/timeline`, 'PUT', input));
  register('scene_code_set', 'Author custom HTML, CSS and JavaScript inside the isolated scene. JavaScript receives sceneRoot and the paused GSAP timeline. Use timeline.to/from/fromTo only for deterministic rendering; no timers, external scripts, network or filesystem. Replaces existing custom code.', { projectId: identifier, html: z.string().max(500_000), css: z.string().max(500_000), js: z.string().max(500_000) }, input => updateProject(input.projectId, project => ({ ...project, motion: { ...project.motion, customCode: { html: input.html, css: input.css, js: input.js } } })));
  register('canvas_node_upsert', 'Add or replace a complete canvas node. Use project_get to inspect the CanvasNode contract.', { projectId: identifier, node: projectSchema.shape.nodes.unwrap().element }, input => updateProject(input.projectId, project => ({ ...project, nodes: project.nodes.some(node => node.id === input.node.id) ? project.nodes.map(node => node.id === input.node.id ? input.node : node) : [...project.nodes, input.node] })));
  register('canvas_node_remove', 'Remove one canvas node and its connections.', { projectId: identifier, nodeId: identifier }, input => updateProject(input.projectId, project => ({ ...project, nodes: project.nodes.filter(node => node.id !== input.nodeId), edges: project.edges.filter(edge => edge.source !== input.nodeId && edge.target !== input.nodeId) })));
  register('canvas_connect', 'Connect two existing canvas nodes as a reference flow.', { projectId: identifier, source: identifier, target: identifier }, input => updateProject(input.projectId, project => {
    if (!project.nodes.some(node => node.id === input.source) || !project.nodes.some(node => node.id === input.target)) throw new Error('Os dois nós precisam existir.');
    return { ...project, edges: [...project.edges, { id: randomUUID(), source: input.source, target: input.target }] };
  }));
  register('canvas_disconnect', 'Remove a canvas connection by edge ID.', { projectId: identifier, edgeId: identifier }, input => updateProject(input.projectId, project => ({ ...project, edges: project.edges.filter(edge => edge.id !== input.edgeId) })));
  register('models_list', 'Discover current provider models. source=curated means the live catalog is unavailable or the provider has no mapped discovery endpoint.', { provider: generationSchema.shape.provider, kind: generationSchema.shape.kind }, input => api(`/api/models?provider=${input.provider}&kind=${input.kind}`), true);
  register('generation_create', 'Start a billable image/video or AI motion generation using a key already configured in the UI. Returns a local job ID. Poll generation_status; never claim success before complete. requestId is an optional UUID for idempotent retries.', generationSchema.shape, input => api('/api/generate', 'POST', input));
  register('generation_status', 'Read generation state and fetch remote progress when due. Outputs appear only after actual provider completion.', { jobId: identifier }, input => api(`/api/jobs/${input.jobId}`), true);
  register('generation_cancel', 'Cancel local generation tracking; OpenRouter may continue processing and billing. Higgsfield cancellation is sent to its API and may be refused when already running.', { jobId: identifier }, input => api(`/api/jobs/${input.jobId}`, 'DELETE'));
  register('render_create', 'Render a saved project scene locally to MP4/WebM through deterministic Chromium frames and FFmpeg. Returns a queued job; poll render_status. No provider credits used.', { projectId: identifier, options: z.object({ format: z.enum(['mp4', 'webm']).optional(), quality: z.enum(['draft', 'high']).optional(), width: z.number().int().min(64).max(4096).optional(), height: z.number().int().min(64).max(4096).optional(), fps: z.number().int().min(1).max(60).optional() }).optional() }, input => api('/api/renders', 'POST', input));
  register('render_status', 'Read actual renderer progress, errors and completed download URL.', { jobId: identifier }, input => api(`/api/renders/${input.jobId}`), true);
  register('render_list', 'List all render jobs retained in this runtime session.', {}, () => api('/api/renders'), true);
  register('render_cancel', 'Cancel a local render and stop its Chromium/FFmpeg work.', { jobId: identifier }, input => api(`/api/renders/${input.jobId}`, 'DELETE'));
  const skills = [
    {name:'motion-skill',uri:'onun://skills/motion',path:'../skills/onunspace-motion/SKILL.md',description:'Motion authoring workflow for Onun Space.'},
    {name:'motion-authoring',uri:'onun://skills/motion/authoring',path:'../skills/onunspace-motion/references/authoring.md',description:'Detailed editable scene and animation authoring guidance.'},
    {name:'motion-review-skill',uri:'onun://skills/motion-review',path:'../skills/onunspace-motion-review/SKILL.md',description:'Review composition, timing, rendering and editing quality.'},
  ];
  for (const skill of skills) server.registerResource(skill.name, skill.uri, {mimeType:'text/markdown',description:skill.description}, async()=>({contents:[{uri:skill.uri,mimeType:'text/markdown',text:await readFile(new URL(skill.path,import.meta.url),'utf8')}]}));
  server.registerResource('motion-contract', 'onun://motion-contract', { mimeType: 'application/json', description: 'Motion scene schema, engine contract and a working starter scene.' }, async () => ({ contents: [{ uri: 'onun://motion-contract', mimeType: 'application/json', text: JSON.stringify({ engine: 'HTML + CSS + GSAP', units: { geometry: 'pixels', time: 'seconds', opacity: '0..1' }, limits: { layers: 200, keyframesPerLayer: 100, duration: 120, fps: 60, maxPixels: 8847360 }, keyframeEase: 'Optional keyframe.ease controls the transition into that keyframe; otherwise layer.ease is used.', layerAppearance: { foreground: 'color remains the text/shape foreground. All appearance fields are optional; omitted fields preserve legacy visuals.', fields: ['fontFamily', 'fontStyle', 'textAlign', 'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration', 'backgroundColor', 'borderColor', 'borderWidth', 'borderStyle', 'padding', 'textStrokeWidth', 'textStrokeColor'], units: 'lineHeight is unitless; letterSpacing, padding, borderWidth and textStrokeWidth are pixels. Colors use #RRGGBB; backgroundColor also accepts transparent.', limits: { fontFamilyCharacters: 200, lineHeight: [.1, 10], letterSpacing: [-200, 1000], padding: [0, 1000], borderWidth: [0, 1000], textStrokeWidth: [0, 100] }, customContent: 'Optional layer.customContent:{html,css}, maximum 100000 HTML and 50000 CSS characters. Content is scoped to a child shadow root; the native geometry, appearance, selection and GSAP keyframes stay on its wrapper. Scripts and event handlers are removed. CSS animations follow scene seek time; transitions are disabled. Use scene.customCode for explicit deterministic JavaScript.' }, eases: ['none', 'power2.out', 'power3.inOut', 'expo.out', 'back.out(1.4)'], customCode: 'HTML/CSS/JS executes in an isolated scene. sceneRoot and paused timeline are available; all animation must be attached to timeline for deterministic seeks. No network or filesystem access.', example: defaultScene }, null, 2) }] }));
  server.registerResource('projects', new ResourceTemplate('onun://projects/{projectId}', { list: undefined }), { mimeType: 'application/json', description: 'Read live project state shared with the visual editor.' }, async (uri, variables) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await api(`/api/projects/${identifier.parse(variables.projectId)}`), null, 2) }] }));
  server.registerPrompt('motion-director', { description: 'A disciplined workflow for designing and rendering polished editable motion in Onun.', argsSchema: { projectId: z.string(), brief: z.string() } }, ({ projectId, brief }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Create an art-directed motion for project ${projectId}. Brief: ${brief}\nFirst read onun://skills/motion, onun://skills/motion/authoring, onun://motion-contract and project_get. For quality review, read onun://skills/motion-review. Plan composition, typography, timing and transitions. Keep geometry on the scene grid and create meaningful staggered animation. Use project_batch with expectedRevision for atomic edits, or scene_code_set with deterministic GSAP timeline for advanced HTML/CSS compositions. Read back the result, use project_validate, then render_create only when the user requests export. Poll render_status to completion and report actual errors. Provider generation is billable: invoke it only when requested; editing and local rendering require no API credits.` } }] }));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await createMcpServer().connect(new StdioServerTransport());
