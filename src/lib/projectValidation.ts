import {t} from './i18n';
import type {Project} from '../../shared/project';
import {validateMotionScene} from '../../shared/motion';
export function parseProject(value:unknown):Project{
 if(!value||typeof value!=='object')throw new Error(t("Projeto inválido."));
 const project=value as Project;
 if(typeof project.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(project.id)||typeof project.name!=='string'||!project.name.trim()||project.name.length>200)throw new Error(t("Nome ou ID inválido."));
 if(!Array.isArray(project.nodes)||project.nodes.length>1000||!Array.isArray(project.edges)||project.edges.length>4000)throw new Error(t("Canvas inválido."));
 const ids=new Set<string>();
 for(const node of project.nodes){if(!node||typeof node.id!=='string'||ids.has(node.id)||!['reference','image','video','motion','text'].includes(node.kind)||![node.x,node.y,node.width].every(Number.isFinite)||node.width<1||node.width>10000||typeof node.title!=='string'||typeof node.prompt!=='string'||typeof node.model!=='string')throw new Error(t("Nó inválido."));ids.add(node.id);if(node.media&&!/^(data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm));base64,|https:\/\/|\/api\/assets\/)/.test(node.media))throw new Error(t("Mídia inválida."));}
 for(const edge of project.edges)if(!ids.has(edge.source)||!ids.has(edge.target)||edge.source===edge.target)throw new Error(t("Conexão inválida."));
 return {...project,motion:validateMotionScene(project.motion)};
}
