import {
  FO_GATE_PASS_STATUS, FO_VISIT_PURPOSE_BY, foMinutesBetween, foWeekStart, mobile10, sectionLabel,
} from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { GatePass, Visitor } from '../models/frontOffice.js'
import { Student, studentName } from '../models/students.js'
import { Branch, User } from '../models/tenant.js'
import { can, moduleEnabled, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { escapeRegex } from '../platform/validate.js'
import { hhmmIn, institutionNow, timeZoneOf } from '../platform/time.js'
import { createEnquiry } from './admissions.js'
import { humanDate, notifyUsers } from './notify.js'

// Front office › Visitor log and Gate passes. The desk checks visitors in and out (with a camera photo and a badge),
// and writes gate passes for students collected early: the class teacher or an admin approves, the gate hands the
// child over and the family is told. Complaints live in services/frontOfficeComplaints.js.

export const foNow = () => institutionNow()
const actor = () => getContext()?.userName
const idStr = (v) => (v ? String(v) : null)
const PHOTO_MAX = 400_000 // characters of a data URL (~300 KB) — the desk sends a small JPEG

/** Records on the caller's campus (data scope BRANCH), or all (ALL). Records with no campus belong to the main one. */
export async function campusFilter(auth) {
  if (scopeOf(auth, 'frontoffice') === 'ALL' || !auth?.user?.branchId) return {}
  const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
  return String(main) === String(auth.user.branchId) ? { branchId: { $in: [auth.user.branchId, null] } } : { branchId: auth.user.branchId }
}

function checkPhoto(photo) {
  if (!photo) return undefined
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo)) throw badRequest('The photo should be a JPEG, PNG or WebP image.', { fields: { photo: 'Not an image' } })
  if (photo.length > PHOTO_MAX) throw badRequest('The photo is too large — take it again.', { fields: { photo: 'Too large' } })
  return photo
}

async function placeLabels(sectionIds) {
  const secs = await Section.find({ _id: { $in: sectionIds.filter(Boolean) } }).select('name classId classTeacherId').lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: secs.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return new Map(secs.map((s) => [String(s._id), { label: sectionLabel(classes.get(String(s.classId)), s, { short: true }), classTeacherId: idStr(s.classTeacherId) }]))
}

// ───────────────────────────────────────────────────────── pickers

/** Staff to pick as "whom to meet" / "assign to": active users by name. */
export async function staffOptions(search) {
  const filter = { active: true }
  if (search?.trim()) filter.name = new RegExp(escapeRegex(search.trim()), 'i')
  const rows = await User.find(filter).select('name designation').sort({ name: 1 }).limit(search ? 25 : 500).lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null }))
}

/** Students for a gate pass or a complaint: name / admission no., with class and guardians on record. */
export async function findStudents(search, auth) {
  const s = String(search ?? '').trim()
  if (s.length < 2) return []
  const re = new RegExp(escapeRegex(s), 'i')
  const rows = await Student.find({ status: 'ACTIVE', ...(await campusFilter(auth)), $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] })
    .select('firstName middleName lastName admissionNo sectionId classId guardians gender').sort({ firstName: 1 }).limit(15).lean()
  const places = await placeLabels(rows.map((r) => r.sectionId))
  return rows.map((r) => ({
    id: String(r._id), name: studentName(r), admissionNo: r.admissionNo, gender: r.gender ?? null,
    classShort: places.get(idStr(r.sectionId))?.label ?? null,
    guardians: (r.guardians ?? []).map((g) => ({ id: String(g._id), name: g.name, relation: g.relation ?? null, mobile: g.mobile ?? null, isPrimary: !!g.isPrimary })),
  }))
}

// ───────────────────────────────────────────────────────── visitor log

