import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { t } from '../../lib/i18n'
import { canvasPoint, clipboardImages, type CanvasImportPoint } from './mediaImport'

const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[role="menu"]')
const modalOpen = () => !!document.querySelector('[role="dialog"],[aria-modal="true"]')
const filesDragged = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files')

export function useCanvasMediaImport(areaRef: RefObject<HTMLDivElement | null>, view: {x:number;y:number;scale:number}, ready: boolean, onImport: (files: File[], point: CanvasImportPoint) => Promise<void>) {
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const depth = useRef(0)
  const pending = useRef(0)
  const mounted = useRef(true)
  const current = useRef({view, ready, onImport})
  current.current = {view, ready, onImport}
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = (files: File[], point: CanvasImportPoint) => {
    if (!files.length) return
    pending.current++; setImporting(true); setError('')
    void current.current.onImport(files, point).catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : t('Não foi possível carregar o arquivo.')) })
      .finally(() => { pending.current--; if (mounted.current) setImporting(pending.current > 0) })
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (!current.current.ready || event.defaultPrevented || editable(event.target) || modalOpen() || !event.clipboardData) return
      const files = clipboardImages(event.clipboardData)
      const rect = areaRef.current?.getBoundingClientRect()
      if (!files.length || !rect) return
      event.preventDefault()
      run(files, canvasPoint({x:rect.left + rect.width / 2, y:rect.top + rect.height / 2}, rect, current.current.view))
    }
    const reset = () => { depth.current = 0; setDragging(false) }
    window.addEventListener('paste', paste)
    window.addEventListener('dragend', reset)
    window.addEventListener('blur', reset)
    return () => { window.removeEventListener('paste', paste); window.removeEventListener('dragend', reset); window.removeEventListener('blur', reset) }
  }, [areaRef])
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (!filesDragged(event) || !ready || modalOpen()) return
      event.preventDefault(); depth.current++; setDragging(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!filesDragged(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = ready && !modalOpen() && !editable(event.target) ? 'copy' : 'none'
    },
    onDragLeave: (event: DragEvent) => {
      if (!filesDragged(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    },
    onDrop: (event: DragEvent) => {
      if (!filesDragged(event)) return
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false)
      const rect = areaRef.current?.getBoundingClientRect()
      if (!ready || !rect || modalOpen() || editable(event.target)) return
      run(Array.from(event.dataTransfer.files), canvasPoint({x:event.clientX,y:event.clientY},rect,view))
    },
  }
  return { dragging, importing, error, handlers }
}
