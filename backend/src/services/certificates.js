import { CERTIFICATE_KIND_BY, CERTIFICATE_STATUS, TUITION_HEAD_CODES, financialYearOf, makeVerifyCode, sectionLabel } from '@schoolgiant/shared'
import { config } from '../config.js'
import { AcademicYear, ClassLevel, Section } from '../models/academics.js'
import { Certificate } from '../models/certificates.js'
import { FeeHead, FeeInvoice, FeePayment, FeeRefund } from '../models/fees.js'
import { Tenant } from '../models/platform.js'
import { Student, studentName } from '../models/students.js'
import { Branch } from '../models/tenant.js'
import { moduleEnabled, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { runAsSystem } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { currentYear } from './academics.js'

// Certificates (module `certificates`): bonafide, character, study, fee paid and merit certificates.
// What a certificate states is copied onto it when issued (snapshot), so a reprint reads the same
// even after the student moves on. Every one carries a verify code; its QR opens /verify/<code>,
// which anyone can check without signing in. Who sees whose certificates follows the role's
// data scope for `certificates`: BRANCH (the user's campus) or ALL.

const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
export const verifyUrl = (code) => `${config.appUrl}/verify/${code}`

async function branchFilter(auth) {
  if (scopeOf(auth, 'certificates') === 'ALL' || !auth.user?.branchId) return null
  const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
  return String(auth.user.branchId) === String(main) ? { branchId: { $in: [auth.user.branchId, null] } } : { branchId: auth.user.branchId }
}

async function studentInScope(id, auth) {
  if (!isOid(id)) throw notFound('Student')
  const s = await Student.findById(id).lean()
  if (!s) throw notFound('Student')
  const f = await branchFilter(auth)
  if (f) {
    const allowed = f.branchId.$in ? f.branchId.$in.map((x) => (x ? String(x) : null)) : [String(f.branchId)]
    if (!allowed.includes(s.branchId ? String(s.branchId) : null)) throw notFound('Student')
  }
  return s
}

async function placeOf(sectionId) {
  if (!sectionId) return null
  const sec = await Section.findById(sectionId).lean()
  if (!sec) return null
  const [cls, year] = await Promise.all([ClassLevel.findById(sec.classId).lean(), AcademicYear.findById(sec.academicYearId).select('name').lean()])
  return { label: sectionLabel(cls, sec), className: cls?.name ?? '', yearName: year?.name ?? '', yearId: sec.academicYearId }
}

const guardianOf = (s, rel) => s.guardians?.find((g) => g.relation === rel)?.name ?? null

/**
 * Fees paid in a financial year, by fee head: each receipt's money is shared over the installments it
 * paid, and inside an installment over its fees (after concession). Refunds made in the year come off.
 */
export async function feesPaidIn(studentId, fyLabel) {
  const fy = financialYearOf(`${fyLabel.slice(0, 4)}-06-01`)
  const [payments, refunds, heads] = await Promise.all([
    FeePayment.find({ studentId, status: 'VALID', date: { $gte: fy.from, $lte: fy.to } }).lean(),
    FeeRefund.find({ studentId, date: { $gte: fy.from, $lte: fy.to } }).lean(),
    FeeHead.find().select('name code').lean(),
  ])
  const invoices = new Map((await FeeInvoice.find({ _id: { $in: payments.flatMap((p) => p.allocations.map((a) => a.invoiceId)) } }).lean()).map((i) => [String(i._id), i]))
  const headOf = new Map(heads.map((h) => [String(h._id), h]))
  const byHead = new Map()
  const receiptTuitionShare = new Map()
  const add = (name, code, amount) => { const prev = byHead.get(name) ?? { name, code, amount: 0 }; prev.amount += amount; byHead.set(name, prev) }
  for (const p of payments) {
    let tuition = 0
    for (const a of p.allocations) {
      const inv = invoices.get(String(a.invoiceId))
      if (!inv) { add('Other', null, a.amount); continue }
      const lines = inv.lines.map((l) => ({ ...l, net: Math.max(0, (l.amount ?? 0) - (l.concession ?? 0)) }))
      const base = lines.reduce((n, l) => n + l.net, 0) + (inv.lateFee ?? 0)
      let given = 0
      lines.forEach((l) => {
        const share = base ? Math.floor((a.amount * l.net) / base) : 0
        given += share
        const h = headOf.get(String(l.feeHeadId))
        add(h?.name ?? l.name ?? 'Other', h?.code ?? null, share)
        if (TUITION_HEAD_CODES.includes(h?.code)) tuition += share
      })
      if (a.amount - given) add('Late fee', 'LATE', a.amount - given) // the late fee and rounding
    }
    receiptTuitionShare.set(String(p._id), p.amount ? tuition / p.amount : 0)
  }
  const refunded = refunds.reduce((n, r) => n + r.amount, 0)
  const tuitionRefunded = Math.round(refunds.reduce((n, r) => n + r.amount * (receiptTuitionShare.get(String(r.paymentId)) ?? 0), 0))
  const list = [...byHead.values()].filter((h) => h.amount > 0).sort((a, b) => b.amount - a.amount)
  const paid = payments.reduce((n, p) => n + p.amount, 0)
  const tuition = list.filter((h) => TUITION_HEAD_CODES.includes(h.code)).reduce((n, h) => n + h.amount, 0)
  return { fy: fy.label, from: fy.from, to: fy.to, receipts: payments.length, paid, refunded, total: paid - refunded, tuition: Math.max(0, tuition - tuitionRefunded), heads: list }
}

/** What the certificate will state for this student, by kind. */
async function snapshotFor(s, kind, input, auth) {
  const place = await placeOf(s.sectionId)
  const first = s.history?.find((h) => h.classLabel)
  const last = [...(s.history ?? [])].reverse().find((h) => h.classLabel)
  const base = {
    name: studentName(s), firstName: s.firstName, gender: s.gender ?? null, admissionNo: s.admissionNo, dob: s.dob ?? null, rollNo: s.rollNo ?? null,
    father: guardianOf(s, 'FATHER'), mother: guardianOf(s, 'MOTHER'), admissionDate: s.admissionDate ?? null, status: s.status,
    class: place?.label ?? last?.classLabel ?? null, yearName: place?.yearName ?? null,
  }
  if (kind === 'BONAFIDE') {
    if (s.status !== 'ACTIVE' || !place) throw conflict(`${base.name} isn’t studying here now — issue a study certificate instead.`)
    const year = await currentYear()
    if (year && String(place.yearId) !== String(year._id)) throw conflict(`${base.name} has no class in ${year.name} yet.`)
  }
  if (kind === 'CHARACTER') Object.assign(base, { conduct: input.conduct || 'Good', from: s.admissionDate ?? null, to: s.leaving?.date ?? null })
  if (kind === 'STUDY') {
    Object.assign(base, {
      from: s.admissionDate ?? null, to: s.leaving?.date ?? null, studying: s.status === 'ACTIVE',
      fromClass: input.fromClass || s.history?.find((h) => h.event === 'ADMITTED')?.classLabel || first?.classLabel || null,
      toClass: input.toClass || (s.status === 'ACTIVE' ? place?.label : last?.classLabel) || null,
    })
  }
  if (kind === 'FEE') {
    if (!moduleEnabled(auth, 'fees')) throw conflict('Fee certificates need the Fees module.')
    if (!input.fy) throw fieldsError({ fy: 'Pick the financial year' })
    const fees = await feesPaidIn(s._id, input.fy)
    if (!fees.total) throw fieldsError({ fy: `${base.name} paid no fees in ${fees.fy}` })
    base.fees = fees
  }
  if (kind === 'MERIT') {
    if (!input.event?.trim()) throw fieldsError({ event: 'Name the event or achievement' })
    Object.assign(base, { event: input.event.trim(), achievement: input.achievement?.trim() || null, eventDate: input.eventDate || null })
  }
  return base
}

async function freshCode() {
  for (let i = 0; i < 5; i++) {
    const code = makeVerifyCode()
    if (!await runAsSystem(() => Certificate.exists({ verifyCode: code }).setOptions({ allTenants: true }))) return code
  }
  throw conflict('Try again.')
}

/** Issue a certificate to each student (several only for kinds that allow it, e.g. merit). */
export async function issueCertificates(input, auth, req) {
  const kind = CERTIFICATE_KIND_BY[input.kind]
  if (!kind) throw fieldsError({ kind: 'Pick a certificate' })
  const ids = [...new Set(input.studentIds)]
  if (ids.length > 1 && !kind.many) throw fieldsError({ studentIds: `A ${kind.label.toLowerCase()} is issued to one student at a time` })
  const issueDate = input.issueDate || await today()
  const year = await currentYear()
  const students = []
  for (const id of ids) students.push(await studentInScope(id, auth))
  // work every snapshot out first, so one problem stops the whole batch before any number is used
  const snaps = []
  for (const s of students) snaps.push(await snapshotFor(s, input.kind, input, auth))
  const created = []
  for (const [i, s] of students.entries()) {
    const c = await Certificate.create({
      certificateNo: await nextNumber('CERTIFICATE', { branchId: s.branchId }), kind: input.kind, studentId: s._id, branchId: s.branchId, academicYearId: year?._id,
      issueDate, purpose: input.purpose || undefined, remarks: input.remarks || undefined, snapshot: snaps[i], verifyCode: await freshCode(),
      issuedBy: auth.user?.name, issuedById: auth.userId,
    })
    created.push(c)
  }
  await audit({
    action: 'CREATE', module: 'certificates', entityType: 'certificate', entityId: String(created[0]._id), entityName: created.length === 1 ? created[0].certificateNo : `${created.length} certificates`,
    studentId: created.length === 1 ? students[0]._id : undefined,
    summary: created.length === 1 ? `Issued ${kind.label.toLowerCase()} ${created[0].certificateNo} to ${snaps[0].name}` : `Issued ${created.length} ${kind.label.toLowerCase()}s (${snaps[0].event ?? ''})`,
  }, req)
  return { created: created.length, ids: created.map((c) => String(c._id)), numbers: created.map((c) => c.certificateNo) }
}

/** What a certificate for this student would say — the issue screen's preview (nothing is saved). */
export async function previewCertificate(input, auth) {
  const s = await studentInScope(input.studentIds[0], auth)
  return snapshotFor(s, input.kind, input, auth)
}

const rowDto = (c) => ({
  ...clean(c), studentId: String(c.studentId), kindLabel: CERTIFICATE_KIND_BY[c.kind]?.label ?? c.kind, statusLabel: CERTIFICATE_STATUS[c.status]?.label,
  name: c.snapshot?.name ?? '?', admissionNo: c.snapshot?.admissionNo ?? null, class: c.snapshot?.class ?? null, verifyUrl: verifyUrl(c.verifyCode),
})

export async function listCertificates(q, paging, auth) {
  const filter = { ...(await branchFilter(auth)) }
  if (q.kind) filter.kind = q.kind
  if (q.status) filter.status = q.status
  if (q.studentId) filter.studentId = q.studentId
  if (q.from || q.to) filter.issueDate = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) }
  if (paging.search) {
    const re = new RegExp(escapeRegex(paging.search), 'i')
    filter.$or = [{ certificateNo: re }, { 'snapshot.name': re }, { 'snapshot.admissionNo': re }, { purpose: re }]
  }
  const [rows, total] = await Promise.all([
    Certificate.find(filter).sort({ issueDate: -1, createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Certificate.countDocuments(filter),
  ])
  return listResponse(rows.map(rowDto), total, paging)
}

async function certificateInScope(id, auth) {
  if (!isOid(id)) throw notFound('Certificate')
  const c = await Certificate.findById(id)
  if (!c) throw notFound('Certificate')
  await studentInScope(c.studentId, auth)
  return c
}

export async function cancelCertificate(id, reason, auth, req) {
  const c = await certificateInScope(id, auth)
  if (c.status === 'CANCELLED') throw conflict('Already cancelled.')
  Object.assign(c, { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: auth.user?.name, cancelReason: reason })
  await c.save()
  await audit({ action: 'CANCEL', module: 'certificates', entityType: 'certificate', entityId: String(c._id), entityName: c.certificateNo, studentId: c.studentId, summary: `Cancelled certificate ${c.certificateNo} (${c.snapshot?.name}): ${reason}` }, req)
  return rowDto(c.toObject())
}

/** For the printed certificate; counts the print so the register shows reprints. */
export async function certificatePrintData(id, auth) {
  const c = await certificateInScope(id, auth)
  await Certificate.updateOne({ _id: c._id }, { $inc: { prints: 1 }, $set: { lastPrintedAt: new Date() } })
  return { certificate: c.toObject(), verifyUrl: verifyUrl(c.verifyCode) }
}

/** Public: is this certificate genuine? Only what the paper itself shows, never more. */
export async function verifyCertificate(code) {
  const want = String(code ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{12}$/.test(want)) return { found: false }
  return runAsSystem(async () => {
    const c = await Certificate.findOne({ verifyCode: want }).setOptions({ allTenants: true }).lean()
    if (!c) return { found: false }
    const t = await Tenant.findById(c.tenantId).select('name profile.city profile.state profile.logoUrl').lean()
    return {
      found: true, valid: c.status === 'ISSUED', status: c.status, certificateNo: c.certificateNo, kind: c.kind, kindLabel: CERTIFICATE_KIND_BY[c.kind]?.label ?? c.kind,
      issueDate: c.issueDate, name: c.snapshot?.name ?? null, class: c.snapshot?.class ?? null, event: c.snapshot?.event ?? null,
      cancelledAt: c.status === 'CANCELLED' ? c.cancelledAt : null,
      institution: { name: t?.name ?? null, city: t?.profile?.city ?? null, state: t?.profile?.state ?? null, logoUrl: t?.profile?.logoUrl ?? null },
    }
  })
}

export const latestCertificate = async () => (await Certificate.findOne({}).sort({ createdAt: -1 }).select('_id').lean())?._id