const visitorDto = (v, now = new Date()) => ({
  id: String(v._id), date: v.date, name: v.name, mobile: v.mobile ?? null, purpose: v.purpose, purposeNote: v.purposeNote ?? null,
  from: v.from ?? null, people: v.people ?? 1, hostId: idStr(v.hostId), hostName: v.hostName ?? null,
  studentId: idStr(v.studentId), studentName: v.studentName ?? null, idType: v.idType ?? null, idNumber: v.idNumber ?? null,
  badgeNo: v.badgeNo ?? null, vehicleNo: v.vehicleNo ?? null, note: v.note ?? null, hasPhoto: !!v.hasPhoto, photo: v.photo ?? undefined,
  inAt: v.inAt, outAt: v.outAt ?? null, inside: !v.outAt, minutes: foMinutesBetween(v.inAt, v.outAt ?? now),
  checkedInBy: v.checkedInBy ?? null, checkedOutBy: v.checkedOutBy ?? null, enquiryId: idStr(v.enquiryId), enquiryNo: v.enquiryNo ?? null,
})

/** The desk: who is in the building now (with photos), today's and this week's numbers, today's log. */
export async function visitorDesk(auth) {
  const { date } = await foNow()
  const scope = await campusFilter(auth)
  const week = foWeekStart(date)
  const [inside, todayRows, weekCount] = await Promise.all([
    Visitor.find({ ...scope, outAt: null }).select('+photo').sort({ inAt: 1 }).limit(300).lean(),
    Visitor.find({ ...scope, date }).sort({ inAt: -1 }).limit(500).lean(),
    Visitor.countDocuments({ ...scope, date: { $gte: week, $lte: date } }),
  ])
  const byPurpose = Object.fromEntries(Object.keys(FO_VISIT_PURPOSE_BY).map((p) => [p, 0]))
  for (const v of todayRows) byPurpose[v.purpose] = (byPurpose[v.purpose] ?? 0) + 1
  // arrivals by hour of the institution's clock (the desk's busy hours)
  const tz = await timeZoneOf()
  const hours = {}
  for (const v of todayRows) {
    const h = hhmmIn(v.inAt, tz).slice(0, 2)
    hours[h] = (hours[h] ?? 0) + 1
  }
  const byHour = Object.keys(hours).sort().map((h) => ({ hour: h, count: hours[h] }))
  const done = todayRows.filter((v) => v.outAt)
  return {
    date, weekStart: week,
    stats: {
      today: todayRows.length, inside: inside.length, out: done.length, week: weekCount,
      avgMinutes: done.length ? Math.round(done.reduce((n, v) => n + foMinutesBetween(v.inAt, v.outAt), 0) / done.length) : 0,
      byPurpose, byHour,
    },
    inside: inside.map((v) => visitorDto(v)),
    today: todayRows.map((v) => visitorDto(v)),
  }
}

/** The log for a date range (default today), newest first. */
export async function listVisitors({ from, to, purpose, status, search } = {}, auth) {
  const { date } = await foNow()
  const filter = { ...(await campusFilter(auth)), date: { $gte: from || date, $lte: to || from || date } }
  if (purpose) filter.purpose = purpose
  if (status === 'IN') filter.outAt = null
  if (status === 'OUT') filter.outAt = { $ne: null }
  if (search?.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i')
    filter.$or = [{ name: re }, { mobile: re }, { badgeNo: re }, { hostName: re }, { from: re }]
  }
  const rows = await Visitor.find(filter).sort({ inAt: -1 }).limit(1000).lean()
  return rows.map((v) => visitorDto(v))
}

export async function getVisitor(id, auth) {
  const v = isOid(id) ? await Visitor.findOne({ _id: id, ...(await campusFilter(auth)) }).select('+photo').lean() : null
  if (!v) throw notFound('Visitor')
  return visitorDto(v)
}

/** A returning visitor: the last visit on this mobile number, to fill the form. */
export async function visitorByMobile(mobile) {
  const ten = mobile10(mobile)
  if (!ten) return null
  const last = await Visitor.findOne({ mobile: new RegExp(`${ten}$`) }).sort({ inAt: -1 }).lean()
  if (!last) return null
  const visits = await Visitor.countDocuments({ mobile: last.mobile })
  return { name: last.name, from: last.from ?? null, idType: last.idType ?? null, idNumber: last.idNumber ?? null, visits, lastDate: last.date }
}

