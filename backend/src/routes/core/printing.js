import { Router } from 'express'
import { LETTERHEAD_IDS, LETTERHEAD_MODES, PAPER_SIZES, PRINT_DOCS } from '@schoolgiant/shared'
import { requirePermission } from '../../platform/middleware.js'
import { objectId, optionalText, z } from '../../platform/validate.js'
import { deleteTemplate, effectiveTemplate, getLetterhead, listTemplates, saveLetterhead, saveTemplate } from '../../services/printing.js'

// Print templates (E8): /api/v1/core/print-templates, /api/v1/core/print/*.
const router = Router()
const values = (list) => list.map((x) => x.value)
const mm = z.coerce.number().min(0).max(60)

router.get('/print/letterhead', requirePermission('core.print-templates.view'), async (req, res) => {
  res.json({ data: await getLetterhead() })
})
router.put('/print/letterhead', requirePermission('core.print-templates.edit'), async (req, res) => {
  const body = z.object({
    align: z.enum(['LEFT', 'CENTER']).optional(),
    showLogo: z.boolean().optional(),
    showContacts: z.boolean().optional(),
    ids: z.array(z.enum(values(LETTERHEAD_IDS))).max(4).optional(),
    tagline: optionalText(120),
    accentColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, 'Use a colour like #0E7C86').optional(),
    footerText: optionalText(300),
  }).parse(req.body)
  res.json({ data: await saveLetterhead(body, req.auth, req) })
})

/** Any signed-in user printing a document reads its layout; the document itself is permission-checked. */
router.get('/print/effective/:docType', async (req, res) => {
  res.json({ data: await effectiveTemplate(req.params.docType) })
})

const templateBody = z.object({
  docType: z.enum(values(PRINT_DOCS)),
  name: z.string().trim().min(2, 'Name the template').max(60),
  isDefault: z.boolean().optional(),
  paper: z.enum(values(PAPER_SIZES)).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins: z.object({ top: mm, right: mm, bottom: mm, left: mm }),
  letterhead: z.enum(values(LETTERHEAD_MODES)).default('FULL'),
  headerSpaceMm: z.coerce.number().min(0).max(120).optional(),
  footerSpaceMm: z.coerce.number().min(0).max(80).optional(),
  footerText: optionalText(300),
  showQr: z.boolean().default(true),
  showPrintedOn: z.boolean().default(true),
  fontScale: z.coerce.number().int().min(80).max(130).default(100),
  body: z.string().max(200_000).optional().nullable(),
  active: z.boolean().default(true),
})

router.get('/print-templates', requirePermission('core.print-templates.view'), async (req, res) => {
  res.json({ data: await listTemplates() })
})
router.post('/print-templates', requirePermission('core.print-templates.create'), async (req, res) => {
  res.status(201).json({ data: await saveTemplate(null, templateBody.parse(req.body), req.auth, req) })
})
router.patch('/print-templates/:id', requirePermission('core.print-templates.edit'), async (req, res) => {
  const { docType, ...rest } = templateBody.partial().parse(req.body)
  res.json({ data: await saveTemplate(objectId.parse(req.params.id), rest, req.auth, req) })
})
router.delete('/print-templates/:id', requirePermission('core.print-templates.delete'), async (req, res) => {
  res.json({ data: await deleteTemplate(objectId.parse(req.params.id), req.auth, req) })
})

export default router
