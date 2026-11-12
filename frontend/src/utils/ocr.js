// "Get text from a photo or PDF" — free, on the device, no AI and no outside service.
//   PDF with real text   the text is copied straight out (pdf.js), exact and instant; old Kruti Dev Hindi is converted
//   scanned PDF / photo  the page is read as a picture (tesseract.js): English and Hindi, printed text works best
// Both libraries load only when this is used; their files are served from /ocr/ (scripts/copy-ocr-assets.mjs) and are
// kept by the browser after the first time (about 8 MB). Pictures are shrunk to 2000 px first: as accurate, and light
// enough for low-cost phones.
import { looksLikeKruti } from './krutiDev'

export const OCR_MAX_PAGES = 20
const MAX_SIDE = 2000
const at = (path) => new URL(`/ocr/${path}`, window.location.origin).href // the worker runs from a blob: address

let listener = null // progress of the page being read: (0..1) => void
let worker = null // { langs, ready: Promise<Worker> }

async function ocrWorker(langs) {
  if (worker?.langs === langs) return worker.ready
  if (worker) { const old = worker.ready; worker = null; old.then((w) => w.terminate()).catch(() => {}) }
  const ready = (async () => {
    const { createWorker } = await import('tesseract.js')
    return createWorker(langs.split('+'), 1, {
      workerPath: at('worker.min.js'), corePath: at('core'), langPath: at('lang'), gzip: true,
      logger: (m) => { if (m.status === 'recognizing text') listener?.(m.progress) },
    })
  })()
  worker = { langs, ready }
  ready.catch(() => { if (worker?.ready === ready) worker = null })
  return ready
}

/** Close the reader (frees its memory); the files stay cached for next time. */
export function closeOcr() {
  if (!worker) return
  worker.ready.then((w) => w.terminate()).catch(() => {})
  worker = null
}

/** A canvas of the picture, at most 2000 px on its long side. */
function shrunk(source, w, h) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  const g = c.getContext('2d')
  g.fillStyle = '#fff' // transparent PNGs read as black otherwise
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(source, 0, 0, c.width, c.height)
  return c
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve(img); URL.revokeObjectURL(url) }
    img.onerror = () => { reject(new Error('image')); URL.revokeObjectURL(url) }
    img.src = url
  })
}

/** Tidy what the reader gives back: no trailing spaces, at most one blank line between paragraphs. */
const tidy = (s) => String(s ?? '').replace(/[\u0000\ufffd]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

async function readCanvas(canvas, langs, onProgress) {
  const w = await ocrWorker(langs)
  listener = onProgress
  try {
    const { data } = await w.recognize(canvas)
    return tidy(data.text)
  } finally { listener = null }
}

/** One photo → { text, preview }. `onProgress(0..1)`. */
export async function readPhoto(file, { langs = 'hin+eng', onProgress } = {}) {
  const img = await loadImage(file)
  const canvas = shrunk(img, img.naturalWidth, img.naturalHeight)
  const preview = canvas.toDataURL('image/jpeg', 0.6)
  return { text: await readCanvas(canvas, langs, onProgress), preview, how: 'PHOTO' }
}

async function pdfLib() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = at('pdf.worker.min.mjs')
  return pdfjs
}

/**
 * Text copied out of a PDF that can't be trusted: characters the PDF gives no code for (shown as nothing or �), or
 * Hindi vowel signs standing on their own (after a space or at the start), which happens when a font maps them apart.
 */
function damaged(text) {
  if (/[\u0000�]/.test(text)) return true
  const loose = text.match(/(^|\s)[ा-्ँ-ः]/g)?.length ?? 0
  return loose >= 2
}

/** The text a PDF page already holds, line by line ('' for a scanned page). */
async function pageText(page) {
  const content = await page.getTextContent()
  let out = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out // raw: damaged() needs the characters tidy() removes
}

/**
 * A PDF, page by page (the first OCR_MAX_PAGES): calls `onPage({ index, total, text, how, kruti, preview })` as each is
 * done — how: TEXT (copied out of the PDF), SCAN (read as a picture) or REPAIRED (read as a picture because the copied
 * text was damaged; `copied` keeps it — its English and maths are exact). `onProgress(page, 0..1)` while a page is read.
 * Returns { pages: total in the file, read }.
 */
export async function readPdf(file, { langs = 'hin+eng', onPage, onProgress, signal } = {}) {
  const pdfjs = await pdfLib()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
  const total = Math.min(doc.numPages, OCR_MAX_PAGES)
  try {
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) break
      const page = await doc.getPage(n)
      const raw = await pageText(page)
      const text = tidy(raw)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(3, MAX_SIDE / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise
      const preview = canvas.toDataURL('image/jpeg', 0.6)
      // a page with real text: take it as it is (a few stray characters on a scan don't count). Hindi PDFs often hold
      // damaged text (letters with no code, vowel signs cut off their letter): such a page is read as a picture instead.
      const hasText = text.replace(/\s/g, '').length >= 25
      if (hasText && !damaged(raw)) {
        onPage?.({ index: n - 1, total, text, how: 'TEXT', kruti: looksLikeKruti(text), preview })
      } else {
        onProgress?.(n - 1, 0)
        onPage?.({ index: n - 1, total, text: await readCanvas(canvas, langs, (p) => onProgress?.(n - 1, p)), how: hasText ? 'REPAIRED' : 'SCAN', kruti: false, preview, ...(hasText && { copied: text }) })
      }
      page.cleanup()
    }
  } finally { doc.destroy() }
  return { pages: doc.numPages, read: total }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// a line that starts a point of its own: •, -, 1. 2) a) (iv) …
const POINT = /^\s*([-•*–]|\d+[.)]|[a-zA-Z][.)]|\(?[ivxIVX]+\))\s/
// a line that finishes a sentence (English or Hindi)
const ENDS = /[.।?!:;)"'”’]\s*$/

/**
 * Plain text → paragraphs for the editor. A blank line starts a new paragraph. Inside one, a line that was only wrapped by
 * the page (it doesn't end a sentence, and the next line isn't a new point) joins the next; other line breaks are kept.
 */
export function textToHtml(text) {
  return tidy(text).split(/\n\s*\n/).filter(Boolean).map((para) => {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean)
    let html = ''
    lines.forEach((line, i) => {
      html += esc(line)
      const next = lines[i + 1]
      if (next !== undefined) html += !ENDS.test(line) && !POINT.test(next) ? ' ' : '<br>'
    })
    return `<p>${html}</p>`
  }).join('')
}
