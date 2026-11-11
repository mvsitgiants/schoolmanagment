import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PAPER_BY } from '@schoolgiant/shared'
import { previewDocument } from '../../api/documents'
import useDebouncedValue from '../../hooks/useDebouncedValue'

const MM = 96 / 25.4 // CSS px per mm

/**
 * Live preview of a server-rendered document: the template being edited (body and layout)
 * filled with the latest real record of that document, scaled to fit.
 */
export default function DocPreview({ docType, body, layout, templateId, height = 620 }) {
  const { t } = useTranslation('ui')
  const box = useRef(null)
  const [width, setWidth] = useState(420)
  const [html, setHtml] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const req = useDebouncedValue(JSON.stringify({ body, layout, templateId }), 600)

  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    previewDocument(docType, JSON.parse(req))
      .then((h) => { if (live) { setHtml(h); setError(null) } })
      .catch((e) => {
        if (!live) return
        let msg = e.message
        try { msg = JSON.parse(e.response?.data)?.message ?? msg } catch { /* not JSON */ }
        setError(msg)
      })
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [docType, req])

  // lay the page out at its real paper width (plus the screen padding), then scale it to fit; ID cards show a
  // card's front and back side by side, a little larger than life
  const paper = PAPER_BY[layout?.paper] ?? PAPER_BY.A4
  const SHEET = paper.card
    ? Math.round(paper.width * MM * 2 + 18 + 32)
    : Math.round((layout?.orientation === 'landscape' ? paper.height : paper.width) * MM + 48)
  const scale = Math.min(paper.card ? 1.4 : 1, width / SHEET)
  // the paper-height frame only while a page is shown; a failed preview is just its note, loading a short placeholder
  const note = error && (
    <div className={`${html ? 'absolute inset-x-0 top-0 z-10 m-2' : ''} rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-xs text-danger-700 flex gap-2`}>
      <AlertTriangle className="w-4 h-4 shrink-0" /><span className="break-words min-w-0">{error}</span>
    </div>
  )
  const skeleton = !html && !error && loading
  return (
    <div ref={box} className={html || skeleton ? 'relative rounded-lg border border-border bg-[#F5F6F8] overflow-hidden' : 'relative'}
      style={html ? { height } : skeleton ? { height: Math.min(height, 180) } : undefined}>
      {note}
      {skeleton && <div className="absolute inset-0 animate-pulse bg-black/5" />}
      {html && (
        <iframe title={t('ui.docPreview.title')} srcDoc={html} sandbox="allow-same-origin"
          style={{ width: SHEET, height: height / scale, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0, opacity: loading ? 0.6 : 1 }} />
      )}
    </div>
  )
}
