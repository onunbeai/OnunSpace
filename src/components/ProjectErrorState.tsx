import {useEffect,useRef} from 'react';
import {useI18n} from '../lib/i18n';
import {Icon} from './Icon';
import './project-error-state.css';

export function ProjectErrorState(){
 const {t}=useI18n();
 const heading=useRef<HTMLHeadingElement>(null);
 const projectsUrl=`/projects${window.location.search}`;
 useEffect(()=>{heading.current?.focus();},[]);
 return <main className="project-recovery" aria-labelledby="project-recovery-title">
  <header className="project-recovery-brand"><img src="/assets/onun-symbol.svg" alt="" width={24} height={24}/><span>OnunSpace</span></header>
  <div className="project-recovery-stage">
   <section className="project-recovery-panel" aria-describedby="project-recovery-description">
    <div className="project-recovery-copy">
     <span className="project-recovery-icon"><Icon name="status-review" size={26}/></span>
     <h1 id="project-recovery-title" ref={heading} tabIndex={-1}>{t('Não foi possível abrir este projeto.')}</h1>
     <p id="project-recovery-description">{t('Recarregue para tentar novamente ou volte aos seus projetos.')}</p>
    </div>
    <div className="project-recovery-actions">
     <button type="button" className="project-recovery-button project-recovery-reload" onClick={()=>window.location.reload()}><Icon name="undo" size={17}/>{t('Recarregar')}</button>
     <a className="project-recovery-button project-recovery-projects" href={projectsUrl}><Icon name="folder" size={17}/>{t('Voltar aos projetos')}</a>
    </div>
   </section>
  </div>
 </main>;
}
