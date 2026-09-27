import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

type Props = {
  document: string
  title: string
  frameRef: RefObject<HTMLIFrameElement | null>
  time: number
  onReady: (error: string) => void
}

/** Keep the painted document until its replacement has loaded and sought to the current playhead. */
export function MotionPreview({ document, title, frameRef, time, onReady }: Props) {
  const [visibleDocument, setVisibleDocument] = useState('')
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const latest = useRef({ document, time, onReady })
  latest.current = { document, time, onReady }
  const pending = useRef<{ document: string; requestId: string; error: string } | null>(null)
  const readyError = useRef('')

  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      const requested = latest.current.document
      const frame = frames.current.get(requested)
      if (!requested || event.source !== frame?.contentWindow) return
      if (event.data?.type === 'onun:ready') {
        const requestId = crypto.randomUUID()
        pending.current = { document: requested, requestId, error: event.data.error || '' }
        frame.contentWindow?.postMessage({ type: 'onun:seek', time: latest.current.time, requestId }, '*')
      }
      if (event.data?.type === 'onun:rendered' && pending.current?.document === requested && pending.current.requestId === event.data.requestId) {
        readyError.current = pending.current.error
        pending.current = null
        setVisibleDocument(requested)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])

  useLayoutEffect(() => {
    frameRef.current = frames.current.get(visibleDocument) ?? null
    if (frameRef.current) latest.current.onReady(readyError.current)
    return () => { frameRef.current = null }
  }, [visibleDocument, frameRef])

  // An empty source means private media are resolving. Retain the last accepted preview.
  const documents = [...new Set([visibleDocument, document].filter(Boolean))]
  return <>{documents.map(source => <iframe
    key={source}
    ref={element => { if (element) frames.current.set(source, element); else frames.current.delete(source) }}
    title={title}
    sandbox="allow-scripts"
    srcDoc={source}
    aria-hidden={source !== visibleDocument}
    tabIndex={-1}
    data-preview-ready={source === visibleDocument}
    style={{ visibility: source === visibleDocument ? 'visible' : 'hidden' }}
  />)}</>
}
