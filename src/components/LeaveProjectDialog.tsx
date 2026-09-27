import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { createProjectArchive, downloadProjectArchive, type ArchiveFormat, type ProjectArchive } from '../lib/projectArchives';
import { Modal, Select } from './ui';
import { Icon } from './Icon';
import './leave-project.css';

export function LeaveProjectDialog({ open, project, onCancel, beforeSave, onContinue }: {
  open: boolean; project: { id: string; name: string }; onCancel: () => void; beforeSave: () => Promise<void>; onContinue: () => void;
}) {
  const { t } = useI18n();
  const [format, setFormat] = useState<ArchiveFormat>('onun');
  const [busy, setBusy] = useState<'save' | 'download' | null>(null);
  const [error, setError] = useState('');
  const [archive, setArchive] = useState<ProjectArchive | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { if (open) { setFormat('onun'); setError(''); setArchive(null); } }, [open, project.id]);
  const leave = async (download: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(download ? 'download' : 'save'); setError('');
    try {
      await beforeSave();
      if (download) {
        const file = archive ?? await createProjectArchive(project.id, format);
        setArchive(file);
        await downloadProjectArchive(file);
      }
      onContinue();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível salvar.')); }
    finally { inFlight.current = false; setBusy(null); }
  };
  return <Modal open={open} onOpenChange={value => { if (!value && !inFlight.current) onCancel(); }} title={t('Sair do editor?')}>
    <div className="leave-project" aria-busy={!!busy}>
      <div className="leave-project-identity"><span><Icon name="folder" size={24}/></span><div><small>{t('Projeto atual')}</small><strong>{project.name}</strong></div></div>
      <p>{t('Salve seu trabalho antes de abrir Projetos. Você também pode levar uma cópia completa com você.')}</p>
      <fieldset className="leave-project-file" disabled={!!busy}><legend>{t('Cópia do projeto')}</legend><Select label={t('Formato do arquivo de projeto')} value={format} options={[{ value: 'onun', label: '.onun' }, { value: 'zip', label: 'ZIP' }]} onChange={value => { setFormat(value as ArchiveFormat); setArchive(null); }}/><small>{t('Inclui canvas, Motion e arquivos. Importe a cópia para continuar de onde parou.')}</small></fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {archive && error && <p className="leave-project-saved">{t('A cópia está salva nesta pasta:')} <span>{archive.path}</span></p>}
      <div className="leave-project-actions"><button className="button primary" disabled={!!busy} onClick={() => void leave(true)}><Icon name={busy === 'download' ? 'clock' : 'export'} size={17}/>{busy === 'download' ? t('Preparando arquivo…') : t(format === 'onun' ? 'Salvar e baixar .onun' : 'Salvar e baixar ZIP')}</button><button className="button" disabled={!!busy} onClick={() => void leave(false)}>{t(busy === 'save' ? 'Salvando…' : 'Salvar e ir para Projetos')}<Icon name="chevron-right" size={15}/></button><button className="leave-project-cancel" disabled={!!busy} onClick={onCancel}>{t('Cancelar')}</button></div>
    </div>
  </Modal>;
}
