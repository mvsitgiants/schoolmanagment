import { HEALTH_SENSITIVE, INCIDENT_SEVERITY, VISIT_CLOSE, VISIT_IN_ROOM, bmi, sectionLabel } from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { HealthIncident, HealthRecord, SickVisit } from '../models/health.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { can, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { hhmmIn, institutionNow, timeZoneOf } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'
import { need, studentFor } from './portal.js'

// Health & infirmary (module `health`): a health record per student — blood group, growth (height / weight → BMI),
// allergies, vaccinations, the family doctor, and the sensitive part (conditions, medicines, emergency notes) that only
// `health.records.view_sensitive` reads or changes; sick-room visits (a student or a staff member: complaint, vitals,
// what was given, how it ended — "sent home" tells the guardian) with a board of who is in the sick room now; and
// incident reports (where, when, what happened, first aid, witnesses, severity, guardian told, follow-up, resolved).

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const words = (code) => String(code ?? '').toLowerCase().replace(/_/g, ' ')
export const seesSensitive = (auth) => can(auth, 'health.records.view_sensitive')

/** Campus scope: someone on one campus sees its students and visits (and those on no campus). */
function siteFilter(auth) {
  if (!auth || scopeOf(auth, 'health') === 'ALL' || !auth.user?.branchId) return {}
  return { branchId: { $in: [oid(auth.user.branchId), null] } }
}

async function studentInScope(studentId, auth, select = 'firstName middleName lastName admissionNo sectionId branchId bloodGroup status gender dob guardians') {
  const s = isOid(studentId) ? await Student.findOne({ _id: studentId, ...siteFilter(auth) }).select(select).lean() : null
  if (!s) throw notFound('Student')
  return s
}

async function classLabels(sectionIds) {
  const sections = await Section.find({ _id: { $in: [...new Set(sectionIds.filter(Boolean).map(String))] } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), { label: sectionLabel(cls.get(String(s.classId)), s, { short: true }), classCode: cls.get(String(s.classId))?.code ?? null }]))
}

async function studentLabels(ids) {
  const students = await Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo sectionId gender guardians').lean()
  const sec = await classLabels(students.map((s) => s.sectionId))
  return new Map(students.map((s) => {
    const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
    const c = sec.get(String(s.sectionId))
    return [String(s._id), { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, className: c?.label ?? '', classCode: c?.classCode ?? null, gender: s.gender ?? null, guardian: g?.name ?? null, mobile: g?.mobile ?? null }]
  }))
}

/** Students matching every word of a search (name parts or admission no.), so "asha rao" finds Asha Rao. */
function studentMatch(q) {
  const words = String(q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5)
  if (!words.length) return null
  return { $and: words.map((w) => { const re = new RegExp(escapeRegex(w), 'i'); return { $or: [{ firstName: re }, { middleName: re }, { lastName: re }, { admissionNo: re }] } }) }
}

/** A visit / incident search on the server: the student's name or admission no., the staff name, or `also` fields. */
async function personSearch(q, also = []) {
  const re = new RegExp(escapeRegex(q), 'i')
  const ids = (await Student.find(studentMatch(q)).select('_id').lean()).map((s) => s._id)
  return { $or: [{ studentId: { $in: ids } }, { staffName: re }, ...also.map((k) => ({ [k]: re }))] }
}

