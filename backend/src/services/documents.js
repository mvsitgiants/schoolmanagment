import { PAPER_BY, PRINT_DOC_BY, fixedPaper, printDefaults } from '@schoolgiant/shared'
import { DOCS } from '../documents/registry.js'
import { sampleModel } from '../documents/samples.js'
import { HELPER_NAMES, defaultTemplate, designsOf, layoutFor, renderPage, templateError } from '../documents/engine.js'
import { PrintTemplate } from '../models/printing.js'
import { can } from '../platform/access.js'
import { clean, isOid } from '../platform/db.js'
import { AppError, badRequest, forbidden, notFound } from '../platform/errors.js'
import { pdfAvailable, pdfOrNull } from '../platform/pdf.js'
import { getLetterhead } from './printing.js'

// Printed documents (engine E8): the data of one record, the institution's template for the
// document (its own Handlebars body, or the built-in one) and the print layout — rendered
// on the server into a page the browser prints.

const docOf = (docType) => {
  const def = DOCS[docType]
  if (!def || !PRINT_DOC_BY[docType]) throw notFound('Document type')
  return def
}

/** The template a document prints with: one picked by id, the institution's default, or the built-in layout. */
async function templateFor(docType, templateId) {
  const saved = templateId && isOid(templateId)
    ? await PrintTemplate.findOne({ _id: templateId, docType }).lean()
    : await PrintTemplate.findOne({ docType, isDefault: true, active: true }).lean()
  return saved ? { ...printDefaults(docType), ...clean(saved), builtIn: false } : printDefaults(docType)
}

/**
 * Render a document from its loaded data. `body` (a template being edited) wins over the
 * saved one; with neither, the built-in template prints.
 */
export async function renderData(docType, raw, opts = {}) {
  return (await renderPrint(docType, raw, opts)).html
}

/** renderData plus what a PDF needs: the paper, orientation and margins, and a file name. */
export async function renderPrint(docType, raw, { templateId, body, layout: draft, autoPrint = true, model: given, lang: askedLang } = {}) {
  const def = docOf(docType)
  let model = given ?? def.model(raw)
  let template = { ...(await templateFor(docType, templateId)), ...(draft ?? {}) }
  // no saved template: the module's own setting chooses the 80 mm roll, or the paper (a sideways ID card)
  if (template.builtIn && !draft && def.thermal?.(raw)) template = { ...template, paper: 'THERMAL_80', margins: { top: 3, right: 3, bottom: 3, left: 3 } }
  if (template.builtIn && !draft && def.paper?.(raw)) template = { ...template, paper: def.paper(raw) }
  if (def.forPaper) model = def.forPaper(model, template.paper)
  const card = !!PAPER_BY[template.paper]?.card
  const letterhead = await getLetterhead()
  const layout = layoutFor(template, letterhead, raw.institution)
  const source = body ?? (template.body?.trim() ? template.body : defaultTemplate(docType))
  if (!source) throw notFound('Template')
  const title = def.title(model)
  try {
    const lang = askedLang || raw.student?.language || raw.bill?.language || raw.receipt?.language || raw.institution?.defaultLanguage || 'en'
    const html = renderPage({ title, source, model, layout, timeZone: letterhead.institution?.timezone || 'Asia/Kolkata', autoPrint, lang })
    return { html, title, paper: template.paper ?? 'A4', landscape: template.orientation === 'landscape' && !fixedPaper(template.paper), margins: card ? {} : template.margins ?? {}, skipped: model.skipped ?? 0 }
  } catch (e) {
    throw badRequest(`The ${PRINT_DOC_BY[docType].label.toLowerCase()} template has a mistake: ${String(e.message).split('\n')[0]}`)
  }
}

/** A file name for a printed document: "<title>.pdf", safe on every OS. */
export const pdfName = (title, fallback = 'document') => `${String(title ?? '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback}.pdf`

/**
 * A printed document as a PDF (Gotenberg). null when PDF can't be made right now — the
 * caller serves the HTML instead. `transform(html)` adds to the page first (a watermark).
 */
export async function printToPdf(docType, raw, { transform, ...opts } = {}) {
  if (!pdfAvailable()) return null
  const p = await renderPrint(docType, raw, { ...opts, autoPrint: false })
  const pdf = await pdfOrNull(transform ? transform(p.html) : p.html, { paper: p.paper, landscape: p.landscape, margins: p.margins, fileName: pdfName(p.title) })
  return pdf ? { pdf, fileName: pdfName(p.title), title: p.title } : null
}


