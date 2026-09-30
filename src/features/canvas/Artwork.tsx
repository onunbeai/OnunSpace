import {Icon} from '../../components/Icon';
import {VideoPlayer} from '../../components/media/VideoPlayer';
import {useI18n} from '../../lib/i18n';
import type {CanvasNode} from '../../../shared/project';
export function Artwork({node,thumbnail=false}:{node:CanvasNode;thumbnail?:boolean}) {
  const {locale}=useI18n();
  const result = 'generatedFrom' in node && Boolean(node.generatedFrom);
  const mediaStyle = result ? {height:'auto',aspectRatio:/^\d+:\d+$/.test(node.aspectRatio)?node.aspectRatio.replace(':',' / '):'1',objectFit:'contain' as const} : undefined;
  if(node.media) return node.kind==='video'?(thumbnail?<video className="node-media" style={mediaStyle} src={node.media} muted playsInline preload="metadata" aria-hidden="true"/>:<VideoPlayer className="node-media" style={mediaStyle} src={node.media} title={node.title} locale={locale==='en'?'en':'pt'} objectFit={result?'contain':'cover'} preload="metadata"/>):<img className="node-media" style={mediaStyle} src={node.media} alt={node.title} draggable={false}/>;
  if(node.artwork==='brand')return <div className="artwork art-brand"><span className="art-eyebrow">A CREATIVE STATE OF MIND</span><img src="/assets/onun-logo.svg" alt="Onun"/><div className="brand-art-footer"><span>be AI. be you.</span><span>® 2026</span></div></div>;
  if(node.artwork==='orb')return <div className="artwork art-orb"><span className="art-eyebrow">ONUN / FORM EXPLORATIONS</span><div className="sculpture"><i/><i/><i/><i/><i/><i/><i/></div><div className="orb-footer"><span>Beyond<br/>the expected.</span><span>01—∞</span></div></div>;
  if(node.artwork==='type')return <div className="artwork art-type"><img src="/assets/onun-symbol.svg" alt=""/><span className="type-main">make<br/><em>room</em><br/>for more.</span><span className="art-eyebrow">CRIATIVIDADE, SEM PONTO FINAL.</span></div>;
  if(node.artwork==='motion')return <div className="artwork art-motion"><span className="art-eyebrow">ONUN MOTION STUDIO</span><div className="motion-rings"><i/><i/><i/></div><strong>Ideas into<br/><em>motion.</em></strong><span className="motion-duration">6s · 1920 × 1080</span></div>;
  if(node.artwork==='poster')return <div className="artwork art-poster"><div className="poster-top"><img src="/assets/onun-symbol.svg" alt=""/><span>IMAGINATION<br/>IS JUST THE START.</span></div><div className="poster-orbit"/><div className="poster-title">what<br/>comes <em>next?</em></div><span className="poster-bottom">UM NOVO UNIVERSO DE POSSIBILIDADES.</span></div>;
  return <div className="artwork art-empty"><Icon name={node.kind==='video'?'video':'image'} size={32}/></div>;
}
