import crypto from 'node:crypto'
import { sectionLabel } from '@schoolgiant/shared'
import { config } from '../config.js'
import { ClassLevel, Section } from '../models/academics.js'
import { Certificate } from '../models/certificates.js'
import { FeePayment } from '../models/fees.js'
import { Employee } from '../models/hrms.js'
import { LibraryCopy, LibraryTitle } from '../models/library.js'
import { Student, TransferCertificate, studentName } from '../models/students.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { on } from './dashboard.js'
import { phonePunch } from './devices.js'
import { candidateAtDoor } from './exams.js'
import { passResult, readPass } from './passes.js'
import { GatePass, Visitor } from '../models/frontOffice.js'
import { StoreAsset } from '../models/inventory.js'
import { Outpass } from '../models/hostel.js'
import { campusFilter } from './frontOffice.js'
import { institutionNow } from '../platform/time.js'
import { scopeFilter } from './students.js'

// Scan: one place that knows what a scanned code is. The app's Scan button, the gate scanner, the class
// register and the bus attendant all send what the camera or a scanner gun read; this says what it is —
// a student, a library book, a fee receipt, a certificate, a member of staff — and what the person who
// scanned it may do next. Nothing is found outside the person's modules, permissions and data scope.
//
// What our printed codes carry:
//   student ID card   QR  → <app>/verify/student/<cardCode>     barcode → admission number
//   certificate       QR  → <app>/verify/<verifyCode>
//   fee receipt       QR  → <app>/verify/receipt/<verifyCode>   (printed receipt number works too)
//   hall ticket / report card  QR → <app>/verify/exam/<candidate verifyCode>
//   library book      barcode → accession number
//   staff punch code  SGP1.<employeeId>.<time>.<signature>      (My workspace, rotates; 90 seconds)

const PUNCH_PREFIX = 'SGP1.'
const PUNCH_TTL_MS = 90_000
const STUDENT_PERMS = ['students.directory.view', 'students.profile.view', 'attendance.mark.view', 'fees.collect.view', 'library.circulation.view', 'transport.tracking.track']

const signPunch = (tenantId, employeeId, ts) => crypto.createHmac('sha256', config.jwtSecret).update(`punch:${tenantId}:${employeeId}:${ts}`).digest('base64url').slice(0, 22)

/** My workspace › the rotating code a member of staff shows at a gate scanner instead of a card. */
export async function myPunchCode(auth) {
  const e = await Employee.findOne({ userId: auth.userId, status: { $ne: 'EXITED' } }).select('_id').lean()
  if (!e) throw notFound('Your staff record')
  const ts = Date.now()
  return { code: `${PUNCH_PREFIX}${e._id}.${ts}.${signPunch(auth.tenantId, e._id, ts)}`, expiresAt: new Date(ts + PUNCH_TTL_MS), ttlSeconds: PUNCH_TTL_MS / 1000 }
}

/** The employee a punch code belongs to — only while it is fresh and signed by this institution. */
async function employeeOfPunch(text, auth) {
  const [, id, ts, sig] = text.slice(PUNCH_PREFIX.length - 1).split('.')
  const t = Number(ts)
  if (!id || !Number.isFinite(t) || !sig) throw badRequest('This code isn’t a staff code.')
  const good = signPunch(auth.tenantId, id, t)
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) throw badRequest('This staff code isn’t from this institution.')
  if (Date.now() - t > PUNCH_TTL_MS || t - Date.now() > 60_000) throw conflict('This staff code has expired — refresh it in My workspace and scan again.')
  const e = await Employee.findById(id).select('employeeCode name designation status').lean()
  if (!e || e.status === 'EXITED') throw notFound('Staff member')
  return e
}

/** What a code read off a printed document means: { kind, code } (kind STUDENT_CARD · RECEIPT · CERTIFICATE · PUNCH · TEXT). */
export function readCode(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { kind: 'EMPTY', code: '' }
  if (text.startsWith(PUNCH_PREFIX)) return { kind: 'PUNCH', code: text }
  if (/^SG[EMK]1\./.test(text)) return { kind: 'PASS', code: text }
  let path = null
  try { path = new URL(text).pathname } catch { /* not a link */ }
  if (path) {
    const m = path.match(/\/verify\/(student|receipt|certificate|exam|tc)\/([A-Za-z0-9]{6,20})\/?$/)
    if (m) return { kind: { student: 'STUDENT_CARD', receipt: 'RECEIPT', certificate: 'CERTIFICATE', exam: 'EXAM', tc: 'TC' }[m[1]], code: m[2].toUpperCase() }
    const c = path.match(/\/verify\/([A-Za-z0-9]{12})\/?$/)
    if (c) return { kind: 'CERTIFICATE', code: c[1].toUpperCase() }
    return { kind: 'LINK', code: text }
  }
  return { kind: 'TEXT', code: text.toUpperCase() }
}

