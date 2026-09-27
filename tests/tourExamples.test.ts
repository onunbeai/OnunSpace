import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTourExamples, isTourGenerator, prepareTourExamples } from '../src/components/tourExamples'
import { createEmptyMotionScene } from '../shared/emptyMotion'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Project } from '../shared/project'

const makeProject = (): Project => ({ id: 'qa-tour', name: 'Authored project', nodes: [], edges: [], motion: createEmptyMotionScene('Authored scene') })
const t = (key: string) => key
test('empty tour demonstrates a generator and feed reference while leaving Motion empty and the project unchanged', () => {
  const project = makeProject(), before = structuredClone(project)
  let examples = prepareTourExamples(project, emptyTourExamples(), 'workspace', t)
  assert.equal(examples.nodes.length, 0)
  examples = prepareTourExamples(project, examples, 'node', t)
  assert.ok(isTourGenerator(examples.nodes[0]))
  examples = prepareTourExamples(project, examples, 'connections', t)
  assert.equal(examples.nodes.length, 2)
  assert.equal(examples.edges.length, 1)
  assert.equal(examples.edges[0].target, examples.nodes[0].id)
  assert.equal(examples.edges[0].source, examples.nodes[1].id)
  const first = examples.nodes[0], second = examples.nodes[1]
  assert.ok(second.x + second.width < first.x, 'The example reference feeds the generator from the left without overlap')
  for (const step of ['node', 'connections', 'properties', 'models', 'connections'] as const) examples = prepareTourExamples(project, examples, step, t)
  assert.equal(examples.nodes.length, 2)
  assert.equal(examples.edges.length, 1)
  assert.equal(second.artwork, undefined)
  assert.ok(second.media && existsSync(fileURLToPath(second.media)), 'The feed reference is bundled for offline use')
  assert.equal(second.aspectRatio, '7:9')
  const canvasExamples = structuredClone(examples)
  for (const step of ['motion', 'timeline'] as const) {
    examples = prepareTourExamples(project, examples, step, t)
    assert.deepEqual(examples, canvasExamples, 'Motion steps must not inject a demo scene')
    assert.equal(project.motion.layers.length, 0)
    assert.equal(project.motion.customCode, undefined)
  }
  assert.deepEqual(project, before)
  assert.deepEqual(emptyTourExamples(), { nodes: [], edges: [] })
})
test('existing generators, connections and custom motion are reused; text-only projects receive a selectable model example', () => {
  const project = makeProject()
  const samples = prepareTourExamples(project, prepareTourExamples(project, emptyTourExamples(), 'node', t), 'connections', t)
  project.nodes = samples.nodes; project.edges = samples.edges
  project.motion.customCode = { html: '<h1>Original</h1>', css: '', js: '' }
  let examples = prepareTourExamples(project, emptyTourExamples(), 'connections', t)
  examples = prepareTourExamples(project, examples, 'motion', t)
  assert.deepEqual(examples, emptyTourExamples())
  project.nodes = [{ ...project.nodes[0], kind: 'text', id: 'authored-note', prompt: 'Keep this note' }]; project.edges = []
  const before = structuredClone(project)
  examples = prepareTourExamples(project, emptyTourExamples(), 'models', t)
  assert.ok(isTourGenerator(examples.nodes[0]))
  assert.deepEqual(project, before)
})
