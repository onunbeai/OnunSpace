import { t } from '../../lib/i18n';
import type { CanvasNode, Project } from '../../../shared/project';
import { createEmptyMotionScene } from '../../../shared/emptyMotion';
export const newNode = (kind: CanvasNode['kind'], x = 500, y = 100): CanvasNode => ({
  id: crypto.randomUUID(), kind, title: t(kind === 'image' ? 'Gerar imagem' : kind === 'video' ? 'Gerar vídeo' : kind === 'motion' ? 'Cena de motion' : kind === 'text' ? 'Nota de direção' : 'Referência'),
  x, y, width: kind === 'reference' ? 250 : 350, prompt: '', model: kind === 'video' ? 'bytedance/seedance-2.0/text-to-video' : 'google/gemini-2.5-flash-image', provider: kind === 'video' ? 'higgsfield' : 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none', generationStatus: 'idle',
});
const node = (id: string, props: Partial<CanvasNode>): CanvasNode => ({...newNode('image'), id, ...props});
export function createSeedProject(): Project {
  return { id: 'onun-studio', name: 'Um novo universo criativo', nodes: [
    node('brand', {kind:'reference', title:'Universo Onun',x:105,y:145,width:260,artwork:'brand'}),
    node('mood', {kind:'reference',title:'Forma, luz e textura',x:105,y:425,width:260,artwork:'orb'}),
    node('brief', {kind:'text',title:'Direção criativa',x:105,y:735,width:260,prompt:'Tecnologia com um lado humano.\nRosa Onun, formas orgânicas e espaço para imaginar.\n\nMenos limites. Mais possibilidades.'}),
    node('generator', {title:'Exploração visual',x:510,y:175,width:390,artwork:'poster',prompt:'Um novo universo de possibilidades. Explore formas fluidas em rosa Onun, luz suave e uma estética editorial. Minimalista, tátil e inesperado.',status:'progress'}),
    node('output-1', {title:'Estudo de forma / 01',x:1035,y:120,width:285,artwork:'orb',status:'approved'}),
    node('output-2', {title:'Estudo tipográfico / 02',x:1035,y:480,width:285,artwork:'type',status:'review'}),
    node('motion', {kind:'motion',title:'Da ideia ao movimento',x:1455,y:290,width:310,artwork:'motion',prompt:'Uma cena de abertura para o universo Onun.',status:'none'}),
  ], edges:[{id:'e1',source:'brand',target:'generator'},{id:'e2',source:'mood',target:'generator'},{id:'e3',source:'brief',target:'generator'},{id:'e4',source:'generator',target:'output-1'},{id:'e5',source:'generator',target:'output-2'},{id:'e6',source:'output-1',target:'motion'},{id:'e7',source:'output-2',target:'motion'}], motion: createEmptyMotionScene(t("Cena sem título")) };
}
