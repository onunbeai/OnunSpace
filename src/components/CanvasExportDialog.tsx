import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/project';
import { useI18n } from '../lib/i18n';
import { canvasExportMedia } from '../lib/canvasExport';
import { createProjectArchive, downloadProjectArchive } from '../lib/projectArchives';
import { Icon } from './Icon';
import { Modal } from './ui';
import './canvas-export.css';

export type ExportDialogProps = {
  open: boolean;
  onClose: () => void;
  project: Project;
  mode: 'canvas' | 'motion' | 'library' | 'projects';
  selectedId?: string | null;
  beforeExport: () => Promise<void>;
  onDownload: (nodeId: string) => void;
};

export function CanvasExportDialog({ open, onClose, project, selectedId, beforeExport, onDownload }: ExportDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const { selected, files } = canvasExportMedia(project, selectedId);
  useEffect(() => { if (open) setError(''); }, [open, project.id]);
  const archive = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await beforeExport(); await downloadProjectArchive(await createProjectArchive(project.id, 'onun')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível salvar.')); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Modal open={open} onOpenChange={value => { if (!value && !inFlight.current) onClose(); }} title={t('Exportar')}>
    <div className="canvas-export" aria-busy={busy}>
      {selected && <section className="canvas-export-selected">
        <div className="canvas-export-heading"><Icon name={selected.kind === 'video' ? 'video' : 'image'} size={20}/><div><small>{t('Arquivo selecionado')}</small><strong>{selected.title}</strong></div></div>
        <p>{t('Baixe o arquivo original, com a qualidade e o formato preservados.')}</p>
        <button className="button primary" disabled={busy} onClick={() => onDownload(selected.id)}><Icon name="export" size={16}/>{t(selected.kind === 'video' ? 'Baixar vídeo' : 'Baixar imagem')}</button>
      </section>}
      {files.length > 0 && <section className="canvas-export-files"><h3>{t('Arquivos do projeto')}</h3><ul>{files.map(node => <li key={node.id}><Icon name={node.kind === 'video' ? 'video' : 'image'} size={17}/><span><strong>{node.title}</strong><small>{t(node.kind === 'video' ? 'Vídeo' : 'Imagem')} · {t('Formato original')}</small></span><button className="icon-button" disabled={busy} aria-label={t('Baixar {name}', { name: node.title })} onClick={() => onDownload(node.id)}><Icon name="export" size={17}/></button></li>)}</ul></section>}
      {!selected && !files.length && <p className="canvas-export-empty">{t('Ainda não há imagens ou vídeos para baixar. Você pode exportar o projeto para continuar depois.')}</p>}
      <section className="canvas-export-project"><div className="canvas-export-heading"><Icon name="folder" size={20}/><div><small>{t('Projeto completo')}</small><strong>{project.name}</strong></div></div><p>{t('Inclui canvas, Motion e arquivos. Importe a cópia para continuar de onde parou.')}</p><button className="button" disabled={busy} onClick={() => void archive()}><Icon name={busy ? 'clock' : 'export'} size={16}/>{t(busy ? 'Criando arquivo…' : 'Baixar projeto .onun')}</button></section>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
