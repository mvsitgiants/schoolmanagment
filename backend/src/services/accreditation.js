import {
  ACCR_DVV_STATUS, ACCR_FRAMEWORK_BY, ACCR_METRIC_STATUS, ACCR_SOURCES, accrCompletion, accrCriteria, accrMarks, accrMetric, accrMetrics, accrPerProgram,
  accrRecentYears, accrWordCount,
} from '@schoolgiant/shared'
import { AcademicYear } from '../models/academics.js'
import { AccrAssessment, AccrEvidence } from '../models/accreditation.js'
import { Program } from '../models/programs.js'
import { logger } from '../platform/logger.js'
import { Attachment } from '../models/engines.js'
import { audit, diffFields } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, notFound } from '../platform/errors.js'
import { institutionNow } from '../platform/time.js'
import { computeMetrics } from './accreditationMetrics.js'

// Accreditation (module `accreditation`): a framework's return (NAAC SSR, NBA SAR per programme, NIRF, AISHE) for an assessment year, metric
// by metric — computed from SchoolGiant's records where it can (services/accreditationMetrics.js), else entered with a
// note; qualitative metrics carry a narrative. Each metric moves not started → draft → complete. The evidence
// repository keeps the documents behind each metric (files engine, record type `accreditation_evidence`) with a
// DVV-style checklist of what data validation asks for.

const EVIDENCE_TYPE = 'accreditation_evidence'
const frameworkOf = (framework) => { if (!ACCR_FRAMEWORK_BY[framework]) throw notFound('Framework'); return framework }

/**
 * The programme a report is for: required by per-programme frameworks (NBA) and must be one of the institution's;
 * null for the others (whatever was sent).
 */
async function programOf(framework, programId) {
  if (!accrPerProgram(framework)) return null
  if (!programId || !isOid(String(programId))) throw badRequest('Pick the programme the report is for.', { fields: { programId: 'Pick a programme' } })
  const p = await Program.findById(programId).select('name code departmentId').lean()
  if (!p) throw notFound('Programme')
  return p
}
const programKey = (p) => (p ? p._id : null)

// The unique index became { framework, year, programId } when NBA came: sync once per process so the old
// { framework, year } index (which would refuse a second programme's report) is dropped where it still exists.
let indexesSynced = null
const syncIndexesOnce = () => (indexesSynced ??= AccrAssessment.syncIndexes().catch((err) => { logger.warn({ err }, 'accreditation: indexes could not be synced') }))

/** Years to pick from: the institution's academic years and the last few, newest first. */
export async function accreditationMeta() {
  const [years, now] = await Promise.all([AcademicYear.find().select('name isCurrent startDate').sort({ startDate: -1 }).lean(), institutionNow()])
  const named = years.map((y) => y.name).filter((n) => /^\d{4}-\d{2}$/.test(n))
  const all = [...new Set([...named, ...accrRecentYears(now.date)])].sort().reverse()
  const current = years.find((y) => y.isCurrent && /^\d{4}-\d{2}$/.test(y.name))?.name ?? accrRecentYears(now.date)[0]
  // programmes for the per-programme frameworks (NBA)
  const programs = (await Program.find({ active: true }).select('name code level').sort({ name: 1 }).lean()).map((p) => ({ id: String(p._id), name: p.name, code: p.code, level: p.level }))
  return { years: all, current, programs }
}

