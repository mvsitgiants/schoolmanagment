import { Router } from 'express'
import {
  CUSTOM_FIELD_ENTITIES, DOC_TYPE_BY_CODE, MODULE_BY_ID, SETTINGS, validatePattern,
} from '@schoolgiant/shared'
import { CustomFieldDef, NumberSeries } from '../../models/tenant.js'
import { bumpAccessVersion } from '../../platform/access.js'
import { audit, diffFields } from '../../platform/audit.js'
import { clean } from '../../platform/db.js'
import { badRequest, conflict, notFound } from '../../platform/errors.js'
import { requirePermission } from '../../platform/middleware.js'
import { listSeries } from '../../platform/numbering.js'
import { getSettings, saveSettings } from '../../platform/settings.js'
import { optionalText, z } from '../../platform/validate.js'

// Administration engines: number series (E9), settings (E3), custom fields (E5).
const router = Router()

// ───────────────────────────────────────────────────────── number series

router.get('/number-series', requirePermission('core.numbering.view'), async (req, res) => {
  const enabled = new Set(req.auth.enabledModules)
  const rows = await listSeries()
  res.json({ data: rows.map((r) => ({ ...r, moduleEnabled: enabled.has(r.module) || !!MODULE_BY_ID[r.module]?.mandatory })) })
})

router.put('/number-series/:docType', requirePermission('core.numbering.edit'), async (req, res) => {
  const def = DOC_TYPE_BY_CODE[req.params.docType]
  if (!def) throw notFound('Document type')
  const { pattern, reset } = z.object({ pattern: z.string().trim(), reset: z.enum(['NEVER', 'YEAR', 'FY', 'MONTH', 'DAY']) }).parse(req.body)
  const problem = validatePattern(pattern)
  if (problem) throw badRequest(problem, { fields: { pattern: problem } })
  const before = await NumberSeries.findOne({ docType: def.code }).lean()
  await NumberSeries.updateOne({ docType: def.code }, { $set: { pattern, reset, updatedBy: req.auth.user.name } }, { upsert: true })
  await audit({
    action: 'UPDATE', module: 'core', entityType: 'number-series', entityId: def.code, entityName: def.label,
    summary: `Number series for ${def.label}: ${pattern} (resets ${reset.toLowerCase()})`,
    changes: diffFields(before ?? { pattern: def.pattern, reset: def.reset }, { pattern, reset }, ['pattern', 'reset']),
  }, req)
  res.json({ data: (await listSeries()).find((s) => s.code === def.code) })
})

// ───────────────────────────────────────────────────────── settings

/** Settings of every module that is switched on, grouped by module. */
router.get('/settings/modules', requirePermission('core.settings.view'), async (req, res) => {
  const enabled = new Set(req.auth.enabledModules)
  const modules = [...new Set(SETTINGS.map((s) => s.module))].filter((m) => enabled.has(m) || MODULE_BY_ID[m]?.mandatory)
  const data = []
  for (const m of modules) {
    data.push({
      module: m, name: MODULE_BY_ID[m]?.name, icon: MODULE_BY_ID[m]?.icon,
      definitions: SETTINGS.filter((s) => s.module === m).map(({ module, ...d }) => d),
      values: await getSettings(m),
    })
  }
  res.json({ data })
})

router.patch('/settings/modules/:module', requirePermission('core.settings.edit'), async (req, res) => {
  const { module } = req.params
  if (!SETTINGS.some((s) => s.module === module)) throw notFound('Settings group')
  const before = await getSettings(module)
  const after = await saveSettings(module, req.body ?? {})
  const changes = diffFields(before, after, Object.keys(req.body ?? {}))
  if (module === 'core' && changes.some((c) => c.field === 'sessionIdleMinutes')) await bumpAccessVersion(req.auth.tenantId) // cached in each user's access
  if (changes.length) await audit({ action: 'UPDATE', module: 'core', entityType: 'settings', entityId: module, entityName: `${MODULE_BY_ID[module]?.name} settings`, summary: `Changed ${MODULE_BY_ID[module]?.name} settings`, changes }, req)
  res.json({ data: after })
})

// ───────────────────────────────────────────────────────── custom fields

const fieldSchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES.map((e) => e.value)),
  label: z.string().trim().min(2, 'Enter a label').max(60),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOL', 'SELECT', 'MULTI']),
  options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  required: z.boolean().default(false),
  showInList: z.boolean().default(false),
  help: optionalText(160),
  active: z.boolean().optional(),
})

const codeFrom = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'field'

router.get('/custom-fields', requirePermission('core.custom-fields.view'), async (req, res) => {
  const filter = req.query.entity ? { entity: String(req.query.entity) } : {}
  res.json({ data: clean(await CustomFieldDef.find(filter).sort({ entity: 1, order: 1, createdAt: 1 }).lean()) })
})

router.post('/custom-fields', requirePermission('core.custom-fields.create'), async (req, res) => {
  const input = fieldSchema.parse(req.body)
  if (['SELECT', 'MULTI'].includes(input.type) && input.options.length < 2) throw badRequest('Give at least two options.', { fields: { options: 'At least two options' } })
  let code = codeFrom(input.label)
  for (let i = 2; await CustomFieldDef.exists({ entity: input.entity, code }); i++) code = `${codeFrom(input.label)}_${i}`
  const last = await CustomFieldDef.findOne({ entity: input.entity }).sort({ order: -1 }).lean()
  const field = await CustomFieldDef.create({ ...input, code, order: (last?.order ?? 0) + 1 })
  await audit({ action: 'CREATE', module: 'core', entityType: 'custom-field', entityId: String(field._id), entityName: field.label, summary: `Added custom field “${field.label}” to ${input.entity}` }, req)
  res.status(201).json({ data: field })
})

router.patch('/custom-fields/:id', requirePermission('core.custom-fields.edit'), async (req, res) => {
  const input = fieldSchema.partial().omit({ entity: true, type: true }).extend({ order: z.number().int().optional() }).parse(req.body)
  const field = await CustomFieldDef.findById(req.params.id)
  if (!field) throw notFound('Custom field')
  if (['SELECT', 'MULTI'].includes(field.type) && input.options && input.options.length < 2) throw badRequest('Give at least two options.')
  const before = field.toObject()
  Object.assign(field, input)
  await field.save()
  const changes = diffFields(before, field.toObject(), ['label', 'options', 'required', 'showInList', 'help', 'active'])
  if (changes.length) await audit({ action: 'UPDATE', module: 'core', entityType: 'custom-field', entityId: String(field._id), entityName: field.label, summary: `Updated custom field “${field.label}”`, changes }, req)
  res.json({ data: field })
})

router.delete('/custom-fields/:id', requirePermission('core.custom-fields.delete'), async (req, res) => {
  const field = await CustomFieldDef.findById(req.params.id)
  if (!field) throw notFound('Custom field')
  if (field.active) throw conflict('Switch the field off first. Records keep any values already entered.')
  await field.deleteOne()
  await audit({ action: 'DELETE', module: 'core', entityType: 'custom-field', entityId: String(field._id), entityName: field.label, summary: `Deleted custom field “${field.label}”` }, req)
  res.json({ data: { deleted: true } })
})

export default router
