import { useI18n } from '../lib/i18n';
import './project-loading.css';

/** The pending editor contains no project content until its document has loaded. */
export function ProjectLoading({ label }: { label?: string }) {
  const { t } = useI18n();
  const message = label ?? t('Abrindo projeto…');
  return <div className="project-loading" aria-busy="true">
    <div className="project-loading-brand"><img src={`${import.meta.env.BASE_URL}assets/onun-logo.svg`} width="128" height="40" alt="Onun"/><span>Space</span></div>
    <div className="project-loading-track" role="progressbar" aria-label={message}><span/></div>
    <p role="status">{message}</p>
  </div>;
}
