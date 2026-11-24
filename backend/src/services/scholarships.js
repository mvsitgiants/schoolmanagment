import {
  SCHOLARSHIP_CHECKS, SCHOLARSHIP_DOC_TYPE_BY, SCHOLARSHIP_OPEN, SCHOLARSHIP_PORTAL_STATUS, SCHOLARSHIP_REJECT_REASON_LABEL, SCHOLARSHIP_STATUS,
  attendancePct, formatINR, scholarshipDocCounts, scholarshipDocState, scholarshipDocValidTill, scholarshipStatusFrom, scholarshipValueText, scholarshipVisitTimes,
} from '@schoolgiant/shared'
import { AcademicYear, ClassLevel } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Attachment } from '../models/engines.js'
import { Exam, ExamCandidate } from '../models/exams.js'
import { FeeHead } from '../models/fees.js'
import { ScholarshipApplication, ScholarshipDocument, ScholarshipScheme, ScholarshipVisitDay } from '../models/scholarships.js'
import { Student, studentName } from '../models/students.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'
import { sectionsInScope, yearOrCurrent } from './academics.js'
import { collect, endScholarshipHold, estimateScholarship, grantScholarshipConcession, studentLabels, withdrawScholarshipConcession } from './fees.js'
import { humanDate } from './notify.js'

// Scholarships (module `scholarships`). The aim is one visit or none for the family:
//   · a scheme says up front who can apply and which documents to give (its checklist);
//   · the student's documents are kept once checked (the document wallet, ScholarshipDocument) and used again for
//     every scheme and every year until they expire — a renewing student only brings what has run out;
//   · eligibility (class, category, income, marks, attendance) is checked by the system before anyone queues;
//   · staff check each document online (a class teacher can collect papers in class) and only the wrong ones go
//     back to the family, with the reason, in one message;
//   · an application whose documents are all correct is approved on its own (scheme approval AUTO) or waits for
//     one approver, who can approve a whole ranked list at once;
//   · while it is being decided, its expected amount is kept out of fee reminders and no late fee is charged
//     (services/fees.js scholarshipHolds); an approved fee waiver becomes an approved fee concession.
// Who sees which students follows the role's data scope for `scholarships` (sectionsInScope).

const OPEN = SCHOLARSHIP_OPEN
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const idStr = (v) => (v ? String(v) : null)
const today = async () => (await institutionNow()).date
const AUTO_BY = 'Automatic — every document is correct'

// ───────────────────────────────────────────────────────── scope

async function scopeSectionIds(auth) {
  return sectionsInScope(auth, 'scholarships') // null = every section
}

async function studentInScope(studentId, auth) {
  if (!isOid(studentId)) throw notFound('Student')
  const s = await Student.findById(studentId).lean()
  if (!s) throw notFound('Student')
  const sections = await scopeSectionIds(auth)
  if (sections && !sections.includes(String(s.sectionId))) throw notFound('Student')
  return s
}

async function applicationInScope(id, auth) {
  const app = isOid(id) ? await ScholarshipApplication.findById(id) : null
  if (!app) throw notFound('Application')
  const sections = await scopeSectionIds(auth)
  if (sections && !sections.includes(String(app.sectionId))) throw notFound('Application')
  return app
}

// ───────────────────────────────────────────────────────── schemes

