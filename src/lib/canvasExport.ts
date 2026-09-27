import type { Project } from '../../shared/project';

/** Export only real media. A generator without a result is not a Motion scene or a downloadable image. */
export function canvasExportMedia(project: Pick<Project, 'nodes'>, selectedId?: string | null) {
  const media = project.nodes.filter(node => Boolean(node.media) && ['image', 'video', 'reference'].includes(node.kind));
  const selected = media.find(node => node.id === selectedId);
  return { selected, files: media.filter(node => node.id !== selected?.id) };
}
