import {useCallback,useEffect,useRef,useState} from 'react';
import type {Project} from '../../shared/project';
import {mergeProject} from '../../shared/mergeProject';
import {createEmptyMotionScene} from '../../shared/emptyMotion';
import {t} from './i18n';
import {api,ApiError} from './api';
import {parseProject} from './projectValidation';
const queryId=new URLSearchParams(location.search).get('project');
const projectId=queryId&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(queryId)?queryId:'onun-studio';
const cacheKey=`onun-space-project-v1-${projectId}`;
export function useProject(){
 // A pending ID is never a demo. Only validated, saved local documents may be recovered offline.
 const[cachedProject]=useState<Project|null>(()=>{try{const raw=localStorage.getItem(cacheKey);if(raw){const cached=parseProject(JSON.parse(raw));if(cached.id===projectId)return cached;}}catch{/* Recover from the durable server copy. */}return null;});
 const[project,setProject]=useState<Project>(()=>cachedProject??{id:projectId,name:t('Sem título'),nodes:[],edges:[],motion:createEmptyMotionScene(t('Cena sem título'))});
 const[connection,setConnection]=useState<'loading'|'local'|'browser'>('loading');
 const[saveState,setSaveState]=useState('Carregando projeto');const[saveError,setSaveError]=useState('');const[loadError,setLoadError]=useState('');
 const[history,setHistory]=useState<Project[]>([]);const[future,setFuture]=useState<Project[]>([]);
 const current=useRef(project),base=useRef(project),dirty=useRef(false),saving=useRef<Promise<void>|null>(null);
 const accept=useCallback((doc:Project)=>{current.current=doc;setProject(doc);},[]);
 useEffect(()=>{let active=true;(async()=>{try{await api('/health');let remote:Project;try{remote=await api(`/projects/${projectId}`);}catch(error){if(!(error instanceof ApiError)||error.status!==404)throw error;try{remote=await api('/projects',{method:'POST',body:JSON.stringify(current.current)});}catch(createError){if(createError instanceof ApiError&&createError.status===409)remote=await api(`/projects/${projectId}`);else throw createError;}}if(active){base.current=remote;accept(remote);setConnection('local');setSaveState('Salvo neste dispositivo');}}catch(error){if(active){if(cachedProject){setConnection('browser');setSaveState('Rascunho no navegador');}else{setLoadError(error instanceof Error?error.message:'Não foi possível abrir este projeto.');}}}})();return()=>{active=false;};},[accept,cachedProject]);
 const update=useCallback((change:Project|((p:Project)=>Project),record=true)=>{if(connection==='loading'||loadError)return;const previous=current.current;const next=typeof change==='function'?change(previous):change;if(record){setHistory(h=>[...h.slice(-39),previous]);setFuture([]);}dirty.current=true;accept(next);setSaveState('Salvando alterações…');setSaveError('');},[accept,connection,loadError]);
 const flush=useCallback(async()=>{
  if(saving.current)await saving.current;
  if(loadError)throw new Error(loadError);
  if(connection==='loading')throw new Error('Aguarde o projeto terminar de carregar.');
  if(!dirty.current)return;
  const snapshot=current.current,ancestor=base.current;
  try{localStorage.setItem(cacheKey,JSON.stringify(snapshot));}catch{const message='O armazenamento do navegador está cheio. Exporte seu projeto.';setSaveError(message);if(connection==='browser')throw new Error(message);}
  if(connection==='browser'){dirty.current=false;setSaveState('Rascunho no navegador');return;}
  const task=(async()=>{try{let saved:Project;try{saved=await api(`/projects/${snapshot.id}`,{method:'PUT',body:JSON.stringify({project:snapshot,expectedRevision:ancestor.revision})});}catch(error){if(!(error instanceof ApiError)||error.status!==409)throw error;const remote=await api<Project>(`/projects/${snapshot.id}`);const merged=mergeProject(ancestor,snapshot,remote);saved=await api(`/projects/${snapshot.id}`,{method:'PUT',body:JSON.stringify({project:merged,expectedRevision:remote.revision})});}
   base.current=saved;if(current.current===snapshot){dirty.current=false;accept(saved);setSaveState('Salvo neste dispositivo');}else{accept(mergeProject(snapshot,current.current,saved));}setSaveError('');
  }catch(error){const message=error instanceof Error?error.message:'Falha ao salvar o projeto.';setSaveState('Alterações não sincronizadas');setSaveError(message);throw error;}finally{saving.current=null;}})();saving.current=task;await task;
 },[accept,connection,loadError]);
 useEffect(()=>{if(connection==='loading')return;const timer=setTimeout(()=>void flush().catch(()=>{}),600);return()=>clearTimeout(timer);},[project,connection,flush]);
 useEffect(()=>{if(connection!=='local')return;const timer=setInterval(async()=>{if(dirty.current||saving.current||document.hidden)return;try{const remote=await api<Project>(`/projects/${current.current.id}`);if(remote.revision!==base.current.revision){base.current=remote;accept(remote);setSaveState('Atualizado via MCP');}}catch{/* Keep the current project during a temporary disconnect. */}},1800);return()=>clearInterval(timer);},[connection,accept]);
 const sync=useCallback(async()=>{await flush();const remote=await api<Project>(`/projects/${current.current.id}`);base.current=remote;accept(remote);setSaveState('Salvo neste dispositivo');},[accept,flush]);
 const undo=()=>{const previous=history.at(-1);if(!previous)return;const previousCurrent=current.current;setFuture(f=>[previousCurrent,...f]);setHistory(h=>h.slice(0,-1));update({...previous,revision:current.current.revision},false);};
 const redo=()=>{const next=future[0];if(!next)return;const previousCurrent=current.current;setHistory(h=>[...h,previousCurrent]);setFuture(f=>f.slice(1));update({...next,revision:current.current.revision},false);};
 return{project,update,connection,saveState,saveError,loadError,undo,redo,canUndo:!!history.length,canRedo:!!future.length,flush,sync};
}