const docKey = (d) => (d.type === 'OTHER' ? `OTHER:${String(d.label ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : d.type)
export const docLabel = (d) => (d.type === 'OTHER' ? d.label : SCHOLARSHIP_DOC_TYPE_BY[d.type]?.label ?? d.type)

export const schemeDto = (x) => ({
  ...clean(x),
  feeHeadIds: (x.feeHeadIds ?? []).map(String),
  eligibility: { ...x.eligibility, classIds: (x.eligibility?.classIds ?? []).map(String) },
  documents: (x.documents ?? []).map((d) => ({ ...d, label: docLabel(d) })),
  valueText: scholarshipValueText(x, formatINR),
})

/** What the screens need to fill forms: the year, fee heads, classes and the active schemes. */
export async function scholarshipMeta() {
  const [year, heads, classes, schemes] = await Promise.all([
    yearOrCurrent().catch(() => null),
    FeeHead.find({ active: true }).select('name').sort({ name: 1 }).lean(),
    ClassLevel.find().select('name code order').sort({ order: 1, name: 1 }).lean(),
    ScholarshipScheme.find({ active: true }).sort({ name: 1 }).lean(),
  ])
  return {
    year: year ? { id: String(year._id), name: year.name } : null,
    heads: heads.map((h) => ({ id: String(h._id), name: h.name })),
    classes: classes.map((c) => ({ id: String(c._id), name: c.name })),
    schemes: schemes.map(schemeDto),
  }
}

/** Schemes with this year's use: applications, approved, money given, seats and budget left. */
export async function listSchemes({ all = false } = {}) {
  const year = await yearOrCurrent().catch(() => null)
  const schemes = await ScholarshipScheme.find(all ? {} : { active: true }).sort({ active: -1, name: 1 }).lean()
  const usage = year ? await ScholarshipApplication.aggregate([
    { $match: { academicYearId: year._id, status: { $ne: 'WITHDRAWN' } } },
    { $group: { _id: { s: '$schemeId', st: '$status' }, n: { $sum: 1 }, amount: { $sum: '$expectedAmount' } } },
  ]) : []
  return {
    year: year ? { id: String(year._id), name: year.name } : null,
    rows: schemes.map((x) => {
      const mine = usage.filter((u) => String(u._id.s) === String(x._id))
      const count = (pred) => mine.filter((u) => pred(u._id.st)).reduce((n, u) => n + u.n, 0)
      const approvedAmount = mine.filter((u) => u._id.st === 'APPROVED').reduce((n, u) => n + u.amount, 0)
      return {
        ...schemeDto(x),
        usage: { applied: count(() => true), open: count((st) => OPEN.includes(st)), approved: count((st) => st === 'APPROVED'), notApproved: count((st) => st === 'NOT_APPROVED'), approvedAmount },
      }
    }),
  }
}

export async function getScheme(id) {
  const x = isOid(id) ? await ScholarshipScheme.findById(id).lean() : null
  if (!x) throw notFound('Scheme')
  return schemeDto(x)
}

export async function saveScheme(id, input, auth, req) {
  const errors = {}
  if (input.kind === 'PCT' && (input.value <= 0 || input.value > 100)) errors.value = '1 to 100%'
  if (input.kind === 'AMOUNT' && input.value <= 0) errors.value = 'Enter the amount'
  if (input.benefit === 'PAID_TO_STUDENT' && input.kind !== 'AMOUNT') errors.kind = 'Money paid to the student is a fixed amount'
  const documents = (input.documents ?? []).map((d) => ({ ...d, label: d.type === 'OTHER' ? d.label?.trim() : undefined }))
  documents.forEach((d, i) => { if (d.type === 'OTHER' && !d.label) errors[`documents.${i}.label`] = 'Name the document' })
  const keys = documents.map(docKey)
  if (new Set(keys).size !== keys.length) errors.documents = 'The same document is in the list twice'
  if (Object.keys(errors).length) throw fieldsError(errors)
  if (await ScholarshipScheme.exists({ name: input.name, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ name: 'Another scheme has this name' })
  const x = id ? await ScholarshipScheme.findById(id) : new ScholarshipScheme()
  if (!x) throw notFound('Scheme')
  Object.assign(x, {
    ...input,
    documents: documents.map((d) => ({ ...d, key: docKey(d) })),
    seats: input.seats ?? undefined, budget: input.budget ?? undefined, lastDate: input.lastDate ?? undefined,
  })
  await x.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'scholarships', entityType: 'scholarship_scheme', entityId: String(x._id), entityName: x.name, summary: `${id ? 'Changed' : 'Added'} the scholarship scheme “${x.name}” (${scholarshipValueText(x, formatINR)}, ${x.documents.length} document(s))` }, req)
  return schemeDto(x.toObject())
}

/** Delete a scheme nobody has applied for; once anyone has, it is switched off instead. */
export async function deleteScheme(id, auth, req) {
  const x = isOid(id) ? await ScholarshipScheme.findById(id) : null
  if (!x) throw notFound('Scheme')
  if (await ScholarshipApplication.exists({ schemeId: x._id })) throw conflict(`Students have applied for “${x.name}”. Switch it off instead.`)
  await x.deleteOne()
  await audit({ action: 'DELETE', module: 'scholarships', entityType: 'scholarship_scheme', entityId: String(x._id), entityName: x.name, summary: `Deleted the scholarship scheme “${x.name}”` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── what the system knows about students

/** The latest published exam % of each student. */
async function latestMarks(ids) {
  const cands = await ExamCandidate.find({ studentId: { $in: ids }, pct: { $ne: null } }).select('studentId examId pct').lean()
  if (!cands.length) return new Map()
  const exams = new Map((await Exam.find({ _id: { $in: [...new Set(cands.map((c) => String(c.examId)))] }, status: 'PUBLISHED' }).select('name publishedAt endDate').lean()).map((e) => [String(e._id), e]))
  const out = new Map()
  for (const c of cands) {
    const e = exams.get(String(c.examId))
    if (!e) continue
    const when = e.publishedAt ? new Date(e.publishedAt).toISOString() : String(e.endDate ?? '')
    const cur = out.get(String(c.studentId))
    if (!cur || when > cur.when) out.set(String(c.studentId), { pct: c.pct, exam: e.name, when })
  }
  return out
}

/** Each student's attendance % this academic year so far (daily attendance). */
async function attendanceOf(ids, year) {
  if (!year?.startDate) return new Map()
  const t = await today()
  const to = year.endDate && year.endDate < t ? year.endDate : t
  const rows = await AttendanceSheet.aggregate([
    { $match: { period: 0, date: { $gte: year.startDate, $lte: to }, 'entries.studentId': { $in: ids } } },
    { $unwind: '$entries' }, { $match: { 'entries.studentId': { $in: ids } } },
    { $group: { _id: { s: '$entries.studentId', st: '$entries.status' }, n: { $sum: 1 } } },
  ])
  const counts = new Map()
  for (const r of rows) {
    if (!['P', 'A', 'L', 'HD', 'LV'].includes(r._id.st)) continue
    const k = String(r._id.s)
    if (!counts.has(k)) counts.set(k, { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 })
    const c = counts.get(k)
    c[r._id.st] += r.n
    c.total += r.n
  }
  return new Map([...counts].map(([k, c]) => [k, attendancePct(c)]))
}

/** Facts the eligibility checks use, for many students at once. */
export async function factsOf(students, year) {
  const ids = students.map((s) => s._id)
  const [marks, attendance] = await Promise.all([latestMarks(ids), attendanceOf(ids, year)])
  return new Map(students.map((s) => [String(s._id), {
    classId: idStr(s.classId), category: s.category ?? null, gender: s.gender ?? null,
    marksPct: marks.get(String(s._id))?.pct ?? null, marksExam: marks.get(String(s._id))?.exam ?? null,
    attendancePct: attendance.get(String(s._id)) ?? null,
  }]))
}

/**
 * The scheme's rules against one student: [{ key, ok, value, need }]. ok = false fails, null = the system can't
 * tell (no marks, no attendance, income not given yet) and someone checks the paper.
 */
export function eligibilityChecks(scheme, facts, { familyIncome, marksPct } = {}) {
  const e = scheme.eligibility ?? {}
  const out = []
  const inList = (list, v) => (v == null ? null : list.map(String).includes(String(v)))
  if (e.classIds?.length) out.push({ key: 'class', value: facts.classId, need: e.classIds.map(String), ok: inList(e.classIds, facts.classId) })
  if (e.categories?.length) out.push({ key: 'category', value: facts.category, need: e.categories, ok: inList(e.categories, facts.category) })
  if (e.genders?.length) out.push({ key: 'gender', value: facts.gender, need: e.genders, ok: inList(e.genders, facts.gender) })
  if (e.maxIncome) out.push({ key: 'income', value: familyIncome ?? null, need: e.maxIncome, ok: familyIncome == null ? null : familyIncome <= e.maxIncome })
  if (e.minMarksPct) {
    const v = marksPct ?? facts.marksPct
    out.push({ key: 'marks', value: v ?? null, need: e.minMarksPct, ok: v == null ? null : v >= e.minMarksPct })
  }
  if (e.minAttendancePct) out.push({ key: 'attendance', value: facts.attendancePct, need: e.minAttendancePct, ok: facts.attendancePct == null ? null : facts.attendancePct >= e.minAttendancePct })
  return out
}

const CHECK_LABEL = Object.fromEntries(SCHOLARSHIP_CHECKS.map((c) => [c.key, c.label.toLowerCase()]))
const failedText = (checks) => checks.filter((c) => c.ok === false).map((c) => CHECK_LABEL[c.key]).join(', ')

// ───────────────────────────────────────────────────────── the document wallet

/** A student's documents by key, with how many files each has and when the last one came. */
export async function walletOf(studentIds, keys) {
  const docs = await ScholarshipDocument.find({ studentId: { $in: studentIds }, ...(keys && { key: { $in: keys } }) }).lean()
  const files = docs.length ? await Attachment.aggregate([
    { $match: { entityType: 'scholarship_doc', entityId: { $in: docs.map((d) => String(d._id)) }, 'deleted.at': null } },
    { $group: { _id: '$entityId', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
  ]) : []
  const fileOf = new Map(files.map((f) => [f._id, f]))
  const out = new Map() // `${studentId}|${key}` → doc
  for (const d of docs) out.set(`${d.studentId}|${d.key}`, { ...d, files: fileOf.get(String(d._id))?.n ?? 0, lastFileAt: fileOf.get(String(d._id))?.last ?? null })
  return out
}

const stateOf = (item, doc, t) => scholarshipDocState(doc, item, t)

const docDto = (d) => d && ({
  id: String(d._id), status: d.status, number: d.number ?? null, issuedOn: d.issuedOn ?? null, validTill: d.validTill ?? null,
  paperCopy: !!d.paperCopy, originalSeen: !!d.originalSeen, originalSeenBy: d.originalSeenBy ?? null, originalSeenAt: d.originalSeenAt ?? null,
  reason: d.reason ?? null, reasonLabel: d.reason ? SCHOLARSHIP_REJECT_REASON_LABEL[d.reason] : null, reasonNote: d.reasonNote ?? null,
  checkedBy: d.checkedBy ?? null, checkedAt: d.checkedAt ?? null, files: d.files ?? 0, lastFileAt: d.lastFileAt ?? null,
  createdAt: d.createdAt, log: (d.log ?? []).slice(-10),
})

/** Each application's checklist lines with their state (many applications at once). */
export async function linesOf(apps, t) {
  const wallet = await walletOf([...new Set(apps.map((a) => String(a.studentId)))].map(oid), [...new Set(apps.flatMap((a) => a.items.map((i) => i.key)))])
  return new Map(apps.map((a) => [String(a._id), a.items.map((it) => {
    const doc = wallet.get(`${a.studentId}|${it.key}`)
    return { ...it, label: docLabel(it), state: stateOf(it, doc, t), doc }
  })]))
}

// ───────────────────────────────────────────────────────── status, approval, hold

export const say = (app, by, text) => { app.log.push({ at: new Date(), by, text }) }

/**
 * Bring an open application's status in line with its documents (and its expected amount with the fees), and
 * approve it on its own when the scheme says so and every required document is correct.
 */
async function refresh(app, auth, req) {
  if (!OPEN.includes(app.status)) return app
  const t = await today()
  const scheme = await ScholarshipScheme.findById(app.schemeId).lean()
  const lines = (await linesOf([app.toObject()], t)).get(String(app._id))
  const next = scholarshipStatusFrom(lines.filter((l) => l.required).map((l) => l.state))
  if (next !== app.status) {
    say(app, auth.user?.name ?? 'System', next === 'READY' ? 'Every required document is correct' : next === 'NEEDS_FIX' ? 'A document needs fixing' : 'Documents are being collected')
    app.status = next
  }
  if (scheme) app.expectedAmount = await estimateScholarship(app.studentId, app.academicYearId, scheme)
  await app.save()
  if (app.status === 'READY' && scheme?.approval === 'AUTO') {
    try {
      await approveOne(app, scheme, auth, req, { auto: true })
    } catch (err) {
      say(app, 'System', `Could not be approved on its own: ${err.message}`)
      await app.save()
    }
  }
  return app
}

/** Re-check every open application of a student (their wallet document changed). */
export async function refreshStudent(studentId, auth, req) {
  for (const app of await ScholarshipApplication.find({ studentId, status: { $in: OPEN } })) await refresh(app, auth, req)
}

async function familyData(app, scheme, extra = {}) {
  const label = (await studentLabels([app.studentId])).get(String(app.studentId))
  return { studentId: String(app.studentId), entity: { type: 'scholarship_application', id: app._id }, data: { student: { class: label?.classShort ?? '' }, scheme: { name: scheme.name }, scholarship: { applicationNo: app.applicationNo, ...extra } } }
}

/** Seats and budget left for one more approval. */
async function assertRoom(app, scheme) {
  const approved = { schemeId: scheme._id, academicYearId: app.academicYearId, status: 'APPROVED', _id: { $ne: app._id } }
  if (scheme.seats != null && await ScholarshipApplication.countDocuments(approved) >= scheme.seats) throw conflict(`All ${scheme.seats} seats of “${scheme.name}” are taken this year.`)
  if (scheme.budget != null) {
    const [u] = await ScholarshipApplication.aggregate([{ $match: approved }, { $group: { _id: null, amount: { $sum: '$expectedAmount' } } }])
    const left = scheme.budget - (u?.amount ?? 0)
    if ((app.expectedAmount ?? 0) > left) throw conflict(`Not enough budget left in “${scheme.name}”: ${formatINR(Math.max(0, left))} left, this needs ${formatINR(app.expectedAmount)}.`)
  }
}

async function approveOne(app, scheme, auth, req, { auto = false, note } = {}) {
  await assertRoom(app, scheme)
  const by = auto ? AUTO_BY : auth.user?.name
  await withTransaction(async () => {
    if (scheme.benefit === 'FEE_WAIVER') {
      const r = await grantScholarshipConcession({
        studentId: app.studentId, academicYearId: app.academicYearId, kind: scheme.kind, value: scheme.value, feeHeadIds: scheme.feeHeadIds,
        reason: scheme.name, note: `Scholarship ${app.applicationNo}`, applicationId: app._id,
      }, auth)
      app.concessionId = r.concessionId
    }
    // paid to the institution later (government, trust): the fees stay held until the money is recorded
    if (scheme.benefit === 'PAID_TO_INSTITUTION') app.awaitingMoney = true
    Object.assign(app, { status: 'APPROVED', decidedBy: by, decidedById: auto ? undefined : auth.userId, decidedAt: new Date(), decisionNote: note || undefined })
    say(app, by, `Approved${note ? ` — ${note}` : ''}`)
    await app.save()
  })
  await endScholarshipHold(app.studentId, app.academicYearId)
  await audit({ action: 'APPROVE', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Approved scholarship ${app.applicationNo} (${scheme.name})${auto ? ' on its own — every document correct' : ''}` }, req)
  await emit('scholarships.approved', await familyData(app, scheme, { amount: scholarshipValueText(scheme, formatINR) }))
}

