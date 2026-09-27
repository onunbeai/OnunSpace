import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { IconButton, Modal } from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import './projects.css';

interface ProjectRecord {
  id: string;
  name: string;
  revision?: number;
  updatedAt?: string;
}

export interface ProjectsProps {
  currentProject: { id: string; name: string };
  onOpen: (id: string) => void;
  onBackup: () => void;
  onRestore: () => void;
  onCreate: (name: string) => Promise<void>;
}

const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function Projects({ currentProject, onOpen, onBackup, onRestore, onCreate }: ProjectsProps) {
  const { t, locale } = useI18n();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const submitting = useRef(false);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    api<{ projects: ProjectRecord[] }>('/projects', { signal: controller.signal })
      .then(response => {
        if (!controller.signal.aborted) setProjects(response.projects);
      })
      .catch(error => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  const visibleProjects = useMemo(() => {
    const search = searchable(query.trim());
    return projects
      .map(project => project.id === currentProject.id ? { ...project, name: currentProject.name } : project)
      .filter(project => searchable(project.name).includes(search));
  }, [projects, currentProject.id, currentProject.name, query]);

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const clearSearch = () => { setQuery(''); searchInput.current?.focus(); };
  const closeCreate = () => {
    if (submitting.current) return;
    setCreating(false);
    setCreateError('');
    requestAnimationFrame(() => createTrigger.current?.focus());
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setCreateError('');
    try {
      await onCreate(projectName);
      setName('');
      setCreating(false);
      setReload(value => value + 1);
      requestAnimationFrame(() => createTrigger.current?.focus());
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t('Não foi possível criar o projeto.'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <main className="projects-page" aria-labelledby="projects-heading">
    <div className="projects-content">
      <header className="projects-heading">
        <div><h1 id="projects-heading">{t('Projetos')}</h1><p>{t('Retome um projeto ou comece um novo.')}</p></div>
        <div className="projects-heading-actions">
          <button type="button" className="projects-button" onClick={onRestore}><Icon name="upload" size={17}/>{t('Restaurar projeto')}</button>
          <button ref={createTrigger} type="button" className="projects-button is-primary" onClick={() => setCreating(true)}><Icon name="plus" size={17}/>{t('Novo projeto')}</button>
        </div>
      </header>

      <section className="projects-browser" aria-labelledby="projects-list-heading">
        <div className="projects-toolbar">
          <div className="projects-list-title"><h2 id="projects-list-heading">{t('Todos os projetos')}</h2>{!loading && !loadError && <span className="projects-count">{projects.length}</span>}</div>
          <div className="projects-list-tools">
            <label className="projects-search"><Icon name="search" size={17}/><input ref={searchInput} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Pesquisar projetos')} aria-label={t('Pesquisar projetos')}/>{query && <IconButton icon="close" label={t('Limpar busca')} onClick={clearSearch}/>}</label>
            <IconButton icon="redo" label={t('Recarregar')} disabled={loading} onClick={() => setReload(value => value + 1)}/>
          </div>
        </div>

        <div className="projects-records" aria-busy={loading}>
          {loading ? <div className="projects-loading" role="status"><span>{t('Carregando projetos…')}</span><div className="projects-skeletons" aria-hidden="true">{[0, 1, 2].map(index => <div className="projects-skeleton" key={index}><i/><div><b/><span/></div></div>)}</div></div>
            : loadError ? <div className="projects-state" role="alert"><Icon name="folder" size={28}/><h3>{t('Não foi possível carregar os projetos.')}</h3><p>{loadError}</p><button type="button" className="projects-button" onClick={() => setReload(value => value + 1)}>{t('Tentar novamente')}</button></div>
              : visibleProjects.length ? <>
                <div className="projects-columns" aria-hidden="true"><span>{t('Nome do projeto')}</span><span>{t('Última edição')}</span><span/></div>
                <ul className="projects-list">{visibleProjects.map(project => {
                  const current = project.id === currentProject.id;
                  const updated = project.updatedAt ? new Date(project.updatedAt) : null;
                  const validDate = updated && Number.isFinite(updated.getTime());
                  const projectName = project.name || t('Sem nome');
                  return <li className={`projects-row${current ? ' is-current' : ''}`} data-project-id={project.id} key={project.id}>
                    <div className="projects-identity"><span className="projects-folder"><Icon name="folder" size={23}/></span><div className="projects-name-block"><button type="button" className="projects-name" aria-label={t('Abrir {name}', { name: projectName })} onClick={() => onOpen(project.id)}>{projectName}</button>{current && <span className="projects-current">{t('Projeto atual')}</span>}</div></div>
                    <div className="projects-date"><span>{t('Última edição')}</span>{validDate ? <time dateTime={updated.toISOString()}>{dateFormat.format(updated)}</time> : <span className="projects-no-date">{t('Data indisponível')}</span>}</div>
                    <div className="projects-row-actions">{current && <IconButton icon="export" label={t('Exportar backup de {name}', { name: projectName })} onClick={onBackup}/>}<button type="button" className="projects-button projects-open" onClick={() => onOpen(project.id)} aria-label={t('Abrir {name}', { name: projectName })}>{t('Abrir')}<Icon name="chevron-right" size={15}/></button></div>
                  </li>;
                })}</ul>
              </> : <div className="projects-state"><Icon name={query.trim() ? 'search' : 'folder'} size={28}/><h3>{t(query.trim() ? 'Nenhum projeto encontrado.' : 'Nenhum projeto ainda.')}</h3><p>{t(query.trim() ? 'Tente outro nome ou limpe a busca.' : 'Crie seu primeiro projeto para começar.')}</p><button type="button" className="projects-button" onClick={() => query.trim() ? clearSearch() : setCreating(true)}>{t(query.trim() ? 'Limpar busca' : 'Novo projeto')}</button></div>}
        </div>
      </section>
    </div>

    <Modal open={creating} onOpenChange={open => open ? setCreating(true) : closeCreate()} title={t('Novo projeto')}>
      <form className="projects-create-form" onSubmit={event => void create(event)} aria-busy={busy}>
        <label htmlFor="projects-create-name">{t('Nome do projeto')}</label>
        <input id="projects-create-name" className="text-input" value={name} onChange={event => { setName(event.target.value); setCreateError(''); }} autoFocus autoComplete="off" maxLength={120} disabled={busy} aria-invalid={!!createError} aria-describedby={createError ? 'projects-create-error' : undefined}/>
        {createError && <p className="projects-create-error" id="projects-create-error" role="alert">{createError}</p>}
        <div className="projects-create-actions"><button type="button" className="projects-button" onClick={closeCreate} disabled={busy}>{t('Cancelar')}</button><button type="submit" className="projects-button is-primary" disabled={busy || !name.trim()}>{t(busy ? 'Criando…' : 'Criar projeto')}</button></div>
      </form>
    </Modal>
  </main>;
}
