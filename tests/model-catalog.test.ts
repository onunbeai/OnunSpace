import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalModelKey, groupModels, modelSettings, type CatalogModel } from '../shared/modelCatalog';

const model = (id: string, name: string, provider: CatalogModel['provider'] = 'higgsfield', extra: Partial<CatalogModel> = {}): CatalogModel => ({ id, name, provider, kind: 'image', ...extra });

test('model settings expose official output values and preserve compatible choices', () => {
  const soul = model('higgsfield/soul', 'SOUL', 'higgsfield', { capabilities: { aspectRatios: ['16:9', '1:1'], resolutions: ['720p'], counts: [1], defaults: { aspectRatio: '16:9', resolution: '720p', count: 1 } } });
  assert.deepEqual(modelSettings(soul, { aspectRatio: '3:4', resolution: '4K', count: 3 }), { aspectRatio: '16:9', resolution: '720p', count: 1 });
  assert.deepEqual(modelSettings(soul, { aspectRatio: '1:1', resolution: '720p', count: 1 }), { aspectRatio: '1:1', resolution: '720p', count: 1 });
  const marketing = model('marketing', 'Marketing', 'higgsfield', { capabilities: { resolutions: ['2k', '4k'], defaults: { resolution: '2k' } } });
  assert.equal(modelSettings(marketing, { aspectRatio: '1:1', resolution: '4K', count: 1 }).resolution, '4k');
  assert.deepEqual(modelSettings(model('custom', 'Custom'), { aspectRatio: '3:4', resolution: '4K', count: 2 }), { aspectRatio: '3:4', resolution: '4K', count: 2 });
  const existingNode = { model: 'old/model', provider: 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1 };
  assert.deepEqual({ model: 'new/model', provider: 'higgsfield', ...modelSettings(model('custom', 'Custom'), existingNode) }, { model: 'new/model', provider: 'higgsfield', aspectRatio: '1:1', resolution: '1K', count: 1 });
});

test('model groups merge vendor prefixes and task suffixes while retaining native provider routes', () => {
  const routes = [model('openai/gpt-image-1', 'OpenAI: GPT Image 1', 'openrouter'), model('gpt-image-1/text-to-image', 'GPT Image 1 (text-to-image)')];
  const groups = groupModels(routes);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].routes, routes);
  assert.equal(canonicalModelKey(routes[0]), 'image:gptimage1');
});

test('versions, quality variants and image/video capabilities remain separate', () => {
  const models = [model('gpt1', 'GPT Image 1'), model('gpt15', 'GPT Image 1.5'), model('gpt2', 'GPT Image 2'), model('flux-pro', 'FLUX Pro'), model('flux-max', 'FLUX Max'), model('gpt-video', 'GPT Image 1', 'higgsfield', { kind: 'video' })];
  assert.equal(groupModels(models).length, models.length);
});

test('vendor labels with colons normalize while product brand names stay part of identity', () => {
  const recraft = model('recraft-v4', 'Recraft V4');
  const namespaced = model('recraft/recraft-v4', 'Recraft: Recraft V4', 'openrouter');
  assert.equal(canonicalModelKey(recraft), 'image:recraftv4');
  assert.equal(groupModels([recraft, namespaced]).length, 1);
  assert.equal(groupModels([recraft, model('other-v4', 'V4')]).length, 2);
  assert.equal(groupModels([model('gpt15-higgs', 'GPT Image 1.5'), model('gpt15-or', 'OpenAI: GPT Image 1.5', 'openrouter')]).length, 1);
  assert.equal(groupModels([model('alibaba/qwen-image-3/text-to-image', 'Qwen Image 3'), model('qwen/qwen-image-3', 'Qwen: Qwen Image 3', 'openrouter')]).length, 1);
  assert.equal(groupModels([model('xai/grok-imagine-image-2.0', 'Grok Image 2.0'), model('x-ai/grok-imagine-image-2.0', 'xAI: Grok Imagine Image 2.0', 'openrouter')]).length, 1);
});

test('preferred native route wins only when supported and does not hide a usable equivalent', () => {
  const unsupported = model('gpt-edit', 'GPT Image 1', 'higgsfield', { supported: false });
  const usable = model('openai/gpt-image-1', 'OpenAI: GPT Image 1', 'openrouter');
  assert.deepEqual(groupModels([unsupported, usable], { id: unsupported.id, provider: 'higgsfield' })[0].model, usable);
  assert.deepEqual(groupModels([unsupported, usable])[0].routes, [unsupported, usable]);
});

test('connected provider filtering preserves the corresponding native identifier', () => {
  const higgsfield = model('openai/gpt-image-1/text-to-image', 'GPT Image 1');
  const openrouter = model('openai/gpt-image-1', 'OpenAI: GPT Image 1', 'openrouter');
  assert.equal(groupModels([higgsfield, openrouter], { id: openrouter.id, provider: 'openrouter' })[0].model.id, openrouter.id);
  assert.equal(groupModels([higgsfield])[0].model.id, higgsfield.id);
  assert.equal(groupModels([openrouter])[0].model.id, openrouter.id);
});

test('duplicate provider rows collapse and explicit canonical identity can join renamed labels', () => {
  const first = model('higgs/native', 'Provider display name', 'higgsfield', { canonicalId: 'gpt-image-1' });
  const second = model('openai/gpt-image-1', 'GPT Image 1', 'openrouter', { canonicalId: 'gpt-image-1' });
  const groups = groupModels([first, { ...first }, second]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].routes.length, 2);
});

test('reference presence chooses the compatible text or edit route while preserving Pro variants', () => {
  const text = model('gpt-image-15/text-to-image', 'GPT Image 1.5 Text-to-Image', 'higgsfield', { canonicalId: 'GPT Image 1.5', capabilities: { referenceFields: [], requiredInputs: [] } });
  const edit = model('gpt-image-15/edit', 'GPT Image 1.5 Edit', 'higgsfield', { canonicalId: 'GPT Image 1.5', capabilities: { referenceFields: ['input_images'], requiredInputs: ['input_images'] } });
  const pro = model('gpt-image-15-pro/edit', 'GPT Image 1.5 Pro', 'higgsfield', { canonicalId: 'GPT Image 1.5 Pro', capabilities: { referenceFields: ['input_images'], requiredInputs: ['input_images'] } });
  const withoutReferences = groupModels([edit, text, pro], { id: edit.id, provider: 'higgsfield' }, false);
  const withReferences = groupModels([text, edit, pro], { id: text.id, provider: 'higgsfield' }, true);
  assert.equal(withoutReferences.length, 2);
  assert.equal(withReferences.length, 2);
  assert.equal(withoutReferences.find(group => group.key === 'image:gptimage15')?.model.id, text.id);
  assert.equal(withReferences.find(group => group.key === 'image:gptimage15')?.model.id, edit.id);
  assert.equal(withReferences.find(group => group.key === 'image:gptimage15pro')?.model.id, pro.id);
  assert.equal(groupModels([{ ...edit, supported: false }, text], { id: edit.id, provider: 'higgsfield' }, true)[0].model.id, text.id);
});
