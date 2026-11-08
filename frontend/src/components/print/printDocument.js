import { downloadDocumentPdf, fetchDocumentHtml, fetchDocumentsHtml } from '../../api/documents'
import { getCurrentUser } from '../../api/auth'
import { notify } from '../../context/SnackbarContext'
import { translateServerMessage } from '../../i18n/serverMessage'
import i18n from '../../i18n'

const tt = (key, fallback) => i18n.t(`ui:ui.print.${key}`, { defaultValue: fallback })

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const SIZE = { FEE_RECEIPT: 'width=760,height=900', HALL_TICKET: 'width=760,height=900', STUDENT_ID_CARD: 'width=760,height=820', STAFF_ID_CARD: 'width=760,height=820' }

/** Can the server make PDFs (Gotenberg set up and reachable)? From the signed-in profile (/auth/me). */
export const pdfEnabled = () => !!getCurrentUser()?.features?.pdf

/** Download a document as a PDF; a toast when it can't be made (Print still works). */
export async function downloadPdf(docType, id) {
  try {
    await downloadDocumentPdf(docType, id)
    return true
  } catch (e) {
    notify(e.code === 'PDF_UNAVAILABLE' ? tt('pdfUnavailable', 'PDF isn’t available just now — use Print instead.') : e.message, { variant: 'error' })
    return false
  }
}

// a screen-only bar in the print window: the same document as a PDF
const pdfBar = () => `<div id="sg-pdf-bar" style="position:fixed;top:8px;right:8px;z-index:2147483647;font:500 13px/1 system-ui,sans-serif"><style>@media print{#sg-pdf-bar{display:none!important}}</style><button id="sg-pdf" type="button" style="cursor:pointer;padding:8px 12px;border-radius:8px;border:1px solid #D0D4DC;background:#fff;color:#12141C;box-shadow:0 1px 4px rgba(0,0,0,.12)">${esc(tt('downloadPdf', 'Download PDF'))}</button></div>`

/**
 * Print a document: the server renders it from the institution's template (Administration ›
 * Print templates) and the browser prints it. The window opens before the request so the
 * browser does not block it as a pop-up. When the server can make PDFs, the window also
 * offers "Download PDF" (hidden on paper).
 *
 *   printDocument('TRANSFER_CERTIFICATE', tc.id)   ·   printDocument('FEE_RECEIPT', receipt.id)
 */
export async function printDocument(docType, id, { print = true } = {}) {
  return (await openPrint(docType, id, async () => ({ html: await fetchDocumentHtml(docType, id, print ? undefined : { print: '0' }) }))).ok
}

/**
 * Print one document made of several records — ID cards for the people picked:
 * `printDocuments('STUDENT_ID_CARD', ids)`. The same pop-up handling as printDocument; resolves to
 * `{ ok, blocked, skipped, error, code }` — `skipped`: records the server left out (students or staff
 * have left). `preparing`: the text shown while it loads. `closeOnError`: close the window and
 * leave the error to the caller instead of showing it there.
 */
export function printDocuments(docType, ids, { print = true, preparing, closeOnError = false } = {}) {
  return openPrint(docType, ids, () => fetchDocumentsHtml(docType, ids, print ? undefined : { print: '0' }), { preparing, closeOnError })
}

const errorOf = (e) => {
  const raw = e?.response?.data
  if (raw && typeof raw === 'string') { try { const j = JSON.parse(raw); return { message: translateServerMessage(j.message), code: j.code } } catch { /* not JSON */ } }
  return { message: e?.message, code: e?.code }
}

async function openPrint(docType, id, load, { preparing, closeOnError = false } = {}) {
  const w = window.open('', '_blank', SIZE[docType] ?? 'width=820,height=1000')
  if (!w) return { ok: false, blocked: true }
  w.document.write(`<!doctype html><title>${esc(tt('preparingTitle', 'Preparing…'))}</title><p style="font:14px system-ui;color:#5B616E;padding:24px">${esc(preparing || tt('preparing', 'Preparing the document…'))}</p>`)
  try {
    const { html, skipped = 0 } = await load()
    w.document.open()
    w.document.write(html)
    w.document.close()
    if (pdfEnabled()) {
      try {
        w.document.body.insertAdjacentHTML('beforeend', pdfBar())
        const btn = w.document.getElementById('sg-pdf')
        btn?.addEventListener('click', async () => {
          btn.disabled = true
          btn.textContent = tt('preparingPdf', 'Preparing PDF…')
          await downloadPdf(docType, id)
          btn.disabled = false
          btn.textContent = tt('downloadPdf', 'Download PDF')
        })
      } catch { /* the print itself still works */ }
    }
    return { ok: true, skipped }
  } catch (e) {
    const { message, code } = errorOf(e)
    if (closeOnError) { w.close(); return { ok: false, error: message || tt('failed', 'The document could not be prepared.'), code } }
    w.document.open()
    w.document.write(`<!doctype html><title>${esc(tt('failedTitle', 'Could not print'))}</title><p style="font:14px system-ui;color:#B22E2E;padding:24px">${esc(message || tt('failed', 'The document could not be prepared.'))}</p>`)
    w.document.close()
    return { ok: false, error: message, code }
  }
}

/** Print HTML the caller loads itself (a staff member's own payslip from My workspace): `printHtml('PAYSLIP', () => fetchMyPayslipHtml(id))`. */
export async function printHtml(docType, load) {
  return (await openPrint(docType, null, async () => ({ html: await load() }))).ok
}
