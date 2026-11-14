import { attendancePct, countMarks } from '@schoolgiant/shared'
import { AcademicYear } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Exam, ExamCandidate } from '../models/exams.js'
import { FeeInvoice } from '../models/fees.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { AppError, badRequest, forbidden, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { sectionsInScope } from './academics.js'

// Holding a student's admit card (hall ticket) and/or result. Two ways, together:
//   by hand   — staff pick students on an exam (ExamCandidate.hold), with a reason and whether the family is told why
//   by rule   — off until the school turns one on in Settings › Exams: fees overdue (above an amount), attendance
//               below a percentage. Worked out each time, so a hold lifts by itself once the fees are paid. Staff can
//               let a student through anyway (ExamCandidate.released).
// A held admit card or result doesn't print, doesn't open in the family app, isn't sent, and the report card's QR
// doesn't show the held result.

export const PARTS = ['admitCard', 'result']

/** The error a held document answers with — the same words for the office and the family app. */
export const onHold = (part) => new AppError(409, part === 'admitCard'
  ? 'This admit card is on hold. Please contact the school office.'
  : 'This result is on hold. Please contact the school office.', { code: 'ON_HOLD' })

/**
 * Each candidate's holds: Map candidateId → { admitCard: { held, reasons }, result: { held, reasons } }. A reason is
 * { kind: MANUAL | FEES | ATTENDANCE, text?, amount?, pct?, below?, show } — `show`: the family may be told it.
 * `candidates`: lean ExamCandidate docs of one exam (studentId, sectionId, hold, released).
 */
export async function holdsOf(exam, candidates) {
  const out = new Map()
  if (!candidates.length) return out
  const cfg = await getSettings('exams')
  const today = (await institutionNow()).date
  const studentIds = candidates.map((c) => c.studentId)
  const autoParts = cfg.holdAutoWhat === 'ADMIT_CARD' ? ['admitCard'] : cfg.holdAutoWhat === 'RESULT' ? ['result'] : PARTS
  const fees = new Map()
  const attendance = new Map()
  if (cfg.holdFeesOverdue) {
    const min = Math.max(0, Number(cfg.holdFeesMinimum) || 0) * 100
    const rows = await FeeInvoice.aggregate([
      { $match: { studentId: { $in: studentIds }, dueDate: { $lt: today }, status: { $in: ['UNPAID', 'PARTIAL'] }, balance: { $gt: 0 } } },
      { $group: { _id: '$studentId', due: { $sum: '$balance' } } },
    ])
    for (const r of rows) if (r.due > 0 && r.due >= min) fees.set(String(r._id), r.due)
  }
  if (cfg.holdAttendance) {
    const below = Number(cfg.holdAttendanceBelow) || 75
    const year = exam.academicYearId ? await AcademicYear.findById(exam.academicYearId).select('startDate endDate').lean() : null
    const to = [today, year?.endDate].filter(Boolean).sort()[0]
    const rows = await AttendanceSheet.aggregate([
      { $match: { sectionId: { $in: [...new Map(candidates.map((c) => [String(c.sectionId), c.sectionId])).values()] }, period: 0, date: { $gte: year?.startDate ?? '0000-01-01', $lte: to } } },
      { $unwind: '$entries' },
      { $match: { 'entries.studentId': { $in: studentIds } } },
      { $group: { _id: { s: '$entries.studentId', st: '$entries.status' }, n: { $sum: 1 } } },
    ])
    const per = new Map()
    for (const r of rows) { const k = String(r._id.s); if (!per.has(k)) per.set(k, []); per.get(k).push(...Array(r.n).fill({ status: r._id.st })) }
    for (const [k, entries] of per) {
      const pct = attendancePct(countMarks(entries))
      if (pct !== null && pct !== undefined && pct < below) attendance.set(k, { pct: Math.round(pct * 10) / 10, below })
    }
  }
  for (const c of candidates) {
    const sid = String(c.studentId)
    const auto = []
    if (fees.has(sid)) auto.push({ kind: 'FEES', amount: fees.get(sid) })
    if (attendance.has(sid)) auto.push({ kind: 'ATTENDANCE', ...attendance.get(sid) })
    const h = {}
    for (const part of PARTS) {
      const reasons = []
      if (c.hold?.[part]) reasons.push({ kind: 'MANUAL', text: c.hold.reason || '', show: !!c.hold.showReason })
      if (autoParts.includes(part) && !c.released?.[part]) for (const a of auto) reasons.push({ ...a, show: !!cfg.holdAutoShowReason })
      h[part] = { held: reasons.length > 0, reasons, released: !!c.released?.[part] && auto.length > 0 && autoParts.includes(part) }
    }
    out.set(String(c._id), h)
  }
  return out
}