const latest = (r) => [...(r?.measurements ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null

/** A record as the caller may see it: without the sensitive part unless they hold view_sensitive. */
function recordOut(r, student, sensitive) {
  const m = latest(r)
  const out = {
    id: r?._id ? String(r._id) : null, studentId: String(student._id),
    bloodGroup: r?.bloodGroup ?? student.bloodGroup ?? null,
    measurements: [...(r?.measurements ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ ...x, bmi: bmi(x.heightCm, x.weightKg) })),
    latest: m ? { ...m, bmi: bmi(m.heightCm, m.weightKg) } : null,
    allergies: r?.allergies ?? [],
    vaccinations: (r?.vaccinations ?? []).map((v) => ({ id: idStr(v._id), name: v.name, date: v.date ?? null, dose: v.dose ?? null, note: v.note ?? null })).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))),
    doctor: r?.doctor?.name || r?.doctor?.phone ? { name: r.doctor.name ?? null, phone: r.doctor.phone ?? null, hospital: r.doctor.hospital ?? null } : null,
    updatedAt: r?.updatedAt ?? null, updatedBy: r?.updatedBy ?? null,
    sensitive: sensitive,
    hasSensitive: !!(r?.conditions?.length || r?.medications?.length || r?.emergencyNotes),
  }
  if (sensitive) Object.assign(out, { conditions: r?.conditions ?? [], medications: r?.medications ?? [], emergencyNotes: r?.emergencyNotes ?? null })
  return out
}

// ───────────────────────────────────────────────────────── records

/**
 * Students with their health at a glance (blood group, allergies, BMI, vaccinations), for the records list; `filter`
 * narrows to those with allergies, with no record yet, or (sensitive) with a condition. One page of the list (search runs on
 * the server across all of them), plus counts for the tiles over every student in scope.
 */
