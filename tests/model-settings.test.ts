import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSettings, videoDurationChoices, type CatalogModel } from '../shared/modelCatalog.js';

const route = (provider: CatalogModel['provider'], capabilities?: CatalogModel['capabilities']): CatalogModel => ({
  id: 'same-model', name: 'Same model', kind: 'image', provider, capabilities,
});
const current = { aspectRatio: '4:3', resolution: '2k', count: 3 };

test('Model selection and preflight use the exact supported enum casing for either provider', () => {
  for (const provider of ['higgsfield', 'openrouter'] as const) {
    const settings = modelSettings(route(provider, { aspectRatios: ['1:1', '4:3'], resolutions: ['1K', '2K', '4K'], counts: [1, 2, 3, 4] }), current);
    assert.deepEqual(settings, { ...current, resolution: '2K' });
  }
});

test('Switching provider routes keeps only choices offered by the target route', () => {
  const higgsfield = route('higgsfield', { resolutions: ['1K', '2K', '4K'], aspectRatios: ['4:3'], counts: [1, 3] });
  const openrouter = route('openrouter', { resolutions: ['1024', '1536'], aspectRatios: ['1:1', '16:9'], counts: [1], defaults: { resolution: '1536', aspectRatio: '16:9', count: 1 } });
  const first = modelSettings(higgsfield, current);
  const switched = modelSettings(openrouter, first);
  assert.deepEqual(switched, { resolution: '1536', aspectRatio: '16:9', count: 1 });
  assert.ok(!Object.values(switched).includes('2K'), 'quality from another provider is not inherited');
});

test('Authoritative absent knobs reset inherited values to the omitted/default sentinels', () => {
  assert.deepEqual(modelSettings(route('openrouter', { resolutions: [], aspectRatios: [], counts: [1] }), current), { resolution: '1K', aspectRatio: '1:1', count: 1 });
  assert.deepEqual(modelSettings(route('higgsfield', { resolutions: [], aspectRatios: [], counts: [], defaults: { resolution: 'auto', aspectRatio: 'auto', count: 1 } }), current), { resolution: 'auto', aspectRatio: 'auto', count: 1 });
});

test('Incomplete descriptors preserve known settings instead of pretending unsupported or inventing quality options', () => {
  assert.deepEqual(modelSettings(route('openrouter'), current), current);
  assert.deepEqual(modelSettings(route('openrouter', { counts: [1] }), current), { ...current, count: 1 });
});


test('Video durations follow model enum, reset on model change and disappear for images', () => {
 const video:CatalogModel={...route('higgsfield',{durations:[5,10],defaults:{duration:5}}),kind:'video'};
 assert.deepEqual(videoDurationChoices(video),[5,10]);
 assert.equal(modelSettings(video,{...current,duration:10}).duration,10);
 assert.equal(modelSettings(video,{...current,duration:8}).duration,5);
 assert.equal(modelSettings({...video,capabilities:{durations:[4,8]}},{...current,duration:10}).duration,4);
 assert.equal(modelSettings({...video,capabilities:{durations:[]}},{...current,duration:10}).duration,undefined);
 assert.equal(modelSettings(route('openrouter'),{...current,duration:10}).duration,undefined);
});

test('Range-based video durations expose supported seconds without inventing choices for unknown or fixed-source models', () => {
 const video:CatalogModel={...route('higgsfield',{durations:[],durationRange:{min:3,max:15},defaults:{duration:5}}),kind:'video'};
 assert.deepEqual(videoDurationChoices(video),Array.from({length:13},(_,i)=>i+3));
 assert.equal(modelSettings(video,current).duration,5);
 assert.deepEqual(videoDurationChoices({...video,capabilities:{durations:[]}}),[]);
 assert.deepEqual(videoDurationChoices({...video,capabilities:undefined}),[]);
});

test('audio follows model defaults, preserves explicit off, and clears on unsupported models',()=>{
 const video:CatalogModel={...route('higgsfield',{audio:true,defaults:{generateAudio:false}}),kind:'video'};
 assert.equal(modelSettings(video,current).generateAudio,false);
 assert.equal(modelSettings(video,{...current,generateAudio:true}).generateAudio,true);
 assert.equal(modelSettings({...video,capabilities:{audio:true,defaults:{generateAudio:true}}},{...current,generateAudio:false}).generateAudio,false);
 assert.equal(modelSettings({...video,capabilities:{audio:false}},{...current,generateAudio:true}).generateAudio,undefined);
 assert.equal(modelSettings({...video,kind:'image'},{...current,generateAudio:true}).generateAudio,undefined);
});
