import { Router } from 'express'
import { FIELD_TYPES, FORM_STATUSES, FORM_USES } from '@schoolgiant/shared'
import { requirePermission } from '../../platform/middleware.js'
import { objectId, optionalText, z } from '../../platform/validate.js'
import { archiveForm, createForm, duplicateForm, getForm, listForms, publishForm, updateForm } from '../../services/forms.js'

// Administration › Form builder: /api/v1/core/forms (docs/00 §7 E6).
const router = Router()

const key = z.string().trim().toUpperCase().max(24)
const num = z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().optional())
const field = z.object({
  key, label: z.string().trim().max(300).default(''), type: z.enum(FIELD_TYPES.map((t) => t.value)),
  required: z.boolean().optional(), help: optionalText(200), unit: optionalText(20),
  min: num, max: num, decimals: z.coerce.number().int().min(0).max(4).optional(),
  options: z.array(z.union([z.string().trim().max(120), z.object({ label: z.string().trim().max(160), points: z.coerce.number().min(-100).max(100) })])).max(30).optional(),
  formula: optionalText(200),
  of: z.array(key).max(50).optional(),
  bands: z.array(z.object({ min: num, max: num, label: z.string().trim().max(60) })).max(10).optional(),
  showIf: z.object({ field: key, equals: z.union([z.string().max(120), z.array(z.string().max(120)).max(10)]) }).optional().nullable(),
})
const definition = z.object({
  sections: z.array(z.object({ title: z.string().trim().max(120).default(''), columns: z.coerce.number().int().min(1).max(3).default(1), fields: z.array(field).max(60).default([]) })).max(20),
})
const formBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,23}$/, 'Capitals, digits and _, starting with a letter'),
  name: z.string().trim().min(2, 'Name the form').max(120),
  description: optionalText(300),
  use: z.enum(FORM_USES.map((u) => u.value)).default('SURVEY'),
  specialities: z.array(z.string().trim().max(60)).max(10).default([]),
  definition: definition.optional(),
})

router.get('/forms', requirePermission('core.forms.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(FORM_STATUSES)).optional(), use: z.string().optional(), search: z.string().max(60).optional() }).parse(req.query)
  res.json({ data: await listForms(q) })
})
router.post('/forms', requirePermission('core.forms.create'), async (req, res) => {
  res.status(201).json({ data: await createForm(formBody.parse(req.body), req) })
})
router.get('/forms/:id', requirePermission('core.forms.view'), async (req, res) => {
  res.json({ data: await getForm(objectId.parse(req.params.id)) })
})
router.put('/forms/:id', requirePermission('core.forms.edit'), async (req, res) => {
  res.json({ data: await updateForm(objectId.parse(req.params.id), formBody.partial().parse(req.body), req) })
})
router.post('/forms/:id/publish', requirePermission('core.forms.publish'), async (req, res) => {
  res.json({ data: await publishForm(objectId.parse(req.params.id), req) })
})
router.post('/forms/:id/archive', requirePermission('core.forms.delete'), async (req, res) => {
  const { archived } = z.object({ archived: z.boolean().default(true) }).parse(req.body ?? {})
  res.json({ data: await archiveForm(objectId.parse(req.params.id), archived, req) })
})
router.post('/forms/:id/duplicate', requirePermission('core.forms.create'), async (req, res) => {
  res.status(201).json({ data: await duplicateForm(objectId.parse(req.params.id), req) })
})

export default router