export async function checkInVisitor(input, auth, req) {
  const { date } = await foNow()
  const photo = checkPhoto(input.photo)
  let host = null
  if (input.hostId) {
    host = await User.findOne({ _id: input.hostId, active: true }).select('name').lean()
    if (!host) throw badRequest('Pick a staff member from the list.', { fields: { hostId: 'Not found' } })
  }
  if (input.purpose === 'MEET_STAFF' && !host && !input.hostName) throw badRequest('Whom is the visitor here to meet?', { fields: { hostId: 'Pick the staff member' } })
  let student = null
  if (input.studentId) {
    student = await Student.findById(input.studentId).select('firstName middleName lastName').lean()
    if (!student) throw badRequest('Student not found.', { fields: { studentId: 'Not found' } })
  }
  const branchId = auth?.user?.branchId || undefined
  let badgeNo = input.badgeNo?.trim()
  if (!badgeNo) badgeNo = `V-${(await Visitor.countDocuments({ date, ...(branchId ? { branchId } : {}) })) + 1}`
  else if (await Visitor.exists({ badgeNo, outAt: null })) throw conflict(`Badge ${badgeNo} is still with a visitor who hasn’t checked out.`, { fields: { badgeNo: 'In use' } })
  const v = await Visitor.create({
    date, branchId, name: input.name, mobile: input.mobile || undefined, purpose: input.purpose, purposeNote: input.purposeNote || undefined,
    from: input.from || undefined, people: input.people ?? 1,
    hostId: host?._id, hostName: host?.name ?? input.hostName ?? undefined,
    studentId: student?._id, studentName: student ? studentName(student) : undefined,
    idType: input.idType || undefined, idNumber: input.idNumber || undefined, photo, hasPhoto: !!photo,
    badgeNo, vehicleNo: input.vehicleNo || undefined, note: input.note || undefined, inAt: new Date(), checkedInBy: actor(),
  })
  if (host) {
    await notifyUsers([host._id], {
      event: 'frontoffice.visitor', title: `${v.name} is at the front desk`, message: `${FO_VISIT_PURPOSE_BY[v.purpose]?.label ?? v.purpose}${v.from ? ` · ${v.from}` : ''} · badge ${badgeNo}`,
      link: '/frontoffice/visitors', tone: 'info', entityType: 'visitor', entityId: String(v._id),
    })
  }
  await audit({ action: 'CREATE', module: 'frontoffice', entityType: 'visitor', entityId: String(v._id), entityName: v.name, summary: `Checked in ${v.name} (${FO_VISIT_PURPOSE_BY[v.purpose]?.label ?? v.purpose}), badge ${badgeNo}` }, req)
  return visitorDto(v.toObject())
}

export async function checkOutVisitor(id, auth, req) {
  const v = isOid(id) ? await Visitor.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!v) throw notFound('Visitor')
  if (v.outAt) throw conflict(`${v.name} has already checked out.`)
  v.outAt = new Date()
  v.checkedOutBy = actor()
  await v.save()
  await audit({ action: 'UPDATE', module: 'frontoffice', entityType: 'visitor', entityId: String(v._id), entityName: v.name, summary: `Checked out ${v.name} (badge ${v.badgeNo ?? '—'})` }, req)
  return visitorDto(v.toObject())
}

/**
 * A walk-in admission enquiry: make an enquiry in Admissions from the visit (the visitor is the parent). Needs the
 * Admissions module and the right to add enquiries.
 */
export async function enquiryFromVisit(id, input, auth, req) {
  if (!moduleEnabled(auth, 'admissions')) throw badRequest('Admissions isn’t switched on for your institution.')
  if (!can(auth, 'admissions.enquiries.create')) throw forbidden('Your role doesn’t allow adding admission enquiries.')
  const v = isOid(id) ? await Visitor.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!v) throw notFound('Visitor')
  if (v.enquiryId) throw conflict(`Enquiry ${v.enquiryNo} was already made from this visit.`)
  if (!v.mobile) throw badRequest('Add the visitor’s mobile number first — the enquiry needs it.')
  const e = await createEnquiry({
    childName: input.childName, parentName: v.name, mobile: v.mobile, classId: input.classId || undefined, dob: input.dob || undefined,
    source: 'WALK_IN', note: input.note || `Walk-in at the front desk (badge ${v.badgeNo ?? '—'}).`, branchId: v.branchId ? String(v.branchId) : undefined,
  }, auth, req)
  v.enquiryId = e.id
  v.enquiryNo = e.enquiryNo
  await v.save()
  return { visitor: visitorDto(v.toObject()), enquiry: { id: e.id, enquiryNo: e.enquiryNo } }
}