async function assessmentFor(framework, year, programId = null) {
  await syncIndexesOnce()
  const upsert = () => AccrAssessment.findOneAndUpdate(
    { framework, year, programId },
    { $setOnInsert: { framework, year, programId, metrics: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
  try {
    return await upsert()
  } catch (err) {
    if (err?.code === 11000) return upsert() // opened at the same moment by someone else: theirs now exists
    throw err
  }
}

/** Evidence items and their files per metric code (for a framework; items of the year or with no year). */
async function evidenceCounts(framework, year, programId = null) {
  const items = await AccrEvidence.find({ framework, ...(programId && { programId }), ...(year && { $or: [{ year }, { year: null }] }) }).select('metricCodes checklist link').lean()
  const files = await fileCounts(items.map((e) => String(e._id)))
  const byMetric = new Map()
  for (const e of items) {
    const n = files.get(String(e._id)) ?? 0
    for (const code of e.metricCodes ?? []) {
      const x = byMetric.get(code) ?? { items: 0, files: 0, checklist: new Set() }
      x.items++
      x.files += n
      if (n || e.link) for (const c of e.checklist ?? []) if (c.startsWith(`${code}#`)) x.checklist.add(c)
      byMetric.set(code, x)
    }
  }
  return byMetric
}

async function fileCounts(ids) {
  if (!ids.length) return new Map()
  const rows = await Attachment.aggregate([
    { $match: { entityType: EVIDENCE_TYPE, entityId: { $in: ids }, 'deleted.at': null } },
    { $group: { _id: '$entityId', n: { $sum: 1 } } },
  ])
  return new Map(rows.map((r) => [r._id, r.n]))
}

/**
 * The report of a framework for a year: criteria with their metrics, each with its computed value (and how it was
 * worked out), the manual value and note, the narrative, its status and the evidence behind it; completion per criterion.
 */
export async function getReport(framework, year, programId) {
  frameworkOf(framework)
  const program = await programOf(framework, programId)
  const a = await assessmentFor(framework, year, programKey(program))
  const metrics = accrMetrics(framework)
  const [{ values, range }, evidence] = await Promise.all([computeMetrics(metrics, year, { programId: programKey(program) }), evidenceCounts(framework, year, programKey(program))])
  const scores = Object.fromEntries((a.scores ?? []).filter((x) => typeof x.marks === 'number').map((x) => [x.criterion, x.marks]))
  const scoreOf = Object.fromEntries((a.scores ?? []).map((x) => [x.criterion, x]))
  const states = Object.fromEntries((a.metrics ?? []).map((m) => [m.code, m]))
  const criteria = accrCriteria(framework).map((c) => {
    const rows = c.metrics.map((m) => {
      const s = states[m.code] ?? {}
      const computed = values.get(m.code) ?? null
      const manual = typeof s.manualValue === 'number' ? s.manualValue : null
      const ev = evidence.get(m.code)
      return {
        code: m.code, title: m.title, kind: m.kind, source: m.source, unit: m.unit ?? null, auto: !!m.auto,
        computed: computed?.value ?? null, detail: computed?.detail ?? [],
        manualValue: manual, value: manual ?? computed?.value ?? null, valueFrom: manual !== null ? 'MANUAL' : computed?.value != null ? 'AUTO' : null,
        note: s.note ?? '', narrative: s.narrative ?? '', words: m.kind === 'QL' ? accrWordCount(s.narrative) : null,
        status: s.status ?? 'NOT_STARTED', updatedBy: s.updatedBy ?? null, updatedAt: s.updatedAt ?? null,
        evidence: ev?.items ?? 0, files: ev?.files ?? 0,
        checklist: m.dvv ? { total: m.dvv.length, done: m.dvv.filter((_, i) => ev?.checklist.has(`${m.code}#${i}`)).length } : null,
      }
    })
    const sc = scoreOf[c.id]
    return {
      id: c.id, code: c.code, title: c.title, weight: c.weight, metrics: rows, completion: accrCompletion(c.metrics, states),
      score: ACCR_FRAMEWORK_BY[framework].marks ? { marks: typeof sc?.marks === 'number' ? sc.marks : null, note: sc?.note ?? '', updatedBy: sc?.updatedBy ?? null, updatedAt: sc?.updatedAt ?? null } : null,
    }
  })
  const all = criteria.flatMap((c) => c.metrics)
  return {
    id: String(a._id), framework, year, range: { from: range.from, to: range.to },
    program: program ? { id: String(program._id), name: program.name, code: program.code } : null,
    criteria,
    marks: ACCR_FRAMEWORK_BY[framework].marks ? accrMarks(accrCriteria(framework), scores) : null,
    summary: {
      ...accrCompletion(metrics, states),
      quantitative: all.filter((m) => m.kind === 'QN').length,
      computed: all.filter((m) => m.valueFrom === 'AUTO').length,
      valued: all.filter((m) => m.kind === 'QN' && m.value !== null).length,
      qualitative: all.filter((m) => m.kind === 'QL').length,
      narratives: all.filter((m) => m.kind === 'QL' && m.narrative.trim()).length,
      evidence: all.reduce((n, m) => n + m.evidence, 0),
    },
  }
}

/** Save a metric: status, manual value (null clears it), note, narrative. */
export async function saveMetric(framework, year, code, input, auth, req) {
  frameworkOf(framework)
  const program = await programOf(framework, input.programId)
  const programId = programKey(program)
  const def = accrMetric(framework, code)
  if (!def) throw notFound('Metric')
  if (def.kind === 'QL' && input.manualValue !== undefined && input.manualValue !== null) throw badRequest('A qualitative metric has a narrative, not a value.', { fields: { manualValue: 'Write the narrative instead' } })
  await assessmentFor(framework, year, programId)
  const a = await AccrAssessment.findOne({ framework, year, programId })
  let s = a.metrics.find((m) => m.code === code)
  if (!s) { a.metrics.push({ code }); s = a.metrics[a.metrics.length - 1] }
  const before = { status: s.status, manualValue: s.manualValue, note: s.note, narrative: s.narrative }
  for (const k of ['status', 'manualValue', 'note', 'narrative']) if (input[k] !== undefined) s[k] = input[k] === '' ? undefined : input[k] ?? undefined
  // writing something moves a metric off "not started"
  if (input.status === undefined && s.status === 'NOT_STARTED' && (s.narrative || s.note || typeof s.manualValue === 'number')) s.status = 'DRAFT'
  s.updatedBy = auth.user?.name
  s.updatedAt = new Date()
  a.markModified('metrics')
  await a.save()
  const changes = diffFields(before, { status: s.status, manualValue: s.manualValue, note: s.note, narrative: s.narrative }, ['status', 'manualValue', 'note', 'narrative'])
    .map((c) => (c.field === 'narrative' ? { field: 'narrative', from: c.from ? `${accrWordCount(c.from)} words` : null, to: c.to ? `${accrWordCount(c.to)} words` : null } : c))
  const what = `${framework}${program ? ` ${program.code}` : ''}`
  await audit({ action: 'UPDATE', module: 'accreditation', entityType: 'accr_metric', entityId: String(a._id), entityName: `${what} ${year} · ${code}`, summary: `Updated ${what} ${code} (${ACCR_METRIC_STATUS[s.status]?.label.toLowerCase() ?? s.status}) for ${year}`, changes }, req)
  return (await getReport(framework, year, programId)).criteria.flatMap((c) => c.metrics).find((m) => m.code === code)
}

/** A criterion's self-assessed marks (frameworks with marks — NBA): 0 to its weight; null clears them. */
export async function saveScore(framework, year, criterion, input, auth, req) {
  frameworkOf(framework)
  if (!ACCR_FRAMEWORK_BY[framework].marks) throw badRequest(`${framework} is not scored in marks.`)
  const program = await programOf(framework, input.programId)
  const programId = programKey(program)
  const c = accrCriteria(framework).find((x) => x.id === criterion)
  if (!c) throw notFound('Criterion')
  if (typeof input.marks === 'number' && (input.marks < 0 || input.marks > c.weight)) throw badRequest(`Marks for criterion ${c.code} are 0 to ${c.weight}.`, { fields: { marks: `0 to ${c.weight}` } })
  await assessmentFor(framework, year, programId)
  const a = await AccrAssessment.findOne({ framework, year, programId })
  let sc = a.scores.find((x) => x.criterion === criterion)
  if (!sc) { a.scores.push({ criterion }); sc = a.scores[a.scores.length - 1] }
  const before = sc.marks ?? null
  if (input.marks !== undefined) sc.marks = input.marks ?? undefined
  if (input.note !== undefined) sc.note = input.note || undefined
  sc.updatedBy = auth.user?.name
  sc.updatedAt = new Date()
  a.markModified('scores')
  await a.save()
  const what = `${framework}${program ? ` ${program.code}` : ''}`
  await audit({ action: 'UPDATE', module: 'accreditation', entityType: 'accr_score', entityId: String(a._id), entityName: `${what} ${year} · criterion ${c.code}`, summary: `${what} criterion ${c.code}: ${sc.marks ?? '—'} of ${c.weight} marks for ${year}`, changes: [{ field: 'marks', from: before, to: sc.marks ?? null }] }, req)
  const r = await getReport(framework, year, programId)
  return { criterion: r.criteria.find((x) => x.id === criterion), marks: r.marks }
}

// ───────────────────────────────────────────────────────── export & print

const plain = (md) => String(md ?? '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim()

/** The report as a CSV: one line per metric. */
export async function exportReport(framework, year, programId) {
  const r = await getReport(framework, year, programId)
  const head = ['Criterion', 'Metric', 'Title', 'Kind', 'Value', 'Unit', 'Value from', 'Data source', 'Status', 'Note', 'Narrative', 'Evidence items', 'Files']
  const lines = r.criteria.flatMap((c) => c.metrics.map((m) => [
    `${c.code} ${c.title}`, m.code, m.title, m.kind, m.value, m.unit, m.valueFrom === 'AUTO' ? 'Computed' : m.valueFrom === 'MANUAL' ? 'Entered' : '',
    ACCR_SOURCES[m.source]?.label ?? m.source, ACCR_METRIC_STATUS[m.status]?.label ?? m.status, m.note, plain(m.narrative), m.evidence, m.files,
  ]))
  // the self-assessed marks of each criterion, under the metrics (NBA)
  const marks = r.marks ? [[], ['Criterion', 'Marks', 'Out of', 'Note'], ...r.criteria.map((c) => [`${c.code} ${c.title}`, c.score?.marks ?? '', c.weight, c.score?.note ?? '']), ['Total', r.marks.claimed, r.marks.max, '']] : []
  const top = r.program ? [[`${r.program.name} (${r.program.code})`], []] : []
  return [...top, head, ...lines, ...marks].map((l) => l.map(csvCell).join(',')).join('\n')
}

/** Print data of an assessment (documents/accreditationDocs.js): `id` is the AccrAssessment. */
export async function reportPrintData(id) {
  if (!isOid(id)) throw notFound('Report')
  const a = await AccrAssessment.findById(id).select('framework year programId').lean()
  if (!a) throw notFound('Report')
  return getReport(a.framework, a.year, a.programId)
}

export const latestAssessmentId = async () => (await AccrAssessment.findOne().sort({ updatedAt: -1 }).select('_id').lean())?._id

// ───────────────────────────────────────────────────────── evidence repository

function evidenceOut(e, files) {
  return {
    ...clean(e),
    uploadedById: e.uploadedById ? String(e.uploadedById) : null,
    files: files.get(String(e._id)) ?? 0,
    dvv: { status: e.dvv?.status ?? 'PENDING', note: e.dvv?.note ?? null, by: e.dvv?.by ?? null, at: e.dvv?.at ?? null },
  }
}

/**
 * Evidence of a framework (optionally one metric or criterion, a year) and the DVV checklist of the metrics in view:
 * per metric its required documents, each ticked when an item with a file (or a link) answers it.
 */
export async function listEvidence({ framework, year, metric, criterion, search, programId }) {
  frameworkOf(framework)
  const program = await programOf(framework, programId)
  const metrics = accrMetrics(framework).filter((m) => (!metric || m.code === metric) && (!criterion || m.criterion === criterion))
  const codes = metrics.map((m) => m.code)
  const filter = { framework, metricCodes: { $in: codes }, ...(program && { programId: program._id }) }
  if (year) filter.$or = [{ year }, { year: null }]
  if (search) {
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$and = [{ $or: [{ title: re }, { description: re }] }]
  }
  const rows = await AccrEvidence.find(filter).sort({ updatedAt: -1 }).limit(1000).lean()
  const files = await fileCounts(rows.map((e) => String(e._id)))
  const items = rows.map((e) => evidenceOut(e, files))
  const checklist = metrics.map((m) => {
    const mine = items.filter((e) => e.metricCodes.includes(m.code))
    return {
      code: m.code, title: m.title, kind: m.kind, criterion: m.criterion,
      evidence: mine.length, files: mine.reduce((n, e) => n + e.files, 0),
      verified: mine.filter((e) => e.dvv.status === 'VERIFIED').length,
      items: (m.dvv ?? []).map((label, i) => {
        const key = `${m.code}#${i}`
        const answering = mine.filter((e) => e.checklist?.includes(key))
        return { key, label, evidence: answering.length, done: answering.some((e) => e.files > 0 || e.link) }
      }),
    }
  })
  return {
    rows: items,
    checklist,
    summary: {
      items: items.length,
      files: items.reduce((n, e) => n + e.files, 0),
      verified: items.filter((e) => e.dvv.status === 'VERIFIED').length,
      clarify: items.filter((e) => e.dvv.status === 'CLARIFY').length,
      metricsCovered: checklist.filter((c) => c.evidence > 0).length,
      metrics: checklist.length,
      checklistDone: checklist.reduce((n, c) => n + c.items.filter((i) => i.done).length, 0),
      checklistTotal: checklist.reduce((n, c) => n + c.items.length, 0),
    },
  }
}

function checkEvidence(framework, input) {
  const errors = {}
  const valid = new Set(accrMetrics(framework).map((m) => m.code))
  if (input.metricCodes) {
    const bad = input.metricCodes.filter((c) => !valid.has(c))
    if (bad.length) errors.metricCodes = `No metric ${bad.join(', ')} in ${framework}`
    if (!input.metricCodes.length) errors.metricCodes = 'Link it to at least one metric'
  }
  if (input.checklist) {
    const codes = new Set(input.metricCodes ?? [])
    const bad = input.checklist.filter((k) => {
      const [code, i] = k.split('#')
      const def = accrMetric(framework, code)
      return !codes.has(code) || !def?.dvv?.[Number(i)]
    })
    if (bad.length) errors.checklist = 'Tick documents of the linked metrics'
  }
  if (Object.keys(errors).length) throw badRequest('Some details need fixing.', { fields: errors })
}

async function evidenceById(id) {
  if (!isOid(id)) throw notFound('Evidence')
  const e = await AccrEvidence.findById(id)
  if (!e) throw notFound('Evidence')
  return e
}

export async function getEvidence(id) {
  const e = (await evidenceById(id)).toObject()
  return evidenceOut(e, await fileCounts([String(e._id)]))
}

export async function saveEvidence(id, input, auth, req) {
  if (!id) {
    frameworkOf(input.framework)
    const program = await programOf(input.framework, input.programId)
    checkEvidence(input.framework, input)
    const e = await AccrEvidence.create({ ...input, programId: programKey(program) ?? undefined, uploadedById: auth.userId, uploadedBy: auth.user?.name })
    await audit({ action: 'CREATE', module: 'accreditation', entityType: EVIDENCE_TYPE, entityId: String(e._id), entityName: e.title, summary: `Added evidence “${e.title}” for ${e.framework} ${e.metricCodes.join(', ')}` }, req)
    return getEvidence(e._id)
  }
  const e = await evidenceById(id)
  const before = e.toObject()
  const next = { metricCodes: input.metricCodes ?? before.metricCodes, checklist: input.checklist ?? before.checklist }
  checkEvidence(e.framework, next)
  for (const [k, v] of Object.entries(input)) if (k !== 'framework' && k !== 'programId') e.set(k, v === null || v === '' ? undefined : v)
  // the checklist only names documents of the linked metrics
  e.checklist = (e.checklist ?? []).filter((k) => e.metricCodes.includes(k.split('#')[0]))
  await e.save()
  const changes = diffFields(before, e.toObject(), ['title', 'description', 'year', 'metricCodes', 'checklist', 'link'])
  await audit({ action: 'UPDATE', module: 'accreditation', entityType: EVIDENCE_TYPE, entityId: String(e._id), entityName: e.title, summary: `Changed evidence “${e.title}”`, changes }, req)
  return getEvidence(e._id)
}

/** DVV: mark an item verified or needing clarification (with a note). */
export async function setEvidenceDvv(id, { status, note }, auth, req) {
  const e = await evidenceById(id)
  const before = e.dvv?.status ?? 'PENDING'
  e.dvv = { status, note: note || undefined, by: auth.user?.name, at: new Date() }
  await e.save()
  await audit({ action: 'UPDATE', module: 'accreditation', entityType: EVIDENCE_TYPE, entityId: String(e._id), entityName: e.title, summary: `DVV: “${e.title}” ${ACCR_DVV_STATUS[status].label.toLowerCase()}${note ? ` — ${note}` : ''}`, changes: [{ field: 'dvv', from: before, to: status }] }, req)
  return getEvidence(e._id)
}

export async function deleteEvidence(id, auth, req) {
  const e = await evidenceById(id)
  await e.deleteOne()
  await audit({ action: 'DELETE', module: 'accreditation', entityType: EVIDENCE_TYPE, entityId: String(e._id), entityName: e.title, summary: `Deleted evidence “${e.title}” (${e.framework} ${e.metricCodes.join(', ')})` }, req)
  return { id: String(e._id) }
}

/** Files engine (services/files.js RECORDS.accreditation_evidence): the evidence item files are added to. */
export async function accrEvidenceRecord(id) {
  if (!isOid(id)) return null
  const e = await AccrEvidence.findById(id).select('title framework metricCodes').lean()
  return e ? { name: `${e.framework} ${e.metricCodes.join(', ')} · ${e.title}`, canAdd: true } : null
}