/** One candidate's holds (a lean ExamCandidate). */
export async function holdOf(c, exam) {
  const e = exam ?? await Exam.findById(c.examId).select('academicYearId').lean()
  return (await holdsOf(e, [c])).get(String(c._id))
}

/** What the family app may show of a hold: held, and only the reasons the school lets the family see. */
export const forFamily = (h) => (h?.held ? { held: true, reasons: h.reasons.filter((r) => r.show).map(({ show, ...r }) => r) } : { held: false, reasons: [] }) // eslint-disable-line no-unused-vars

// ───────────────────────────────────────────────────────── staff: hold by hand, release

async function pick(examId, candidateIds, parts, auth) {
  if (!isOid(examId)) throw notFound('Exam')
  const exam = await Exam.findById(examId).select('name academicYearId').lean()
  if (!exam) throw notFound('Exam')
  if (!parts.length) throw badRequest('Choose what to hold: the admit card, the result, or both.')
  // the admit card is the hall-ticket desk's; the result is whoever publishes results or report cards
  if (parts.includes('admitCard') && !auth.fullAccess && !can(auth, 'exams.hall-tickets.print')) throw forbidden('You can’t hold or release admit cards.')
  if (parts.includes('result') && !auth.fullAccess && !can(auth, 'exams.results.publish') && !can(auth, 'exams.report-cards.publish')) throw forbidden('You can’t hold or release results.')
  const ids = [...new Set(candidateIds.map(String))].filter(isOid)
  const rows = await ExamCandidate.find({ _id: { $in: ids }, examId: exam._id }).select('_id sectionId').lean()
  const allowed = await sectionsInScope(auth, 'exams')
  if (rows.length !== ids.length || (allowed && rows.some((r) => !allowed.includes(String(r.sectionId))))) throw badRequest('Some students are not on this exam.')
  return { exam, ids: rows.map((r) => r._id) }
}

const partsOf = ({ admitCard, result }) => PARTS.filter((p) => (p === 'admitCard' ? admitCard : result))
const what = (parts) => (parts.length === 2 ? 'admit card and result' : parts[0] === 'admitCard' ? 'admit card' : 'result')

/** Hold the admit card and/or result of these students, with a reason and whether the family is told it. */
export async function holdCandidates(examId, { candidateIds, admitCard = false, result = false, reason = '', showReason = false }, auth, req) {
  const parts = partsOf({ admitCard, result })
  const { exam, ids } = await pick(examId, candidateIds, parts, auth)
  const set = { 'hold.reason': reason || undefined, 'hold.showReason': !!showReason, 'hold.by': auth.user?.name, 'hold.at': new Date() }
  const unset = {}
  for (const p of parts) { set[`hold.${p}`] = true; unset[`released.${p}`] = 1 } // holding by hand wins over an earlier "let through"
  await ExamCandidate.updateMany({ _id: { $in: ids } }, { $set: set, $unset: unset })
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'exam', entityId: String(exam._id), entityName: exam.name, summary: `Held the ${what(parts)} of ${ids.length} student(s) for ${exam.name}${reason ? ` — ${reason}` : ''}` }, req)
  return { held: ids.length }
}

/** Release: take off a hold made by hand, and let the student through a rule (fees, attendance) for this exam. */
export async function releaseCandidates(examId, { candidateIds, admitCard = false, result = false }, auth, req) {
  const parts = partsOf({ admitCard, result })
  const { exam, ids } = await pick(examId, candidateIds, parts, auth)
  const set = { 'released.by': auth.user?.name, 'released.at': new Date() }
  const unset = {}
  for (const p of parts) { unset[`hold.${p}`] = 1; set[`released.${p}`] = true }
  await ExamCandidate.updateMany({ _id: { $in: ids } }, { $set: set, $unset: unset })
  // nothing left held by hand: the reason goes too
  await ExamCandidate.updateMany({ _id: { $in: ids }, 'hold.admitCard': { $ne: true }, 'hold.result': { $ne: true } }, { $unset: { hold: 1 } })
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'exam', entityId: String(exam._id), entityName: exam.name, summary: `Released the ${what(parts)} of ${ids.length} student(s) for ${exam.name}` }, req)
  return { released: ids.length }
}