// ───────────────────────────────────────────────────────── gate passes

const passDto = (p, places) => ({
  id: String(p._id), passNo: p.passNo, kind: p.kind, date: p.date,
  studentId: idStr(p.studentId), studentName: p.studentName ?? null, admissionNo: p.admissionNo ?? null, sectionId: idStr(p.sectionId), classLabel: p.classLabel ?? null,
  staffId: idStr(p.staffId), staffName: p.staffName ?? null,
  collector: p.collector ? { type: p.collector.type, name: p.collector.name ?? null, relation: p.collector.relation ?? null, mobile: p.collector.mobile ?? null, idNumber: p.collector.idNumber ?? null, photo: p.collector.photo ?? null } : null,
  reason: p.reason, leaveAt: p.leaveAt ?? null, returnBy: p.returnBy ?? null, status: p.status,
  requestedBy: p.requestedBy ?? null, approvedBy: p.approvedBy ?? null, approvedAt: p.approvedAt ?? null, decisionNote: p.decisionNote ?? null,
  leftAt: p.leftAt ?? null, leftBy: p.leftBy ?? null, returnedAt: p.returnedAt ?? null, cancelledReason: p.cancelledReason ?? null, createdAt: p.createdAt,
  classTeacherId: places?.get(idStr(p.sectionId))?.classTeacherId ?? null,
})

/** May this user approve the pass? The approve permission, or the student's class teacher. */
async function mayApprove(p, auth) {
  if (can(auth, 'frontoffice.gate-pass.approve')) return true
  if (p.kind !== 'STUDENT' || !p.sectionId) return false
  const sec = await Section.findById(p.sectionId).select('classTeacherId').lean()
  return !!sec?.classTeacherId && String(sec.classTeacherId) === String(auth.userId)
}

/** Passes of a day (default today) with counts by status. `mine`: those waiting for this user (class teacher). */
export async function listPasses({ date, status, kind, search, mine } = {}, auth) {
  const t = (await foNow()).date
  const filter = { ...(await campusFilter(auth)), date: date || t }
  if (kind) filter.kind = kind
  if (search?.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i')
    filter.$or = [{ studentName: re }, { staffName: re }, { passNo: re }, { admissionNo: re }, { 'collector.name': re }]
  }
  if (mine) {
    const secs = await Section.find({ classTeacherId: auth.userId }).select('_id').lean()
    filter.status = 'REQUESTED'
    if (!can(auth, 'frontoffice.gate-pass.approve')) filter.sectionId = { $in: secs.map((s) => s._id) }
    delete filter.date
  }
  const all = await GatePass.find(filter).sort({ createdAt: -1 }).limit(500).lean()
  const counts = Object.fromEntries(Object.keys(FO_GATE_PASS_STATUS).map((s) => [s, 0]))
  for (const p of all) counts[p.status] = (counts[p.status] ?? 0) + 1
  const rows = status ? all.filter((p) => p.status === status) : all
  const places = await placeLabels(rows.map((p) => p.sectionId))
  const settings = await getSettings('frontoffice')
  return { date: filter.date ?? t, counts, needsApproval: settings.gatePassApproval !== false, rows: rows.map((p) => passDto(p, places)) }
}

export async function getPass(id, auth) {
  const p = isOid(id) ? await GatePass.findOne({ _id: id, ...(await campusFilter(auth)) }).lean() : null
  if (!p) throw notFound('Gate pass')
  return passDto(p, await placeLabels([p.sectionId]))
}