// ───────────────────────────────────────────────────────── applications

const STATUS_ORDER = { NEEDS_FIX: 0, IN_PROGRESS: 1, READY: 2, APPROVED: 3, NOT_APPROVED: 4, WITHDRAWN: 5 }

/** Merit order inside a scheme: renewals first (when the scheme says so), then by the scheme's order. */
function compareRank(scheme, a, b) {
  if (scheme?.renewalsFirst) {
    const d = Number(!a.renewedFromId) - Number(!b.renewedFromId)
    if (d) return d
  }
  return rankKey(scheme, a) - rankKey(scheme, b)
}

function rankKey(scheme, a) {
  if (scheme?.rankBy === 'MARKS') return -(a.marksPct ?? -1)
  if (scheme?.rankBy === 'INCOME') return a.familyIncome ?? Number.MAX_SAFE_INTEGER
  return new Date(a.createdAt).getTime()
}

/**
 * Applications of a year a page at a time, with each one's documents counted by state. `view`: TO_CHECK (a
 * document is waiting to be checked), FAMILY (something is pending from the family). The summary is over every
 * application in scope for the year (what needs doing leads the screen). With a scheme picked, open and approved
 * applications get their rank (the scheme's merit order).
 */
/**
 * The list's tab: what the application needs next. CHECK — a document is waiting to be checked; DECIDE — every
 * required document is correct; FAMILY — something is still to come from the family (or an original to show);
 * APPROVED; CLOSED — not approved or withdrawn.
 */
const FAMILY_STATES = ['MISSING', 'NOT_ACCEPTED', 'EXPIRED', 'ORIGINAL_DUE']
export const SCHOLARSHIP_TABS = ['CHECK', 'FAMILY', 'DECIDE', 'APPROVED', 'CLOSED']
function tabOf(a, lines) {
  if (a.status === 'APPROVED') return 'APPROVED'
  if (!OPEN.includes(a.status)) return 'CLOSED'
  if ((lines ?? []).some((l) => l.state === 'SUBMITTED')) return 'CHECK'
  return a.status === 'READY' ? 'DECIDE' : 'FAMILY'
}

/** What happens next, for the list's "next step" column: { code, count }. */
function nextStepOf(a, tab, lines) {
  const n = (st) => (lines ?? []).filter((l) => (l.required || l.state !== 'MISSING') && st.includes(l.state)).length
  if (tab === 'CHECK') return { code: 'CHECK', count: n(['SUBMITTED']) }
  if (tab === 'DECIDE') return { code: 'DECIDE', count: 0 }
  if (tab === 'FAMILY') {
    if (n(['NOT_ACCEPTED', 'EXPIRED'])) return { code: 'FIX', count: n(['NOT_ACCEPTED', 'EXPIRED']) }
    if (n(['MISSING'])) return { code: 'GIVE', count: n(['MISSING']) }
    return { code: 'ORIGINALS', count: n(['ORIGINAL_DUE']) }
  }
  if (tab === 'APPROVED') return { code: a.awaitingMoney ? 'MONEY' : 'DONE', count: 0 }
  return { code: a.status, count: 0 }
}

