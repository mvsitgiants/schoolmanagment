import { DOC_TYPE_BY_CODE, PAYMENT_MODE_LABEL, donationFundLabel, formatINR, isValidDonorPan } from '@schoolgiant/shared'
import { Alumnus, AlumniDonation } from '../models/alumni.js'
import { Tenant } from '../models/platform.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { escapeRegex } from '../platform/validate.js'
import { today } from './alumni.js'

// Alumni donations: who gave (an alumnus from the directory, or anyone), how much, how (cash, UPI, cheque …), to which
// fund, and the receipt — numbered from the DONATION series and printed (DONATION_RECEIPT), marked 80G when the
// institution's exemption applies (the donor's PAN is then needed). Each donation emits `alumni.donation`; Accounts
// posts it (Dr cash / bank, Cr Donations & grants).

const rx = (s) => new RegExp(escapeRegex(String(s)), 'i')
const fyStart = (ymd) => { const y = Number(ymd.slice(0, 4)); return Number(ymd.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01` }

/** The next receipt number: the DONATION series, or (until the series is set up) a plain running number. */
async function receiptNumber(date, branchId) {
  if (DOC_TYPE_BY_CODE.DONATION) return nextNumber('DONATION', { branchId, date: new Date(`${date}T12:00:00Z`) })
  const prefix = `DN${date.slice(2, 4)}`
  let n = (await AlumniDonation.countDocuments({ receiptNo: new RegExp(`^${prefix}`) })) + 1
  while (await AlumniDonation.exists({ receiptNo: `${prefix}${String(n).padStart(5, '0')}` })) n++
  return `${prefix}${String(n).padStart(5, '0')}`
}

function donationFilter({ fund, batch, from, to, search, status, alumnusId, is80G }) {
  const f = {}
  if (status) f.status = status
  if (fund) f.fund = fund
  if (batch) f['donor.batch'] = Number(batch)
  if (alumnusId && isOid(alumnusId)) f['donor.alumnusId'] = alumnusId
  if (is80G === '1') f.is80G = true
  if (from || to) f.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  if (search) { const re = rx(search); f.$or = [{ 'donor.name': re }, { receiptNo: re }, { reference: re }, { purpose: re }, { 'donor.pan': re }] }
  return f
}

const donationOut = (d) => ({ ...clean(d), donor: { ...d.donor, alumnusId: d.donor?.alumnusId ? String(d.donor.alumnusId) : null } })

export async function listDonations(q = {}) {
  const page = q.page ?? 1
  const pageSize = q.pageSize ?? 50
  const f = donationFilter(q)
  const [rows, total, sum] = await Promise.all([
    AlumniDonation.find(f).sort({ date: -1, createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    AlumniDonation.countDocuments(f),
    AlumniDonation.aggregate([{ $match: { ...f, status: 'RECEIVED' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
  ])
  return { data: rows.map(donationOut), total, amount: sum[0]?.amount ?? 0, page, pageSize }
}

export async function getDonation(id) {
  const d = isOid(id) ? await AlumniDonation.findById(id).lean() : null
  if (!d) throw notFound('Donation')
  return donationOut(d)
}

export async function createDonation(input, auth, req) {
  const date = input.date || await today()
  if (date > await today()) throw badRequest('The donation date is in the future.', { fields: { date: 'Pick today or earlier' } })
  let donor
  if (input.donorKind === 'ALUMNUS') {
    const a = isOid(input.alumnusId) ? await Alumnus.findById(input.alumnusId).lean() : null
    if (!a) throw badRequest('Pick the alumnus.', { fields: { alumnusId: 'Pick from the directory' } })
    donor = { kind: 'ALUMNUS', alumnusId: a._id, name: a.name, batch: a.batch, email: input.email || a.email, mobile: input.mobile || a.mobile, pan: input.pan, address: input.address }
  } else {
    if (!input.name) throw badRequest('Enter the donor’s name.', { fields: { name: 'Required' } })
    donor = { kind: 'OTHER', name: input.name, email: input.email, mobile: input.mobile, pan: input.pan, address: input.address }
  }
  if (donor.pan && !isValidDonorPan(donor.pan)) throw badRequest('That PAN doesn’t look right.', { fields: { pan: 'Like ABCDE1234F' } })
  if (input.is80G && !donor.pan) throw badRequest('An 80G receipt needs the donor’s PAN.', { fields: { pan: 'Needed for 80G' } })
  const branchId = auth.user?.branchId ?? undefined
  const receiptNo = await receiptNumber(date, branchId)
  const d = await AlumniDonation.create({
    receiptNo, date, donor: { ...donor, pan: donor.pan?.toUpperCase() }, amount: input.amount, mode: input.mode, reference: input.reference,
    fund: input.fund || 'GENERAL', purpose: input.purpose, is80G: !!input.is80G, branchId, note: input.note, receivedBy: auth.user?.name,
  })
  await emit('alumni.donation', { entity: { type: 'alumni_donation', id: d._id }, data: { donation: { receiptNo, amount: formatINR(d.amount), fund: donationFundLabel(d.fund), donor: donor.name } } })
  await audit({ action: 'CREATE', module: 'alumni', entityType: 'alumni_donation', entityId: String(d._id), entityName: donor.name, summary: `Donation of ${formatINR(d.amount)} from ${donor.name}${donor.batch ? ` (batch ${donor.batch})` : ''} to ${donationFundLabel(d.fund)}, receipt ${receiptNo}` }, req)
  return getDonation(d._id)
}

/** Totals by fund, by batch and by month; all time and this financial year. */
export async function donationSummary({ from, to } = {}) {
  const t = await today()
  const range = from || to ? { date: { ...(from && { $gte: from }), ...(to && { $lte: to }) } } : {}
  const m = { status: 'RECEIVED', ...range }
  const [all, fy, byFund, byBatch, byMonth, donors] = await Promise.all([
    AlumniDonation.aggregate([{ $match: m }, { $group: { _id: null, amount: { $sum: '$amount' }, n: { $sum: 1 }, g80: { $sum: { $cond: ['$is80G', '$amount', 0] } }, largest: { $max: '$amount' } } }]),
    AlumniDonation.aggregate([{ $match: { status: 'RECEIVED', date: { $gte: fyStart(t), $lte: t } } }, { $group: { _id: null, amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    AlumniDonation.aggregate([{ $match: m }, { $group: { _id: '$fund', amount: { $sum: '$amount' }, n: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    AlumniDonation.aggregate([{ $match: { ...m, 'donor.batch': { $ne: null } } }, { $group: { _id: '$donor.batch', amount: { $sum: '$amount' }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    AlumniDonation.aggregate([{ $match: m }, { $group: { _id: { $substrCP: ['$date', 0, 7] }, amount: { $sum: '$amount' }, n: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 12 }]),
    AlumniDonation.aggregate([{ $match: m }, { $group: { _id: { $ifNull: ['$donor.alumnusId', '$donor.name'] }, name: { $first: '$donor.name' }, batch: { $first: '$donor.batch' }, amount: { $sum: '$amount' } } }, { $sort: { amount: -1 } }, { $limit: 10 }]),
  ])
  return {
    totals: { amount: all[0]?.amount ?? 0, count: all[0]?.n ?? 0, amount80G: all[0]?.g80 ?? 0, largest: all[0]?.largest ?? 0, fyAmount: fy[0]?.amount ?? 0, fyCount: fy[0]?.n ?? 0, fyFrom: fyStart(t) },
    byFund: byFund.map((f) => ({ fund: f._id, label: donationFundLabel(f._id), amount: f.amount, count: f.n })),
    byBatch: byBatch.map((b) => ({ batch: b._id, amount: b.amount, count: b.n })),
    byMonth: byMonth.reverse().map((x) => ({ month: x._id, amount: x.amount, count: x.n })),
    topDonors: donors.map((d) => ({ name: d.name, batch: d.batch ?? null, amount: d.amount })),
    funds: (await AlumniDonation.distinct('fund')).filter(Boolean),
  }
}

export async function exportDonations(q) {
  const { data } = await listDonations({ ...q, page: 1, pageSize: 50000 })
  const head = ['Receipt', 'Date', 'Donor', 'Alumnus / other', 'Batch', 'Amount', 'Mode', 'Reference', 'Fund', 'Purpose', '80G', 'PAN', 'Email', 'Mobile', 'Status', 'Received by']
  return [head, ...data.map((d) => [d.receiptNo, d.date, d.donor.name, d.donor.kind === 'ALUMNUS' ? 'Alumnus' : 'Other', d.donor.batch, d.amount / 100, PAYMENT_MODE_LABEL[d.mode] ?? d.mode, d.reference, donationFundLabel(d.fund), d.purpose, d.is80G ? 'Yes' : '', d.donor.pan, d.donor.email, d.donor.mobile, d.status, d.receivedBy])]
    .map((r) => r.map(csvCell).join(',')).join('\n')
}

/** What the DONATION_RECEIPT document prints (documents/alumniDocs.js). */
export async function donationPrintData(id) {
  const d = await getDonation(id)
  const t = await Tenant.findById(getContext()?.tenantId).select('name profile').lean()
  return { donation: d, institutionPan: t?.profile?.pan ?? null, registrationNo: t?.profile?.registrationNo ?? null }
}

export const latestDonationId = async () => (await AlumniDonation.findOne().sort({ createdAt: -1 }).select('_id').lean())?._id
