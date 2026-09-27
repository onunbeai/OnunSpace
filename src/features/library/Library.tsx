import { useI18n } from '../../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Grid2x2, List, FolderOpen } from '@keyline-icons/react/duotone'
import type { CanvasNode } from '../../../shared/project'
import { Icon, type IconName } from '../../components/Icon'
import { Artwork } from '../canvas/Artwork'
import './library.css'

type FileFilter = 'all' | 'image' | 'video' | 'motion'
interface LibraryProps {
  nodes: CanvasNode[]
  onPreview: (id: string) => void
  onUpload: () => void
}

const filters: { value: FileFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'image', label: 'Imagens' },
  { value: 'video', label: 'Vídeos' },
  { value: 'motion', label: 'Motion' },
]
const kinds: Record<string, { label: string; icon: IconName }> = {
  image: { label: 'Imagem', icon: 'image' },
  reference: { label: 'Imagem', icon: 'image' },
  video: { label: 'Vídeo', icon: 'video' },
  motion: { label: 'Motion', icon: 'motion' },
}
const searchable = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')

function FileThumbnail({ node }: { node: CanvasNode }) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  const thumbnailRef = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const artworkHeight = { brand: 218, orb: 285, type: 305, poster: 360, motion: 231 }[node.artwork || 'orb']
  const artworkWidth = Math.max(1, node.width)
  const artworkScale = Math.min(size.width / artworkWidth, size.height / artworkHeight)
  useEffect(() => {
    if (!node.artwork || node.media || !thumbnailRef.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(thumbnailRef.current)
    return () => observer.disconnect()
  }, [node.artwork, node.media])
  const kind = kinds[node.kind] || kinds.image

  return (
    <span className="file-library-thumbnail" ref={thumbnailRef}>
      {node.media && !failed ? (
        node.kind === 'video' ? (
          <video src={node.media} muted playsInline preload="metadata" onError={() => setFailed(true)} aria-hidden="true" />
        ) : (
          <img src={node.media} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        )
      ) : node.artwork && !failed ? (
        <span className="file-library-artwork" style={{ width: artworkWidth, height: artworkHeight, transform: `translate(-50%, -50%) scale(${artworkScale})` }}><Artwork node={node} /></span>
      ) : (
        <span className="file-library-placeholder">
          <Icon name={kind.icon} size={32} />
          {failed && <span>{t("Prévia indisponível")}</span>}
        </span>
      )}
      {node.kind === 'video' && !failed && node.media && <span className="file-library-video-mark"><Icon name="play" size={16} /></span>}
    </span>
  )
}

export function Library({ nodes, onPreview, onUpload }: LibraryProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FileFilter>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const files = useMemo(() => nodes.filter(node => node.kind !== 'text'), [nodes])
  const visibleFiles = useMemo(() => {
    const term = searchable(query.trim())
    return files.filter(node => {
      const matchesKind = filter === 'all' || node.kind === filter || (filter === 'image' && node.kind === 'reference')
      return matchesKind && (!term || searchable(node.title).includes(term))
    })
  }, [files, filter, query])

  return (
    <main className="file-library" aria-label={t("Arquivos do projeto")}>
      <div className="file-library-toolbar">
        <header className="file-library-heading">
          <div className="file-library-title"><h1>{t("Arquivos")}</h1><span aria-label={t('{count} arquivos', { count: files.length })}>{files.length}</span></div>
          <div className="file-library-search">
            <Icon name="search" size={16} />
            <input type="search" aria-label={t("Buscar arquivos")} placeholder={t("Buscar arquivos")} value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" aria-label={t("Limpar busca")} onClick={() => setQuery('')}><Icon name="close" size={13} /></button>}
          </div>
          <button type="button" className="file-library-upload" onClick={onUpload}><Icon name="upload" size={16} />{t("Carregar arquivo")}</button>
        </header>
        <div className="file-library-controls">
          <div className="file-library-filters" role="group" aria-label={t("Filtrar arquivos")}>
            {filters.map(item => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{t(item.label)}</button>)}
          </div>
          <div className="file-library-views" role="group" aria-label={t("Visualização dos arquivos")}>
            <button type="button" aria-label={t("Visualização em grade")} aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2x2 size={17} aria-hidden="true" /></button>
            <button type="button" aria-label={t("Visualização em lista")} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      {visibleFiles.length ? (
        <div className="file-library-results">
          {view === 'list' && <div className="file-library-list-heading" aria-hidden="true"><span>{t("Nome")}</span><span>{t("Tipo")}</span><span>{t("Proporção")}</span><span /></div>}
          <ul className={`file-library-items is-${view}`} aria-label={t("Arquivos")}>
            {visibleFiles.map(node => (
              <li key={node.id}>
                <button type="button" className="file-library-file" aria-label={t('Abrir {name}', { name: node.title })} onClick={() => onPreview(node.id)}>
                  <FileThumbnail key={`${node.id}-${node.media || node.artwork || ''}`} node={node} />
                  <span className="file-library-filename" title={node.title}>{node.title}</span>
                  <span className="file-library-filetype">{t(kinds[node.kind]?.label || 'Imagem')}</span>
                  <span className="file-library-fileformat">{node.aspectRatio || '—'}</span>
                  <Icon name="arrow" size={14} className="file-library-open" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="file-library-empty" role="status">
          <FolderOpen size={30} aria-hidden="true" />
          <p>{files.length ? t('Nenhum arquivo encontrado.') : t('Nenhum arquivo por aqui.')}</p>
          {(query || filter !== 'all') && <button type="button" onClick={() => { setQuery(''); setFilter('all') }}>{t("Limpar filtros")}</button>}
        </div>
      )}
    </main>
  )
}
