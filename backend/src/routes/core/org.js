import { Router } from 'express'
import { Branch, DEPARTMENT_TYPES, Department, User } from '../../models/tenant.js'
import { audit, diffFields } from '../../platform/audit.js'
import { clean } from '../../platform/db.js'
import { badRequest, conflict, notFound } from '../../platform/errors.js'
import { requirePermission } from '../../platform/middleware.js'
import { importDepartments } from '../../services/coreImport.js'
import { objectId, optionalText, printImage, z } from '../../platform/validate.js'
import { assertWithinLimit } from '../../services/subscription.js'
import { attendanceSitesInput, sitesIn, sitesText } from '../../services/attendanceSites.js'

const router = Router()

// ───────────────────────────────────────────────────────── branches

const branchSchema = z.object({
  name: z.string().trim().min(2, 'Enter a branch name').max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or dashes'),
  addressLine: optionalText(250), city: optionalText(80), state: optionalText(80), pincode: optionalText(12),
  phone: optionalText(30),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN has 15 letters/digits').optional().or(z.literal('').transform(() => undefined)),
  // self-attendance geofence: named sites (circle or outline) of this branch
  attendanceSites: attendanceSitesInput.optional(),
  // printed documents of this campus, when it is its own school on paper (empty = the institution's)
  identity: z.object({
    printName: optionalText(160), board: optionalText(120), affiliationNo: optionalText(60), schoolCode: optionalText(30), udiseCode: optionalText(60),
    email: optionalText(120), principalName: optionalText(120), logoUrl: printImage, sealUrl: printImage, principalSignUrl: printImage,
  }).optional(),
})

router.get('/branches', async (req, res) => {
  const [rows, counts] = await Promise.all([
    Branch.find().sort({ isDefault: -1, name: 1 }).lean(),
    User.aggregate([{ $match: { active: true, branchId: { $ne: null } } }, { $group: { _id: '$branchId', n: { $sum: 1 } } }]),
  ])
  const byId = new Map(counts.map((c) => [String(c._id), c.n]))
  res.json({ data: rows.map((b) => ({ ...clean(b), userCount: byId.get(String(b._id)) ?? 0 })) })
})

router.post('/branches', requirePermission('core.branches.create'), async (req, res) => {
  const input = branchSchema.parse(req.body)
  await assertWithinLimit(req.auth.tenantId, 'branches', 1)
  const branch = await Branch.create({ ...input, attendanceSites: sitesIn(input.attendanceSites) ?? [] })
  await audit({ action: 'CREATE', module: 'core', entityType: 'branch', entityId: String(branch._id), entityName: branch.name, summary: `Added branch ${branch.name}` }, req)
  res.status(201).json({ data: branch })
})

router.patch('/branches/:id', requirePermission('core.branches.edit'), async (req, res) => {
  const input = branchSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body)
  const branch = await Branch.findById(req.params.id)
  if (!branch) throw notFound('Branch')
  if (input.active === false && branch.isDefault) throw badRequest('The main branch is always active.')
  if (input.active === true && !branch.active) await assertWithinLimit(req.auth.tenantId, 'branches', 1)
  const before = branch.toObject()
  const { attendanceSites, identity, ...rest } = input
  Object.assign(branch, rest)
  if (identity) branch.identity = Object.fromEntries(Object.entries(identity).map(([k, v]) => [k, v || undefined]))
  if (attendanceSites) branch.attendanceSites = sitesIn(attendanceSites)
  await branch.save()
  const after = branch.toObject()
  const changes = diffFields({ ...before, attendanceSites: sitesText(before.attendanceSites) }, { ...after, attendanceSites: sitesText(after.attendanceSites) }, ['name', 'code', 'addressLine', 'city', 'state', 'pincode', 'phone', 'gstin', 'attendanceSites', 'active'])
  if (changes.length) await audit({ action: 'UPDATE', module: 'core', entityType: 'branch', entityId: String(branch._id), entityName: branch.name, summary: `Updated branch ${branch.name}`, changes }, req)
  res.json({ data: branch })
})

