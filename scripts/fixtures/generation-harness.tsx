import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Project } from '../../shared/project';
import { useGeneration } from '../../src/lib/useGeneration';
import { useViewport } from '../../src/features/canvas/useViewport';

declare global { interface Window { __generationQA: any; __generationFixture: Project } }
const initialProject = window.__generationFixture;
const control = { before: Promise.resolve(), release: () => {}, syncFailures: 0, syncCalls: 0, syncProject: initialProject, notices: [] as string[] };
function Harness() {
  const [project, setProject] = useState(initialProject);
  const { generate, states } = useGeneration(project, () => control.before, async () => {
    control.syncCalls++;
    if (control.syncFailures-- > 0) throw new Error('Mock project connection lost');
    setProject(control.syncProject);
  }, message => control.notices.push(message));
  const { areaRef, view } = useViewport(project, true);
  useEffect(() => {
    window.__generationQA = {
      project, states, view, notices: control.notices, syncCalls: control.syncCalls,
      generate: () => { void generate(project.nodes[0]); },
      replace: setProject,
      hold: () => { control.before = new Promise(resolve => { control.release = resolve; }); },
      release: () => { control.release(); control.before = Promise.resolve(); },
      setSync: (next: Project, failures = 0) => { control.syncProject = next; control.syncFailures = failures; },
      unmount: () => root.unmount(),
    };
  });
  const original = useRef(project.nodes[0]);
  return <main><pre data-testid="state">{JSON.stringify({ states, projectId: project.id, view })}</pre><div ref={areaRef} style={{ width: 1100, height: 750, position: 'relative', overflow: 'hidden', background: '#171717' }}><div style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, position: 'absolute' }}>{project.nodes.map(node => <div key={node.id} data-node-id={node.id} style={{ position: 'absolute', left: node.x, top: node.y, width: node.width, height: 300, background: '#343434', color: '#fff' }}>{node.id}</div>)}</div></div><p>{original.current.title}</p></main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Harness />);
