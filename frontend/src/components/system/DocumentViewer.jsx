import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Download, X, ZoomIn, ZoomOut, ExternalLink, Loader2, FileQuestion } from 'lucide-react'
import { useOverlayLayer } from './Modal'

/**
 * In-app document viewer — open any stored file without downloading it.
 * PDF (browser viewer), images (zoom), video/audio, text / JSON / Markdown / code,
 * CSV/TSV as a table, Word .docx (docx-preview) and Excel .xlsx (read-excel-file),
 * both lazy-loaded only when such a file is opened. Anything else offers Download.
 *
 * Mount <DocumentViewerHost /> once near the app root, then from anywhere:
 *   openDocumentViewer({ name: 'Rate card.xlsx', contentType, load: () => api.get(url, { responseType: 'blob' }), download })
 * `load` may resolve to a Blob or to an axios response whose `data` is the Blob.
 */

const extOf = (name = '') => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', oga: 'audio/ogg', ogg: 'audio/ogg',
}
const TEXT_EXT = new Set(['txt', 'log', 'md', 'markdown', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'cfg', 'sql', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'java', 'py', 'sh', 'properties', 'env'])
const MAX_TEXT = 3 * 1024 * 1024
const MAX_ROWS = 1000

/** What the viewer can show inline: pdf | image | video | audio | table | text | docx | xlsx | other. */
export function viewKind(name, contentType = '') {
  const ext = extOf(name)
  const ct = String(contentType || '').toLowerCase()
  if (ext === 'pdf' || ct.includes('pdf')) return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext) || ct.startsWith('image/')) return 'image'
  if (['mp4', 'm4v', 'webm', 'mov', 'ogv'].includes(ext) || ct.startsWith('video/')) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'oga', 'ogg'].includes(ext) || ct.startsWith('audio/')) return 'audio'
  if (ext === 'csv' || ext === 'tsv' || ct.includes('csv')) return 'table'
  if (ext === 'docx' || ct.includes('wordprocessingml')) return 'docx'
  if (ext === 'xlsx' || ext === 'xlsm' || ct.includes('spreadsheetml')) return 'xlsx'
  if (TEXT_EXT.has(ext) || ct.startsWith('text/') || ct.includes('json') || ct.includes('xml')) return 'text'
  return 'other'
}

// Small RFC-4180 parser (quoted cells, embedded delimiters/newlines, "" escapes)
function parseDelimited(text, delim) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
      if (rows.length > MAX_ROWS) break
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const cellText = (v) => (v == null ? '' : v instanceof Date ? v.toLocaleDateString() : String(v))

// ---- host: one viewer for the whole app ---------------------------------------------------------
let showViewer = null

/** Open a file in the in-app viewer. Returns false if no host is mounted (caller may fall back). */
export function openDocumentViewer(file) {
  if (!showViewer || !file?.load) return false
  showViewer(file)
  return true
}

export function DocumentViewerHost() {
  const [file, setFile] = useState(null)
  useEffect(() => {
    showViewer = setFile
    return () => { if (showViewer === setFile) showViewer = null }
  }, [])
  const close = useCallback(() => setFile(null), [])
  return file ? <DocumentViewer file={file} onClose={close} /> : null
}

