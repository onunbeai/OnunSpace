import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasExportMedia } from '../src/lib/canvasExport';
import type { CanvasNode } from '../shared/project';

function node(id: string, kind: CanvasNode['kind'], media?: string): CanvasNode {
  return { id, kind, media, title: id, x: 0, y: 0, width: 300, prompt: '', model: '', provider: 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none' };
}
const image = node('image', 'image', '/assets/result.png');
const video = node('video', 'video', '/assets/result.webm');
const reference = node('reference', 'reference', '/assets/input.jpg');
const nodes = [image, video, reference, node('pending-image', 'image'), node('pending-video', 'video'), node('motion', 'motion'), node('note', 'text')];

test('exporting an image or video targets its actual original media and lists remaining files once', () => {
  for (const selected of [image, video, reference]) {
    const result = canvasExportMedia({ nodes }, selected.id);
    assert.strictEqual(result.selected, selected);
    assert.equal(result.selected.media, selected.media);
    assert.deepEqual(result.files, [image, video, reference].filter(file => file !== selected));
  }
});
test('no selection, stale selection and generators without media show only downloadable assets', () => {
  for (const selected of [null, undefined, 'missing', 'pending-image', 'pending-video', 'motion', 'note']) {
    assert.deepEqual(canvasExportMedia({ nodes }, selected), { selected: undefined, files: [image, video, reference] });
  }
  assert.deepEqual(canvasExportMedia({ nodes: [] }), { selected: undefined, files: [] });
});
