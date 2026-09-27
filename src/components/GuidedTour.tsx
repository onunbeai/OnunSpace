import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './Icon';
import {useI18n} from '../lib/i18n';
import './guided-tour.css';

export type TourStepId='workspace'|'canvas'|'tools'|'node'|'connections'|'properties'|'models'|'motion'|'timeline'|'library'|'mcp'|'backup';
interface TourStep{id:TourStepId;title:string;body:string;detail:string;selector:string;advancedSelector?:string;fallbackSelector?:string}
export const tourSteps:readonly TourStep[]=[
 {id:'workspace',title:'Seu espaço de trabalho',body:'Troque entre Canvas, Motion e Arquivos. O projeto atual aparece à esquerda.',detail:'O idioma muda apenas a interface. Nomes, prompts e textos das suas criações permanecem como você os escreveu.',selector:'.app-header'},
 {id:'canvas',title:'Navegue pelo canvas',body:'Arraste o fundo para navegar. Use os controles no centro inferior para aproximar ou enquadrar os nós.',detail:'O canvas organiza referências e gerações em um único projeto. Mover ou aproximar a visualização não muda a posição dos seus nós.',selector:'.canvas-area'},
 {id:'tools',title:'Adicione o que precisa',body:'O botão + abre imagens, vídeos, motion e notas. Você também pode carregar arquivos do computador.',detail:'Uma referência pode ser conectada a diferentes gerações. As ferramentas Desfazer e Refazer recuperam alterações recentes no projeto.',selector:'.canvas-tools',advancedSelector:'.add-panel'},
 {id:'node',title:'Trabalhe em um nó',body:'Selecione um nó para acessar suas ações. Arraste seu corpo ou título para reposicioná-lo.',detail:'A barra do nó reúne geração, propriedades, visualização, duplicação e download. O menu também permite alterar o status de revisão.',selector:'.canvas-node.selected',advancedSelector:'.dropdown'},
 {id:'connections',title:'Conecte referências',body:'Segure a porta de saída de um nó e solte na entrada de outro para conectar os dois.',detail:'Você também pode clicar na saída e depois na entrada. Soltar no fundo cancela a conexão; clicar em uma conexão permite removê-la.',selector:'.canvas-node.selected .port-out'},
 {id:'properties',title:'Ajuste as propriedades',body:'Abra as propriedades para editar o nome, prompt, proporção, resolução e status do nó.',detail:'O painel mostra as referências conectadas e as opções do nó selecionado. Alterações de texto são salvas no projeto; a geração começa somente ao usar Iniciar geração.',selector:'.canvas-node.selected .node-toolbar',advancedSelector:'.node-inspector'},
 {id:'models',title:'Escolha um modelo',body:'Abra o seletor do nó para pesquisar modelos de imagem ou vídeo.',detail:'Filtre por OpenRouter ou Higgsfield. A disponibilidade depende do provedor e da sua conta; um ID personalizado pode ser informado no fim da lista.',selector:'.canvas-node.selected .model-trigger',advancedSelector:'.modal:has(.model-list)'},
 {id:'motion',title:'Edite a cena de motion',body:'O editor de motion reúne camadas, visualização da cena e propriedades.',detail:'Selecione camadas para editar texto, cor e transformação. O editor de código permite trabalhar com HTML, CSS e JavaScript usando a timeline GSAP da cena.',selector:'.motion-editor'},
 {id:'timeline',title:'Controle o tempo',body:'Reproduza a cena, mova o cursor de tempo e ajuste os keyframes na timeline.',detail:'Selecione vários keyframes com Shift, Cmd ou Ctrl, ou arraste uma área na timeline. Arraste o grupo para ajustar o tempo em conjunto. As faixas mostram o início e o fim de cada camada.',selector:'.motion-timeline'},
 {id:'library',title:'Encontre seus arquivos',body:'Arquivos reúne as imagens, vídeos e cenas deste projeto em grade ou lista.',detail:'Pesquise pelo nome, filtre pelo tipo e abra uma visualização. Carregar um arquivo adiciona uma referência ao projeto atual.',selector:'.file-library'},
 {id:'mcp',title:'Conecte um assistente',body:'A configuração MCP permite que Claude ou Codex trabalhem com o runtime local.',detail:'Copie a configuração STDIO para o cliente MCP. Com o runtime ativo, o assistente pode consultar projetos, editar cenas e solicitar renders pelas ferramentas disponíveis.',selector:'.local-badge',fallbackSelector:'.header-actions',advancedSelector:'.modal:has(.mcp-content)'},
 {id:'backup',title:'Guarde uma cópia',body:'Salve uma cópia .onun ou ZIP com o projeto e seus arquivos. Escolha uma pasta para guardar o backup.',detail:'A pasta de destino é lembrada por projeto. Importar a cópia cria um novo projeto, mantendo o atual.',selector:'.avatar',fallbackSelector:'.header-actions',advancedSelector:'.modal:has(.backup-dialog)'},
];
interface Rect{x:number;y:number;width:number;height:number;radius:number}
interface Props{hasExamples?:boolean;onClose:()=>void;onPrepare:(stepId:TourStepId,advanced:boolean)=>void}
function visibleTarget(step:TourStep,advanced:boolean):HTMLElement|null{
 const selectors=['[data-tour="'+step.id+'"]',advanced&&step.advancedSelector,step.selector,step.fallbackSelector].filter(Boolean) as string[];
 for(const selector of selectors){for(const element of document.querySelectorAll<HTMLElement>(selector)){const rect=element.getBoundingClientRect();if(rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth)return element;}}
 return null;
}
function sameRect(a:Rect|null,b:Rect|null){return a===b||!!a&&!!b&&Math.abs(a.x-b.x)<.5&&Math.abs(a.y-b.y)<.5&&Math.abs(a.width-b.width)<.5&&Math.abs(a.height-b.height)<.5&&a.radius===b.radius;}
export function GuidedTour({onClose,onPrepare,hasExamples=false}:Props){
 const{t}=useI18n();const[index,setIndex]=useState(0);const[advanced,setAdvanced]=useState(false);const[rect,setRect]=useState<Rect|null>(null);const[size,setSize]=useState({width:344,height:300});const[viewport,setViewport]=useState({width:innerWidth,height:innerHeight});const cardRef=useRef<HTMLElement>(null);const prepareRef=useRef(onPrepare);const closeRef=useRef(onClose);const step=tourSteps[index];
 useEffect(()=>{prepareRef.current=onPrepare;closeRef.current=onClose;},[onPrepare,onClose]);
 useEffect(()=>{prepareRef.current(step.id,advanced);},[step.id,advanced]);
 useLayoutEffect(()=>{
  const update=()=>{setViewport(previous=>previous.width===innerWidth&&previous.height===innerHeight?previous:{width:innerWidth,height:innerHeight});const target=visibleTarget(step,advanced);const bounds=target?.getBoundingClientRect();const radius=target?getComputedStyle(target).borderTopLeftRadius:'0';const pixels=parseFloat(radius)||0;const rounded=bounds&&(radius.endsWith('%')?pixels>=50:pixels>=Math.min(bounds.width,bounds.height)/2);const next=bounds?{x:Math.max(6,bounds.left-5),y:Math.max(6,bounds.top-5),width:Math.min(innerWidth-6,bounds.right+5)-Math.max(6,bounds.left-5),height:Math.min(innerHeight-6,bounds.bottom+5)-Math.max(6,bounds.top-5),radius:rounded?999:pixels+5}:null;setRect(previous=>sameRect(previous,next)?previous:next);};
  update();const timer=setInterval(update,180);window.addEventListener('resize',update);window.addEventListener('scroll',update,true);return()=>{clearInterval(timer);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
 },[step,advanced]);
 useLayoutEffect(()=>{const element=cardRef.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setSize({width:entry.borderBoxSize[0]?.inlineSize??entry.contentRect.width,height:entry.borderBoxSize[0]?.blockSize??entry.contentRect.height}));observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{const timer=setTimeout(()=>cardRef.current?.focus({preventScroll:true}),60);return()=>clearTimeout(timer);},[index,advanced]);
 useEffect(()=>{
  if(step.id!=='node'||!advanced)return;
  const menuAt=(x:number,y:number)=>{if(innerWidth>480)return null;const menu=document.querySelector<HTMLElement>('.dropdown');const bounds=menu?.getBoundingClientRect();return menu&&bounds&&x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom?menu:null;};
  // The shield still blocks menu actions; only scrolling the compact demonstration is forwarded.
  const wheel=(event:WheelEvent)=>{const menu=menuAt(event.clientX,event.clientY);if(!menu)return;event.preventDefault();event.stopImmediatePropagation();menu.scrollTop+=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?menu.clientHeight:1);};
  let touch:{menu:HTMLElement;y:number}|null=null;
  const start=(event:TouchEvent)=>{const point=event.touches[0];const menu=point&&menuAt(point.clientX,point.clientY);touch=menu?{menu,y:point.clientY}:null;};
  const move=(event:TouchEvent)=>{const point=event.touches[0];if(!touch||!point)return;event.preventDefault();event.stopImmediatePropagation();touch.menu.scrollTop+=touch.y-point.clientY;touch.y=point.clientY;};
  const end=()=>{touch=null;};
  window.addEventListener('wheel',wheel,{capture:true,passive:false});window.addEventListener('touchstart',start,{capture:true,passive:true});window.addEventListener('touchmove',move,{capture:true,passive:false});window.addEventListener('touchend',end,true);window.addEventListener('touchcancel',end,true);
  return()=>{window.removeEventListener('wheel',wheel,true);window.removeEventListener('touchstart',start,true);window.removeEventListener('touchmove',move,true);window.removeEventListener('touchend',end,true);window.removeEventListener('touchcancel',end,true);};
 },[step.id,advanced]);
 useEffect(()=>{const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeRef.current();return;}if(event.key==='Tab'){const controls=[...cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')??[]];const position=controls.indexOf(document.activeElement as HTMLElement);if(controls.length&&(event.shiftKey?position<=0:position<0||position===controls.length-1)){event.preventDefault();event.stopImmediatePropagation();controls[event.shiftKey?controls.length-1:0].focus();}return;}if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();event.stopImmediatePropagation();setIndex(value=>Math.min(tourSteps.length-1,Math.max(0,value+(event.key==='ArrowRight'?1:-1))));return;}if(!cardRef.current?.contains(event.target as Node)&&event.key!=='Tab'){event.preventDefault();event.stopImmediatePropagation();}};window.addEventListener('keydown',keyboard,true);return()=>window.removeEventListener('keydown',keyboard,true);},[]);
 const gap=16,padding=16;let left=(viewport.width-size.width)/2,top=(viewport.height-size.height)/2;
 if(rect){if(viewport.width-rect.x-rect.width>=size.width+gap+padding){left=rect.x+rect.width+gap;top=rect.y;}else if(rect.x>=size.width+gap+padding){left=rect.x-size.width-gap;top=rect.y;}else if(viewport.height-rect.y-rect.height>=size.height+gap+padding){left=rect.x;top=rect.y+rect.height+gap;}else if(rect.y>=size.height+gap+padding){left=rect.x;top=rect.y-size.height-gap;}else{left=viewport.width-size.width-padding;top=viewport.height-size.height-padding;}}
 left=Math.max(padding,Math.min(left,viewport.width-size.width-padding));top=Math.max(padding,Math.min(top,viewport.height-size.height-padding));
 return createPortal(<div className="guided-tour" data-tour-step={step.id} data-tour-advanced={advanced}>
  <div className={'guided-tour-shield '+(rect?'has-target':'')} aria-hidden="true"/>
  {rect&&<div className="guided-tour-highlight" aria-hidden="true" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height,borderRadius:rect.radius}}/>}
  <section className="guided-tour-card" ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="guided-tour-title" aria-describedby="guided-tour-description" style={{left,top}}>
   <div className="guided-tour-heading"><span>{t('Guia do Onun Space')}</span><button aria-label={t('Sair do guia')} onClick={onClose}><Icon name="close" size={15}/></button></div>
   <div className="guided-tour-progress" role="progressbar" aria-valuemin={1} aria-valuemax={tourSteps.length} aria-valuenow={index+1} aria-label={t('Passo {current} de {total}',{current:index+1,total:tourSteps.length})}>{tourSteps.map((item,position)=><span key={item.id} className={position<=index?'is-complete':''}/>)}</div>
   <div className="guided-tour-copy" aria-live="polite"><span className="guided-tour-counter">{String(index+1).padStart(2,'0')} / {tourSteps.length}</span><h2 id="guided-tour-title">{t(step.title)}</h2><p id="guided-tour-description">{t(step.body)}</p>{advanced&&<p className="guided-tour-detail">{t(step.detail)}</p>}</div>
   {hasExamples&&<p className="guided-tour-example-note"><Icon name="layers" size={13}/>{t('Exemplos temporários · removidos ao sair do guia.')}</p>}
   <div className="guided-tour-mode"><span>{t('Modo avançado')}</span><button role="switch" aria-label={t('Modo avançado')} aria-checked={advanced} className={advanced?'is-on':''} onClick={()=>setAdvanced(value=>!value)}><span/></button></div>
   <div className="guided-tour-footer"><button className="guided-tour-back" disabled={index===0} onClick={()=>setIndex(value=>value-1)}><Icon name="chevron-left" size={14}/>{t('Anterior')}</button><button className="guided-tour-next" onClick={()=>index===tourSteps.length-1?onClose():setIndex(value=>value+1)}>{t(index===tourSteps.length-1?'Concluir guia':'Próximo')}<Icon name={index===tourSteps.length-1?'check':'chevron-right'} size={14}/></button></div>
  </section>
 </div>,document.body);
}