export async function createPass(input, auth, req) {
  const { date } = await foNow()
  const settings = await getSettings('frontoffice')
  const doc = { kind: input.kind, date, reason: input.reason, leaveAt: input.leaveAt || undefined, returnBy: input.returnBy || undefined, requestedBy: actor(), requestedById: auth.userId }
  let classTeacherId = null
  if (input.kind === 'STUDENT') {
    const s = isOid(input.studentId) ? await Student.findOne({ _id: input.studentId, status: 'ACTIVE' }).lean() : null
    if (!s) throw badRequest('Pick the student.', { fields: { studentId: 'Pick the student' } })
    if (await GatePass.exists({ studentId: s._id, date, status: { $in: ['REQUESTED', 'APPROVED'] } })) throw conflict(`${studentName(s)} already has a gate pass waiting today.`)
    const place = (await placeLabels([s.sectionId])).get(idStr(s.sectionId))
    classTeacherId = place?.classTeacherId ?? null
    const c = input.collector ?? {}
    let collector
    if (c.type === 'GUARDIAN') {
      const g = (s.guardians ?? []).find((x) => String(x._id) === String(c.guardianId))
      if (!g) throw badRequest('Pick the guardian collecting the student.', { fields: { 'collector.guardianId': 'Pick a guardian on record' } })
      collector = { type: 'GUARDIAN', guardianId: g._id, name: g.name, relation: g.relation, mobile: g.mobile, idNumber: c.idNumber || undefined, photo: checkPhoto(c.photo) }
    } else {
      if (!c.name?.trim() || !c.relation?.trim()) throw badRequest('Who is collecting the student, and how are they related?', { fields: { 'collector.name': c.name?.trim() ? undefined : 'Enter the name', 'collector.relation': c.relation?.trim() ? undefined : 'Enter the relation' } })
      collector = { type: 'OTHER', name: c.name.trim(), relation: c.relation.trim(), mobile: c.mobile || undefined, idNumber: c.idNumber || undefined, photo: checkPhoto(c.photo) }
    }
    Object.assign(doc, { studentId: s._id, studentName: studentName(s), admissionNo: s.admissionNo, sectionId: s.sectionId, classLabel: place?.label, collector, branchId: s.branchId || auth?.user?.branchId || undefined })
  } else {
    const u = isOid(input.staffId) ? await User.findOne({ _id: input.staffId, active: true }).select('name branchId').lean() : null
    if (!u) throw badRequest('Pick the staff member.', { fields: { staffId: 'Pick the staff member' } })
    Object.assign(doc, { staffId: u._id, staffName: u.name, branchId: u.branchId || auth?.user?.branchId || undefined })
  }
  // approved at once when the institution doesn't ask for approval, or when an approver writes it and says so
  const autoApprove = settings.gatePassApproval === false || (input.approveNow && can(auth, 'frontoffice.gate-pass.approve'))
  if (autoApprove) Object.assign(doc, { status: 'APPROVED', approvedBy: actor(), approvedById: auth.userId, approvedAt: new Date() })
  doc.passNo = await nextNumber('GATE_PASS', { branchId: doc.branchId })
  const p = await GatePass.create(doc)
  const who = p.studentName ?? p.staffName
  if (!autoApprove && classTeacherId && classTeacherId !== String(auth.userId)) {
    await notifyUsers([classTeacherId], {
      event: 'frontoffice.gate_pass_request', title: `Gate pass to approve: ${who}`, message: `${p.reason}${p.collector ? ` · collected by ${p.collector.name} (${p.collector.relation ?? '—'})` : ''}`,
      link: `/frontoffice/gate-pass?id=${p._id}`, tone: 'warning', entityType: 'gate_pass', entityId: String(p._id),
    })
  }
  await audit({ action: 'CREATE', module: 'frontoffice', entityType: 'gate_pass', entityId: String(p._id), entityName: p.passNo, summary: `Gate pass ${p.passNo} for ${who}: ${p.reason}${autoApprove ? ' (approved)' : ''}` }, req)
  return getPass(p._id, auth)
}

export async function decidePass(id, { approve, note }, auth, req) {
  const p = isOid(id) ? await GatePass.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!p) throw notFound('Gate pass')
  if (p.status !== 'REQUESTED') throw conflict(`Gate pass ${p.passNo} is ${FO_GATE_PASS_STATUS[p.status]?.label.toLowerCase() ?? p.status} — nothing to decide.`)
  if (!(await mayApprove(p, auth))) throw forbidden('Only the class teacher or someone allowed to approve gate passes can decide this.')
  Object.assign(p, { status: approve ? 'APPROVED' : 'REJECTED', approvedBy: actor(), approvedById: auth.userId, approvedAt: new Date(), decisionNote: note || undefined })
  await p.save()
  if (p.requestedById && String(p.requestedById) !== String(auth.userId)) {
    await notifyUsers([p.requestedById], {
      event: 'frontoffice.gate_pass_decided', title: `Gate pass ${approve ? 'approved' : 'not approved'}: ${p.studentName ?? p.staffName}`, message: note || p.reason,
      link: `/frontoffice/gate-pass?id=${p._id}`, tone: approve ? 'success' : 'danger', entityType: 'gate_pass', entityId: String(p._id),
    })
  }
  await audit({ action: approve ? 'APPROVE' : 'REJECT', module: 'frontoffice', entityType: 'gate_pass', entityId: String(p._id), entityName: p.passNo, summary: `${approve ? 'Approved' : 'Did not approve'} gate pass ${p.passNo} (${p.studentName ?? p.staffName})${note ? `: ${note}` : ''}` }, req)
  return getPass(p._id, auth)
}

