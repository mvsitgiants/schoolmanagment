import { Router } from 'express'
import { Role } from '../../models/tenant.js'
import { clean } from '../../platform/db.js'
import { badRequest } from '../../platform/errors.js'
import { requirePermission } from '../../platform/middleware.js'
import { objectId, optionalText, z } from '../../platform/validate.js'
import {
  catalogFor, cloneRole, createFromTemplates, createRole, deleteRole, getRole, listRoles,
  listTemplates, roleHistory, roleMembers, updateRole,
} from '../../services/roles.js'

const router = Router()

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name').max(80),
  description: optionalText(500),
  icon: optionalText(40),
  fullAccess: z.boolean().optional(),
  permissions: z.array(z.string().max(80)).max(2000).default([]),
  dataScopes: z.record(z.string()).default({}),
  limits: z.record(z.union([z.number(), z.string(), z.null()])).default({}),
  homePage: optionalText(120),
  security: z.object({ require2fa: z.boolean().optional(), idleMinutes: z.number().int().min(5).max(720).nullable().optional() }).optional(),
})

router.get('/permissions/catalog', requirePermission('core.roles.view'), async (req, res) => {
  res.json({ data: await catalogFor(req.auth) })
})

router.get('/roles', requirePermission('core.roles.view', 'core.users.view'), async (req, res) => {
  res.json({ data: await listRoles(req.auth) })
})

router.get('/role-templates', requirePermission('core.roles.view'), async (req, res) => {
  res.json({ data: await listTemplates(req.auth) })
})

router.post('/roles/from-templates', requirePermission('core.roles.create'), async (req, res) => {
  const { codes } = z.object({ codes: z.array(z.string()).min(1, 'Pick at least one role').max(50) }).parse(req.body)
  res.status(201).json({ data: await createFromTemplates(codes, req.auth) })
})

router.get('/roles-compare', requirePermission('core.roles.view'), async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean)
  if (ids.length < 2 || ids.length > 4) throw badRequest('Pick 2 to 4 roles to compare.')
  z.array(objectId).parse(ids)
  const roles = await Role.find({ _id: { $in: ids } }).lean()
  res.json({ data: clean(roles) })
})

router.post('/roles', requirePermission('core.roles.create'), async (req, res) => {
  res.status(201).json({ data: await createRole(roleSchema.parse(req.body), req.auth) })
})

router.get('/roles/:id', requirePermission('core.roles.view'), async (req, res) => {
  res.json({ data: await getRole(req.params.id, req.auth) })
})

router.patch('/roles/:id', requirePermission('core.roles.edit'), async (req, res) => {
  res.json({ data: await updateRole(req.params.id, roleSchema.partial().parse(req.body), req.auth) })
})

router.delete('/roles/:id', requirePermission('core.roles.delete'), async (req, res) => {
  const { moveMembersTo } = z.object({ moveMembersTo: objectId.optional() }).parse(req.body ?? {})
  res.json({ data: await deleteRole(req.params.id, { moveMembersTo }, req.auth) })
})

router.post('/roles/:id/clone', requirePermission('core.roles.create'), async (req, res) => {
  res.status(201).json({ data: await cloneRole(req.params.id, req.auth) })
})

router.get('/roles/:id/members', requirePermission('core.roles.view'), async (req, res) => {
  res.json({ data: await roleMembers(req.params.id) })
})

router.get('/roles/:id/history', requirePermission('core.roles.view'), async (req, res) => {
  res.json({ data: await roleHistory(req.params.id) })
})

export default router