export async function listApplications({ academicYearId, schemeId, status, view, tab, renewal, sectionId, classId, search, page = 1, pageSize = 50 } = {}, auth) {
  const year = await yearOrCurrent(academicYearId)
  const t = await today()
  const sections = await scopeSectionIds(auth)
  const base = { academicYearId: year._id, ...(sections && { sectionId: { $in: sections.map(oid) } }) }
  const all = await ScholarshipApplication.find(base).select('-log -eligibility').lean()
  const lines = await linesOf(all.filter((a) => OPEN.includes(a.status)), t)
  // an open application's status as its documents stand now (a file uploaded again makes it "to check" at once)
  for (const a of all) if (OPEN.includes(a.status)) a.status = scholarshipStatusFrom(lines.get(String(a._id)).filter((l) => l.required).map((l) => l.state))
  const countsOf = (a) => scholarshipDocCounts((lines.get(String(a._id)) ?? []).filter((l) => l.required || l.state !== 'MISSING').map((l) => l.state))

  const summary = { total: 0, byStatus: Object.fromEntries(Object.keys(SCHOLARSHIP_STATUS).map((k) => [k, 0])), docsToCheck: 0, appsToCheck: 0, familyPending: 0, approvedAmount: 0, heldAmount: 0, portalToVerify: 0, moneyAwaited: 0, moneyApps: 0, government: 0 }
  const receivedOf = (a) => (a.received ?? []).reduce((n, x) => n + (x.amount ?? 0), 0)
  const verifyOnPortal = (a) => a.portal?.status === 'APPLIED' && a.status !== 'WITHDRAWN' && a.status !== 'NOT_APPROVED'
  for (const a of all) {
    summary.total++
    summary.byStatus[a.status]++
    if (a.portal?.status) summary.government++
    if (verifyOnPortal(a)) summary.portalToVerify++
    if (a.awaitingMoney) { summary.moneyApps++; summary.moneyAwaited += Math.max(0, (a.expectedAmount ?? 0) - receivedOf(a)) }
    if (a.status === 'APPROVED') summary.approvedAmount += a.expectedAmount ?? 0
    if (!OPEN.includes(a.status)) continue
    if (a.holdFees) summary.heldAmount += a.expectedAmount ?? 0
    const c = countsOf(a)
    summary.docsToCheck += c.SUBMITTED
    if (c.SUBMITTED) summary.appsToCheck++
    if ((lines.get(String(a._id)) ?? []).some((l) => l.required && ['MISSING', 'NOT_ACCEPTED', 'EXPIRED', 'ORIGINAL_DUE'].includes(l.state))) summary.familyPending++
  }

  let rows = all
  if (schemeId) rows = rows.filter((a) => String(a.schemeId) === String(schemeId))
  // the tabs count what is in the picked scheme, before the tab, search and other filters
  for (const a of rows) a.tab = tabOf(a, lines.get(String(a._id)))
  summary.tabs = Object.fromEntries(SCHOLARSHIP_TABS.map((k) => [k, rows.filter((a) => a.tab === k).length]))
  summary.renewals = rows.filter((a) => a.renewedFromId).length
  if (tab) rows = rows.filter((a) => a.tab === tab)
  if (renewal === 'RENEWAL') rows = rows.filter((a) => a.renewedFromId)
  if (renewal === 'NEW') rows = rows.filter((a) => !a.renewedFromId)
  if (status) rows = rows.filter((a) => a.status === status)
  if (view === 'TO_CHECK') rows = rows.filter((a) => OPEN.includes(a.status) && countsOf(a).SUBMITTED > 0)
  if (view === 'PORTAL_VERIFY') rows = rows.filter(verifyOnPortal)
  if (view === 'MONEY') rows = rows.filter((a) => a.awaitingMoney)
  if (view === 'FAMILY') rows = rows.filter((a) => (lines.get(String(a._id)) ?? []).some((l) => l.required && ['MISSING', 'NOT_ACCEPTED', 'EXPIRED', 'ORIGINAL_DUE'].includes(l.state)))
  if (sectionId) rows = rows.filter((a) => String(a.sectionId) === String(sectionId))
  if (classId || search) {
    const q = String(search ?? '').trim()
    const re = q && new RegExp(escapeRegex(q), 'i')
    const studentFilter = { _id: { $in: rows.map((a) => a.studentId) }, ...(classId && { classId: oid(classId) }), ...(re && { $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] }) }
    const keep = new Set((await Student.find(studentFilter).select('_id').lean()).map((s) => String(s._id)))
    rows = rows.filter((a) => keep.has(String(a.studentId)) || (re && re.test(a.applicationNo)))
  }

  const schemes = new Map((await ScholarshipScheme.find({ _id: { $in: [...new Set(all.map((a) => String(a.schemeId)))] } }).lean()).map((x) => [String(x._id), x]))
  // merit order inside the picked scheme: open and approved applications
  const rank = new Map()
  if (schemeId) {
    const scheme = schemes.get(String(schemeId))
    all.filter((a) => String(a.schemeId) === String(schemeId) && (OPEN.includes(a.status) || a.status === 'APPROVED'))
      .sort((a, b) => compareRank(scheme, a, b)).forEach((a, i) => rank.set(String(a._id), i + 1))
    rows.sort((a, b) => (rank.get(String(a._id)) ?? 1e9) - (rank.get(String(b._id)) ?? 1e9) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  } else {
    rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  if (schemeId) {
    const x = schemes.get(String(schemeId))
    const ok = all.filter((a) => String(a.schemeId) === String(schemeId) && a.status === 'APPROVED')
    if (x) summary.scheme = { seats: x.seats ?? null, budget: x.budget ?? null, approved: ok.length, approvedAmount: ok.reduce((n, a) => n + (a.expectedAmount ?? 0), 0), rankBy: x.rankBy, approval: x.approval, renewalsFirst: !!x.renewalsFirst }
  }

  const total = rows.length
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const [names, cats] = await Promise.all([
    studentLabels(pageRows.map((a) => a.studentId)),
    Student.find({ _id: { $in: pageRows.map((a) => a.studentId) } }).select('category').lean().then((x) => new Map(x.map((y) => [String(y._id), y.category ?? null]))),
  ])
  return {
    year: { id: String(year._id), name: year.name },
    rows: pageRows.map((a) => {
      const scheme = schemes.get(String(a.schemeId))
      const mine = lines.get(String(a._id)) ?? []
      return {
        id: String(a._id), applicationNo: a.applicationNo, status: a.status, createdAt: a.createdAt, familyToldAt: a.familyToldAt ?? null,
        student: names.get(String(a.studentId)) ?? null, studentId: String(a.studentId),
        scheme: scheme ? { id: String(scheme._id), name: scheme.name, kind: scheme.kind, value: scheme.value, valueText: scholarshipValueText(scheme, formatINR), approval: scheme.approval } : null,
        expectedAmount: a.expectedAmount ?? 0, marksPct: a.marksPct ?? null, familyIncome: a.familyIncome ?? null, rank: rank.get(String(a._id)) ?? null,
        docs: OPEN.includes(a.status) ? {
          required: mine.filter((l) => l.required).length, correct: mine.filter((l) => l.required && l.state === 'ACCEPTED').length, counts: countsOf(a),
          items: mine.filter((l) => l.required || l.state !== 'MISSING').map((l) => ({ key: l.key, label: l.label, state: l.state })),
        } : null,
        renewal: !!a.renewedFromId,
        tab: a.tab ?? tabOf(a, mine), next: nextStepOf(a, a.tab ?? tabOf(a, mine), mine), category: cats.get(String(a.studentId)) ?? null,
        decidedBy: a.decidedBy ?? null, decidedAt: a.decidedAt ?? null,
        portal: a.portal?.status ? { status: a.portal.status, applicationId: a.portal.applicationId ?? null } : null,
        awaitingMoney: !!a.awaitingMoney, received: receivedOf(a), benefit: scheme?.benefit ?? null, provider: scheme?.provider ?? null,
      }
    }),
    total, page, pageSize, summary,
    ids: rows.slice(0, 1000).map((a) => String(a._id)), // the whole filtered list in order: the review page's previous / next
  }
}

/** One application in full: the student, the scheme, the eligibility checks, every checklist line with its document. */
export async function getApplication(id, auth) {
  const app = await applicationInScope(id, auth)
  const t = await today()
  const [scheme, label, year, lines] = await Promise.all([
    ScholarshipScheme.findById(app.schemeId).lean(),
    studentLabels([app.studentId]).then((m) => m.get(String(app.studentId))),
    AcademicYear.findById(app.academicYearId).select('name').lean(),
    linesOf([app.toObject()], t).then((m) => m.get(String(app._id))),
  ])
  const o = app.toObject()
  const prev = o.renewedFromId ? await ScholarshipApplication.findById(o.renewedFromId).select('applicationNo academicYearId expectedAmount').lean() : null
  const prevYear = prev ? await AcademicYear.findById(prev.academicYearId).select('name').lean() : null
  if (OPEN.includes(o.status)) o.status = scholarshipStatusFrom(lines.filter((l) => l.required).map((l) => l.state))
  return {
    ...clean(o), schemeId: String(o.schemeId), studentId: String(o.studentId), academicYearId: String(o.academicYearId),
    concessionId: idStr(o.concessionId), yearName: year?.name ?? null, student: label ?? null,
    renewedFrom: prev ? { id: String(prev._id), applicationNo: prev.applicationNo, yearName: prevYear?.name ?? null, amount: prev.expectedAmount ?? 0 } : null,
    scheme: scheme ? schemeDto(scheme) : null,
    items: lines.map((l) => ({ key: l.key, type: l.type, label: l.label, required: l.required, originalNeeded: l.originalNeeded, note: l.note ?? null, state: l.state, doc: docDto(l.doc) })),
    eligible: !(o.eligibility ?? []).some((c) => c.ok === false),
    visit: o.visit?.dayId ? { ...o.visit, dayId: String(o.visit.dayId) } : null,
    portal: o.portal?.status || o.portal?.applicationId ? { ...o.portal, history: [...(o.portal.history ?? [])].reverse() } : null,
    received: (o.received ?? []).map((r) => ({ ...r, receiptId: idStr(r.receiptId) })), receivedTotal: (o.received ?? []).reduce((n, r) => n + (r.amount ?? 0), 0),
    log: [...(o.log ?? [])].reverse(),
    today: t,
  }
}

/** Before applying: is the student eligible, which documents are already with us, what is still needed. */
export async function previewApplication({ schemeId, studentId, familyIncome, marksPct }, auth) {
  const [s, scheme, year] = await Promise.all([studentInScope(studentId, auth), ScholarshipScheme.findById(schemeId).lean(), yearOrCurrent()])
  if (!scheme) throw notFound('Scheme')
  const t = await today()
  const facts = (await factsOf([s], year)).get(String(s._id))
  const checks = eligibilityChecks(scheme, facts, { familyIncome, marksPct })
  const wallet = await walletOf([s._id], scheme.documents.map((d) => d.key))
  const existing = await ScholarshipApplication.findOne({ schemeId: scheme._id, studentId: s._id, academicYearId: year._id, status: { $nin: ['WITHDRAWN', 'NOT_APPROVED'] } }).select('applicationNo status').lean()
  return {
    student: (await studentLabels([s._id])).get(String(s._id)),
    facts: { marksPct: facts.marksPct, marksExam: facts.marksExam, attendancePct: facts.attendancePct, category: facts.category },
    checks, eligible: !checks.some((c) => c.ok === false),
    items: scheme.documents.map((d) => {
      const doc = wallet.get(`${s._id}|${d.key}`)
      return { key: d.key, type: d.type, label: docLabel(d), required: d.required, originalNeeded: d.originalNeeded, state: stateOf(d, doc, t), validTill: doc?.validTill ?? null, checkedAt: doc?.checkedAt ?? null }
    }),
    expectedAmount: await estimateScholarship(s._id, year._id, scheme),
    existing: existing ? { id: String(existing._id), applicationNo: existing.applicationNo, status: existing.status } : null,
  }
}

/**
 * Start an application for a student already found (office: in the caller's scope; app: the family's own child).
 * `auth` is the person, or the family stand-in from the app (services/scholarshipsFamily.js). Returns the document.
 */
export async function startApplication({ s, scheme, year, familyIncome, marksPct, note, source = 'OFFICE', renewedFrom }, auth, req) {
  if (!scheme) throw notFound('Scheme')
  if (!scheme.active) throw conflict(`“${scheme.name}” is switched off.`)
  if (s.status !== 'ACTIVE') throw conflict(`${studentName(s)} is not a current student.`)
  const existing = await ScholarshipApplication.findOne({ schemeId: scheme._id, studentId: s._id, academicYearId: year._id, status: { $nin: ['WITHDRAWN', 'NOT_APPROVED'] } }).select('applicationNo').lean()
  if (existing) throw conflict(`${studentName(s)} has already applied for “${scheme.name}” (${existing.applicationNo}).`)
  const facts = (await factsOf([s], year)).get(String(s._id))
  familyIncome = familyIncome ?? renewedFrom?.familyIncome ?? undefined // a renewal starts from last year's income (the new certificate confirms it)
  // a renewal is held to the renewal rule, not to the marks and attendance a new applicant needs
  const checks = renewedFrom ? renewalEligibility(scheme, facts, { familyIncome }) : eligibilityChecks(scheme, facts, { familyIncome, marksPct })
  if (checks.some((c) => c.ok === false)) throw conflict(`${studentName(s)} can’t ${renewedFrom ? 'renew' : 'apply for'} “${scheme.name}” — ${failedText(checks)} does not match the scheme.`, { checks })
  const who = auth.user?.name
  const app = new ScholarshipApplication({
    applicationNo: await nextNumber('SCHOLARSHIP', { branchId: s.branchId }), schemeId: scheme._id, studentId: s._id, academicYearId: year._id,
    branchId: s.branchId, sectionId: s.sectionId, source,
    marksPct: marksPct ?? facts.marksPct ?? undefined, marksFrom: marksPct != null ? 'ENTERED' : facts.marksPct != null ? 'EXAM' : undefined,
    attendancePct: facts.attendancePct ?? undefined, eligibility: checks, items: scheme.documents, holdFees: !!scheme.holdFees,
    note: note || undefined, createdBy: who, createdById: auth.userId, status: 'IN_PROGRESS', renewedFromId: renewedFrom?._id,
    familyIncome,
    // a government renewal is made on the portal against last year's application: keep its number at hand
    ...(renewedFrom?.portal?.applicationId && { portal: { previousId: renewedFrom.portal.applicationId, status: 'NOT_APPLIED' } }),
  })
  say(app, who, source === 'FAMILY' ? 'Applied from the app' : renewedFrom ? `Renewed from ${renewedFrom.applicationNo} (last year)` : 'Application started')
  await app.save()
  await audit({ action: 'CREATE', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: s._id, summary: `${source === 'FAMILY' ? 'The family applied' : 'Started'} scholarship application ${app.applicationNo} for ${studentName(s)} (${scheme.name})` }, req)
  await refresh(app, auth, req) // documents already in the wallet count straight away
  return app
}

export async function createApplication({ schemeId, studentId, familyIncome, marksPct, note, tellFamily = false, renewal = false }, auth, req) {
  const [s, scheme, year] = await Promise.all([studentInScope(studentId, auth), isOid(schemeId) ? ScholarshipScheme.findById(schemeId).lean() : null, yearOrCurrent()])
  let renewedFrom
  if (renewal) {
    renewedFrom = await lastAward(scheme, s._id, year)
    if (!renewedFrom) throw conflict(`${studentName(s)} did not have “${scheme?.name ?? 'this scholarship'}” last year.`)
    const facts = (await factsOf([s], year)).get(String(s._id))
    const failed = renewalChecks(scheme, facts).filter((c) => c.ok === false)
    if (failed.length) throw conflict(`${studentName(s)} does not meet the renewal rule — ${failed.map((c) => CHECK_LABEL[c.key]).join(', ')}.`)
  }
  const app = await startApplication({ s, scheme, year, familyIncome, marksPct, note, renewedFrom }, auth, req)
  if (tellFamily && OPEN.includes(app.status)) await tellFamilyOne(app, scheme, auth, req).catch(() => null)
  return getApplication(app._id, auth)
}

/** Start applications for many students at once (from "Who can apply"). Students who can't apply are listed, not failed. */
export async function createApplications({ schemeId, studentIds, tellFamily, renewal = false }, auth, req) {
  let created = 0
  const skipped = []
  for (const studentId of studentIds) {
    try {
      await createApplication({ schemeId, studentId, tellFamily, renewal }, auth, req)
      created++
    } catch (err) {
      const s = isOid(studentId) ? await Student.findById(studentId).select('firstName middleName lastName').lean() : null
      skipped.push({ studentId, name: s ? studentName(s) : studentId, message: err.message })
    }
  }
  return { created, skipped }
}

/** The student's approved application of this scheme in an earlier year (the latest), which a renewal continues. */
export async function lastAward(scheme, studentId, year) {
  if (!scheme) return null
  const earlier = await AcademicYear.find({ startDate: { $lt: year.startDate } }).select('_id').lean()
  return ScholarshipApplication.findOne({ schemeId: scheme._id, studentId, status: 'APPROVED', academicYearId: { $in: earlier.map((y) => y._id) } }).sort({ createdAt: -1 }).lean()
}

/** The scheme's renewal rule (marks and attendance this year) against a student. */
export function renewalChecks(scheme, facts) {
  const r = scheme.renewal ?? {}
  const out = []
  if (r.minMarksPct) out.push({ key: 'marks', value: facts.marksPct, need: r.minMarksPct, ok: facts.marksPct == null ? null : facts.marksPct >= r.minMarksPct })
  if (r.minAttendancePct) out.push({ key: 'attendance', value: facts.attendancePct, need: r.minAttendancePct, ok: facts.attendancePct == null ? null : facts.attendancePct >= r.minAttendancePct })
  return out
}

/** What a renewal is checked against: the scheme's rules except entry marks and attendance, plus the renewal rule. */
export function renewalEligibility(scheme, facts, opts = {}) {
  return [...eligibilityChecks(scheme, facts, opts).filter((c) => c.key !== 'marks' && c.key !== 'attendance'), ...renewalChecks(scheme, facts)]
}

/**
 * Last year's scholars of a scheme who are still here and haven't applied this year, each with the renewal rule and
 * the scheme's rules checked (`ok` false = does not renew, with why). Their checked documents carry over, so most
 * only give a new income certificate.
 */
async function renewalStudents(scheme, year, sections) {
  const earlier = await AcademicYear.find({ startDate: { $lt: year.startDate } }).select('_id name').sort({ startDate: -1 }).lean()
  const last = await ScholarshipApplication.find({ schemeId: scheme._id, status: 'APPROVED', academicYearId: { $in: earlier.map((y) => y._id) } }).select('studentId academicYearId applicationNo').lean()
  const applied = new Set((await ScholarshipApplication.find({ schemeId: scheme._id, academicYearId: year._id, status: { $nin: ['WITHDRAWN', 'NOT_APPROVED'] } }).select('studentId').lean()).map((a) => String(a.studentId)))
  const ids = [...new Set(last.map((a) => String(a.studentId)))].filter((id) => !applied.has(id))
  const students = await Student.find({ _id: { $in: ids.map(oid) }, status: 'ACTIVE', ...(sections && { sectionId: { $in: sections.map(oid) } }) }).select('firstName middleName lastName admissionNo classId sectionId category gender').lean()
  const facts = await factsOf(students, year)
  const names = await studentLabels(students.map((s) => s._id))
  const yearName = new Map(earlier.map((y) => [String(y._id), y.name]))
  return students.map((s) => {
    const f = facts.get(String(s._id))
    const checks = renewalEligibility(scheme, f)
    const prev = last.filter((a) => String(a.studentId) === String(s._id)).sort((a, b) => String(b.academicYearId).localeCompare(String(a.academicYearId)))[0]
    return { studentId: String(s._id), student: names.get(String(s._id)) ?? null, checks, ok: !checks.some((c) => c.ok === false), marksPct: f.marksPct, attendancePct: f.attendancePct, lastYear: yearName.get(String(prev?.academicYearId)) ?? null, lastNo: prev?.applicationNo ?? null }
  }).sort((a, b) => Number(b.ok) - Number(a.ok))
}

/**
 * Students in scope who can apply for a scheme and haven't yet this year — the office starts their applications in
 * one go instead of waiting for families to come asking. Income is not known yet, so it is checked on the certificate.
 */
export async function eligibleStudents(schemeId, { classId, sectionId, search, renewal = false } = {}, auth) {
  const scheme = isOid(schemeId) ? await ScholarshipScheme.findById(schemeId).lean() : null
  if (!scheme) throw notFound('Scheme')
  const year = await yearOrCurrent()
  const sections = await scopeSectionIds(auth)
  if (renewal) return { rows: await renewalStudents(scheme, year, sections), capped: false, renewal: true }
  const e = scheme.eligibility ?? {}
  const filter = { status: 'ACTIVE' }
  if (sections) filter.sectionId = { $in: sections.map(oid) }
  if (sectionId) filter.sectionId = sections && !sections.includes(String(sectionId)) ? { $in: [] } : oid(sectionId)
  if (classId) filter.classId = oid(classId)
  if (e.classIds?.length) filter.classId = classId ? (e.classIds.map(String).includes(String(classId)) ? oid(classId) : { $in: [] }) : { $in: e.classIds }
  if (e.categories?.length) filter.category = { $in: e.categories }
  if (e.genders?.length) filter.gender = { $in: e.genders }
  const q = String(search ?? '').trim()
  if (q) { const re = new RegExp(escapeRegex(q), 'i'); filter.$or = [{ firstName: re }, { lastName: re }, { admissionNo: re }] }
  const applied = (await ScholarshipApplication.find({ schemeId: scheme._id, academicYearId: year._id, status: { $nin: ['WITHDRAWN', 'NOT_APPROVED'] } }).select('studentId').lean()).map((a) => a.studentId)
  if (applied.length) filter._id = { $nin: applied }
  const students = await Student.find(filter).select('firstName middleName lastName admissionNo classId sectionId category gender').sort({ placeKey: 1, rollNo: 1 }).limit(500).lean()
  const facts = await factsOf(students, year)
  const rows = students
    .map((s) => ({ s, checks: eligibilityChecks(scheme, facts.get(String(s._id))) }))
    .filter((r) => !r.checks.some((c) => c.ok === false))
  const names = await studentLabels(rows.map((r) => r.s._id))
  return {
    rows: rows.map(({ s, checks }) => ({ studentId: String(s._id), student: names.get(String(s._id)) ?? null, checks, ok: true, marksPct: facts.get(String(s._id))?.marksPct ?? null, attendancePct: facts.get(String(s._id))?.attendancePct ?? null })),
    capped: students.length >= 500,
  }
}

/** Change what the office typed when applying (family income, marks), and re-run the checks. */
export async function updateApplication(id, { familyIncome, marksPct, note }, auth, req) {
  const app = await applicationInScope(id, auth)
  if (!OPEN.includes(app.status)) throw conflict('This application is already decided.')
  const [s, scheme, year] = await Promise.all([Student.findById(app.studentId).lean(), ScholarshipScheme.findById(app.schemeId).lean(), AcademicYear.findById(app.academicYearId).lean()])
  if (familyIncome !== undefined) app.familyIncome = familyIncome ?? undefined
  if (marksPct !== undefined) { app.marksPct = marksPct ?? undefined; app.marksFrom = marksPct != null ? 'ENTERED' : undefined }
  if (note !== undefined) app.note = note || undefined
  const facts = (await factsOf([s], year)).get(String(s._id))
  app.eligibility = eligibilityChecks(scheme, facts, { familyIncome: app.familyIncome, marksPct: app.marksFrom === 'ENTERED' ? app.marksPct : undefined })
  say(app, auth.user?.name, 'Details changed')
  await app.save()
  await audit({ action: 'UPDATE', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Changed the details of scholarship application ${app.applicationNo}` }, req)
  return getApplication(app._id, auth)
}

// ───────────────────────────────────────────────────────── documents on an application

async function lineOf(id, key, auth) {
  const app = await applicationInScope(id, auth)
  const item = app.items.find((i) => i.key === key)
  if (!item) throw notFound('Document')
  return { app, item }
}

async function walletDoc(app, item) {
  return (await ScholarshipDocument.findOne({ studentId: app.studentId, key: item.key }))
    ?? new ScholarshipDocument({ studentId: app.studentId, key: item.key, type: item.type, label: item.type === 'OTHER' ? item.label : undefined, status: 'NEW' })
}

/** The wallet record a checklist line's files go on (made the first time), so files can be uploaded to it. */
export async function documentFor(id, key, auth) {
  const { app, item } = await lineOf(id, key, auth)
  const doc = await walletDoc(app, item)
  if (doc.isNew) await doc.save()
  return { id: String(doc._id) }
}

/** The document's details, or "a paper copy was given" — it then waits to be checked. */
export async function saveDocument(id, key, { number, issuedOn, validTill, paperCopy }, auth, req) {
  const { app, item } = await lineOf(id, key, auth)
  if (!OPEN.includes(app.status)) throw conflict('This application is already decided.')
  const doc = await walletDoc(app, item)
  const who = auth.user?.name
  if (number !== undefined) doc.number = number || undefined
  if (issuedOn !== undefined) { doc.issuedOn = issuedOn || undefined; doc.validTill = validTill || scholarshipDocValidTill(doc.type, issuedOn) || undefined }
  else if (validTill !== undefined) doc.validTill = validTill || undefined
  if (paperCopy) {
    doc.paperCopy = true
    const expired = doc.status === 'ACCEPTED' && doc.validTill && doc.validTill < await today()
    if (doc.status !== 'ACCEPTED' || expired) doc.status = 'SUBMITTED'
    if (expired && issuedOn === undefined) { doc.issuedOn = undefined; doc.validTill = undefined } // the new paper's date is entered when it is checked
    doc.log.push({ at: new Date(), by: who, text: 'Paper copy received' })
  }
  await doc.save()
  await refreshStudent(app.studentId, auth, req)
  return getApplication(app._id, auth)
}

/**
 * Check one document: correct (with the original seen, when it was) or not, with the reason the family is told.
 * A document with an expiry (income certificate) needs the day it was issued.
 */
export async function checkDocument(id, key, { result, reason, note, originalSeen, number, issuedOn, validTill }, auth, req) {
  const { app, item } = await lineOf(id, key, auth)
  if (!OPEN.includes(app.status)) throw conflict('This application is already decided.')
  const doc = await walletDoc(app, item)
  const who = auth.user?.name
  const files = doc.isNew ? 0 : await Attachment.countDocuments({ entityType: 'scholarship_doc', entityId: String(doc._id), 'deleted.at': null })
  if (result === 'ACCEPT') {
    if (!files && !doc.paperCopy && !originalSeen) throw conflict('Nothing has been given for this document yet — add a photo or scan, mark the paper copy, or tick that you have seen the original.')
    const issued = issuedOn ?? doc.issuedOn
    const months = SCHOLARSHIP_DOC_TYPE_BY[doc.type]?.validMonths
    if (months && !issued && !validTill) throw fieldsError({ issuedOn: `Enter the day it was issued — it is good for ${months} months` })
    const till = validTill || (issuedOn ? scholarshipDocValidTill(doc.type, issuedOn) : doc.validTill)
    if (till && till < await today()) throw fieldsError({ issuedOn: 'This document has already expired — ask for a new one' })
    Object.assign(doc, { status: 'ACCEPTED', reason: undefined, reasonNote: undefined, issuedOn: issued || undefined, validTill: till || undefined })
    if (number !== undefined) doc.number = number || undefined
    if (originalSeen && !doc.originalSeen) Object.assign(doc, { originalSeen: true, originalSeenBy: who, originalSeenAt: new Date() })
    doc.log.push({ at: new Date(), by: who, text: originalSeen ? 'Correct — original seen' : 'Correct' })
  } else {
    if (!reason) throw fieldsError({ reason: 'Say what is wrong — the family is told this' })
    if (reason === 'OTHER' && !note?.trim()) throw fieldsError({ note: 'Write what is wrong' })
    Object.assign(doc, { status: 'NOT_ACCEPTED', reason, reasonNote: note?.trim() || undefined })
    doc.log.push({ at: new Date(), by: who, text: `Needs fixing: ${SCHOLARSHIP_REJECT_REASON_LABEL[reason]}${note ? ` — ${note}` : ''}` })
  }
  Object.assign(doc, { checkedBy: who, checkedById: auth.userId, checkedAt: new Date() })
  await doc.save()
  say(app, who, `${docLabel(item)}: ${result === 'ACCEPT' ? 'correct' : `needs fixing (${SCHOLARSHIP_REJECT_REASON_LABEL[reason].toLowerCase()})`}`)
  await app.save()
  await audit({ action: result === 'ACCEPT' ? 'APPROVE' : 'REJECT', module: 'scholarships', entityType: 'scholarship_document', entityId: String(doc._id), entityName: docLabel(item), studentId: app.studentId, summary: `${docLabel(item)} for ${app.applicationNo}: ${result === 'ACCEPT' ? 'correct' : `needs fixing — ${SCHOLARSHIP_REJECT_REASON_LABEL[reason]}`}` }, req)
  await refreshStudent(app.studentId, auth, req)
  return getApplication(app._id, auth)
}

/** The original was seen at the office (the copy was already checked online). */
export async function markOriginalSeen(id, key, auth, req) {
  const { app, item } = await lineOf(id, key, auth)
  const doc = await ScholarshipDocument.findOne({ studentId: app.studentId, key: item.key })
  if (!doc || doc.status !== 'ACCEPTED') throw conflict('Check the copy first.')
  Object.assign(doc, { originalSeen: true, originalSeenBy: auth.user?.name, originalSeenAt: new Date() })
  doc.log.push({ at: new Date(), by: auth.user?.name, text: 'Original seen' })
  await doc.save()
  await audit({ action: 'UPDATE', module: 'scholarships', entityType: 'scholarship_document', entityId: String(doc._id), entityName: docLabel(item), studentId: app.studentId, summary: `Saw the original ${docLabel(item)} for ${app.applicationNo}` }, req)
  await refreshStudent(app.studentId, auth, req)
  return getApplication(app._id, auth)
}

// ───────────────────────────────────────────────────────── telling the family

const PENDING_TEXT = {
  MISSING: () => 'please give it',
  NOT_ACCEPTED: (l) => `${(SCHOLARSHIP_REJECT_REASON_LABEL[l.doc?.reason] ?? 'needs fixing').toLowerCase()}${l.doc?.reasonNote ? ` (${l.doc.reasonNote})` : ''}`,
  EXPIRED: () => 'the one we have has expired — a new one is needed',
  ORIGINAL_DUE: () => 'please book a time in the school app and show the original at the office',
}

async function tellFamilyOne(app, scheme, auth, req) {
  const t = await today()
  const lines = (await linesOf([app.toObject ? app.toObject() : app], t)).get(String(app._id)).filter((l) => PENDING_TEXT[l.state] && (l.required || l.state !== 'MISSING'))
  if (!lines.length) throw conflict('Nothing is pending from the family.')
  const list = lines.map((l) => `• ${l.label} — ${PENDING_TEXT[l.state](l)}`).join('\n')
  await emit('scholarships.documents_needed', await familyData(app, scheme, { documents: list, lastDate: scheme.lastDate ? humanDate(scheme.lastDate) : '' }))
  const doc = app.toObject ? app : await ScholarshipApplication.findById(app._id)
  doc.familyToldAt = new Date()
  say(doc, auth.user?.name, `Family told what is pending (${lines.length})`)
  await doc.save()
  await audit({ action: 'SEND', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Told the family of ${app.applicationNo} the ${lines.length} document(s) still needed` }, req)
  return lines.length
}

/** One message to each family listing only what is still needed or wrong (and why). */
export async function tellFamilies(ids, auth, req) {
  let sent = 0
  const skipped = []
  for (const id of ids) {
    try {
      const app = await applicationInScope(id, auth)
      if (!OPEN.includes(app.status)) throw conflict('Already decided.')
      const scheme = await ScholarshipScheme.findById(app.schemeId).lean()
      await tellFamilyOne(app, scheme, auth, req)
      sent++
    } catch (err) {
      skipped.push({ id, message: err.message })
    }
  }
  return { sent, skipped }
}

// ───────────────────────────────────────────────────────── decisions

/**
 * Approve or refuse applications — one, or a whole list at once. Approving needs every required document correct;
 * a list is approved in merit order, so the seats go to the top of the list. Whoever started an application can't
 * approve it themselves.
 */
export async function decideApplications(ids, approve, note, auth, req) {
  const apps = []
  for (const id of ids) apps.push(await applicationInScope(id, auth))
  const schemes = new Map((await ScholarshipScheme.find({ _id: { $in: apps.map((a) => a.schemeId) } }).lean()).map((x) => [String(x._id), x]))
  apps.sort((a, b) => compareRank(schemes.get(String(a.schemeId)), a, b))
  let done = 0
  const skipped = []
  for (const app of apps) {
    const scheme = schemes.get(String(app.schemeId))
    try {
      if (!OPEN.includes(app.status)) throw conflict('Already decided.')
      if (String(app.createdById) === String(auth.userId) && !auth.fullAccess) throw forbidden('Someone other than the person who started it must decide.')
      if (approve) {
        await refresh(app, auth, req)
        if (app.status === 'APPROVED') { done++; continue } // approved on its own just now
        if (app.status !== 'READY') throw conflict('Some documents are still to be given or checked.')
        await approveOne(app, scheme, auth, req, { note })
      } else {
        if (!note?.trim()) throw fieldsError({ note: 'Write the reason — the family is told' })
        Object.assign(app, { status: 'NOT_APPROVED', decidedBy: auth.user?.name, decidedById: auth.userId, decidedAt: new Date(), decisionNote: note.trim() })
        say(app, auth.user?.name, `Not approved — ${note.trim()}`)
        await app.save()
        await endScholarshipHold(app.studentId, app.academicYearId)
        await audit({ action: 'REJECT', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Did not approve scholarship ${app.applicationNo} (${scheme.name}): ${note.trim()}` }, req)
        await emit('scholarships.not_approved', await familyData(app, scheme, { reason: note.trim() }))
      }
      done++
    } catch (err) {
      skipped.push({ id: String(app._id), applicationNo: app.applicationNo, message: err.message })
    }
  }
  return { done, skipped }
}

// ───────────────────────────────────────────────────────── government portal and money

/**
 * Where applications stand on the government portal — one, or a whole list at once (after verifying a batch on the
 * portal). The portal's own application id is kept for one application at a time. A sanctioned amount becomes what the
 * application is worth (the fees held, the money awaited).
 */
export async function updatePortal(ids, { status, applicationId, sanctionedAmount, note }, auth, req) {
  if (ids.length > 1 && applicationId) throw badRequest('The portal’s application id is entered one application at a time.')
  let done = 0
  const skipped = []
  for (const id of ids) {
    try {
      const app = await applicationInScope(id, auth)
      if (app.status === 'WITHDRAWN') throw conflict('This application was withdrawn.')
      const p = app.portal ?? {}
      if (applicationId !== undefined) p.applicationId = applicationId || undefined
      if (status && status !== p.status) {
        p.status = status
        p.statusOn = new Date()
        p.history = [...(p.history ?? []), { at: new Date(), by: auth.user?.name, status, note: note || undefined }]
      }
      if (note !== undefined) p.note = note || undefined
      if (sanctionedAmount != null) {
        p.sanctionedAmount = sanctionedAmount
        app.expectedAmount = sanctionedAmount
      }
      app.portal = p
      app.markModified('portal')
      say(app, auth.user?.name, `Portal: ${SCHOLARSHIP_PORTAL_STATUS[p.status]?.label ?? 'details changed'}${p.applicationId ? ` (${p.applicationId})` : ''}${note ? ` — ${note}` : ''}`)
      await app.save()
      await audit({ action: 'UPDATE', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Portal status of ${app.applicationNo}: ${SCHOLARSHIP_PORTAL_STATUS[p.status]?.label ?? '—'}` }, req)
      done++
    } catch (err) {
      skipped.push({ id, message: err.message })
    }
  }
  return { done, skipped }
}

/**
 * Money a government or trust paid the institution for approved students (benefit PAID_TO_INSTITUTION): each becomes
 * a fee receipt (mode SCHOLARSHIP) against the student's dues, posted to Accounts like any receipt. When the whole
 * expected amount has come (or `final`: nothing more will come), the fees are no longer held.
 */
export async function recordMoney(rows, { date, reference, final = false }, auth, req) {
  let done = 0
  const skipped = []
  for (const r of rows) {
    try {
      const app = await applicationInScope(r.id, auth)
      if (app.status !== 'APPROVED' || !app.awaitingMoney) throw conflict('No money is awaited on this application.')
      const scheme = await ScholarshipScheme.findById(app.schemeId).select('name').lean()
      const receipt = await collect({ studentId: app.studentId, amount: r.amount, mode: 'SCHOLARSHIP', reference: reference || app.portal?.applicationId || undefined, note: `${scheme?.name ?? 'Scholarship'} — ${app.applicationNo}`, scholarship: true }, auth, req)
      const got = [...(app.received ?? []), { at: new Date(), date: date || receipt.date, amount: r.amount, receiptId: receipt.id, receiptNo: receipt.receiptNo, reference: reference || undefined, by: auth.user?.name }]
      app.received = got
      const total = got.reduce((n, x) => n + x.amount, 0)
      if (final || r.final || total >= (app.expectedAmount ?? 0)) app.awaitingMoney = false
      if (!app.awaitingMoney && app.portal) { app.portal.status = 'PAID'; app.markModified('portal') }
      say(app, auth.user?.name, `${formatINR(r.amount)} received (receipt ${receipt.receiptNo})${app.awaitingMoney ? '' : ' — nothing more awaited'}`)
      await app.save()
      if (!app.awaitingMoney) await endScholarshipHold(app.studentId, app.academicYearId)
      await audit({ action: 'CREATE', module: 'scholarships', entityType: 'scholarship_money', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Recorded ${formatINR(r.amount)} of scholarship money for ${app.applicationNo} (receipt ${receipt.receiptNo})` }, req)
      done++
    } catch (err) {
      skipped.push({ id: r.id, message: err.message })
    }
  }
  return { done, skipped }
}

/** Withdraw an application (the family no longer wants it, or it was made by mistake). An approved one takes its fee concession back. */
export async function withdrawApplication(id, reason, auth, req) {
  const app = await applicationInScope(id, auth)
  if (!OPEN.includes(app.status) && app.status !== 'APPROVED') throw conflict('This application is not active.')
  if (app.status === 'APPROVED' && !can(auth, 'scholarships.applications.approve')) throw forbidden('Only someone who approves scholarships can withdraw an approved one.')
  const was = app.status
  await withTransaction(async () => {
    if (was === 'APPROVED') await withdrawScholarshipConcession(app.concessionId)
    app.status = 'WITHDRAWN'
    app.awaitingMoney = false
    say(app, auth.user?.name, `Withdrawn — ${reason}`)
    await app.save()
  })
  await endScholarshipHold(app.studentId, app.academicYearId)
  await audit({ action: 'CANCEL', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Withdrew scholarship ${app.applicationNo}${was === 'APPROVED' ? ' (it was approved; the fee concession is taken back)' : ''}: ${reason}` }, req)
  return getApplication(app._id, auth)
}

/** At the counter: every original still to be seen on this application was seen — one click. */
export async function markAllOriginalsSeen(id, auth, req) {
  const app = await applicationInScope(id, auth)
  if (!OPEN.includes(app.status)) throw conflict('This application is already decided.')
  const t = await today()
  const due = (await linesOf([app.toObject()], t)).get(String(app._id)).filter((l) => l.state === 'ORIGINAL_DUE')
  if (!due.length) throw conflict('No originals are waiting to be seen.')
  const who = auth.user?.name
  await ScholarshipDocument.updateMany(
    { _id: { $in: due.map((l) => l.doc._id) } },
    { $set: { originalSeen: true, originalSeenBy: who, originalSeenAt: new Date() }, $push: { log: { at: new Date(), by: who, text: 'Original seen' } } },
  )
  if (app.visit?.dayId) app.visit.attended = true
  say(app, who, `Originals seen (${due.map((l) => l.label).join(', ')})`)
  await app.save()
  await audit({ action: 'UPDATE', module: 'scholarships', entityType: 'scholarship_application', entityId: String(app._id), entityName: app.applicationNo, studentId: app.studentId, summary: `Saw ${due.length} original(s) for ${app.applicationNo}` }, req)
  await refreshStudent(app.studentId, auth, req)
  return getApplication(app._id, auth)
}

// ───────────────────────────────────────────────────────── beneficiaries & money (the report)

/**
 * A year's scholarships at a glance, in the caller's scope: by scheme (applied, approved, worth, received, awaited,
 * seats and budget used), by category, by class and by who gives it, and the list of beneficiaries (for export —
 * NAAC 5.1, UDISE+, the trust's report).
 */
export async function scholarshipReport({ academicYearId } = {}, auth) {
  const year = await yearOrCurrent(academicYearId)
  const sections = await scopeSectionIds(auth)
  const apps = await ScholarshipApplication.find({ academicYearId: year._id, status: { $ne: 'WITHDRAWN' }, ...(sections && { sectionId: { $in: sections.map(oid) } }) })
    .select('schemeId studentId status expectedAmount received awaitingMoney decidedAt applicationNo holdFees').lean()
  const [schemes, students, classes] = await Promise.all([
    ScholarshipScheme.find({ _id: { $in: [...new Set(apps.map((a) => String(a.schemeId)))] } }).lean(),
    Student.find({ _id: { $in: [...new Set(apps.map((a) => String(a.studentId)))].map(oid) } }).select('category classId gender').lean(),
    ClassLevel.find().select('name order').sort({ order: 1 }).lean(),
  ])
  const schemeOf = new Map(schemes.map((x) => [String(x._id), x]))
  const studentOf = new Map(students.map((x) => [String(x._id), x]))
  const got = (a) => (a.received ?? []).reduce((n, r) => n + (r.amount ?? 0), 0)
  const approved = apps.filter((a) => a.status === 'APPROVED')
  const group = (keyOf) => {
    const m = new Map()
    for (const a of approved) {
      const k = keyOf(a) ?? 'NONE'
      if (!m.has(k)) m.set(k, { key: k, students: new Set(), amount: 0 })
      const g = m.get(k)
      g.students.add(String(a.studentId))
      g.amount += a.expectedAmount ?? 0
    }
    return [...m.values()].map((g) => ({ key: g.key, students: g.students.size, amount: g.amount })).sort((x, y) => y.students - x.students)
  }
  const classOrder = new Map(classes.map((c, i) => [String(c._id), i]))
  const className = new Map(classes.map((c) => [String(c._id), c.name]))
  const names = await studentLabels(approved.map((a) => a.studentId))
  return {
    year: { id: String(year._id), name: year.name },
    totals: {
      applied: apps.length, approved: approved.length, students: new Set(approved.map((a) => String(a.studentId))).size,
      amount: approved.reduce((n, a) => n + (a.expectedAmount ?? 0), 0), received: apps.reduce((n, a) => n + got(a), 0),
      awaited: apps.filter((a) => a.awaitingMoney).reduce((n, a) => n + Math.max(0, (a.expectedAmount ?? 0) - got(a)), 0),
      held: apps.filter((a) => OPEN.includes(a.status) && a.holdFees).reduce((n, a) => n + (a.expectedAmount ?? 0), 0),
      open: apps.filter((a) => OPEN.includes(a.status)).length,
    },
    schemes: schemes.map((x) => {
      const mine = apps.filter((a) => String(a.schemeId) === String(x._id))
      const ok = mine.filter((a) => a.status === 'APPROVED')
      return {
        id: String(x._id), name: x.name, provider: x.provider, benefit: x.benefit, kind: x.kind, value: x.value, valueText: scholarshipValueText(x, formatINR), seats: x.seats ?? null, budget: x.budget ?? null,
        applied: mine.length, approved: ok.length, notApproved: mine.filter((a) => a.status === 'NOT_APPROVED').length, open: mine.filter((a) => OPEN.includes(a.status)).length,
        amount: ok.reduce((n, a) => n + (a.expectedAmount ?? 0), 0), received: mine.reduce((n, a) => n + got(a), 0),
        awaited: mine.filter((a) => a.awaitingMoney).reduce((n, a) => n + Math.max(0, (a.expectedAmount ?? 0) - got(a)), 0),
      }
    }).sort((a, b) => b.approved - a.approved),
    byProvider: group((a) => schemeOf.get(String(a.schemeId))?.provider),
    byCategory: group((a) => studentOf.get(String(a.studentId))?.category),
    byClass: group((a) => idStr(studentOf.get(String(a.studentId))?.classId)).map((g) => ({ ...g, name: className.get(g.key) ?? null })).sort((x, y) => (classOrder.get(x.key) ?? 99) - (classOrder.get(y.key) ?? 99)),
    beneficiaries: approved.map((a) => {
      const st = studentOf.get(String(a.studentId))
      const x = schemeOf.get(String(a.schemeId))
      return {
        id: String(a._id), applicationNo: a.applicationNo, student: names.get(String(a.studentId)) ?? null, category: st?.category ?? null, gender: st?.gender ?? null,
        scheme: x?.name ?? null, provider: x?.provider ?? null, amount: a.expectedAmount ?? 0, received: got(a), awaitingMoney: !!a.awaitingMoney, decidedAt: a.decidedAt ?? null,
      }
    }),
  }
}

// ───────────────────────────────────────────────────────── visit times for originals

const visitDayDto = (d, booked = 0) => ({ ...clean(d), branchId: idStr(d.branchId), times: scholarshipVisitTimes(d), booked })

/** Visit days from today on (or every one), with how many families have booked. */
export async function listVisitDays({ all = false } = {}) {
  const t = await today()
  const days = await ScholarshipVisitDay.find(all ? {} : { date: { $gte: t } }).sort({ date: 1, from: 1 }).limit(200).lean()
  const counts = days.length ? await ScholarshipApplication.aggregate([
    { $match: { 'visit.dayId': { $in: days.map((d) => d._id) }, status: { $ne: 'WITHDRAWN' } } },
    { $group: { _id: '$visit.dayId', n: { $sum: 1 } } },
  ]) : []
  const n = new Map(counts.map((c) => [String(c._id), c.n]))
  return days.map((d) => visitDayDto(d, n.get(String(d._id)) ?? 0))
}

export async function saveVisitDay(id, input, auth, req) {
  if (input.from >= input.to) throw fieldsError({ to: 'Make the end later than the start' })
  if (!scholarshipVisitTimes(input).length) throw fieldsError({ slotMinutes: 'No time fits between the start and the end' })
  const d = id ? await ScholarshipVisitDay.findById(id) : new ScholarshipVisitDay()
  if (!d) throw notFound('Visit day')
  if (id && await ScholarshipApplication.exists({ 'visit.dayId': d._id, status: { $ne: 'WITHDRAWN' }, $or: [{ 'visit.time': { $lt: input.from } }, { 'visit.time': { $gte: input.to } }] })) {
    throw conflict('Families have booked times outside the new hours. Keep those hours, or move them first.')
  }
  Object.assign(d, { ...input, branchId: input.branchId || undefined })
  await d.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'scholarships', entityType: 'scholarship_visit_day', entityId: String(d._id), entityName: d.date, summary: `${id ? 'Changed' : 'Added'} scholarship visit times on ${d.date} (${d.from}–${d.to})` }, req)
  return visitDayDto(d.toObject())
}

export async function deleteVisitDay(id, auth, req) {
  const d = isOid(id) ? await ScholarshipVisitDay.findById(id) : null
  if (!d) throw notFound('Visit day')
  if (await ScholarshipApplication.exists({ 'visit.dayId': d._id, status: { $in: OPEN } })) throw conflict('Families have booked a time on this day. Switch it off instead, so nobody else books.')
  await d.deleteOne()
  await audit({ action: 'DELETE', module: 'scholarships', entityType: 'scholarship_visit_day', entityId: String(d._id), entityName: d.date, summary: `Deleted scholarship visit times on ${d.date}` }, req)
  return { deleted: true }
}

/** Who is coming on a visit day, by time — the desk's list (in the caller's scope). */
export async function visitDayBookings(id, auth) {
  const d = isOid(id) ? await ScholarshipVisitDay.findById(id).lean() : null
  if (!d) throw notFound('Visit day')
  const sections = await scopeSectionIds(auth)
  const apps = await ScholarshipApplication.find({ 'visit.dayId': d._id, status: { $ne: 'WITHDRAWN' }, ...(sections && { sectionId: { $in: sections.map(oid) } }) }).sort({ 'visit.time': 1 }).lean()
  const t = await today()
  const [names, lines, schemes] = await Promise.all([
    studentLabels(apps.map((a) => a.studentId)), linesOf(apps, t),
    ScholarshipScheme.find({ _id: { $in: apps.map((a) => a.schemeId) } }).select('name').lean().then((x) => new Map(x.map((y) => [String(y._id), y.name]))),
  ])
  return {
    day: visitDayDto(d, apps.length),
    rows: apps.map((a) => ({
      id: String(a._id), applicationNo: a.applicationNo, status: a.status, time: a.visit.time, attended: !!a.visit.attended,
      student: names.get(String(a.studentId)) ?? null, scheme: schemes.get(String(a.schemeId)) ?? null,
      originals: (lines.get(String(a._id)) ?? []).filter((l) => l.state === 'ORIGINAL_DUE').map((l) => l.label),
    })),
  }
}

/** Free times of the coming visit days for a student's campus: [{ id, date, place, times: [{ time, free }] }]. */
export async function freeVisitTimes(branchId) {
  const now = await institutionNow()
  const days = await ScholarshipVisitDay.find({ active: true, date: { $gte: now.date }, $or: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] }).sort({ date: 1, from: 1 }).limit(20).lean()
  if (!days.length) return []
  const taken = await ScholarshipApplication.aggregate([
    { $match: { 'visit.dayId': { $in: days.map((d) => d._id) }, status: { $in: OPEN } } },
    { $group: { _id: { d: '$visit.dayId', t: '$visit.time' }, n: { $sum: 1 } } },
  ])
  const n = new Map(taken.map((x) => [`${x._id.d}|${x._id.t}`, x.n]))
  return days.map((d) => ({
    id: String(d._id), date: d.date, place: d.place ?? null, note: d.note ?? null,
    times: scholarshipVisitTimes(d).filter((tm) => d.date > now.date || tm > now.time).map((tm) => ({ time: tm, free: Math.max(0, (d.perSlot ?? 1) - (n.get(`${d._id}|${tm}`) ?? 0)) })),
  })).filter((d) => d.times.some((x) => x.free > 0))
}

// ───────────────────────────────────────────────────────── scan (services/scan.js)

/** A scanned application number (the QR in the family app) → the application, for people who work on scholarships. */
export async function scholarshipScanResult(code, auth, can) {
  if (!/^[A-Z0-9/-]{4,30}$/.test(code) || !can('scholarships.applications.view')) return null
  const a = await ScholarshipApplication.findOne({ applicationNo: code }).lean()
  if (!a) return null
  const sections = await scopeSectionIds(auth)
  if (sections && !sections.includes(String(a.sectionId))) return null
  const [label, scheme] = await Promise.all([studentLabels([a.studentId]).then((m) => m.get(String(a.studentId))), ScholarshipScheme.findById(a.schemeId).select('name').lean()])
  return {
    kind: 'SCHOLARSHIP', id: String(a._id), title: label?.name ?? a.applicationNo,
    subtitle: [scheme?.name, a.applicationNo, label?.classShort, a.visit?.time && a.visit.date ? `${a.visit.date} ${a.visit.time}` : null].filter(Boolean).join(' · '),
    status: a.status, actions: [{ key: 'scholarshipOpen', link: `/scholarships/applications/${a._id}` }],
  }
}

// ───────────────────────────────────────────────────────── files (services/files.js RECORDS.scholarship_doc)

/** A wallet document as a file record: its student and a name; staff in scope who work on scholarships. */
export async function scholarshipDocRecord(id, auth) {
  const d = isOid(id) ? await ScholarshipDocument.findById(id).lean() : null
  if (!d) return null
  const s = await Student.findById(d.studentId).select('firstName middleName lastName admissionNo sectionId').lean()
  if (!s) return null
  const sections = await scopeSectionIds(auth)
  if (sections && !sections.includes(String(s.sectionId))) return null
  return { studentId: s._id, name: `${docLabel(d)} · ${studentName(s)} (${s.admissionNo})` }
}