export async function listRecords({ search, sectionId, filter, page = 1, pageSize = 50 }, auth) {
  const sensitive = seesSensitive(auth)
  const f = { status: 'ACTIVE', ...siteFilter(auth) }
  if (isOid(sectionId)) f.sectionId = oid(sectionId)
  const q = String(search ?? '').trim()
  if (q) Object.assign(f, studentMatch(q))
  const recFilter = filter === 'ALLERGIES' ? { 'allergies.0': { $exists: true } } : filter === 'CONDITIONS' && sensitive ? { 'conditions.0': { $exists: true } } : null
  if (recFilter) f._id = { $in: (await HealthRecord.find(recFilter).select('studentId').lean()).map((r) => r.studentId) }
  if (filter === 'NO_RECORD') f._id = { $nin: (await HealthRecord.find({}).select('studentId').lean()).map((r) => r.studentId) }
  const [students, total] = await Promise.all([
    Student.find(f).select('firstName middleName lastName admissionNo sectionId bloodGroup gender').sort({ firstName: 1, lastName: 1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Student.countDocuments(f),
  ])
  const [records, sec] = await Promise.all([HealthRecord.find({ studentId: { $in: students.map((s) => s._id) } }).lean(), classLabels(students.map((s) => s.sectionId))])
  const byStudent = new Map(records.map((r) => [String(r.studentId), r]))
  const rows = students.map((s) => {
    const r = byStudent.get(String(s._id))
    const m = latest(r)
    const c = sec.get(String(s.sectionId))
    return {
      id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, className: c?.label ?? '', classCode: c?.classCode ?? null, gender: s.gender ?? null,
      hasRecord: !!r, bloodGroup: r?.bloodGroup ?? s.bloodGroup ?? null, allergies: r?.allergies ?? [], vaccinations: r?.vaccinations?.length ?? 0,
      heightCm: m?.heightCm ?? null, weightKg: m?.weightKg ?? null, bmi: m ? bmi(m.heightCm, m.weightKg) : null, measuredOn: m?.date ?? null,
      ...(sensitive && { conditions: r?.conditions ?? [] }), updatedAt: r?.updatedAt ?? null,
    }
  })
  // the tiles count the whole scope, not just this page of the list
  const scope = { status: 'ACTIVE', ...siteFilter(auth) }
  const scopeIds = (await Student.find(scope).select('_id').lean()).map((s) => s._id)
  const all = await HealthRecord.find({ studentId: { $in: scopeIds } }).select('bloodGroup allergies conditions').lean()
  const blood = {}
  for (const r of all) if (r.bloodGroup) blood[r.bloodGroup] = (blood[r.bloodGroup] ?? 0) + 1
  return {
    rows, total, page, pageSize, sensitive,
    counts: {
      students: scopeIds.length, withRecord: all.length, withAllergies: all.filter((r) => r.allergies?.length).length,
      ...(sensitive && { withConditions: all.filter((r) => r.conditions?.length).length }), bloodGroups: blood,
    },
  }
}

export async function getRecord(studentId, auth) {
  const s = await studentInScope(studentId, auth)
  const r = await HealthRecord.findOne({ studentId: s._id }).lean()
  const [visits, incidents, sec] = await Promise.all([
    SickVisit.find({ studentId: s._id }).sort({ inAt: -1 }).limit(10).lean(),
    HealthIncident.find({ studentId: s._id }).sort({ date: -1 }).limit(5).lean(),
    classLabels([s.sectionId]),
  ])
  const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
  return {
    student: { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, className: sec.get(String(s.sectionId))?.label ?? '', gender: s.gender ?? null, dob: s.dob ?? null, guardian: g?.name ?? null, relation: g?.relation ?? null, mobile: g?.mobile ?? null },
    record: recordOut(r, s, seesSensitive(auth)),
    visits: visits.map((v) => ({ id: String(v._id), date: v.date, inAt: v.inAt, complaint: v.complaint, outcome: v.outcome, treatment: v.treatment ?? null, tempC: v.vitals?.tempC ?? null })),
    incidents: incidents.map((i) => ({ id: String(i._id), date: i.date, kind: i.kind, severity: i.severity, status: i.status, place: i.place ?? null })),
  }
}

/** What the sick room needs to know at once about a student: allergies, blood group (and conditions, if allowed). */
export async function healthBrief(studentId, auth) {
  const s = await studentInScope(studentId, auth)
  const r = await HealthRecord.findOne({ studentId: s._id }).lean()
  const sensitive = seesSensitive(auth)
  const visits30 = await SickVisit.countDocuments({ studentId: s._id, date: { $gte: addDays(await today(), -30) } })
  return {
    studentId: String(s._id), bloodGroup: r?.bloodGroup ?? s.bloodGroup ?? null, allergies: r?.allergies ?? [], visits30,
    ...(sensitive && { conditions: r?.conditions ?? [], medications: r?.medications ?? [] }),
  }
}

export async function saveRecord(studentId, input, auth, req) {
  const s = await studentInScope(studentId, auth)
  const sensitive = seesSensitive(auth)
  const r = (await HealthRecord.findOne({ studentId: s._id })) ?? new HealthRecord({ studentId: s._id, branchId: s.branchId })
  const changed = []
  for (const k of ['bloodGroup', 'allergies', 'vaccinations', 'doctor']) if (input[k] !== undefined) { r[k] = input[k] ?? undefined; changed.push(k) }
  if (sensitive) for (const k of HEALTH_SENSITIVE) if (input[k] !== undefined) { r[k] = input[k] ?? undefined; changed.push(k) }
  if (input.measurement) {
    const m = { ...input.measurement, date: input.measurement.date || await today(), by: auth.user?.name }
    r.measurements = [...(r.measurements ?? []).filter((x) => x.date !== m.date), m]
    changed.push('measurement')
  }
  r.updatedBy = auth.user?.name
  await r.save()
  // the student's own record keeps the blood group (ID cards, the profile)
  if (input.bloodGroup !== undefined && (input.bloodGroup ?? null) !== (s.bloodGroup ?? null)) await Student.updateOne({ _id: s._id }, input.bloodGroup ? { $set: { bloodGroup: input.bloodGroup } } : { $unset: { bloodGroup: 1 } })
  await audit({ action: 'UPDATE', module: 'health', entityType: 'health_record', entityId: String(r._id), entityName: studentName(s), studentId: s._id, summary: `Health record of ${studentName(s)}: ${changed.join(', ') || 'no change'}` }, req)
  return getRecord(String(s._id), auth)
}

export async function deleteMeasurement(studentId, date, auth, req) {
  const s = await studentInScope(studentId, auth)
  const r = await HealthRecord.findOne({ studentId: s._id })
  if (!r) throw notFound('Health record')
  r.measurements = (r.measurements ?? []).filter((x) => x.date !== date)
  await r.save()
  await audit({ action: 'UPDATE', module: 'health', entityType: 'health_record', entityId: String(r._id), entityName: studentName(s), studentId: s._id, summary: `Removed the ${date} height / weight of ${studentName(s)}` }, req)
  return getRecord(String(s._id), auth)
}

// ───────────────────────────────────────────────────────── people (student or staff)

async function personFor(input, auth) {
  if (input.personType === 'STAFF') {
    const u = isOid(input.staffUserId) ? await User.findById(input.staffUserId).select('name branchId').lean() : null
    if (!u && !input.staffName) throw fieldsError({ staffUserId: 'Pick a staff member, or type the name' })
    return { personType: 'STAFF', staffUserId: u?._id, staffName: u?.name ?? input.staffName, branchId: u?.branchId ?? auth.user?.branchId, name: u?.name ?? input.staffName }
  }
  const s = isOid(input.studentId) ? await Student.findOne({ _id: input.studentId, status: 'ACTIVE', ...siteFilter(auth) }).select('firstName middleName lastName branchId sectionId').lean() : null
  if (!s) throw fieldsError({ studentId: 'Pick a current student' })
  return { personType: 'STUDENT', studentId: s._id, branchId: s.branchId ?? auth.user?.branchId, name: studentName(s), student: s }
}

async function withPeople(rows) {
  const labels = await studentLabels(rows.filter((r) => r.studentId).map((r) => r.studentId))
  return (r) => ({
    person: r.personType === 'STAFF' ? { kind: 'STAFF', name: r.staffName ?? '', id: idStr(r.staffUserId) } : { kind: 'STUDENT', ...(labels.get(String(r.studentId)) ?? { name: '' }) },
  })
}

async function classOf(s) {
  if (!s?.sectionId) return ''
  return (await classLabels([s.sectionId])).get(String(s.sectionId))?.label ?? ''
}

// ───────────────────────────────────────────────────────── sick-room visits

const visitOut = (v, people) => ({
  ...clean(v), studentId: idStr(v.studentId), staffUserId: idStr(v.staffUserId), branchId: idStr(v.branchId), ...people(v),
  minutes: Math.max(0, Math.round(((v.outAt ? new Date(v.outAt) : new Date()).getTime() - new Date(v.inAt).getTime()) / 60000)),
})

/** Visits on a day (default today) or over a date range, one page at a time; search runs on the server. */
export async function listVisits({ date, from, to, search, personType, page = 1, pageSize = 50 }, auth) {
  const d = date || (!from && !to ? await today() : null)
  const f = { ...siteFilter(auth), ...(d ? { date: d } : { date: { ...(from && { $gte: from }), ...(to && { $lte: to }) } }), ...(personType && { personType }) }
  const q = String(search ?? '').trim()
  if (q) Object.assign(f, await personSearch(q))
  const [rows, total] = await Promise.all([
    SickVisit.find(f).sort({ inAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    SickVisit.countDocuments(f),
  ])
  const people = await withPeople(rows)
  return { rows: rows.map((v) => visitOut(v, people)), total, page, pageSize }
}

/** Today in the sick room: who is in now, everyone seen today, how visits ended, and the last 30 days' complaints. */
export async function visitBoard(auth) {
  const t = await today()
  const rows = await SickVisit.find({ ...siteFilter(auth), $or: [{ date: t }, { outcome: { $in: VISIT_IN_ROOM } }] }).sort({ inAt: -1 }).lean()
  const people = await withPeople(rows)
  const list = rows.map((v) => visitOut(v, people))
  const since = addDays(t, -29)
  const recent = await SickVisit.aggregate([{ $match: { ...siteFilter(auth), date: { $gte: since } } }, { $group: { _id: '$complaint', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
  const byDay = await SickVisit.aggregate([{ $match: { ...siteFilter(auth), date: { $gte: addDays(t, -13) } } }, { $group: { _id: '$date', n: { $sum: 1 } } }])
  const frequent = await SickVisit.aggregate([{ $match: { ...siteFilter(auth), date: { $gte: since }, personType: 'STUDENT' } }, { $group: { _id: '$studentId', n: { $sum: 1 } } }, { $match: { n: { $gte: 3 } } }, { $sort: { n: -1 } }, { $limit: 10 }])
  const fl = await studentLabels(frequent.map((x) => x._id))
  const outcomes = {}
  for (const v of list.filter((x) => x.date === t)) outcomes[v.outcome] = (outcomes[v.outcome] ?? 0) + 1
  return {
    date: t,
    inRoom: list.filter((v) => VISIT_IN_ROOM.includes(v.outcome)),
    today: list.filter((v) => v.date === t),
    outcomes,
    complaints: recent.map((c) => ({ complaint: c._id, count: c.n })),
    days: Array.from({ length: 14 }, (_, i) => addDays(t, i - 13)).map((date) => ({ date, count: byDay.find((x) => x._id === date)?.n ?? 0 })),
    frequent: frequent.map((x) => ({ student: fl.get(String(x._id)) ?? null, count: x.n })),
  }
}

async function tellSentHome(v, person) {
  const tz = await timeZoneOf()
  await emit('health.sent_home', {
    studentId: String(v.studentId), entity: { type: 'sick_visit', id: v._id },
    data: { student: { class: await classOf(person.student ?? await Student.findById(v.studentId).select('sectionId').lean()) }, health: { complaint: words(v.complaint), time: hhmmIn(new Date(), tz), note: v.outcomeNote ?? v.treatment ?? '', pickedUpBy: v.pickedUpBy ?? '' } },
  })
  v.guardianNotified = true
}

const VISIT_FIELDS = ['complaint', 'complaintNote', 'vitals', 'treatment', 'medicines', 'outcomeNote', 'referredTo', 'pickedUpBy']

export async function createVisit(input, auth, req) {
  const person = await personFor(input, auth)
  const v = new SickVisit({ ...person, date: await today(), inAt: new Date(), by: auth.user?.name })
  for (const k of VISIT_FIELDS) if (input[k] !== undefined) v[k] = input[k]
  v.outcome = input.outcome ?? 'IN_ROOM'
  if (VISIT_CLOSE.includes(v.outcome)) Object.assign(v, { outAt: new Date(), closedBy: auth.user?.name })
  if (v.outcome === 'SENT_HOME' && v.studentId && input.notifyGuardian !== false) await tellSentHome(v, person)
  await v.save()
  await audit({ action: 'CREATE', module: 'health', entityType: 'sick_visit', entityId: String(v._id), entityName: person.name, ...(v.studentId && { studentId: v.studentId }), summary: `${person.name} in the sick room: ${words(v.complaint)}${v.outcome !== 'IN_ROOM' ? ` → ${words(v.outcome)}` : ''}` }, req)
  const people = await withPeople([v.toObject()])
  return visitOut(v.toObject(), people)
}

/** Change a visit while it is open (vitals, what was given) or end it: back to class, resting, sent home, referred. */
export async function updateVisit(id, input, auth, req) {
  const v = isOid(id) ? await SickVisit.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!v) throw notFound('Visit')
  if (VISIT_CLOSE.includes(v.outcome) && input.outcome && input.outcome !== v.outcome) throw conflict('This visit is closed.')
  for (const k of VISIT_FIELDS) if (input[k] !== undefined) v[k] = input[k]
  const was = v.outcome
  if (input.outcome) v.outcome = input.outcome
  if (VISIT_CLOSE.includes(v.outcome) && !v.outAt) Object.assign(v, { outAt: new Date(), closedBy: auth.user?.name })
  if (v.outcome === 'REFERRED' && !v.referredTo) throw fieldsError({ referredTo: 'Say where to' })
  if (v.outcome === 'SENT_HOME' && was !== 'SENT_HOME' && v.studentId && !v.guardianNotified && input.notifyGuardian !== false) await tellSentHome(v, {})
  await v.save()
  await audit({ action: 'UPDATE', module: 'health', entityType: 'sick_visit', entityId: String(v._id), entityName: v.staffName ?? '', ...(v.studentId && { studentId: v.studentId }), summary: `Sick-room visit ${was !== v.outcome ? `${words(was)} → ${words(v.outcome)}` : 'updated'}` }, req)
  const people = await withPeople([v.toObject()])
  return visitOut(v.toObject(), people)
}

/** Staff logins, for a staff member's visit or incident. */
export async function staffLogins() {
  const rows = await User.find({ active: true }).select('name designation').sort({ name: 1 }).limit(1000).lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null }))
}

// ───────────────────────────────────────────────────────── incidents

const incidentOut = (i, people) => ({ ...clean(i), studentId: idStr(i.studentId), staffUserId: idStr(i.staffUserId), visitId: idStr(i.visitId), branchId: idStr(i.branchId), ...people(i) })

/** Incident reports, one page at a time (search on the server: the person or the place); the tiles count all open ones. */
export async function listIncidents({ status, severity, from, to, search, page = 1, pageSize = 50 }, auth) {
  const f = { ...siteFilter(auth), ...(status && { status }), ...(severity && { severity }), ...((from || to) && { date: { ...(from && { $gte: from }), ...(to && { $lte: to }) } }) }
  const q = String(search ?? '').trim()
  if (q) Object.assign(f, await personSearch(q, ['place']))
  const [rows, total] = await Promise.all([
    HealthIncident.find(f).sort({ date: -1, createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    HealthIncident.countDocuments(f),
  ])
  const people = await withPeople(rows)
  const list = rows.map((i) => incidentOut(i, people))
  const t = await today()
  const open = await HealthIncident.find({ ...siteFilter(auth), status: 'OPEN' }).select('severity guardianInformed followUpDate').lean()
  return {
    rows: list, total, page, pageSize,
    counts: {
      open: open.length, serious: open.filter((i) => (INCIDENT_SEVERITY[i.severity]?.rank ?? 0) >= 3).length,
      notInformed: open.filter((i) => !i.guardianInformed?.at).length, followUpDue: open.filter((i) => i.followUpDate && i.followUpDate <= t).length,
      thisMonth: await HealthIncident.countDocuments({ ...siteFilter(auth), date: { $gte: `${t.slice(0, 7)}-01` } }),
    },
  }
}

const INCIDENT_FIELDS = ['kind', 'date', 'time', 'place', 'description', 'injury', 'firstAid', 'witnesses', 'severity', 'followUp', 'followUpDate']

export async function createIncident(input, auth, req) {
  const person = await personFor(input, auth)
  const i = new HealthIncident({ ...person, reportedBy: auth.user?.name })
  for (const k of INCIDENT_FIELDS) if (input[k] !== undefined) i[k] = input[k]
  if (!i.date) i.date = await today()
  if (isOid(input.visitId)) i.visitId = input.visitId
  if (input.guardianInformed?.how) i.guardianInformed = { at: new Date(), by: auth.user?.name, how: input.guardianInformed.how, note: input.guardianInformed.note }
  await i.save()
  if (input.notifyGuardian && i.studentId) {
    await emit('health.incident', {
      studentId: String(i.studentId), entity: { type: 'health_incident', id: i._id },
      data: { student: { class: await classOf(person.student) }, incident: { kind: words(i.kind), date: i.date, time: i.time ?? '', place: i.place ?? '', severity: words(i.severity), firstAid: i.firstAid ?? '' } },
    })
    if (!i.guardianInformed?.at) { i.guardianInformed = { at: new Date(), by: auth.user?.name, how: 'APP' }; await i.save() }
  }
  await audit({ action: 'CREATE', module: 'health', entityType: 'health_incident', entityId: String(i._id), entityName: person.name, ...(i.studentId && { studentId: i.studentId }), summary: `Incident report (${words(i.severity)}): ${person.name}, ${words(i.kind)}${i.place ? ` at ${i.place}` : ''} on ${i.date}` }, req)
  return incidentOut(i.toObject(), await withPeople([i.toObject()]))
}

export async function updateIncident(id, input, auth, req) {
  const i = isOid(id) ? await HealthIncident.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!i) throw notFound('Incident')
  if (i.status === 'RESOLVED') throw conflict('This incident is resolved.')
  for (const k of INCIDENT_FIELDS) if (input[k] !== undefined) i[k] = input[k]
  if (input.guardianInformed?.how && !i.guardianInformed?.at) i.guardianInformed = { at: new Date(), by: auth.user?.name, how: input.guardianInformed.how, note: input.guardianInformed.note }
  await i.save()
  await audit({ action: 'UPDATE', module: 'health', entityType: 'health_incident', entityId: String(i._id), entityName: i.staffName ?? '', ...(i.studentId && { studentId: i.studentId }), summary: `Incident report of ${i.date} updated` }, req)
  return incidentOut(i.toObject(), await withPeople([i.toObject()]))
}

export async function resolveIncident(id, { resolution }, auth, req) {
  const i = isOid(id) ? await HealthIncident.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!i) throw notFound('Incident')
  if (i.status === 'RESOLVED') throw conflict('This incident is already resolved.')
  Object.assign(i, { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: auth.user?.name, resolution })
  await i.save()
  await audit({ action: 'UPDATE', module: 'health', entityType: 'health_incident', entityId: String(i._id), entityName: i.staffName ?? '', ...(i.studentId && { studentId: i.studentId }), summary: `Incident of ${i.date} resolved: ${resolution}` }, req)
  return incidentOut(i.toObject(), await withPeople([i.toObject()]))
}

// ───────────────────────────────────────────────────────── the family app (feature HEALTH)

/** The family app › Health: a read-only card — blood group, growth, allergies, vaccinations, recent sick-room visits. */
export async function familyHealth(f, id) {
  need(f, 'HEALTH')
  const s = studentFor(f, id)
  const [r, visits, incidents] = await Promise.all([
    HealthRecord.findOne({ studentId: s._id }).lean(),
    SickVisit.find({ studentId: s._id }).sort({ inAt: -1 }).limit(10).lean(),
    HealthIncident.find({ studentId: s._id }).sort({ date: -1 }).limit(5).lean(),
  ])
  const m = latest(r)
  return {
    bloodGroup: r?.bloodGroup ?? s.bloodGroup ?? null,
    latest: m ? { date: m.date, heightCm: m.heightCm ?? null, weightKg: m.weightKg ?? null, bmi: bmi(m.heightCm, m.weightKg) } : null,
    growth: [...(r?.measurements ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-8).map((x) => ({ date: x.date, heightCm: x.heightCm ?? null, weightKg: x.weightKg ?? null })),
    allergies: r?.allergies ?? [],
    vaccinations: (r?.vaccinations ?? []).map((v) => ({ name: v.name, date: v.date ?? null, dose: v.dose ?? null })).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))),
    visits: visits.map((v) => ({ id: String(v._id), date: v.date, inAt: v.inAt, outAt: v.outAt ?? null, complaint: v.complaint, treatment: v.treatment ?? null, outcome: v.outcome, tempC: v.vitals?.tempC ?? null })),
    incidents: incidents.map((i) => ({ id: String(i._id), date: i.date, kind: i.kind, place: i.place ?? null, severity: i.severity, firstAid: i.firstAid ?? null, status: i.status })),
  }
}
