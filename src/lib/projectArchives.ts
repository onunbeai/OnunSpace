import { api } from './api';
import { t } from './i18n';

export type ArchiveFormat = 'onun' | 'zip';
export interface ProjectArchive { id: string; fileName: string; path: string; createdAt: string; bytes: number; downloadUrl: string; format?: ArchiveFormat }
export const createProjectArchive = (projectId: string, format: ArchiveFormat) => api<ProjectArchive>(`/projects/${encodeURIComponent(projectId)}/backups`, { method: 'POST', body: JSON.stringify({ format }) });
export async function downloadProjectArchive(archive: ProjectArchive) {
  const target = new URL(archive.downloadUrl, location.origin);
  if (target.origin !== location.origin || !/^\/api\/projects\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\/backups\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\/file$/.test(target.pathname) || target.search || target.hash)
    throw new Error(t('Não foi possível baixar o arquivo. Tente novamente.'));
  const response = await fetch(target.href, { headers: { 'X-Onun-Client': 'studio' } });
  if (!response.ok) throw new Error(t('Não foi possível baixar o arquivo. Tente novamente.'));
  const blob = await response.blob();
  if (!blob.size) throw new Error(t('Não foi possível baixar o arquivo. Tente novamente.'));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = archive.fileName;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export const restoreProjectArchive = (file: File) => api<{ id: string }>('/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
