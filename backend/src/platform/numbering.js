import { DOC_TYPES, DOC_TYPE_BY_CODE, formatDocNumber, periodKey } from '@schoolgiant/shared'
import { Tenant } from '../models/platform.js'
import { Branch, NumberSeries, TenantCounter } from '../models/tenant.js'
import { getContext } from './context.js'
import { AppError } from './errors.js'

// Number series engine (E9). Human numbers come only from here (docs/03 §4 rule 9).
// The counter row is bumped with one atomic findOneAndUpdate($inc), so two cashiers
// pressing "Save" in the same millisecond still get different numbers.

async function tenantTimezone() {
  const t = await Tenant.findById(getContext()?.tenantId).select('profile.timezone').lean()
  return t?.profile?.timezone || 'Asia/Kolkata'
}

/** The effective series for a doc type: the tenant's own, else the default. */
export async function seriesFor(docType) {
  const def = DOC_TYPE_BY_CODE[docType]
  if (!def) throw new AppError(500, `Unknown document type ${docType}`)
  const own = await NumberSeries.findOne({ docType }).lean()
  return { ...def, pattern: own?.pattern ?? def.pattern, reset: own?.reset ?? def.reset, customised: !!own }
}

/**
 * The pattern a series prints with. A series counted per campus restarts at 1 on each campus, so with two or more
 * campuses its default pattern (which has no campus code) would print the same number twice — there the campus code
 * goes in front ("UPB/TC/2026/0001"). An institution's own pattern is used as saved.
 */
async function patternOf(series) {
  if (!series.perBranch || series.customised || series.pattern.includes('{BR}')) return series.pattern
  return (await Branch.countDocuments({ active: true })) > 1 ? `{BR}/${series.pattern}` : series.pattern
}

async function branchCode(branchId) {
  if (!branchId) return (await Branch.findOne({ isDefault: true }).select('code').lean())?.code ?? 'MAIN'
  return (await Branch.findById(branchId).select('code').lean())?.code ?? 'MAIN'
}

/** Issue the next number, e.g. nextNumber('ADMISSION_NO') → '20260125'. */
export async function nextNumber(docType, { branchId, date = new Date() } = {}) {
  const series = await seriesFor(docType)
  const timeZone = await tenantTimezone()
  const code = await branchCode(branchId)
  const scope = series.perBranch ? code : 'ALL'
  const period = periodKey(series.reset, date, timeZone)
  const counter = await TenantCounter.findOneAndUpdate(
    { docType, scope, period },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  return formatDocNumber(await patternOf(series), { seq: counter.seq, date, timeZone, branchCode: code })
}

/** Every doc type with its pattern, the last number used and a preview of the next one. */
export async function listSeries() {
  const timeZone = await tenantTimezone()
  const code = await branchCode()
  const now = new Date()
  const out = []
  for (const d of DOC_TYPES) {
    const s = await seriesFor(d.code)
    const scope = s.perBranch ? code : 'ALL'
    const counter = await TenantCounter.findOne({ docType: d.code, scope, period: periodKey(s.reset, now, timeZone) }).lean()
    const seq = counter?.seq ?? 0
    const pattern = await patternOf(s)
    out.push({
      ...s,
      lastNumber: seq ? formatDocNumber(pattern, { seq, date: now, timeZone, branchCode: code }) : null,
      nextNumber: formatDocNumber(pattern, { seq: seq + 1, date: now, timeZone, branchCode: code }),
      issued: seq,
    })
  }
  return out
}