/**
 * At the gate: the student is handed over (or the staff member steps out). For a student the family is told at once
 * (event `frontoffice.gate_pass`). Today's attendance is not changed here — the record shows the time they left.
 */
export async function markLeft(id, auth, req) {
  const p = isOid(id) ? await GatePass.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!p) throw notFound('Gate pass')
  if (p.status !== 'APPROVED') throw conflict(p.status === 'REQUESTED' ? `Gate pass ${p.passNo} hasn’t been approved yet.` : `Gate pass ${p.passNo} is ${FO_GATE_PASS_STATUS[p.status]?.label.toLowerCase() ?? p.status}.`)
  const { time } = await foNow()
  Object.assign(p, { status: 'LEFT', leftAt: new Date(), leftBy: actor() })
  await p.save()
  if (p.kind === 'STUDENT' && p.studentId) {
    await emit('frontoffice.gate_pass', {
      studentId: String(p.studentId), entity: { type: 'gate_pass', id: p._id },
      data: { student: { class: p.classLabel ?? '' }, gatepass: { no: p.passNo, time: `${humanDate(p.date)}, ${time}`, collector: p.collector?.name ?? '', relation: p.collector?.relation ?? '', reason: p.reason } },
    })
  }
  await audit({ action: 'UPDATE', module: 'frontoffice', entityType: 'gate_pass', entityId: String(p._id), entityName: p.passNo, summary: `${p.studentName ?? p.staffName} left at ${time} on gate pass ${p.passNo}${p.collector ? ` with ${p.collector.name}` : ''}` }, req)
  return getPass(p._id, auth)
}

/** A staff member back from a short absence. */
export async function markReturned(id, auth, req) {
  const p = isOid(id) ? await GatePass.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!p) throw notFound('Gate pass')
  if (p.kind !== 'STAFF' || p.status !== 'LEFT') throw conflict('Only a staff member who has gone out can be marked back.')
  Object.assign(p, { status: 'RETURNED', returnedAt: new Date() })
  await p.save()
  await audit({ action: 'UPDATE', module: 'frontoffice', entityType: 'gate_pass', entityId: String(p._id), entityName: p.passNo, summary: `${p.staffName} back in school (gate pass ${p.passNo})` }, req)
  return getPass(p._id, auth)
}

export async function cancelPass(id, reason, auth, req) {
  const p = isOid(id) ? await GatePass.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!p) throw notFound('Gate pass')
  if (!['REQUESTED', 'APPROVED'].includes(p.status)) throw conflict(`Gate pass ${p.passNo} can no longer be cancelled.`)
  Object.assign(p, { status: 'CANCELLED', cancelledReason: reason || undefined })
  await p.save()
  await audit({ action: 'CANCEL', module: 'frontoffice', entityType: 'gate_pass', entityId: String(p._id), entityName: p.passNo, summary: `Cancelled gate pass ${p.passNo}${reason ? `: ${reason}` : ''}` }, req)
  return getPass(p._id, auth)
}

/** A student's earlier passes (how often they leave early) — shown when writing a new one. */
export async function studentPassHistory(studentId) {
  if (!isOid(studentId)) return []
  const rows = await GatePass.find({ studentId }).sort({ createdAt: -1 }).limit(10).lean()
  return rows.map((p) => ({ id: String(p._id), passNo: p.passNo, date: p.date, reason: p.reason, status: p.status, collector: p.collector?.name ?? null }))
}