/** One record's document for a signed-in user, checked against the document's permissions. */
export async function renderDocument(docType, id, auth, opts = {}) {
  const raw = await loadDocument(docType, id, auth)
  return renderData(docType, raw, opts)
}

async function loadDocument(docType, id, auth) {
  const def = docOf(docType)
  if (!auth.fullAccess && !def.perms.some((p) => can(auth, p))) throw forbidden()
  if (!isOid(id)) throw notFound('Record')
  return def.load(id, auth)
}

/** Several records in one document (staff ID cards): only for document types made for it, same permission checks. */
async function loadMany(docType, ids, auth) {
  const def = docOf(docType)
  if (!def.many) throw notFound('Document type')
  if (!auth.fullAccess && !def.perms.some((p) => can(auth, p))) throw forbidden()
  if (!ids.length || !ids.every(isOid)) throw notFound('Record')
  return def.load(ids, auth)
}

/** Several records' document, ready to print, and how many of them were left out (people who have left). */
export async function renderDocuments(docType, ids, auth, opts = {}) {
  const p = await renderPrint(docType, await loadMany(docType, ids, auth), opts)
  return { html: p.html, skipped: p.skipped }
}

/** Several records' document as a PDF; 409 PDF_UNAVAILABLE as for one record. */
export async function renderDocumentsPdf(docType, ids, auth, opts = {}) {
  const out = await printToPdf(docType, await loadMany(docType, ids, auth), opts)
  if (!out) throw new AppError(409, 'PDF download isn’t available just now — use Print instead.', { code: 'PDF_UNAVAILABLE' })
  return out
}

/**
 * One record's document as a PDF, with the same permission checks as the printed page.
 * Throws 409 PDF_UNAVAILABLE when Gotenberg is not set up or not reachable — not 503, which
 * the web app reads as "server down" — and the screen offers Print instead.
 */
export async function renderDocumentPdf(docType, id, auth, opts = {}) {
  const raw = await loadDocument(docType, id, auth)
  const out = await printToPdf(docType, raw, opts)
  if (!out) throw new AppError(409, 'PDF download isn’t available just now — use Print instead.', { code: 'PDF_UNAVAILABLE' })
  return out
}

/** Template editor preview: the draft body and layout over a real record (the latest one when none is named). */
export async function previewDocument(docType, { body, templateId, id, layout }, auth) {
  const def = docOf(docType)
  if (body !== undefined) {
    const err = templateError(body)
    if (err) throw badRequest(`The template has a mistake: ${err}`, { fields: { body: err } })
  }
  const recordId = id && isOid(id) ? id : await def.sample()
  // several-record documents (staff ID cards) load in the editor's own scope: one it can't see previews over the sample
  const raw = recordId && (def.many ? await def.load([String(recordId)], auth).catch((e) => { if (e.status === 404) return null; throw e }) : await def.load(String(recordId), auth))
  if (raw) return renderData(docType, raw, { templateId, body, layout, autoPrint: false })
  // none made yet (a new institution): preview over made-up data, marked so nobody takes it for a record
  const { institution } = await getLetterhead()
  const model = sampleModel(docType, institution)
  if (!model) throw badRequest(`There is no ${PRINT_DOC_BY[docType].label.toLowerCase()} yet to preview with. Make one first.`)
  const html = await renderData(docType, { institution }, { templateId, body, layout, autoPrint: false, model })
  return html.replace('</body>', `${sampleRibbon(PRINT_DOC_BY[docType].label)}</body>`)
}

const sampleRibbon = (label) => `<div style="position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99;padding:4px 12px;border-radius:999px;background:#FEF3C7;color:#92400E;border:1px solid #F59E0B;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.12)">Sample data — no ${label.toLowerCase()} yet</div>`

/**
 * What the editor shows for a document: the built-in template, the variables and helpers, and — for a document with
 * several starting designs (the staff ID card) — each design's key and body; the first is the built-in one.
 */
export function documentHelp(docType) {
  const def = docOf(docType)
  return { docType, source: defaultTemplate(docType), variables: def.variables, helpers: HELPER_NAMES, designs: designsOf(docType) }
}

export const documentTypes = () => Object.keys(DOCS)