async function placeOf(sectionId) {
  if (!sectionId) return null
  const sec = await Section.findById(sectionId).lean()
  const cls = sec ? await ClassLevel.findById(sec.classId).select('name code').lean() : null
  return sec ? sectionLabel(cls, sec, { short: true }) : null
}

async function findStudent(match, auth) {
  if (!STUDENT_PERMS.some((k) => auth.fullAccess || (auth.permissions ?? []).includes(k))) return null
  const scope = await scopeFilter(auth)
  return Student.findOne({ ...match, ...(scope ?? {}) }).select('firstName middleName lastName admissionNo cardCode rollNo sectionId status').lean()
}

async function studentResult(s, auth) {
  const place = await placeOf(s.sectionId)
  const actions = [
    on(auth, 'students', 'students.profile.view') && { key: 'profile', link: `/students/profile/${s._id}` },
    on(auth, 'fees', 'fees.collect.view') && { key: 'collectFee', link: `/fees/collect?student=${s._id}` },
    on(auth, 'library', 'library.circulation.view') && { key: 'library', link: `/library/circulation?card=${encodeURIComponent(s.cardCode || s.admissionNo)}` },
  ].filter(Boolean)
  // an approved gate pass for today: the gate marks the child out from the same scan
  let gatePass = null
  if (on(auth, 'frontoffice', 'frontoffice.gate-pass.create')) {
    const today = (await institutionNow()).date
    const p = await GatePass.findOne({ studentId: s._id, date: today, status: { $in: ['APPROVED', 'LEFT'] }, ...(await campusFilter(auth)) }).sort({ createdAt: -1 }).lean()
    if (p) {
      gatePass = { id: String(p._id), passNo: p.passNo, status: p.status, collector: p.collector?.name ?? null, relation: p.collector?.relation ?? null, reason: p.reason ?? null, leftAt: p.leftAt ?? null }
      if (p.status === 'APPROVED') actions.unshift({ key: 'gatePassLeft', post: `/v1/scan/gate-pass/${p._id}/left` })
    }
  }
  // a boarder at the hostel gate: an approved outpass to mark out, or one they are out on to mark back in
  let outpass = null
  if (on(auth, 'hostel', 'hostel.outpass.create', 'hostel.outpass.approve')) {
    const o = await Outpass.findOne({ studentId: s._id, status: { $in: ['APPROVED', 'OUT'] } }).sort({ createdAt: -1 }).lean()
    if (o) {
      outpass = { id: String(o._id), no: o.outpassNo, status: o.status, leaveAt: o.leaveAt ?? null, returnBy: o.returnBy ?? null, outAt: o.outAt ?? null, reason: o.reason ?? null }
      actions.unshift({ key: o.status === 'APPROVED' ? 'outpassOut' : 'outpassIn', post: `/v1/scan/outpass/${o._id}/${o.status === 'APPROVED' ? 'out' : 'in'}` })
    }
  }
  return {
    kind: 'STUDENT', id: String(s._id), title: studentName(s), subtitle: [place, s.admissionNo, s.rollNo && `Roll ${s.rollNo}`].filter(Boolean).join(' · '), gatePass, outpass,
    student: { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, sectionId: s.sectionId ? String(s.sectionId) : null, class: place },
    status: s.status === 'ACTIVE' ? null : s.status, actions,
  }
}

async function bookResult(code, auth) {
  if (!on(auth, 'library', 'library.circulation.view', 'library.catalogue.view')) return null
  const copy = await LibraryCopy.findOne({ accessionNo: code }).lean()
  if (!copy) return null
  const title = await LibraryTitle.findById(copy.titleId).select('title authors').lean()
  return {
    kind: 'BOOK', id: String(copy._id), title: title?.title ?? code, subtitle: [code, (title?.authors ?? []).join(', '), copy.shelf].filter(Boolean).join(' · '), status: copy.status,
    actions: [on(auth, 'library', 'library.circulation.view') && { key: 'issueReturn', link: `/library/circulation?book=${encodeURIComponent(code)}` }].filter(Boolean),
  }
}

