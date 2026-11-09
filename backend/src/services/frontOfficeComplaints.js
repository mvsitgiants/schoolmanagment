import {
  FO_COMPLAINT_CATEGORIES, FO_COMPLAINT_FLOW, FO_COMPLAINT_OPEN, FO_COMPLAINT_SOURCE_LABEL, FO_COMPLAINT_STATUS,
  complaintDueOn, complaintOverdue, mobile10, sectionLabel,
} from '@schoolgiant/shared'
import mongoose from 'mongoose'
import { ClassLevel, Section } from '../models/academics.js'
import { Complaint } from '../models/frontOffice.js'
import { Student, familyContact, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { escapeRegex } from '../platform/validate.js'
import { campusFilter, foNow } from './frontOffice.js'
import { humanDate, notifyUsers } from './notify.js'
import { need, studentFor } from './portal.js'

// Front office › Complaints: a complaint or grievance from a parent, a student, staff, a walk-in or the family app —
// numbered (COMPLAINT), given a due day by the SLA (Settings › Front office), assigned to someone, and tracked
// OPEN → IN_PROGRESS → RESOLVED → CLOSED. The person who complained is told when it is resolved.

const actor = () => getContext()?.userName
const idStr = (v) => (v ? String(v) : null)

const dto = (c, today) => ({
  id: String(c._id), complaintNo: c.complaintNo, date: c.date, source: c.source, sourceLabel: FO_COMPLAINT_SOURCE_LABEL[c.source] ?? c.source,
  category: c.category, priority: c.priority, subject: c.subject, description: c.description ?? null,
  complainant: { name: c.complainant?.name ?? null, mobile: c.complainant?.mobile ?? null, email: c.complainant?.email ?? null, userId: idStr(c.complainant?.userId) },
  studentId: idStr(c.studentId), studentName: c.studentName ?? null, classLabel: c.classLabel ?? null,
  assignedToId: idStr(c.assignedToId), assignedTo: c.assignedTo ?? null, status: c.status, dueOn: c.dueOn ?? null,
  overdue: complaintOverdue(c, today), daysOpen: Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${c.date}T12:00:00Z`)) / 864e5)),
  resolution: c.resolution ?? null, resolvedAt: c.resolvedAt ?? null, resolvedBy: c.resolvedBy ?? null, closedAt: c.closedAt ?? null,
  steps: (c.steps ?? []).map((s) => ({ at: s.at, by: s.by ?? null, action: s.action, status: s.status ?? null, note: s.note ?? null })),
  createdBy: c.createdBy ?? null, createdAt: c.createdAt,
})

async function classOf(sectionId) {
  if (!sectionId) return null
  const sec = await Section.findById(sectionId).select('name classId').lean()
  if (!sec) return null
  const cls = await ClassLevel.findById(sec.classId).select('name code').lean()
  return sectionLabel(cls, sec, { short: true })
}

const oid = (v) => (v ? new mongoose.Types.ObjectId(String(v)) : null)
/** campusFilter, typed for an aggregate $match (no schema casting there). */
const matchScope = (scope) => (scope.branchId ? { branchId: scope.branchId.$in ? { $in: scope.branchId.$in.map(oid) } : oid(scope.branchId) } : scope)

/**
 * One page of the list, with counts for the board (by status, overdue, open by category, average days to resolve)
 * worked out over every complaint matching the other filters — the status / open / overdue view only narrows the rows.
 */
export async function listComplaints({ status, category, priority, mine, overdue, search, open, page = 1, pageSize = 50 } = {}, auth) {
  const { date: today } = await foNow()
  const scope = await campusFilter(auth)
  const base = {}
  if (category) base.category = category
  if (priority) base.priority = priority
  if (mine) base.assignedToId = oid(auth.userId)
  if (search?.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i')
    base.$or = [{ complaintNo: re }, { subject: re }, { 'complainant.name': re }, { studentName: re }, { assignedTo: re }]
  }
  // overdue = still open and past its due day (complaintOverdue), as a query
  const late = { status: { $in: FO_COMPLAINT_OPEN }, dueOn: { $gt: '', $lt: today } }
  const narrow = []
  if (status) narrow.push({ status })
  if (open) narrow.push({ status: { $in: FO_COMPLAINT_OPEN } })
  if (overdue) narrow.push(late)
  const filter = { ...scope, ...base, ...(narrow.length && { $and: narrow }) }
  const [rows, total, [board]] = await Promise.all([
    Complaint.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Complaint.countDocuments(filter),
    Complaint.aggregate([{ $match: { ...matchScope(scope), ...base } }, { $facet: {
      byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
      byCategory: [{ $match: { status: { $in: FO_COMPLAINT_OPEN } } }, { $group: { _id: '$category', n: { $sum: 1 } } }],
      late: [{ $match: late }, { $count: 'n' }],
      resolve: [{ $match: { resolvedAt: { $ne: null } } }, { $group: { _id: null, ms: { $avg: { $subtract: ['$resolvedAt', '$createdAt'] } } } }],
    } }]),
  ])
  const counts = Object.fromEntries(Object.keys(FO_COMPLAINT_STATUS).map((s) => [s, 0]))
  for (const x of board?.byStatus ?? []) counts[x._id] = x.n
  const byCategory = Object.fromEntries(FO_COMPLAINT_CATEGORIES.map((c) => [c.value, 0]))
  for (const x of board?.byCategory ?? []) byCategory[x._id] = x.n
  const ms = board?.resolve?.[0]?.ms
  const avgDays = ms != null ? Math.round((ms / 864e5) * 10) / 10 : null
  return {
    today, counts, overdue: board?.late?.[0]?.n ?? 0, byCategory, avgResolveDays: avgDays,
    rows: rows.map((c) => dto(c, today)), total, page, pageSize,
  }
}

export async function getComplaint(id, auth) {
  const c = isOid(id) ? await Complaint.findOne({ _id: id, ...(await campusFilter(auth)) }).lean() : null
  if (!c) throw notFound('Complaint')
  return dto(c, (await foNow()).date)
}

/** Raise one. Shared by the desk (staff) and the family app. */
async function raise(input, { by, auth, req, familyMobile }) {
  const { date } = await foNow()
  const settings = await getSettings('frontoffice')
  const sla = input.priority === 'URGENT' ? Math.min(1, Number(settings.complaintSlaDays) || 1) : Number(settings.complaintSlaDays) || 3
  const doc = {
    date, source: input.source, category: input.category, priority: input.priority || 'MEDIUM', subject: input.subject, description: input.description || undefined,
    complainant: { name: input.complainant?.name || undefined, mobile: input.complainant?.mobile || undefined, email: input.complainant?.email || undefined },
    familyMobile: familyMobile || undefined, dueOn: complaintDueOn(date, sla), status: 'OPEN', createdBy: by,
    branchId: auth?.user?.branchId || undefined,
    steps: [{ by, action: 'RAISED', status: 'OPEN', note: FO_COMPLAINT_SOURCE_LABEL[input.source] }],
  }
  if (input.source === 'STAFF' && input.complainantUserId) {
    const u = isOid(input.complainantUserId) ? await User.findById(input.complainantUserId).select('name mobile email').lean() : null
    if (u) doc.complainant = { name: u.name, mobile: u.mobile || undefined, email: u.email || undefined, userId: u._id }
  }
  if (input.studentId) {
    const s = isOid(input.studentId) ? await Student.findById(input.studentId).lean() : null
    if (!s) throw badRequest('Student not found.', { fields: { studentId: 'Not found' } })
    Object.assign(doc, { studentId: s._id, studentName: studentName(s), classLabel: await classOf(s.sectionId) ?? undefined, branchId: s.branchId || doc.branchId })
    if (!doc.complainant.name && ['PARENT', 'FAMILY_APP'].includes(input.source)) {
      const fc = familyContact(s)
      doc.complainant = { name: fc.name, mobile: fc.mobile || undefined, email: fc.email || undefined }
    }
  }
  if (!doc.complainant.name) throw badRequest('Who is complaining?', { fields: { 'complainant.name': 'Enter the name' } })
  if (input.assignedToId) {
    const u = isOid(input.assignedToId) ? await User.findOne({ _id: input.assignedToId, active: true }).select('name').lean() : null
    if (!u) throw badRequest('Pick a staff member to assign it to.', { fields: { assignedToId: 'Not found' } })
    Object.assign(doc, { assignedToId: u._id, assignedTo: u.name, status: 'IN_PROGRESS' })
    doc.steps.push({ by, action: 'ASSIGNED', status: 'IN_PROGRESS', note: u.name })
  }
  doc.complaintNo = await nextNumber('COMPLAINT', { branchId: doc.branchId })
  const c = await Complaint.create(doc)
  if (c.assignedToId && String(c.assignedToId) !== String(auth?.userId)) await tellAssignee(c)
  await tellComplainant('frontoffice.complaint_received', c)
  await audit({ action: 'CREATE', module: 'frontoffice', entityType: 'complaint', entityId: String(c._id), entityName: c.complaintNo, summary: `Complaint ${c.complaintNo} (${FO_COMPLAINT_SOURCE_LABEL[c.source]}): ${c.subject}` }, req)
  return c
}

/** A message to whoever complained: the family of the student, else the complainant's own number / email. */
async function tellComplainant(event, c) {
  const data = { complaint: { no: c.complaintNo, subject: c.subject, name: c.complainant?.name ?? '', dueDate: humanDate(c.dueOn), resolution: c.resolution ?? '' } }
  const entity = { type: 'complaint', id: c._id }
  if (c.studentId && ['PARENT', 'FAMILY_APP', 'STUDENT'].includes(c.source)) await emit(event, { studentId: String(c.studentId), data, entity })
  else if (c.complainant?.mobile || c.complainant?.email) await emit(event, { to: { mobile: c.complainant.mobile, email: c.complainant.email }, data, entity })
}

const tellAssignee = (c) => notifyUsers([c.assignedToId], {
  event: 'frontoffice.complaint_assigned', title: `Complaint ${c.complaintNo} assigned to you`, message: `${c.subject}${c.dueOn ? ` · due ${humanDate(c.dueOn)}` : ''}`,
  link: `/frontoffice/complaints?id=${c._id}`, tone: c.priority === 'URGENT' || c.priority === 'HIGH' ? 'warning' : 'info', entityType: 'complaint', entityId: String(c._id),
})

export async function raiseComplaint(input, auth, req) {
  const c = await raise(input, { by: actor(), auth, req })
  return dto(c.toObject(), (await foNow()).date)
}

async function loadFor(id, auth) {
  const c = isOid(id) ? await Complaint.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!c) throw notFound('Complaint')
  return c
}

export async function assignComplaint(id, { assignedToId, note }, auth, req) {
  const c = await loadFor(id, auth)
  if (!FO_COMPLAINT_OPEN.includes(c.status)) throw conflict(`Complaint ${c.complaintNo} is ${FO_COMPLAINT_STATUS[c.status].label.toLowerCase()}.`)
  const u = isOid(assignedToId) ? await User.findOne({ _id: assignedToId, active: true }).select('name').lean() : null
  if (!u) throw badRequest('Pick a staff member.', { fields: { assignedToId: 'Not found' } })
  Object.assign(c, { assignedToId: u._id, assignedTo: u.name, status: c.status === 'OPEN' ? 'IN_PROGRESS' : c.status })
  c.steps.push({ by: actor(), action: 'ASSIGNED', status: c.status, note: [u.name, note].filter(Boolean).join(' — ') })
  await c.save()
  if (String(u._id) !== String(auth.userId)) await tellAssignee(c)
  await audit({ action: 'UPDATE', module: 'frontoffice', entityType: 'complaint', entityId: String(c._id), entityName: c.complaintNo, summary: `Assigned complaint ${c.complaintNo} to ${u.name}` }, req)
  return dto(c.toObject(), (await foNow()).date)
}

/**
 * Move a complaint along: IN_PROGRESS, RESOLVED (needs what was done), CLOSED, or back to IN_PROGRESS from RESOLVED.
 * Allowed to anyone with "resolve", and to the person it is assigned to.
 */
export async function setComplaintStatus(id, { status, note, resolution }, auth, req) {
  const c = await loadFor(id, auth)
  if (!can(auth, 'frontoffice.complaints.resolve') && String(c.assignedToId) !== String(auth.userId)) throw forbidden('Only the person it is assigned to, or someone allowed to resolve complaints, can change this.')
  if (!(FO_COMPLAINT_FLOW[c.status] ?? []).includes(status)) throw conflict(`A ${FO_COMPLAINT_STATUS[c.status].label.toLowerCase()} complaint can’t be moved to ${FO_COMPLAINT_STATUS[status]?.label.toLowerCase() ?? status}.`)
  if (status === 'RESOLVED' && !(resolution ?? c.resolution)?.trim()) throw badRequest('Say how it was resolved — the family will be told.', { fields: { resolution: 'Say what was done' } })
  const reopened = c.status === 'RESOLVED' && status === 'IN_PROGRESS'
  c.status = status
  if (status === 'RESOLVED') Object.assign(c, { resolution: resolution?.trim() || c.resolution, resolvedAt: new Date(), resolvedBy: actor() })
  if (status === 'CLOSED') c.closedAt = new Date()
  if (reopened) Object.assign(c, { resolvedAt: undefined, resolvedBy: undefined })
  c.steps.push({ by: actor(), action: reopened ? 'REOPENED' : status === 'RESOLVED' ? 'RESOLVED' : status === 'CLOSED' ? 'CLOSED' : 'STATUS', status, note: status === 'RESOLVED' ? c.resolution : note || undefined })
  await c.save()
  if (status === 'RESOLVED') await tellComplainant('frontoffice.complaint_resolved', c)
  await audit({ action: 'UPDATE', module: 'frontoffice', entityType: 'complaint', entityId: String(c._id), entityName: c.complaintNo, summary: `Complaint ${c.complaintNo} → ${FO_COMPLAINT_STATUS[status].label}${note ? `: ${note}` : ''}` }, req)
  return dto(c.toObject(), (await foNow()).date)
}

export async function addComplaintNote(id, note, auth, req) {
  const c = await loadFor(id, auth)
  c.steps.push({ by: actor(), action: 'NOTE', note })
  await c.save()
  await audit({ action: 'UPDATE', module: 'frontoffice', entityType: 'complaint', entityId: String(c._id), entityName: c.complaintNo, summary: `Note on complaint ${c.complaintNo}` }, req)
  return dto(c.toObject(), (await foNow()).date)
}

// ───────────────────────────────────────────────────────── family app › Complaints

const FAMILY_SOURCES = ['PARENT', 'FAMILY_APP', 'STUDENT']
const familyDto = (c, today) => ({
  id: String(c._id), complaintNo: c.complaintNo, date: c.date, category: c.category, subject: c.subject, description: c.description ?? null,
  status: c.status, dueOn: c.dueOn ?? null, overdue: complaintOverdue(c, today), resolution: c.resolution ?? null, resolvedAt: c.resolvedAt ?? null,
  // what families see of the progress: when it moved, not who wrote internal notes
  steps: (c.steps ?? []).filter((s) => s.action !== 'NOTE').map((s) => ({ at: s.at, action: s.action, status: s.status ?? null })),
})

/** The child's complaints raised by the family (app, phone or at the desk). */
export async function familyComplaints(f, studentId) {
  need(f, 'COMPLAINTS')
  const s = studentFor(f, studentId)
  const { date } = await foNow()
  const rows = await Complaint.find({ studentId: s._id, source: { $in: FAMILY_SOURCES } }).sort({ createdAt: -1 }).limit(50).lean()
  return { categories: FO_COMPLAINT_CATEGORIES.map((c) => c.value), rows: rows.map((c) => familyDto(c, date)) }
}

export async function familyRaiseComplaint(f, studentId, input, req) {
  need(f, 'COMPLAINTS')
  const s = studentFor(f, studentId)
  const ten = mobile10(f.session.mobile)
  const g = (s.guardians ?? []).find((x) => mobile10(x.mobile) === ten)
  const student = f.session.kind === 'STUDENT'
  const c = await raise({
    source: student ? 'STUDENT' : 'FAMILY_APP', category: input.category, priority: 'MEDIUM', subject: input.subject, description: input.description,
    studentId: String(s._id), complainant: { name: student ? studentName(s) : g?.name || `Parent of ${s.firstName}`, mobile: f.session.mobile, email: g?.email },
  }, { by: student ? 'Student (family app)' : `${g?.name ?? 'Parent'} (family app)`, auth: null, req, familyMobile: ten })
  return familyDto(c.toObject(), (await foNow()).date)
}