router.delete('/branches/:id', requirePermission('core.branches.delete'), async (req, res) => {
  const branch = await Branch.findById(req.params.id)
  if (!branch) throw notFound('Branch')
  if (branch.isDefault) throw badRequest("The main branch can't be deleted.")
  const users = await User.countDocuments({ branchId: branch._id })
  if (users) throw conflict(`${users} user(s) belong to this branch. Move them or deactivate the branch instead.`)
  await branch.deleteOne()
  await audit({ action: 'DELETE', module: 'core', entityType: 'branch', entityId: String(branch._id), entityName: branch.name, summary: `Deleted branch ${branch.name}` }, req)
  res.json({ data: { deleted: true } })
})

// ───────────────────────────────────────────────────────── departments

const deptSchema = z.object({
  name: z.string().trim().min(2, 'Enter a department name').max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or dashes'),
  type: z.enum(DEPARTMENT_TYPES),
  headUserId: objectId.optional().nullable().or(z.literal('').transform(() => null)),
  description: optionalText(500),
  active: z.boolean().optional(),
})

router.get('/departments', async (req, res) => {
  const [rows, counts] = await Promise.all([
    Department.find().sort({ active: -1, name: 1 }).lean(),
    User.aggregate([{ $match: { active: true } }, { $unwind: '$departmentIds' }, { $group: { _id: '$departmentIds', n: { $sum: 1 } } }]),
  ])
  const heads = await User.find({ _id: { $in: rows.map((d) => d.headUserId).filter(Boolean) } }).select('name').lean()
  const headName = new Map(heads.map((u) => [String(u._id), u.name]))
  const byId = new Map(counts.map((c) => [String(c._id), c.n]))
  res.json({ data: rows.map((d) => ({ ...clean(d), staffCount: byId.get(String(d._id)) ?? 0, headName: d.headUserId ? headName.get(String(d.headUserId)) : null })) })
})

router.post('/departments/import', requirePermission('core.departments.import'), async (req, res) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.any())).max(5000), dryRun: z.boolean().default(true) }).parse(req.body)
  res.json({ data: await importDepartments(rows, { dryRun, schema: deptSchema }, req) })
})
router.post('/departments', requirePermission('core.departments.create'), async (req, res) => {
  const input = deptSchema.parse(req.body)
  const dept = await Department.create(input)
  await audit({ action: 'CREATE', module: 'core', entityType: 'department', entityId: String(dept._id), entityName: dept.name, summary: `Added department ${dept.name}` }, req)
  res.status(201).json({ data: dept })
})

router.patch('/departments/:id', requirePermission('core.departments.edit'), async (req, res) => {
  const input = deptSchema.partial().parse(req.body)
  const dept = await Department.findById(req.params.id)
  if (!dept) throw notFound('Department')
  const before = dept.toObject()
  Object.assign(dept, input)
  await dept.save()
  const changes = diffFields(before, dept.toObject(), ['name', 'code', 'type', 'headUserId', 'description', 'active'])
  if (changes.length) await audit({ action: 'UPDATE', module: 'core', entityType: 'department', entityId: String(dept._id), entityName: dept.name, summary: `Updated department ${dept.name}`, changes }, req)
  res.json({ data: dept })
})

router.delete('/departments/:id', requirePermission('core.departments.delete'), async (req, res) => {
  const dept = await Department.findById(req.params.id)
  if (!dept) throw notFound('Department')
  const staff = await User.countDocuments({ departmentIds: dept._id })
  if (staff) throw conflict(`${staff} user(s) are in this department. Deactivate it instead, or move them first.`)
  await dept.deleteOne()
  await audit({ action: 'DELETE', module: 'core', entityType: 'department', entityId: String(dept._id), entityName: dept.name, summary: `Deleted department ${dept.name}` }, req)
  res.json({ data: { deleted: true } })
})

export default router