async function receiptResult(match, auth) {
  if (!on(auth, 'fees', 'fees.collect.view', 'fees.invoices.view')) return null
  const p = await FeePayment.findOne(match).lean()
  if (!p) return null
  const s = await findStudent({ _id: p.studentId }, auth)
  if (!s) return null
  return {
    kind: 'RECEIPT', id: String(p._id), title: p.receiptNo, subtitle: [studentName(s), p.date].join(' · '), amount: p.amount, status: p.status === 'VALID' ? null : p.status,
    actions: [on(auth, 'fees', 'fees.collect.view') && { key: 'collectFee', link: `/fees/collect?student=${s._id}` }].filter(Boolean),
  }
}

async function certificateResult(match, auth, code) {
  if (on(auth, 'certificates', 'certificates.register.view')) {
    const c = await Certificate.findOne(match).lean()
    if (c) return { kind: 'CERTIFICATE', id: String(c._id), title: c.certificateNo, subtitle: [c.snapshot?.student?.name ?? c.snapshot?.name, c.issueDate].filter(Boolean).join(' · '), certificateKind: c.kind, status: c.status === 'ISSUED' ? null : c.status, actions: [{ key: 'register', link: '/certificates/register' }] }
  }
  return code ? { kind: 'CERTIFICATE', id: null, title: code, subtitle: '', actions: [{ key: 'verify', link: `/verify/${code}` }] } : null
}

/** A transfer certificate's QR: the register for staff who keep it, the public check for everyone else. */
async function tcResult(code, auth) {
  if (on(auth, 'students', 'students.transfer.view')) {
    const tc = await TransferCertificate.findOne({ verifyCode: code }).lean()
    const s = tc && await Student.findById(tc.studentId).select('firstName middleName lastName admissionNo').lean()
    if (tc) return { kind: 'TC', id: String(tc._id), title: tc.tcNo ?? code, subtitle: [s && studentName(s), s?.admissionNo, tc.leavingDate].filter(Boolean).join(' · '), status: tc.status === 'ISSUED' ? null : tc.status, actions: [{ key: 'tcRegister', link: '/students/transfer' }] }
  }
  return { kind: 'TC', id: null, title: code, subtitle: '', actions: [{ key: 'verify', link: `/verify/tc/${code}` }] }
}

/** A hall ticket (or report card) at the exam door: who, which exam, and today's room and seat. */
async function examResult(code, auth) {
  if (!on(auth, 'exams', 'exams.hall-tickets.view', 'exams.seating.view', 'exams.marks.view', 'exams.results.view')) return null
  const c = await candidateAtDoor(code, auth)
  if (!c) return null
  return {
    kind: 'HALL_TICKET', id: c.candidateId, title: c.student, subtitle: [c.exam, c.class].filter(Boolean).join(' · '),
    papers: c.today, nextDate: c.nextDate,
    actions: [
      on(auth, 'exams', 'exams.hall-tickets.view') && { key: 'hallTickets', link: '/exams/hall-tickets' },
      c.examStatus === 'PUBLISHED' && on(auth, 'exams', 'exams.results.view') && { key: 'results', link: '/exams/results' },
    ].filter(Boolean),
  }
}

/**
 * A visitor's badge (front office hands out numbered badges; cards print with VB-<no> as a QR): the visitor inside now
 * holding it — scanned at the exit to check them out.
 */
async function visitorByBadge(code, auth) {
  if (!on(auth, 'frontoffice', 'frontoffice.visitors.view', 'frontoffice.visitors.checkout')) return null
  const badge = code.replace(/^VB-?/, '')
  if (!badge || badge.length > 12) return null
  const v = await Visitor.findOne({ badgeNo: { $in: [badge, badge.toLowerCase(), code] }, outAt: null, ...(await campusFilter(auth)) }).sort({ inAt: -1 }).lean()
  if (!v) return null
  return {
    kind: 'VISITOR', id: String(v._id), title: v.name, subtitle: [v.purposeNote || v.purpose, v.hostName, v.studentName].filter(Boolean).join(' · '),
    inAt: v.inAt, badgeNo: v.badgeNo, people: v.people ?? 1, mobile: v.mobile ?? null,
    actions: on(auth, 'frontoffice', 'frontoffice.visitors.checkout') ? [{ key: 'visitorOut', post: `/v1/scan/visitor/${v._id}/check-out` }] : [],
  }
}
/** An asset's tag: what it is, where it should be, who has it — and "seen here" for a physical audit. */
export async function assetByTag(code, auth) {
  if (!on(auth, 'inventory', 'inventory.assets.view')) return null
  const a = await StoreAsset.findOne({ assetTag: code.toUpperCase() }).lean()
  if (!a) return null
  return {
    kind: 'ASSET', id: String(a._id), title: a.name, subtitle: [a.assetTag, a.roomName || a.location, a.assignedTo?.name].filter(Boolean).join(' · '),
    status: a.status === 'IN_USE' ? null : a.status, lastVerified: a.lastVerified?.at ? a.lastVerified : null,
    actions: [
      on(auth, 'inventory', 'inventory.assets.edit') && a.status !== 'DISPOSED' && { key: 'verifyAsset', post: `/v1/scan/asset/${a._id}/verify` },
      { key: 'assets', link: `/inventory/assets?search=${encodeURIComponent(a.assetTag)}` },
    ].filter(Boolean),
  }
}

