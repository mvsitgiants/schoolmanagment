import {
  CERTIFICATE_KIND_BY, PAYMENT_MODES, REPORTS, REPORT_BY, attendancePct, countMarks, formatINR, nextRunAt, resolveRange, sectionLabel,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { AcademicYear, ClassLevel, Section, Subject } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Certificate } from '../models/certificates.js'
import { MessageLog } from '../models/engines.js'
import { Exam, ExamCandidate, ExamPaper, MarkSheet } from '../models/exams.js'
import { Concession, FeeInvoice, FeePayment, FeeRefund } from '../models/fees.js'
import { Homework } from '../models/homework.js'
import { Tenant } from '../models/platform.js'
import { SavedReport } from '../models/reports.js'
import { Student, studentName } from '../models/students.js'
import { Branch, User } from '../models/tenant.js'
import { can, loadAccess, moduleEnabled, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, forbidden, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { institutionNow } from '../platform/time.js'
import { currentYear, sectionsInScope } from './academics.js'
import { splitByHead } from './certificates.js'
import { notifyUsers } from './notify.js'

// Reports (module `reports`): the standard library (definitions in @schoolgiant/shared reports.js)
// and saved reports. Every report keeps to the caller's data scope in the report's own module —
// a class teacher's "Low attendance" lists only their sections, a campus accountant's "Fee
// collection" only their campus. Scheduled saved reports run as the person who saved them.

const today = async () => (await institutionNow()).date
const byRoll = { locale: 'en', numericOrdering: true }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The campus filter for a module with campus scopes (BRANCH → the user's campus; main campus also gets records with none). */
async function branchFilterFor(auth, moduleId) {
  if (scopeOf(auth, moduleId) === 'ALL' || !auth.user?.branchId) return {}
  const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
  return String(auth.user.branchId) === String(main) ? { branchId: { $in: [auth.user.branchId, null] } } : { branchId: auth.user.branchId }
}

/** This year's sections the caller may see in a module, with labels, in class order. */
async function sectionsFor(auth, moduleId, yearId) {
  const year = yearId ? await AcademicYear.findById(yearId).lean() : await currentYear()
  if (!year) return []
  const allowed = await sectionsInScope(auth, moduleId)
  const sections = await Section.find({ academicYearId: year._id, active: { $ne: false }, ...(allowed && { _id: { $in: allowed } }) }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
  return sections
    .filter((s) => classes.has(String(s.classId)))
    .map((s) => ({ ...s, cls: classes.get(String(s.classId)), label: sectionLabel(classes.get(String(s.classId)), s), short: sectionLabel(classes.get(String(s.classId)), s, { short: true }) }))
    .sort((a, b) => (a.cls.order - b.cls.order) || a.name.localeCompare(b.name))
}

const primaryGuardian = (s) => s.guardians?.find((g) => g.isPrimary) ?? s.guardians?.[0] ?? null

async function labelsOf(sectionIds) {
  const sections = await Section.find({ _id: { $in: sectionIds } }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), { short: sectionLabel(classes.get(String(s.classId)), s, { short: true }), order: classes.get(String(s.classId))?.order ?? 0 }]))
}

// ───────────────────────────────────────────────────────── the runners