// ---- the viewer ---------------------------------------------------------------------------------
export default function DocumentViewer({ file, onClose }) {
  const { t } = useTranslation('ui')
  const kind = useMemo(() => viewKind(file?.name, file?.contentType), [file])
  const [state, setState] = useState({ loading: true, error: null, blob: null, url: null })
  const [text, setText] = useState(null)
  const [table, setTable] = useState(null) // { sheets: [{ name, rows }], active }
  const [truncated, setTruncated] = useState(false)
  const [zoom, setZoom] = useState(1)
  const docxRef = useRef(null)
  const isTop = useOverlayLayer(!!file)

  useEffect(() => {
    let cancelled = false
    let url = null
    setState({ loading: true, error: null, blob: null, url: null })
    setText(null); setTable(null); setTruncated(false); setZoom(1)
    ;(async () => {
      try {
        const raw = await file.load()
        let blob = raw instanceof Blob ? raw : raw?.data
        if (!(blob instanceof Blob)) throw new Error(t('ui.docViewer.loadFailed'))
        // Servers often send application/octet-stream — the browser only renders inline with the real type
        const mime = MIME[extOf(file.name)] || (kind === 'pdf' ? 'application/pdf' : null)
        if (mime && blob.type !== mime && ['pdf', 'image', 'video', 'audio'].includes(kind)) blob = new Blob([blob], { type: mime })

        if (kind === 'text' || kind === 'table') {
          const big = blob.size > MAX_TEXT
          let txt = await (big ? blob.slice(0, MAX_TEXT) : blob).text()
          if (cancelled) return
          if (kind === 'table') {
            const delim = extOf(file.name) === 'tsv' || (!txt.includes(',') && txt.includes('\t')) ? '\t' : ','
            const rows = parseDelimited(txt, delim)
            setTruncated(big || rows.length > MAX_ROWS)
            setTable({ sheets: [{ name: file.name, rows: rows.slice(0, MAX_ROWS) }], active: 0 })
          } else {
            if (extOf(file.name) === 'json' || /json/i.test(file.contentType || '')) {
              try { txt = JSON.stringify(JSON.parse(txt), null, 2) } catch { /* not valid JSON — show as-is */ }
            }
            setTruncated(big)
            setText(txt)
          }
        } else if (kind === 'xlsx') {
          const { default: readXlsxFile } = await import('read-excel-file/browser')
          const sheets = await readXlsxFile(blob)
          if (cancelled) return
          setTruncated(sheets.some((s) => (s.data || []).length > MAX_ROWS))
          setTable({ sheets: sheets.map((s) => ({ name: s.sheet, rows: (s.data || []).slice(0, MAX_ROWS) })), active: 0 })
        }
        url = URL.createObjectURL(blob)
        if (!cancelled) setState({ loading: false, error: null, blob, url })
      } catch (e) {
        if (!cancelled) {
          const msg = typeof e?.response?.data?.message === 'string' ? e.response.data.message : null
          setState({ loading: false, error: msg || (kind === 'xlsx' ? t('ui.docViewer.xlsxFailed') : e?.message || t('ui.docViewer.openFailed')), blob: null, url: null })
        }
      }
    })()
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [file, kind])

  // Word: render into the container once the bytes are here
  useEffect(() => {
    if (kind !== 'docx' || !state.blob || !docxRef.current) return undefined
    let cancelled = false
    const el = docxRef.current
    el.innerHTML = ''
    import('docx-preview')
      .then(({ renderAsync }) => renderAsync(state.blob, el, undefined, { inWrapper: true, breakPages: true, ignoreWidth: false }))
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, error: t('ui.docViewer.docxFailed') })) })
    return () => { cancelled = true }
  }, [kind, state.blob])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && isTop()) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isTop, onClose])

  const download = () => {
    if (file.download) { file.download(); return }
    if (!state.blob) return
    const u = URL.createObjectURL(state.blob)
    const a = document.createElement('a')
    a.href = u; a.download = file.name || 'file'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 1000)
  }
  const zoomBy = (d) => setZoom((z) => Math.min(5, Math.max(0.25, Math.round((z + d) * 100) / 100)))
  const canOpenTab = state.url && ['pdf', 'image', 'video', 'audio', 'text'].includes(kind)
  const ext = extOf(file.name)

  let body
  if (state.loading) {
    body = <div className="flex-1 flex items-center justify-center gap-2 text-sm text-ink-muted"><Loader2 size={16} className="animate-spin" /> {t('ui.docViewer.opening', { name: file.name })}</div>
  } else if (state.error) {
    body = (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FileQuestion size={32} className="text-ink-faint" />
        <p className="text-sm text-ink max-w-md">{state.error}</p>
        {file.download && <button type="button" onClick={download} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"><Download size={14} /> {t('ui.docViewer.downloadInstead')}</button>}
      </div>
    )
  } else if (kind === 'pdf') {
    body = <iframe title={file.name} src={state.url} className="flex-1 min-h-0 w-full bg-white" />
  } else if (kind === 'image') {
    body = (
      <div className={`flex-1 min-h-0 overflow-auto bg-bg p-2 flex justify-center ${zoom > 1 ? 'items-start' : 'items-center'}`}>
        <img
          src={state.url} alt={file.name}
          onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center top' }}
          className={`${zoom === 1 ? 'max-w-full max-h-[78vh] object-contain' : 'max-w-none'} select-none`}
        />
      </div>
    )
  } else if (kind === 'video') {
    body = <div className="flex-1 min-h-0 flex items-center justify-center bg-black"><video src={state.url} controls className="max-w-full max-h-full" /></div>
  } else if (kind === 'audio') {
    body = <div className="flex-1 flex items-center justify-center p-6"><audio src={state.url} controls className="w-full max-w-lg" /></div>
  } else if (kind === 'text') {
    body = <pre className="flex-1 min-h-0 overflow-auto m-0 p-4 bg-white text-xs leading-relaxed font-mono text-ink whitespace-pre-wrap break-words">{text}</pre>
  } else if (kind === 'table' || kind === 'xlsx') {
    const sheet = table?.sheets?.[table.active]
    const rows = sheet?.rows || []
    const cols = rows.reduce((n, r) => Math.max(n, r.length), 0)
    body = (
      <div className="flex-1 min-h-0 flex flex-col">
        {table?.sheets?.length > 1 && (
          <div className="flex gap-1 px-3 pt-2 border-b border-border overflow-x-auto shrink-0">
            {table.sheets.map((s, i) => (
              <button key={s.name + i} type="button" onClick={() => setTable((tb) => ({ ...tb, active: i }))}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-md border border-b-0 whitespace-nowrap ${i === table.active ? 'bg-white text-ink border-border' : 'text-ink-muted border-transparent hover:text-ink'}`}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto bg-white">
          {rows.length === 0 ? <p className="p-6 text-sm text-ink-faint text-center">{t('ui.docViewer.sheetEmpty')}</p> : (
            <table className="text-xs border-collapse min-w-full">
              <thead className="sticky top-0 bg-bg">
                <tr>
                  <th className="px-2 py-1.5 text-end text-ink-faint font-normal border border-border w-10">#</th>
                  {Array.from({ length: cols }, (_, c) => <th key={c} className="px-2 py-1.5 text-start font-semibold text-ink border border-border whitespace-nowrap">{cellText(rows[0][c])}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((r, i) => (
                  <tr key={i} className="hover:bg-brand-50/40">
                    <td className="px-2 py-1 text-end text-ink-faint border border-border tabular-nums">{i + 2}</td>
                    {Array.from({ length: cols }, (_, c) => <td key={c} className="px-2 py-1 text-ink border border-border whitespace-nowrap max-w-[28rem] truncate" title={cellText(r[c])}>{cellText(r[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  } else if (kind === 'docx') {
    body = <div className="flex-1 min-h-0 overflow-auto bg-bg"><div ref={docxRef} /></div>
  } else {
    body = (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FileQuestion size={32} className="text-ink-faint" />
        <p className="text-sm text-ink">
          {ext
            ? <Trans t={t} i18nKey={['doc', 'xls', 'ppt', 'pptx'].includes(ext) ? 'ui.docViewer.noPreviewExtLegacy' : 'ui.docViewer.noPreviewExt'} values={{ ext }} components={{ code: <span className="font-mono" /> }} />
            : t('ui.docViewer.noPreviewThis')}
        </p>
        <button type="button" onClick={download} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"><Download size={14} /> {t('ui.docViewer.downloadToOpen')}</button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-navy-900/70 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-label={t('ui.docViewer.viewing', { name: file.name })} className="relative w-full max-w-5xl h-[94vh] sm:h-[90vh] bg-surface rounded-lg shadow-pop border border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate">{file.name}</p>
            {truncated && <p className="text-[11px] text-warning-600">{t('ui.docViewer.truncated')}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {kind === 'image' && state.url && (
              <>
                <button type="button" onClick={() => zoomBy(-0.25)} disabled={zoom <= 0.25} className="p-1.5 rounded hover:bg-bg text-ink-muted disabled:opacity-40" title={t('ui.docViewer.zoomOut')}><ZoomOut size={15} /></button>
                <button type="button" onClick={() => setZoom(1)} className="px-1.5 text-[11px] tabular-nums text-ink-muted hover:text-ink min-w-[2.75rem]" title={t('ui.docViewer.resetZoom')}>{Math.round(zoom * 100)}%</button>
                <button type="button" onClick={() => zoomBy(0.25)} disabled={zoom >= 5} className="p-1.5 rounded hover:bg-bg text-ink-muted disabled:opacity-40" title={t('ui.docViewer.zoomIn')}><ZoomIn size={15} /></button>
                <span className="w-px h-4 bg-border mx-0.5" />
              </>
            )}
            {canOpenTab && <a href={state.url} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-bg text-ink-muted" title={t('ui.docViewer.openInNewTab')}><ExternalLink size={15} /></a>}
            <button type="button" onClick={download} disabled={!file.download && !state.blob} className="p-1.5 rounded hover:bg-bg text-ink-muted disabled:opacity-40" title={t('ui.common.download')}><Download size={15} /></button>
            <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-bg text-ink-muted" title={t('ui.common.closeEsc')}><X size={15} /></button>
          </div>
        </div>
        {body}
      </div>
    </div>
  )
}
