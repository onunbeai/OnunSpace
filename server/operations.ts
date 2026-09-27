import { z } from 'zod';
import { HttpError } from './errors.js';
import { identifier, projectSchema, type ProjectDocument } from './store.js';

const patch = z.record(z.string(), z.unknown());
export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('project.rename'), name: z.string().min(1).max(200) }),
  z.object({ op: z.literal('node.upsert'), node: projectSchema.shape.nodes.unwrap().element }),
  z.object({ op: z.literal('node.patch'), id: identifier, patch }),
  z.object({ op: z.literal('node.remove'), id: identifier }),
  z.object({ op: z.literal('edge.connect'), id: identifier.optional(), source: identifier, target: identifier }),
  z.object({ op: z.literal('edge.remove'), id: identifier }),
  z.object({ op: z.literal('scene.replace'), scene: z.unknown() }),
  z.object({ op: z.literal('layer.upsert'), layer: patch }),
  z.object({ op: z.literal('layer.patch'), id: identifier, patch }),
  z.object({ op: z.literal('layer.remove'), id: identifier }),
  z.object({ op: z.literal('keyframes.replace'), layerId: identifier, keyframes: z.array(patch).max(100) }),
  z.object({ op: z.literal('code.replace'), html: z.string().max(500_000), css: z.string().max(500_000), js: z.string().max(500_000) }),
]);
export const batchSchema = z.object({ expectedRevision: z.number().int().min(0), operations: z.array(operationSchema).min(1).max(200) });

export function applyOperations(project: ProjectDocument, operations: z.infer<typeof operationSchema>[]): ProjectDocument {
  const document = structuredClone(project);
  for (const operation of operations) {
    if (operation.op === 'project.rename') document.name = operation.name;
    if (operation.op === 'node.upsert') document.nodes = document.nodes.some(node => node.id === operation.node.id) ? document.nodes.map(node => node.id === operation.node.id ? operation.node : node) : [...document.nodes, operation.node];
    if (operation.op === 'node.patch') {
      if (!document.nodes.some(node => node.id === operation.id)) throw new HttpError(404, 'Nó não encontrado.', 'node_not_found');
      document.nodes = document.nodes.map(node => node.id === operation.id ? { ...node, ...operation.patch, id: node.id } : node);
    }
    if (operation.op === 'node.remove') { document.nodes = document.nodes.filter(node => node.id !== operation.id); document.edges = document.edges.filter(edge => edge.source !== operation.id && edge.target !== operation.id); }
    if (operation.op === 'edge.connect') document.edges.push({ id: operation.id ?? crypto.randomUUID(), source: operation.source, target: operation.target });
    if (operation.op === 'edge.remove') document.edges = document.edges.filter(edge => edge.id !== operation.id);
    if (operation.op === 'scene.replace') document.motion = operation.scene as ProjectDocument['motion'];
    if (operation.op === 'layer.upsert') {
      const layer = operation.layer as unknown as ProjectDocument['motion']['layers'][number];
      document.motion.layers = document.motion.layers.some(item => item.id === layer.id) ? document.motion.layers.map(item => item.id === layer.id ? layer : item) : [...document.motion.layers, layer];
    }
    if (operation.op === 'layer.patch') {
      if (!document.motion.layers.some(layer => layer.id === operation.id)) throw new HttpError(404, 'Camada não encontrada.', 'layer_not_found');
      document.motion.layers = document.motion.layers.map(layer => layer.id === operation.id ? { ...layer, ...operation.patch, id: layer.id } : layer);
    }
    if (operation.op === 'layer.remove') document.motion.layers = document.motion.layers.filter(layer => layer.id !== operation.id);
    if (operation.op === 'keyframes.replace') {
      if (!document.motion.layers.some(layer => layer.id === operation.layerId)) throw new HttpError(404, 'Camada não encontrada.', 'layer_not_found');
      document.motion.layers = document.motion.layers.map(layer => layer.id === operation.layerId ? { ...layer, keyframes: operation.keyframes as ProjectDocument['motion']['layers'][number]['keyframes'] } : layer);
    }
    if (operation.op === 'code.replace') document.motion.customCode = { html: operation.html, css: operation.css, js: operation.js };
  }
  return projectSchema.parse(document);
}