const RUNNERS = {
  async 'students.strength'(p, auth) {
    const sections = await sectionsFor(auth, 'students')
    const counts = await Student.aggregate([
      { $match: { status: 'ACTIVE', sectionId: { $in: sections.map((s) => s._id) } } },
      { $group: { _id: { s: '$sectionId', g: '$gender' }, n: { $sum: 1 } } },
    ])
    return sections.map((s) => {
      const mine = counts.filter((c) => String(c._id.s) === String(s._id))
      const n = (g) => mine.filter((c) => (g === 'OTHER' ? !['MALE', 'FEMALE'].includes(c._id.g) : c._id.g === g)).reduce((x, c) => x + c.n, 0)
      return { class: s.cls.name, section: s.name, boys: n('MALE'), girls: n('FEMALE'), other: n('OTHER'), total: mine.reduce((x, c) => x + c.n, 0) }
    })
  },

  async 'students.admissions'(p, auth) {
    const allowed = await sectionsInScope(auth, 'students')
    const rows = await Student.find({ admissionDate: { $gte: p.range.from, $lte: p.range.to }, ...(allowed && { sectionId: { $in: allowed } }) }).sort({ admissionDate: 1, admissionNo: 1 }).limit(5000).lean()
    const labels = await labelsOf(rows.map((r) => r.sectionId).filter(Boolean))
    return rows.map((s) => {
      const g = primaryGuardian(s)
      return { admissionDate: s.admissionDate, admissionNo: s.admissionNo, name: studentName(s), class: labels.get(String(s.sectionId))?.short ?? '—', gender: s.gender ?? '', guardian: g?.name ?? '', mobile: g?.mobile ?? '' }
    })
  },

  async 'students.contacts'(p, auth) {
    const sections = await sectionsFor(auth, 'students')
    if (!sections.some((s) => String(s._id) === String(p.sectionId))) throw notFound('Section')
    const rows = await Student.find({ sectionId: p.sectionId, status: 'ACTIVE' }).collation(byRoll).sort({ rollNo: 1, firstName: 1 }).lean()
    return rows.map((s) => {
      const g = primaryGuardian(s)
      return { rollNo: s.rollNo ?? '', name: studentName(s), admissionNo: s.admissionNo, guardian: g?.name ?? '', relation: g?.relation ?? '', mobile: g?.mobile ?? '', email: g?.email ?? '' }
    })
  },

  async 'students.birthdays'(p, auth) {
    const allowed = await sectionsInScope(auth, 'students')
    const mm = String(p.month).padStart(2, '0')
    const rows = await Student.find({ status: 'ACTIVE', dob: new RegExp(`^\\d{4}-${mm}-`), ...(allowed && { sectionId: { $in: allowed } }) }).lean()
    const labels = await labelsOf(rows.map((r) => r.sectionId).filter(Boolean))
    const year = Number((await today()).slice(0, 4))
    return rows
      .map((s) => ({ day: Number(s.dob.slice(8, 10)), name: studentName(s), class: labels.get(String(s.sectionId))?.short ?? '—', dob: s.dob, age: year - Number(s.dob.slice(0, 4)) }))
      .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name))
  },

  async 'attendance.daily'(p, auth) {
    const sections = await sectionsFor(auth, 'attendance')
    const ids = sections.map((s) => s._id)
    const [sheets, strength] = await Promise.all([
      AttendanceSheet.find({ sectionId: { $in: ids }, date: p.date, period: 0 }).lean(),
      Student.aggregate([{ $match: { sectionId: { $in: ids }, status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]),
    ])
    const size = new Map(strength.map((r) => [String(r._id), r.n]))
    return sections.map((s) => {
      const sh = sheets.find((x) => String(x.sectionId) === String(s._id))
      if (!sh) return { class: s.short, strength: size.get(String(s._id)) ?? 0, present: null, absent: null, late: null, leave: null, pct: null, takenBy: '— not marked —' }
      const c = countMarks(sh.entries)
      return { class: s.short, strength: size.get(String(s._id)) ?? 0, present: c.P + c.HD, absent: c.A, late: c.L, leave: c.LV, pct: attendancePct(c), takenBy: sh.updatedBy || sh.takenBy || '' }
    })
  },

  async 'attendance.defaulters'(p, auth) {
    let sections = await sectionsFor(auth, 'attendance')
    if (p.sectionId) sections = sections.filter((s) => String(s._id) === String(p.sectionId))
    const ids = sections.map((s) => s._id)
    const agg = await AttendanceSheet.aggregate([
      { $match: { sectionId: { $in: ids }, period: 0, date: { $gte: p.range.from, $lte: p.range.to } } },
      { $unwind: '$entries' },
      { $group: { _id: { st: '$entries.studentId', m: '$entries.status' }, n: { $sum: 1 } } },
    ])
    const per = new Map()
    for (const a of agg) {
      const k = String(a._id.st)
      const c = per.get(k) ?? { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 }
      c[a._id.m] = (c[a._id.m] ?? 0) + a.n
      c.total += a.n
      per.set(k, c)
    }
    const students = await Student.find({ _id: { $in: [...per.keys()] }, status: 'ACTIVE', sectionId: { $in: ids } }).lean()
    const label = new Map(sections.map((s) => [String(s._id), s]))
    return students
      .map((s) => {
        const c = per.get(String(s._id))
        const g = primaryGuardian(s)
        return { order: label.get(String(s.sectionId))?.cls.order ?? 0, class: label.get(String(s.sectionId))?.short ?? '—', rollNo: s.rollNo ?? '', name: studentName(s), days: c.total, attended: c.P + c.L + 0.5 * c.HD, absent: c.A, pct: attendancePct(c), guardian: g?.name ?? '', mobile: g?.mobile ?? '' }
      })
      .filter((r) => r.pct !== null && r.pct < Number(p.below))
      .sort((a, b) => a.pct - b.pct || a.order - b.order)
      .map(({ order, ...r }) => r) // eslint-disable-line no-unused-vars
  },

  async 'fees.collection'(p, auth) {
    const f = await branchFilterFor(auth, 'fees')
    const range = { $gte: p.range.from, $lte: p.range.to }
    const [pays, refunds] = await Promise.all([
      FeePayment.aggregate([{ $match: { ...f, status: 'VALID', date: range } }, { $group: { _id: { d: '$date', m: '$mode' }, amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
      FeeRefund.aggregate([{ $match: { ...f, date: range } }, { $group: { _id: '$date', amount: { $sum: '$amount' } } }]),
    ])
    const dates = [...new Set([...pays.map((x) => x._id.d), ...refunds.map((x) => x._id)])].sort()
    return dates.map((d) => {
      const row = { date: d, receipts: 0, refunds: refunds.find((r) => r._id === d)?.amount ?? 0 }
      for (const m of PAYMENT_MODES) row[m.value] = 0
      for (const x of pays.filter((y) => y._id.d === d)) { row[x._id.m] = (row[x._id.m] ?? 0) + x.amount; row.receipts += x.n }
      row.net = PAYMENT_MODES.reduce((n, m) => n + row[m.value], 0) - row.refunds
      return row
    })
  },

  async 'fees.headwise'(p, auth) {
    const f = await branchFilterFor(auth, 'fees')
    const payments = await FeePayment.find({ ...f, status: 'VALID', date: { $gte: p.range.from, $lte: p.range.to } }).lean()
    const { heads } = await splitByHead(payments)
    const total = heads.reduce((n, h) => n + h.amount, 0)
    return heads.map((h) => ({ head: h.name, amount: h.amount, share: total ? Math.round((h.amount / total) * 1000) / 10 : 0 }))
  },

  async 'fees.classDues'(p, auth) {
    const year = await currentYear()
    if (!year) return []
    const f = await branchFilterFor(auth, 'fees')
    const t = await today()
    const agg = await FeeInvoice.aggregate([
      { $match: { ...f, academicYearId: year._id, status: { $ne: 'CANCELLED' } } },
      { $group: {
        _id: '$sectionId', billed: { $sum: '$net' }, paid: { $sum: '$paid' }, due: { $sum: '$balance' },
        overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', t] }, { $gt: ['$balance', 0] }] }, '$balance', 0] } },
        owing: { $addToSet: { $cond: [{ $gt: ['$balance', 0] }, '$studentId', null] } },
      } },
    ])
    const labels = await labelsOf(agg.map((a) => a._id).filter(Boolean))
    return agg
      .map((a) => ({ order: labels.get(String(a._id))?.order ?? 999, class: labels.get(String(a._id))?.short ?? '—', students: a.owing.filter(Boolean).length, billed: a.billed, paid: a.paid, due: a.due, overdue: a.overdue, pct: a.billed ? Math.round((a.paid / a.billed) * 1000) / 10 : null }))
      .sort((a, b) => a.order - b.order || a.class.localeCompare(b.class))
      .map(({ order, ...r }) => r) // eslint-disable-line no-unused-vars
  },

  async 'fees.concessions'(p, auth) {
    const year = await currentYear()
    if (!year) return []
    const f = await branchFilterFor(auth, 'fees')
    const students = f.branchId ? (await Student.find(f).select('_id').lean()).map((s) => s._id) : null
    const rows = await Concession.find({ academicYearId: year._id, status: 'APPROVED', ...(students && { studentId: { $in: students } }) }).lean()
    const ids = [...new Set(rows.map((r) => String(r.studentId)))]
    const [st, inv] = await Promise.all([
      Student.find({ _id: { $in: ids } }).select('firstName middleName lastName sectionId').lean(),
      FeeInvoice.aggregate([{ $match: { academicYearId: year._id, studentId: { $in: ids.map(oid) }, status: { $ne: 'CANCELLED' } } }, { $group: { _id: '$studentId', c: { $sum: '$concession' } } }]),
    ])
    const labels = await labelsOf(st.map((s) => s.sectionId).filter(Boolean))
    const off = new Map(inv.map((i) => [String(i._id), i.c]))
    return st.map((s) => {
      const mine = rows.filter((r) => String(r.studentId) === String(s._id))
      return {
        name: studentName(s), class: labels.get(String(s.sectionId))?.short ?? '—', reason: [...new Set(mine.map((r) => r.reason))].join(', '),
        value: mine.map((r) => (r.kind === 'PCT' ? `${r.value}%` : formatINR(r.value))).join(' + '), amount: off.get(String(s._id)) ?? 0,
        approvedBy: [...new Set(mine.map((r) => r.decidedBy).filter(Boolean))].join(', '),
      }
    }).sort((a, b) => b.amount - a.amount)
  },

  async 'exams.toppers'(p, auth) {
    const exam = await examFor(p.examId)
    const sections = await sectionsFor(auth, 'exams', exam.academicYearId)
    const rows = await ExamCandidate.find({ examId: exam._id, sectionId: { $in: sections.map((s) => s._id) }, rank: { $lte: Number(p.top) } }).lean()
    const st = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName middleName lastName').lean()).map((s) => [String(s._id), s]))
    const order = new Map(sections.map((s, i) => [String(s._id), { i, short: s.short }]))
    return rows
      .sort((a, b) => (order.get(String(a.sectionId))?.i ?? 0) - (order.get(String(b.sectionId))?.i ?? 0) || a.rank - b.rank)
      .map((r) => ({ class: order.get(String(r.sectionId))?.short ?? '—', rank: r.rank, name: studentName(st.get(String(r.studentId))), total: r.total, max: r.max, pct: r.pct, grade: r.grade ?? '' }))
  },

  async 'exams.subjects'(p, auth) {
    const exam = await examFor(p.examId)
    const sections = await sectionsFor(auth, 'exams', exam.academicYearId)
    const [papers, sheets] = await Promise.all([
      ExamPaper.find({ examId: exam._id, gradeOnly: { $ne: true } }).lean(),
      MarkSheet.find({ examId: exam._id, sectionId: { $in: sections.map((s) => s._id) } }).lean(),
    ])
    const subjects = new Map((await Subject.find({ _id: { $in: papers.map((x) => x.subjectId) } }).select('name').lean()).map((s) => [String(s._id), s.name]))
    const out = []
    for (const s of sections) {
      for (const paper of papers.filter((x) => String(x.classId) === String(s.classId)).sort((a, b) => a.order - b.order)) {
        const sh = sheets.find((x) => String(x.paperId) === String(paper._id) && String(x.sectionId) === String(s._id))
        const sat = (sh?.entries ?? []).filter((e) => !e.exempt)
        const marked = sat.filter((e) => !e.absent && e.marks !== null && e.marks !== undefined)
        const pcts = marked.map((e) => (e.marks / paper.maxMarks) * 100)
        out.push({
          class: s.short, subject: subjects.get(String(paper.subjectId)) ?? '?', students: sat.length,
          average: pcts.length ? Math.round((pcts.reduce((n, x) => n + x, 0) / pcts.length) * 10) / 10 : null,
          highest: marked.length ? Math.max(...marked.map((e) => e.marks)) : null, lowest: marked.length ? Math.min(...marked.map((e) => e.marks)) : null,
          passPct: sat.length ? Math.round((marked.filter((e) => e.marks >= paper.passMarks).length / sat.length) * 1000) / 10 : null,
          absent: sat.filter((e) => e.absent).length,
        })
      }
    }
    return out
  },

  async 'homework.summary'(p, auth) {
    const sections = await sectionsFor(auth, 'homework')
    const rows = await Homework.find({ sectionId: { $in: sections.map((s) => s._id) }, setDate: { $gte: p.range.from, $lte: p.range.to } }).lean()
    const [subjects, strength] = await Promise.all([
      Subject.find({ _id: { $in: rows.map((r) => r.subjectId) } }).select('name').lean().then((x) => new Map(x.map((s) => [String(s._id), s.name]))),
      Student.aggregate([{ $match: { sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]).then((x) => new Map(x.map((r) => [String(r._id), r.n]))),
    ])
    const label = new Map(sections.map((s) => [String(s._id), s.short]))
    const groups = new Map()
    for (const h of rows) {
      const k = `${h.teacher}|${h.subjectId}|${h.sectionId}`
      const g = groups.get(k) ?? { teacher: h.teacher ?? '—', subject: subjects.get(String(h.subjectId)) ?? '?', class: label.get(String(h.sectionId)) ?? '—', count: 0, tracked: 0, handed: 0 }
      g.count++
      if (h.needsSubmission) {
        g.tracked += strength.get(String(h.sectionId)) ?? 0
        g.handed += h.entries.filter((e) => ['SUBMITTED', 'LATE', 'CHECKED'].includes(e.status)).length
      }
      groups.set(k, g)
    }
    return [...groups.values()]
      .map(({ tracked, handed, ...g }) => ({ ...g, handedIn: tracked ? Math.round((handed / tracked) * 1000) / 10 : null }))
      .sort((a, b) => a.teacher.localeCompare(b.teacher) || a.subject.localeCompare(b.subject) || a.class.localeCompare(b.class))
  },

  async 'certificates.issued'(p, auth) {
    const f = await branchFilterFor(auth, 'certificates')
    const rows = await Certificate.find({ ...f, issueDate: { $gte: p.range.from, $lte: p.range.to } }).sort({ issueDate: 1, certificateNo: 1 }).limit(5000).lean()
    return rows.map((c) => ({ issueDate: c.issueDate, certificateNo: c.certificateNo, kind: CERTIFICATE_KIND_BY[c.kind]?.label ?? c.kind, name: c.snapshot?.name ?? '', class: c.snapshot?.class ?? '', purpose: c.purpose ?? c.snapshot?.event ?? '', status: c.status === 'CANCELLED' ? 'Cancelled' : 'Issued' }))
  },
}

async function examFor(id) {
  if (!isOid(id)) throw badRequest('Pick an exam', { fields: { examId: 'Pick an exam' } })
  const e = await Exam.findById(id).lean()
  if (!e) throw notFound('Exam')
  return e
}

// ───────────────────────────────────────────────────────── library

/** May this person run this report? Its module on, and one of its `needs`. */
export const mayRun = (auth, def) => !!def && moduleEnabled(auth, def.module) && def.needs.some((k) => can(auth, k))

/** The reports the caller may run, by group. */
export function libraryFor(auth) {
  return REPORTS.filter((r) => mayRun(auth, r)).map((r) => ({ id: r.id, group: r.group, module: r.module, label: r.label, desc: r.desc, params: r.params, columns: r.columns }))
}

/** Inputs as given (presets allowed) → the values the runner uses. */
export async function resolveParams(def, raw = {}) {
  const t = await today()
  const out = {}
  const errors = {}
  for (const p of def.params) {
    let v = raw[p.key] ?? p.default
    if (p.type === 'dateRange') {
      if (typeof v === 'string') v = resolveRange(v, t)
      if (!v?.from || !v?.to || !/^\d{4}-\d{2}-\d{2}$/.test(v.from) || !/^\d{4}-\d{2}-\d{2}$/.test(v.to) || v.from > v.to) { if (p.required) errors[p.key] = 'Pick the dates'; continue }
    } else if (p.type === 'date') {
      if (v === 'today' || !v) v = t
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { errors[p.key] = 'Pick a date'; continue }
    } else if (p.type === 'number') {
      v = Number(v)
      if (!Number.isFinite(v) || (p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) { errors[p.key] = `${p.min ?? 0} to ${p.max ?? '…'}`; continue }
    } else if (p.options === 'months') {
      v = v === 'thisMonth' || !v ? Number(t.slice(5, 7)) : Number(v)
      if (!(v >= 1 && v <= 12)) { errors[p.key] = 'Pick a month'; continue }
    } else if (['section', 'exam', 'class'].includes(p.type)) {
      if (!v) { if (p.required) errors[p.key] = 'Pick one'; continue }
      if (!isOid(v)) { errors[p.key] = 'Pick one'; continue }
    }
    if (v !== undefined && v !== null && v !== '') out[p.key] = v
  }
  if (Object.keys(errors).length) throw badRequest('Some inputs need fixing.', { fields: errors })
  return out
}

const labelOfParam = async (def, params) => {
  const parts = []
  for (const p of def.params) {
    const v = params[p.key]
    if (v === undefined) continue
    if (p.type === 'dateRange') parts.push(`${v.from} – ${v.to}`)
    else if (p.type === 'section') { const s = (await labelsOf([v])).get(String(v)); parts.push(s?.short ?? '') }
    else if (p.type === 'exam') parts.push((await Exam.findById(v).select('name').lean())?.name ?? '')
    else if (p.options === 'months') parts.push(MONTHS[v - 1])
    else parts.push(`${p.label}: ${v}`)
  }
  return parts.filter(Boolean).join(' · ')
}

/** Run a library report: the rows, its columns (or the chosen ones) and totals. */
export async function runReport(id, raw, auth, { columns } = {}) {
  const def = REPORT_BY[id]
  if (!def) throw notFound('Report')
  if (!mayRun(auth, def)) throw forbidden('Your role can’t run this report.')
  const params = await resolveParams(def, raw)
  const rows = await RUNNERS[id](params, auth)
  const cols = columns?.length ? def.columns.filter((c) => columns.includes(c.key)) : def.columns
  const totals = def.totals?.length && rows.length
    ? Object.fromEntries(def.totals.filter((k) => cols.some((c) => c.key === k)).map((k) => [k, rows.reduce((n, r) => n + (Number(r[k]) || 0), 0)]))
    : null
  return { report: { id: def.id, label: def.label, desc: def.desc, module: def.module }, params, paramsLabel: await labelOfParam(def, params), columns: cols, rows, totals, generatedAt: new Date() }
}

// ───────────────────────────────────────────────────────── saved reports

const roleIdsOf = (auth) => (auth.roles ?? []).map((r) => r.id)
const mayOpenSaved = (auth, r) => String(r.ownerId) === String(auth.userId) || auth.fullAccess || (r.sharedRoleIds ?? []).some((id) => roleIdsOf(auth).includes(String(id)))
const savedDto = (r, auth) => ({
  ...clean(r), ownerId: String(r.ownerId), sharedRoleIds: (r.sharedRoleIds ?? []).map(String),
  schedule: { ...r.schedule, userIds: (r.schedule?.userIds ?? []).map(String) },
  label: REPORT_BY[r.reportId]?.label ?? r.reportId, group: REPORT_BY[r.reportId]?.group ?? null,
  mine: String(r.ownerId) === String(auth.userId), canRun: mayRun(auth, REPORT_BY[r.reportId]),
})

export async function listSaved(auth) {
  const rows = await SavedReport.find(auth.fullAccess ? {} : { $or: [{ ownerId: auth.userId }, { sharedRoleIds: { $in: roleIdsOf(auth) } }] }).sort({ name: 1 }).lean()
  return rows.map((r) => savedDto(r, auth))
}

async function savedFor(id, auth) {
  if (!isOid(id)) throw notFound('Saved report')
  const r = await SavedReport.findById(id)
  if (!r || !mayOpenSaved(auth, r)) throw notFound('Saved report')
  return r
}

async function tzOffsetMin() {
  const tz = (await Tenant.findById(getContext()?.tenantId).select('profile.timezone').lean())?.profile?.timezone || 'Asia/Kolkata'
  const now = new Date()
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  return Math.round((local - utc) / 60_000)
}

export async function saveSaved(id, input, auth, req) {
  const def = REPORT_BY[input.reportId]
  if (!def) throw badRequest('Pick a report', { fields: { reportId: 'Pick a report' } })
  if (!mayRun(auth, def)) throw forbidden('Your role can’t run this report.')
  // date ranges stay as presets so a schedule moves on; check the rest resolve now
  await resolveParams(def, input.params)
  const unknown = (input.columns ?? []).filter((c) => !def.columns.some((x) => x.key === c))
  if (unknown.length) throw badRequest('Pick columns from the report', { fields: { columns: 'Pick columns from the report' } })
  const r = id ? await savedFor(id, auth) : new SavedReport({ ownerId: auth.userId, owner: auth.user?.name })
  if (id && String(r.ownerId) !== String(auth.userId) && !auth.fullAccess) throw forbidden('Only the person who saved this report can change it.')
  const schedule = input.schedule ?? { active: false }
  if (schedule.active && !can(auth, 'reports.builder.schedule')) throw forbidden('Your role can’t schedule reports.')
  if (input.sharedRoleIds?.length && !can(auth, 'reports.builder.share')) throw forbidden('Your role can’t share reports.')
  if (schedule.active && !schedule.userIds?.length && !schedule.emails?.length) throw badRequest('Who gets it?', { fields: { schedule: 'Pick at least one person or email' } })
  if (schedule.userIds?.length && await User.countDocuments({ _id: { $in: schedule.userIds } }) !== new Set(schedule.userIds).size) throw badRequest('Pick people from the list', { fields: { schedule: 'Pick people from the list' } })
  Object.assign(r, {
    name: input.name, reportId: input.reportId, params: input.params ?? {}, columns: input.columns ?? [], sharedRoleIds: input.sharedRoleIds ?? [],
    schedule: { active: !!schedule.active, frequency: schedule.frequency ?? 'WEEKLY', hour: schedule.hour ?? 7, userIds: schedule.userIds ?? [], emails: schedule.emails ?? [] },
    nextRunAt: schedule.active ? nextRunAt(schedule.frequency ?? 'WEEKLY', schedule.hour ?? 7, new Date(), await tzOffsetMin()) : undefined,
  })
  r.markModified('params')
  await r.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'reports', entityType: 'saved_report', entityId: String(r._id), entityName: r.name, summary: `${id ? 'Updated' : 'Saved'} report “${r.name}” (${def.label})${r.schedule.active ? `, sent ${r.schedule.frequency.toLowerCase()}` : ''}` }, req)
  return savedDto(r.toObject(), auth)
}

export async function deleteSaved(id, auth, req) {
  const r = await savedFor(id, auth)
  if (String(r.ownerId) !== String(auth.userId) && !auth.fullAccess) throw forbidden('Only the person who saved this report can delete it.')
  await SavedReport.deleteOne({ _id: r._id })
  await audit({ action: 'DELETE', module: 'reports', entityType: 'saved_report', entityId: String(r._id), entityName: r.name, summary: `Deleted saved report “${r.name}”` }, req)
  return { deleted: true }
}

export async function runSaved(id, auth) {
  const r = await savedFor(id, auth)
  const out = await runReport(r.reportId, r.params, auth, { columns: r.columns })
  return { ...out, saved: { id: String(r._id), name: r.name } }
}

// ───────────────────────────────────────────────────────── schedules

const cell = (c, v) => (v === null || v === undefined || v === '' ? '—' : c.type === 'money' ? formatINR(Number(v)) : c.type === 'pct' ? `${v}%` : String(v))

/** A plain-text summary of a run (the email body): the first rows and the totals. */
function textSummary(saved, out) {
  const lines = [`${saved.name} — ${out.report.label}`, out.paramsLabel, '']
  const cols = out.columns.slice(0, 6)
  for (const row of out.rows.slice(0, 25)) lines.push(cols.map((c) => `${c.label}: ${cell(c, row[c.key])}`).join(' · '))
  if (out.rows.length > 25) lines.push(`… and ${out.rows.length - 25} more rows.`)
  if (!out.rows.length) lines.push('No rows this time.')
  if (out.totals) lines.push('', `Totals: ${out.columns.filter((c) => c.key in out.totals).map((c) => `${c.label} ${cell(c, out.totals[c.key])}`).join(' · ')}`)
  lines.push('', `Open the full report: ${config.appUrl}/reports/builder?run=${saved._id}`)
  return lines.join('\n')
}

/** One due schedule, in its institution, run as the person who saved it. */
async function runSchedule(saved) {
  const access = await loadAccess(saved.tenantId, saved.ownerId)
  const offset = await runAsTenant(saved.tenantId, () => tzOffsetMin())
  const next = nextRunAt(saved.schedule.frequency, saved.schedule.hour, new Date(), offset)
  if (!access || !access.user?.active) {
    await runAsTenant(saved.tenantId, () => SavedReport.updateOne({ _id: saved._id }, { $set: { 'schedule.active': false, lastError: 'The person who saved it no longer has an active account.' } }))
    return
  }
  const auth = { ...access, tenantId: String(saved.tenantId), userId: String(saved.ownerId) }
  await runAsTenant(saved.tenantId, async () => {
    try {
      const out = await runReport(saved.reportId, saved.params, auth, { columns: saved.columns })
      const body = textSummary(saved, out)
      const link = `/reports/builder?run=${saved._id}`
      await notifyUsers(saved.schedule.userIds, { event: 'reports.scheduled', title: saved.name, message: `${out.rows.length} row(s) · ${out.paramsLabel}`, link, tone: 'info', entityType: 'saved_report', entityId: String(saved._id) })
      if (saved.schedule.emails?.length) await MessageLog.insertMany(saved.schedule.emails.map((to) => ({ event: 'reports.scheduled', channel: 'EMAIL', to, subject: `${saved.name} — ${out.report.label}`, body, entityType: 'saved_report', entityId: String(saved._id), createdBy: 'Report schedule' })))
      await SavedReport.updateOne({ _id: saved._id }, { $set: { lastRunAt: new Date(), lastRows: out.rows.length, nextRunAt: next }, $unset: { lastError: 1 } })
    } catch (err) {
      await SavedReport.updateOne({ _id: saved._id }, { $set: { lastRunAt: new Date(), nextRunAt: next, lastError: err.message } })
      logger.warn({ err, savedReport: String(saved._id) }, 'scheduled report failed')
    }
  })
}

/** The background job: every saved report whose time has come, across institutions. */
export async function runDueSchedules() {
  const due = await runAsSystem(() => SavedReport.find({ 'schedule.active': true, nextRunAt: { $lte: new Date() } }).setOptions({ allTenants: true }).limit(200).lean())
  for (const saved of due) await runSchedule(saved)
  return due.length
}