export const visitorAfterCheckout = (v) => ({ kind: 'VISITOR', id: v.id, title: v.name, subtitle: [v.purposeNote || v.purpose, v.hostName].filter(Boolean).join(' · '), inAt: v.inAt, outAt: v.outAt, badgeNo: v.badgeNo, actions: [] })

function staffResult(e, auth) {
  return {
    kind: 'STAFF', id: String(e._id), title: e.name, subtitle: [e.employeeCode, e.designation].filter(Boolean).join(' · '), status: e.status === 'ACTIVE' ? null : e.status,
    actions: [on(auth, 'hrms', 'hrms.employees.view') && { key: 'staffProfile', link: `/hrms/employees/${e._id}` }].filter(Boolean),
  }
}

/** What did the camera read? The first match in the order below; UNKNOWN when nothing the person may see matches. */
export async function resolveCode(raw, auth) {
  const { kind, code } = readCode(raw)
  if (kind === 'EMPTY') throw badRequest('Nothing to look up.')
  let hit = null
  if (kind === 'PUNCH') hit = staffResult(await employeeOfPunch(code, auth), auth)
  else if (kind === 'PASS') { const pass = readPass(code, auth.tenantId); hit = pass && await passResult(pass, auth) }
  else if (kind === 'STUDENT_CARD') { const s = await findStudent({ cardCode: code }, auth); hit = s && await studentResult(s, auth) }
  else if (kind === 'RECEIPT') hit = await receiptResult({ verifyCode: code }, auth)
  else if (kind === 'CERTIFICATE') hit = await certificateResult({ verifyCode: code }, auth, code)
  else if (kind === 'EXAM') hit = await examResult(code, auth)
  else if (kind === 'TC') hit = await tcResult(code, auth)
  else if (kind === 'TEXT') {
    const s = await findStudent({ $or: [{ cardCode: code }, { admissionNo: code }] }, auth)
    hit = (s && await studentResult(s, auth))
      ?? await bookResult(code, auth)
      ?? await receiptResult({ $or: [{ receiptNo: code }, { verifyCode: code }] }, auth)
      ?? await certificateResult({ $or: [{ certificateNo: code }, { verifyCode: code }] }, auth, null)
    if (!hit && on(auth, 'hrms', 'hrms.employees.view')) {
      const e = await Employee.findOne({ employeeCode: code }).select('employeeCode name designation status').lean()
      hit = e && staffResult(e, auth)
    }
  }
  if (!hit && kind === 'TEXT') hit = await visitorByBadge(code, auth)
  if (!hit && kind === 'TEXT') hit = await assetByTag(code, auth)
  return hit ?? { kind: 'UNKNOWN', id: null, title: code, subtitle: '', actions: kind === 'LINK' ? [{ key: 'open', link: code }] : [] }
}

/** The gate scanner: one read on a phone scanner. A staff punch code becomes the employee code; anything else goes as read. */
export async function gateScan(deviceId, { code, direction }, auth) {
  const read = readCode(code)
  if (read.kind === 'EMPTY') throw badRequest('Nothing to look up.')
  let value = read.code
  if (read.kind === 'PUNCH') value = (await employeeOfPunch(read.code, auth)).employeeCode
  if (['LINK', 'RECEIPT', 'CERTIFICATE', 'EXAM', 'TC', 'PASS'].includes(read.kind)) throw badRequest('That isn’t an ID card — scan the student’s or staff member’s card.')
  return phonePunch(deviceId, { code: value, direction }, auth)
}

/** Who may scan at a phone scanner: students → can mark attendance; staff → can edit staff attendance. */
export function mayUseScanner(usedFor, auth) {
  const need = usedFor === 'STAFF' ? ['hrms', 'hrms.attendance.edit'] : ['attendance', 'attendance.mark.create']
  if (!on(auth, ...need)) throw forbidden(usedFor === 'STAFF' ? 'Scanning staff in needs “Staff attendance › Edit”.' : 'Scanning students in needs “Mark attendance › Create”.')
}
