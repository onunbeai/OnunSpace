import {ProjectLoading} from './components/ProjectLoading';
import {ProjectErrorState} from './components/ProjectErrorState';
import {GuidedTour,type TourStepId} from './components/GuidedTour';
import {GuidedTourMode} from './components/guided-tour-context';
import {emptyTourExamples, isTourGenerator, prepareTourExamples, type TourExamples} from './components/tourExamples';
import { useI18n } from './lib/i18n';
import { LanguageSelector } from './components/LanguageSelector';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasNode, NodeKind } from '../shared/project';
import { Icon } from './components/Icon';
import { IconButton, Menu, Modal, Tooltip } from './components/ui';
import { Projects } from './features/projects/Projects';
import { LeaveProjectDialog } from './components/LeaveProjectDialog';
import { ReferencePicker } from './components/ReferencePicker';
import { MediaPreview } from './components/MediaPreview';
import { BackupDialog } from './components/BackupDialog';
import { ExportDialog } from './components/ExportDialog';
import { Canvas } from './features/canvas/Canvas';
import { Library } from './features/library/Library';
import { Inspector } from './features/canvas/Inspector';
import { ModelPicker } from './features/canvas/ModelPicker';
import { parseProject } from './lib/projectValidation';
import { MotionAssistant } from './features/motion/MotionAssistant';
import { newNode } from './features/canvas/seed';
import { placeNode, nodeHeight } from './features/canvas/layout';
import { importedMediaName, placeImportedNodes, type CanvasImportPoint } from './features/canvas/mediaImport';
import { Settings } from './features/settings/Settings';
import { useProject } from './lib/useProject';
import { useGeneration } from './lib/useGeneration';
import { api, downloadFile } from './lib/api';
import { loadModelCatalog, type ProviderSettings } from './lib/modelCatalog';
import { modelSettings, type CatalogModel, type ModelProvider } from '../shared/modelCatalog';
import { ModelCatalogContext } from './lib/modelCatalog-context';
import { createEmptyMotionScene } from '../shared/emptyMotion';
import { restoreProjectArchive } from './lib/projectArchives';
import './features/settings/settings.css';
const MotionEditor = lazy(() => import('./features/motion/MotionEditor').then(m => ({ default: m.MotionEditor })));
type Mode = 'canvas' | 'motion' | 'library' | 'projects';
const modeFromPath = (): Mode => location.pathname === '/projects' ? 'projects' : location.pathname === '/motion' ? 'motion' : location.pathname === '/library' ? 'library' : 'canvas';
export default function App() {
    const { t } = useI18n();
    const { project, update, connection, saveState, saveError, loadError, flush, sync, undo, redo, canUndo, canRedo } = useProject();
    const currentProjectId = useRef(project.id);
    currentProjectId.current = project.id;
    const [backupOpen, setBackupOpen] = useState(false);
    const [tourOpen,setTourOpen]=useState(false);
    const [tourTools,setTourTools]=useState(false);
    const [tourMenu,setTourMenu]=useState(false);
    const [tourFocus,setTourFocus]=useState<{id:string;key:string;relatedIds?:string[]}>();
    const [tourExamples,setTourExamples]=useState<TourExamples>(emptyTourExamples);
    const tourExamplesRef=useRef(tourExamples);
    const tourSnapshot=useRef<{mode:Mode;selected:string|null;inspected:string|null;url:string}|null>(null);
    const [referenceNode, setReferenceNode] = useState<string | null>(null);
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [leaveProjectOpen, setLeaveProjectOpen] = useState(false);
    const [mode, setMode] = useState<Mode>(modeFromPath);
    const [selected, setSelected] = useState<string | null>(decodeURIComponent(location.hash.slice(1)) || 'generator');
    const [inspected, setInspected] = useState<string | null>(null);
    const [modelNode, setModelNode] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsProvider, setSettingsProvider] = useState<'openrouter' | 'higgsfield'>('openrouter');
    const [settingsTab, setSettingsTab] = useState<'providers' | 'mcp'>('providers');
    const [exportOpen, setExportOpen] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [historyNode, setHistoryNode] = useState<string | null>(null);
    const [help, setHelp] = useState(false);
    const [rename, setRename] = useState(false);
    const [toast, setToast] = useState('');
    const [defaultModels, setDefaultModels] = useState<Partial<Record<'image' | 'video', CatalogModel>>>({});
    const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
    useEffect(() => {
        if (settingsOpen) return;
        let active = true;
        void Promise.all(['image', 'video'].map(async kind => {
            const catalog = await loadModelCatalog(kind);
            const usable = catalog.models.filter(model => (!catalog.connected.length || catalog.connected.includes(model.provider)) && model.supported !== false && !(model.capabilities?.requiredInputs ?? []).some(input => model.capabilities?.referenceFields?.includes(input)));
            const model = usable.find(model => /text-to-(image|video)$/.test(model.id)) ?? usable[0];
            return { kind, model, models: catalog.models };
        })).then(entries => { if (active) { setDefaultModels(Object.fromEntries(entries.map(entry => [entry.kind, entry.model]))); setCatalogModels(entries.flatMap(entry => entry.models)); } }).catch(() => { if (active) { setDefaultModels({}); setCatalogModels([]); } });
        return () => { active = false; };
    }, [settingsOpen]);
    const inputRef = useRef<HTMLInputElement>(null);
    const importRef = useRef<HTMLInputElement>(null);
    const finishNavigation = useCallback((next: Mode) => { setMode(next); setInspected(null); history.pushState(null, '', `${next === 'canvas' ? '/' : `/${next}`}${location.search}`); }, []);
    const navigate = useCallback((next: Mode) => { if (next === 'projects' && mode !== 'projects') { setLeaveProjectOpen(true); return; } if (next !== mode) finishNavigation(next); }, [mode, finishNavigation]);
    useEffect(() => { const pop = () => { const next = modeFromPath(); if (next === 'projects' && mode !== 'projects') { history.pushState(null, '', `${mode === 'canvas' ? '/' : `/${mode}`}${location.search}`); setLeaveProjectOpen(true); } else { setMode(next); setInspected(null); } }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, [mode]);
    const saveCurrentProject = async () => { if (loadError) throw new Error(loadError); if (connection === 'loading') throw new Error(t('Aguarde o projeto terminar de carregar.')); await flush(); };
    const openProject = async (id: string) => { try { await saveCurrentProject(); if (id === project.id) finishNavigation('canvas'); else location.href = `/?project=${encodeURIComponent(id)}`; } catch (error) { setToast(error instanceof Error ? error.message : t('Não foi possível salvar.')); } };
    const createProject = async (name: string) => { await saveCurrentProject(); const id = crypto.randomUUID(); await api('/projects', { method: 'POST', body: JSON.stringify({ id, name: name.trim() || t('Sem título'), nodes: [], edges: [], motion: createEmptyMotionScene(t('Cena sem título')) }) }); location.href = `/?project=${id}`; };
    useEffect(() => { if (!toast)
        return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
    const patch = useCallback((id: string, change: Partial<CanvasNode>) => update(p => ({ ...p, nodes: p.nodes.map(n => n.id === id ? { ...n, ...change } : n) })), [update]);
    const { generate, cancel, states } = useGeneration(project, flush, sync, setToast);
    const visibleProject = { ...project, nodes: [...project.nodes.map(n => ({ ...n, ...states[n.id] })), ...(tourOpen ? tourExamples.nodes : [])], edges: [...project.edges, ...(tourOpen ? tourExamples.edges : [])] };
    const createNode = (kind: NodeKind) => { const node = newNode(kind, 0, 0); const model = kind === 'image' || kind === 'video' ? defaultModels[kind] : undefined; return model ? { ...node, ...modelSettings(model, node), model: model.id, provider: model.provider } : node; };
    const chooseModel = (model: string, provider: ModelProvider, entry?: CatalogModel) => {
        const node = project.nodes.find(item => item.id === modelNode);
        if (!node) return;
        const currentKind = node.kind === 'video' ? 'video' : 'image';
        const nextKind = entry?.kind === 'video' ? 'video' : entry?.kind === 'image' ? 'image' : currentKind;
        if (nextKind !== currentKind) {
            const base = newNode(nextKind, 0, 0);
            const created = { ...base, ...(entry ? modelSettings(entry, base) : {}), model, provider, prompt: node.prompt };
            const acceptsImageReference = entry?.capabilities?.referenceFields === undefined || entry.capabilities.referenceFields.length > 0;
            update(p => ({ ...p, nodes: [...p.nodes, placeNode(created, p.nodes, node.id)], edges: acceptsImageReference && node.media && (node.kind === 'image' || node.kind === 'reference') ? [...p.edges, { id: crypto.randomUUID(), source: node.id, target: created.id }] : p.edges }));
            setSelected(created.id); setInspected(created.id);
        } else {
            if ((states[node.id]?.generationStatus ?? node.generationStatus) === 'running') return;
            patch(node.id, { model, provider, ...(entry ? modelSettings(entry, node) : {}), error: undefined });
        }
        if (entry) setCatalogModels(models => [...models.filter(item => item.id !== entry.id || item.provider !== entry.provider), entry]);
    };
    const startGeneration = async (node: CanvasNode) => {
        if (!node.prompt.trim()) { setToast(t('Adicione um prompt.')); return; }
        try {
            const settings = await api<ProviderSettings>('/settings');
            if (!settings.providers[node.provider]?.configured) { setSettingsProvider(node.provider); setSettingsTab('providers'); setSettingsOpen(true); setToast(t('Conecte {provider} para gerar com este modelo.', { provider: node.provider === 'higgsfield' ? 'Higgsfield' : 'OpenRouter' })); return; }
            const catalog = await api<{ models: CatalogModel[] }>(`/models?provider=${node.provider}&kind=${node.kind === 'video' ? 'video' : 'image'}`);
            const entry = catalog.models.find(model => model.id === node.model && model.provider === node.provider);
            if (entry?.supported === false || !entry && node.provider === 'higgsfield') { setModelNode(node.id); setToast(t('Este modelo não está no catálogo atual. Escolha outro modelo.')); return; }
            if (entry) {
                setCatalogModels(models => [...models.filter(model => model.id !== entry.id || model.provider !== entry.provider), entry]);
                const supportedSettings = modelSettings(entry, node);
                if (supportedSettings.aspectRatio !== node.aspectRatio || supportedSettings.resolution !== node.resolution || supportedSettings.count !== node.count || supportedSettings.duration !== node.duration || supportedSettings.generateAudio !== node.generateAudio) {
                    patch(node.id, supportedSettings); setInspected(node.id); setToast(t('Opções ajustadas às capacidades do modelo. Confira antes de gerar.')); return;
                }
            }
            await generate(node);
        } catch (error) { setToast(error instanceof Error ? error.message : t('Não foi possível carregar os modelos.')); }
    };
    const add = (kind: NodeKind) => { const node = placeNode(createNode(kind), project.nodes, selected); update(p => ({ ...p, nodes: [...p.nodes, node] })); setSelected(node.id); if (kind === 'motion')
        navigate('motion');
    else
        setInspected(node.id); };
    const action = (id: string, action: string) => { const node = project.nodes.find(n => n.id === id); if (!node)
        return; if (action === 'cancel') { void cancel(node); return; } if (action === 'references') {
        setSelected(id);
        setReferenceNode(id);
        return;
    } if (action === 'library') {
        navigate('library');
        return;
    } if (action === 'history') {
        setHistoryNode(id);
        return;
    } if (action.startsWith('copy-')) {
        const value = action === 'copy-prompt' ? node.prompt : action === 'copy-json' ? JSON.stringify(node, null, 2) : `${location.origin}/?project=${project.id}#${node.id}`;
        void navigator.clipboard.writeText(value).then(() => setToast(t("Copiado."))).catch(() => setToast(t("Não foi possível copiar.")));
        return;
    } if (action === 'variation') {
        const variation = placeNode({ ...createNode('image'), prompt: node.prompt, title: t('{title} · variação', { title: node.title }) }, project.nodes, id);
        update(p => ({ ...p, nodes: [...p.nodes, variation], edges: [...p.edges, { id: crypto.randomUUID(), source: id, target: variation.id }] }));
        setSelected(variation.id);
        setInspected(variation.id);
        return;
    } if (action === 'edit') {
        setInspected(id);
        return;
    } if (action === 'preview') {
        setPreview(id);
        return;
    } if (action === 'run') {
        if (node.kind === 'motion')
            navigate('motion');
        else if (node.kind === 'text' || node.kind === 'reference')
            setInspected(id);
        else
            void startGeneration(node);
        return;
    } if (action === 'duplicate') {
        const clone = placeNode({ ...structuredClone(node), id: crypto.randomUUID(), title: t('{title} · cópia', { title: node.title }), generationStatus: 'idle' as const }, project.nodes, id);
        update(p => ({ ...p, nodes: [...p.nodes, clone] }));
        setSelected(clone.id);
        return;
    } if (action === 'delete') {
        update(p => ({ ...p, nodes: p.nodes.filter(n => n.id !== id), edges: p.edges.filter(e => e.source !== id && e.target !== id) }));
        setSelected(null);
        setInspected(null);
        return;
    } if (action === 'download') {
        if (node.media) {
            const a = document.createElement('a');
            a.href = node.media;
            a.download = node.title;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.click();
        }
        else {
            downloadFile(`${node.title}.json`, JSON.stringify(node, null, 2));
            setToast(t("Nó salvo como JSON. Estudos visuais são exemplos editáveis."));
        }
    } };
    useEffect(() => { const handler = (e: KeyboardEvent) => { if (connection === 'loading' || loadError || mode === 'projects' || e.defaultPrevented || (e.target as HTMLElement).closest('input,textarea,[contenteditable=true],[role=dialog],[role=menu],.onun-video-player'))
        return; if (e.key === 'Escape') {
        setInspected(null);
        setSelected(null);
    } if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey)
            redo();
        else
            undo();
    } if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selected && mode === 'canvas') {
        e.preventDefault();
        action(selected, 'duplicate');
    } if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected && mode === 'canvas')
            action(selected, 'delete');
    } if (e.key === '?')
        setHelp(true); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); });
    const upload = async (files: FileList | File[] | null, targetId?: string, point?: CanvasImportPoint) => {
        if (!files)
            return;
        const created: CanvasNode[] = [];
        const errors: string[] = [];
        if (files.length > 12) errors.push(t('Importe até 12 arquivos por vez. Os primeiros 12 foram processados.'));
        const target = targetId ? project.nodes.find(node => node.id === targetId) : undefined;
        if (targetId && !target)
            throw new Error(t("Este nó não está mais no canvas."));
        for (const file of Array.from(files).slice(0, 12)) {
            if (!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(file.type)) {
                errors.push(t("Use imagens PNG, JPG, WebP, GIF ou vídeos MP4 e WebM."));
                continue;
            }
            if (file.size > 8 * 1024 * 1024) {
                errors.push(t("O limite de importação é 8 MB por arquivo."));
                continue;
            }
            try {
                const media = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(t('Não foi possível ler {name}.', { name: file.name }))); reader.onabort = () => reject(new Error(t("Importação cancelada."))); reader.readAsDataURL(file); });
                const kind = file.type.startsWith('video') ? 'video' : 'reference';
                const node = { ...newNode(kind, 0, 0), title: importedMediaName(file.name, t('Imagem colada')), media };
                created.push(node);
            }
            catch (error) {
                errors.push(error instanceof Error ? error.message : t("Não foi possível carregar o arquivo."));
            }
        }
        if (created.length) {
            update(current => {
                if (current.id !== project.id) return current;
                const placed = placeImportedNodes(created, current.nodes, point, targetId ?? selected, nodeHeight);
                return { ...current, nodes: [...current.nodes, ...placed], edges: targetId && current.nodes.some(node => node.id === targetId) ? [...current.edges, ...placed.map(node => ({ id: crypto.randomUUID(), source: node.id, target: targetId }))] : current.edges };
            });
            if (currentProjectId.current === project.id) setSelected(targetId ?? created.at(-1)!.id);
        }
        if (errors.length) {
            const message = [...new Set(errors)].join(' ');
            if (targetId)
                throw new Error(message);
            setToast(message);
        }
    };
    const toggleReference = (targetId: string, sourceId: string) => update(current => {
        if (targetId === sourceId || !current.nodes.some(node => node.id === sourceId) || !current.nodes.some(node => node.id === targetId))
            return current;
        const connected = current.edges.some(edge => edge.source === sourceId && edge.target === targetId);
        return { ...current, edges: connected ? current.edges.filter(edge => edge.source !== sourceId || edge.target !== targetId) : [...current.edges, { id: crypto.randomUUID(), source: sourceId, target: targetId }] };
    });
    const importProject = async (file?: File) => { if (!file)
        return; try {
        const prefix = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (/\.(zip|onun)$/i.test(file.name) && (prefix[0] === 0x50 && prefix[1] === 0x4b || /\.zip$/i.test(file.name))) {
            await saveCurrentProject();
            const restored = await restoreProjectArchive(file);
            location.href = `/?project=${encodeURIComponent(restored.id)}`;
            return;
        }
        if (file.size > 20 * 1024 * 1024)
            throw new Error(t("Arquivo muito grande."));
        const doc = parseProject(JSON.parse(await file.text()));
        update({ ...doc, id: project.id, revision: project.revision });
        setToast(t("Projeto importado."));
    }
    catch {
        setToast(t("Não foi possível importar o projeto. Use um arquivo .onun, ZIP ou .onun.json válido."));
    } };
    const prepareTour=useCallback((step:TourStepId,advanced:boolean)=>{
        setInspected(null);setModelNode(null);setSettingsOpen(false);setBackupOpen(false);setExportOpen(false);setPreview(null);setHelp(false);setLeaveProjectOpen(false);setReferenceNode(null);
        const mode:Mode=step==='motion'||step==='timeline'?'motion':step==='library'?'library':'canvas';
        setMode(mode);setTourTools(step==='tools'&&advanced);setTourMenu(step==='node'&&advanced);
        const examples=prepareTourExamples(project,tourExamplesRef.current,step,t);
        tourExamplesRef.current=examples;setTourExamples(examples);
        const nodes=[...project.nodes,...examples.nodes];
        const node=nodes.find(isTourGenerator);
        const relatedIds=step==='connections'?[...project.edges,...examples.edges].filter(edge=>edge.target===node?.id).map(edge=>edge.source):undefined;
        if(['node','connections','properties','models'].includes(step)){setSelected(node?.id??null);setTourFocus(node?{id:node.id,key:`${step}:${advanced}`,relatedIds}:undefined);}else setTourFocus(undefined);
        if(step==='properties'&&advanced&&node)setInspected(node.id);
        if(step==='models'&&advanced&&node)setModelNode(node.id);
        if(step==='mcp'&&advanced){setSettingsTab('mcp');setSettingsOpen(true);}
        if(step==='backup'&&advanced)setBackupOpen(true);
    },[project,t]);
    const startTour=()=>{
        tourSnapshot.current={mode,selected,inspected,url:location.href};
        const examples=emptyTourExamples();tourExamplesRef.current=examples;setTourExamples(examples);
        setTourOpen(true);
    };
    const closeTour=()=>{
        setTourOpen(false);setTourTools(false);setTourMenu(false);setTourFocus(undefined);setModelNode(null);setSettingsOpen(false);setBackupOpen(false);
        const previous=tourSnapshot.current;
        if(previous){setMode(previous.mode);setSelected(previous.selected);setInspected(previous.inspected);history.replaceState(null,'',previous.url);}
        tourSnapshot.current=null;
        const examples=emptyTourExamples();tourExamplesRef.current=examples;setTourExamples(examples);
    };
    const inspectNode = visibleProject.nodes.find(n => n.id === inspected);
    const previewNode = project.nodes.find(n => n.id === preview);
    const referenceTarget = project.nodes.find(n => n.id === referenceNode);
    if(loadError) return <ProjectErrorState/>;
    if(connection==='loading') return <ProjectLoading/>;
    return <ModelCatalogContext.Provider value={catalogModels}><GuidedTourMode.Provider value={tourOpen}><div className="app">
 <header className="app-header" data-tour="workspace"><div className="header-left"><Tooltip content={t("Projetos")}><button className="icon-button project-back" aria-label={t("Projetos")} onClick={() => navigate('projects')}><Icon name="chevron-left"/></button></Tooltip><div className="project-name"><i /><Tooltip content={t("Renomear projeto")}><button onClick={() => setRename(true)}>{project.name}</button></Tooltip><Icon name="chevron-down" size={13}/></div></div><nav className="header-tabs" aria-label={t("Modos do editor")}>{([{ id: 'projects', name: t('Projetos'), icon: 'folder' }, { id: 'canvas', name: 'Canvas', icon: 'grid' }, { id: 'motion', name: 'Motion', icon: 'motion' }, { id: 'library', name: t("Arquivos"), icon: 'folder' }] as const).map(tab => <Tooltip key={tab.id} content={t(tab.id==='projects'?'Abra, crie e guarde seus projetos.':tab.id==='canvas'?'Conecte referências e crie imagens ou vídeos.':tab.id==='motion'?'Anime camadas e edite keyframes.':'Veja e organize os arquivos do projeto.')}><button className={mode === tab.id ? 'active' : ''} aria-current={mode === tab.id ? 'page' : undefined} onClick={() => navigate(tab.id)}><Icon name={tab.icon} size={14}/>{tab.name}</button></Tooltip>)}</nav><div className="header-actions"><LanguageSelector /><IconButton icon="help" label={t("Guia interativo")} onClick={startTour}/><Tooltip content={t("Conexão MCP")}><button className="local-badge" aria-label={t("Conexão MCP")} data-save-state={t(saveState)} onClick={() => { setSettingsTab('mcp'); setSettingsOpen(true); }}><Icon name="mcp" size={18}/><i /></button></Tooltip>{mode === 'motion' && <Tooltip content={t("Criar cena com IA")}><button className="button ai-create" onClick={() => setAssistantOpen(true)}><Icon name="motion" size={15}/><span>{t("Criar com IA")}</span></button></Tooltip>}<Tooltip content={t("Conectar API")}><button aria-label={t("Conectar API")} className="icon-button api-connect" onClick={() => { setSettingsTab('providers'); setSettingsOpen(true); }}><Icon name="link" size={15}/></button></Tooltip><Tooltip content={t("Exportar")}><button className="button light" onClick={() => setExportOpen(true)}><Icon name="export" size={15}/>{t("Exportar")}</button></Tooltip><Menu label={t("Menu do espaço")} className="avatar" trigger={<Icon name="user" size={17}/>} align="end" items={[{ label:t('Guia interativo'),value:'tour',icon:'help' },{ label: t('Backup do projeto'), value: 'backup', icon: 'export' }, { label: t("Importar projeto"), value: 'import', icon: 'upload' }, { label: t("Conexão MCP"), value: 'mcp', icon: 'mcp' }, { label: t("Atalhos do teclado"), value: 'help', icon: 'cursor' }, { label: t("Renomear projeto"), value: 'rename', icon: 'text' }]} onSelect={value => { if(value==='tour')startTour(); if (value === 'backup')
        setBackupOpen(true); if (value === 'import')
        importRef.current?.click(); if (value === 'help')
        setHelp(true); if (value === 'rename')
        setRename(true); if (value === 'mcp') {
        setSettingsTab('mcp');
        setSettingsOpen(true);
    } }}/></div></header>
 {mode === 'projects' && <Projects currentProject={project} onOpen={id => void openProject(id)} onBackup={() => setBackupOpen(true)} onRestore={() => importRef.current?.click()} onCreate={createProject}/>}
 {mode === 'canvas' && <Canvas tourMenuOpen={tourMenu} tourFocus={tourFocus} tourAddOpen={tourOpen?tourTools:undefined} project={visibleProject} ready={true} selected={selected} onSelect={setSelected} onUpdate={update} onChange={patch} onAction={action} onModel={setModelNode} onEdit={setInspected} onAdd={add} onLibrary={() => navigate('library')} onUpload={() => inputRef.current?.click()} onImportMedia={(files, point) => upload(files, undefined, point)} onSettings={() => { setSettingsTab('providers'); setSettingsOpen(true); }} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}/>}
 {mode === 'motion' && <Suspense fallback={<ProjectLoading label={t("Preparando o Motion Studio…")}/>}><MotionEditor scene={visibleProject.motion} onChange={motion => update(p => ({ ...p, motion }))} onExport={() => setExportOpen(true)}/></Suspense>}
 {mode === 'library' && <Library nodes={visibleProject.nodes} onPreview={setPreview} onUpload={() => inputRef.current?.click()}/>}
 {mode === 'canvas' && inspectNode && <Inspector node={inspectNode} references={visibleProject.edges.filter(e => e.target === inspectNode.id).map(e => visibleProject.nodes.find(n => n.id === e.source)).filter(Boolean) as CanvasNode[]} onClose={() => setInspected(null)} onChange={change => patch(inspectNode.id, change)} onModel={() => setModelNode(inspectNode.id)} onGenerate={() => action(inspectNode.id, 'run')} onCancel={() => action(inspectNode.id, 'cancel')}/>}
 {referenceTarget && <ReferencePicker key={referenceTarget.id} project={project} target={referenceTarget} onClose={() => setReferenceNode(null)} onToggle={sourceId => toggleReference(referenceTarget.id, sourceId)} onImport={files => upload(files, referenceTarget.id)}/>}
 <BackupDialog open={backupOpen} projectId={project.id} onClose={() => setBackupOpen(false)} beforeBackup={saveCurrentProject} onRestore={id => { location.href = `/?project=${encodeURIComponent(id)}`; }}/>
 <LeaveProjectDialog open={leaveProjectOpen} project={project} onCancel={() => setLeaveProjectOpen(false)} beforeSave={saveCurrentProject} onContinue={() => { setLeaveProjectOpen(false); finishNavigation('projects'); }}/><MotionAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} project={project} onScene={() => void sync()} onConnect={() => { setAssistantOpen(false); setSettingsTab('mcp'); setSettingsOpen(true); }}/><Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab={settingsTab} initialProvider={settingsProvider}/><ModelPicker hasReferences={project.edges.some(edge => edge.target === modelNode && project.nodes.some(node => node.id === edge.source && !!node.media))} onConnect={() => { setSettingsTab('providers'); setSettingsOpen(true); }} node={visibleProject.nodes.find(n => n.id === modelNode) ?? null} onClose={() => setModelNode(null)} onSelect={chooseModel}/><ExportDialog mode={mode} selectedId={mode === 'canvas' ? selected : null} onDownload={id => action(id, 'download')} beforeExport={saveCurrentProject} open={exportOpen} onClose={() => setExportOpen(false)} project={project}/>
 {previewNode && <MediaPreview key={`${previewNode.id}:${previewNode.media ?? previewNode.artwork ?? ""}`} node={previewNode} onClose={() => setPreview(null)}/>}
 <Modal open={!!historyNode} onOpenChange={o => !o && setHistoryNode(null)} title={t("Histórico")}>{(project.nodes.find(n => n.id === historyNode)?.outputs ?? []).length ? <div className="library-grid">{project.nodes.find(n => n.id === historyNode)?.outputs?.map((url, i) => <a href={url} target="_blank" rel="noopener noreferrer" key={url}>{t("Resultado")} {i + 1}</a>)}</div> : <p className="muted" style={{ fontSize: 13 }}>{t("Nenhum resultado gerado.")}</p>}</Modal><Modal open={rename} onOpenChange={setRename} title={t("Nome do seu projeto")}><form className="form-stack" onSubmit={e => { e.preventDefault(); setRename(false); }}><input aria-label={t("Nome do projeto")} className="text-input" maxLength={120} value={project.name} onChange={e => update(p => ({ ...p, name: e.target.value }))}/><button className="button primary">{t("Salvar nome")}</button></form></Modal>
 <Modal open={help} onOpenChange={setHelp} title={t("Atalhos de teclado")}><div className="keyboard-list"><span>{t("Desfazer")}</span><kbd>⌘ Z</kbd><span>{t("Refazer")}</span><kbd>⌘ ⇧ Z</kbd><span>{t("Duplicar nó")}</span><kbd>⌘ D</kbd><span>{t("Excluir nó")}</span><kbd>Delete</kbd><span>{t("Ajustar zoom")}</span><kbd>⌘ + scroll</kbd><span>{t("Desselecionar")}</span><kbd>Esc</kbd></div></Modal>
 <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple hidden onChange={e => { void upload(e.target.files); e.target.value = ''; }}/><input ref={importRef} type="file" accept=".onun,.zip,.json,.onun.json" hidden onChange={e => { void importProject(e.target.files?.[0]); e.target.value = ''; }}/>
 {saveError && <div className="save-error" role="alert">{t(saveError)}<button onClick={() => downloadFile(`${project.name}.onun.json`, JSON.stringify(project, null, 2))}>{t("Exportar rascunho")}</button></div>}
 {toast && <div className="toast" role="status">{toast}<IconButton icon="close" label={t("Fechar aviso")} onClick={() => setToast('')}/></div>}
 {tourOpen&&<GuidedTour onClose={closeTour} onPrepare={prepareTour} hasExamples={mode!=='motion'&&!!(tourExamples.nodes.length||tourExamples.edges.length)}/>}
 </div></GuidedTourMode.Provider></ModelCatalogContext.Provider>;
}
