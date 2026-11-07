import { Router } from 'express'
import { PAPER_SIZES, LETTERHEAD_MODES } from '@schoolgiant/shared'
import { authenticate, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, z } from '../platform/validate.js'
import { sendPdf } from '../platform/pdf.js'
import { documentHelp, previewDocument, renderDocument, renderDocumentPdf, renderDocuments, renderDocumentsPdf } from '../services/documents.js'

// Printed documents: /api/v1/documents — server-rendered from Handlebars templates (E8).
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate)

const values = (list) => list.map((x) => x.value)
const html = (res, page) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.send(page) }

/** The built-in template, variables and helpers for the template editor. */
router.get('/:docType/help', requirePermission('core.print-templates.view'), async (req, res) => {
  res.json({ data: documentHelp(req.params.docType) })
})

/** Preview a template being edited, over the latest record (or `id`). */
router.post('/:docType/preview', requirePermission('core.print-templates.view'), async (req, res) => {
  const mm = z.coerce.number().min(0).max(60)
  const body = z.object({
    body: z.string().max(200_000).optional(),
    templateId: objectId.optional(),
    id: objectId.optional(),
    layout: z.object({
      paper: z.enum(values(PAPER_SIZES)), orientation: z.enum(['portrait', 'landscape']), margins: z.object({ top: mm, right: mm, bottom: mm, left: mm }),
      letterhead: z.enum(values(LETTERHEAD_MODES)), headerSpaceMm: z.coerce.number().min(0).max(120).optional(), footerSpaceMm: z.coerce.number().min(0).max(80).optional(),
      footerText: z.string().max(300).optional(), showQr: z.boolean(), showPrintedOn: z.boolean(), fontScale: z.coerce.number().int().min(80).max(130),
    }).partial().optional(),
  }).parse(req.body ?? {})
  html(res, await previewDocument(req.params.docType, body, req.auth))
})

/**
 * Several records in one document, ready to print — ID cards for the people picked (`?ids=a,b,…`, up to 200).
 * Same permission checks, `?templateId=`, `?print=0` and `?format=pdf` as one record's document. `X-Skipped`: how
 * many were left out (people who have left).
 */
const idList = z.string().trim().min(1, 'Pick at least one record')
  .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])
  .pipe(z.array(objectId).min(1, 'Pick at least one record').max(200, 'Print up to 200 ID cards at a time'))
router.get('/:docType', async (req, res) => {
  const { ids } = z.object({ ids: idList }).parse(req.query)
  const opts = { templateId: req.query.templateId }
  if (req.query.format === 'pdf') {
    const { pdf, fileName } = await renderDocumentsPdf(req.params.docType, ids, req.auth, opts)
    sendPdf(res, pdf, fileName, { inline: req.query.inline === '1' })
    return
  }
  const { html: page, skipped } = await renderDocuments(req.params.docType, ids, req.auth, { ...opts, autoPrint: req.query.print !== '0' })
  res.setHeader('X-Skipped', String(skipped ?? 0))
  html(res, page)
})

/**
 * One record's document, ready to print. Each document checks its own permissions.
 * `?format=pdf` — the same document as a PDF download (Gotenberg); 409 PDF_UNAVAILABLE when
 * the server can't make PDFs just now (the screen offers Print instead).
 */
router.get('/:docType/:id', async (req, res) => {
  const opts = { templateId: req.query.templateId }
  if (req.query.format === 'pdf') {
    const { pdf, fileName } = await renderDocumentPdf(req.params.docType, req.params.id, req.auth, opts)
    sendPdf(res, pdf, fileName, { inline: req.query.inline === '1' })
    return
  }
  html(res, await renderDocument(req.params.docType, req.params.id, req.auth, { ...opts, autoPrint: req.query.print !== '0' }))
})

export default router
