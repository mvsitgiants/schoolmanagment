import {
  RESEARCH_AGENCY_BY, RESEARCH_INDEXING, RESEARCH_INDEXING_BY, RESEARCH_PROJECT_STATUS, RESEARCH_PUB_TYPES, RESEARCH_PUB_TYPE_BY,
  RESEARCH_SCHOLAR_STATUS, isValidIssn, normDoi, normIssn, projectUtilisation, researchHIndex, researchSplitNames,
} from '@schoolgiant/shared'
import { ResearchProject, ResearchPublication, ResearchScholar } from '../models/research.js'
import { Department, User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit, diffFields } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'

// Research (module `research`): publications (and patents), funded projects and grants, Ph.D. scholars.
// Data scope: ALL / BRANCH → everything · DEPARTMENT → records of the user's departments (and their own) · OWN → records
// they author, lead or guide. Staff are sign-in users (User): an author, PI or guide is picked from them.

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const AUDIT = (entityType, entity, summary, extra = {}) => ({
  action: extra.action ?? 'UPDATE', module: 'research', entityType, entityId: String(entity._id), entityName: entity.title ?? entity.name, summary, ...extra,
})

// ───────────────────────────────────────────────────────── scope

const myDepts = (auth) => (auth.user?.departmentIds ?? []).map(oid)
const me = (auth) => oid(auth.userId)

/** Filter of the records the caller may see. `own` = the fields naming the people a record belongs to. */
function scopeFilter(auth, own) {
  const scope = scopeOf(auth, 'research')
  const mine = own.map((f) => ({ [f]: me(auth) }))
  if (scope === 'OWN' || scope === 'CLASS') return { $or: mine }
  if (scope === 'DEPARTMENT') return { $or: [{ departmentId: { $in: myDepts(auth) } }, ...mine] }
  return {}
}
const PUB_OWN = ['authors.userId']
const PROJECT_OWN = ['piId', 'coPiIds']
const SCHOLAR_OWN = ['guideId', 'coGuideId']

async function findInScope(Model, id, auth, own, what) {
  if (!isOid(id)) throw notFound(what)
  const doc = await Model.findOne({ _id: id, ...scopeFilter(auth, own) })
  if (!doc) throw notFound(what)
  return doc
}

// ───────────────────────────────────────────────────────── lookups

async function staffMap(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  const rows = await User.find({ _id: { $in: list.map(oid) } }).select('name designation departmentIds').lean()
  return new Map(rows.map((u) => [String(u._id), u]))
}
async function deptMap() {
  const rows = await Department.find().select('name code').lean()
  return new Map(rows.map((d) => [String(d._id), d]))
}

/** Departments and staff for the pickers; the years that have publications. */
export async function researchMeta() {
  const [departments, staff, years] = await Promise.all([
    Department.find({ active: true }).select('name code type').sort({ name: 1 }).lean(),
    User.find({ active: true }).select('name designation departmentIds').sort({ name: 1 }).limit(3000).lean(),
    ResearchPublication.distinct('year'),
  ])
  return {
    departments: departments.map((d) => ({ id: String(d._id), name: d.name, code: d.code, type: d.type })),
    staff: staff.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null, departmentId: idStr(u.departmentIds?.[0]) })),
    years: years.filter(Boolean).sort((a, b) => b - a),
  }
}

// ───────────────────────────────────────────────────────── publications

function pubOut(p, depts) {
  const d = p.departmentId ? depts.get(String(p.departmentId)) : null
  return {
    ...clean(p),
    departmentId: idStr(p.departmentId),
    department: d ? { id: String(d._id), name: d.name, code: d.code } : null,
    authors: (p.authors ?? []).map((a) => ({ userId: idStr(a.userId), name: a.name })),
  }
}

function pubFilter(q, auth, { skip = [] } = {}) {
  const f = { ...scopeFilter(auth, PUB_OWN) }
  const and = []
  if (q.departmentId && !skip.includes('departmentId')) and.push({ departmentId: q.departmentId === 'none' ? null : oid(q.departmentId) })
  if (q.year && !skip.includes('year')) and.push({ year: q.year })
  if (q.indexing) and.push({ indexing: q.indexing })
  if (q.type) and.push({ type: q.type })
  if (q.authorId) and.push({ 'authors.userId': oid(q.authorId) })
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i')
    and.push({ $or: [{ title: re }, { venue: re }, { 'authors.name': re }, { doi: re }] })
  }
  if (and.length) f.$and = [...(f.$and ?? []), ...and]
  return f
}

/** Publications with the figures the screen draws: per year, per department, per type and indexing, h-index. */
export async function listPublications(q, auth) {
  const [rows, depts, deptRows, yearRows] = await Promise.all([
    ResearchPublication.find(pubFilter(q, auth)).sort({ year: -1, createdAt: -1 }).limit(2000).lean(),
    deptMap(),
    ResearchPublication.aggregate([{ $match: pubFilter({ ...q, departmentId: undefined }, auth) }, { $group: { _id: '$departmentId', n: { $sum: 1 } } }]),
    ResearchPublication.aggregate([{ $match: pubFilter({ ...q, year: undefined }, auth) }, { $group: { _id: '$year', n: { $sum: 1 }, citations: { $sum: '$citations' } } }, { $sort: { _id: 1 } }]),
  ])
  const citations = rows.map((r) => r.citations ?? 0)
  const ifs = rows.map((r) => r.impactFactor).filter((v) => typeof v === 'number' && v > 0)
  const count = (key, list) => list.map((x) => ({ value: x.value, n: rows.filter((r) => (key === 'indexing' ? r.indexing?.includes(x.value) : r[key] === x.value)).length }))
  return {
    rows: rows.map((r) => pubOut(r, depts)),
    summary: {
      total: rows.length,
      citations: citations.reduce((a, b) => a + b, 0),
      hIndex: researchHIndex(citations),
      avgImpact: ifs.length ? Math.round((ifs.reduce((a, b) => a + b, 0) / ifs.length) * 100) / 100 : null,
      indexed: rows.filter((r) => r.indexing?.some((i) => i === 'SCOPUS' || i === 'WOS')).length,
      byType: count('type', RESEARCH_PUB_TYPES),
      byIndexing: count('indexing', RESEARCH_INDEXING),
      byYear: yearRows.filter((y) => y._id).map((y) => ({ year: y._id, n: y.n, citations: y.citations })),
      byDepartment: deptRows.map((d) => ({ departmentId: idStr(d._id), name: d._id ? depts.get(String(d._id))?.name ?? null : null, n: d.n })).sort((a, b) => b.n - a.n),
    },
  }
}

export async function getPublication(id, auth) {
  const p = await findInScope(ResearchPublication, id, auth, PUB_OWN, 'Publication')
  return pubOut(p.toObject(), await deptMap())
}

/** Staff authors keep their login (for "my publications" and per-teacher counts); outside authors are names. */
async function resolveAuthors(list) {
  const staff = await staffMap(list.map((a) => a.userId))
  const errors = {}
  const authors = list.map((a, i) => {
    if (a.userId) {
      const u = staff.get(String(a.userId))
      if (!u) { errors[`authors.${i}`] = 'Pick a member of staff'; return null }
      return { userId: u._id, name: u.name }
    }
    return { name: String(a.name ?? '').trim() }
  }).filter((a) => a && a.name)
  return { authors, staff, errors }
}

async function checkPublication(input, id) {
  const errors = {}
  if (input.doi !== undefined && input.doi) {
    const doi = normDoi(input.doi)
    if (!doi) errors.doi = 'Not a DOI (10.xxxx/…)'
    else {
      input.doi = doi
      if (await ResearchPublication.exists({ doi, ...(id && { _id: { $ne: id } }) })) errors.doi = 'Another publication has this DOI'
    }
  }
  if (input.issn) {
    if (!isValidIssn(input.issn)) errors.issn = 'Not a valid ISSN'
    else input.issn = normIssn(input.issn)
  }
  if (input.departmentId && !(await Department.exists({ _id: input.departmentId }))) errors.departmentId = 'Pick a department'
  return errors
}

export async function savePublication(id, input, auth, req) {
  const data = { ...input }
  const errors = await checkPublication(data, id)
  let staff = new Map()
  if (data.authors) {
    const r = await resolveAuthors(data.authors)
    Object.assign(errors, r.errors)
    data.authors = r.authors
    staff = r.staff
    if (!id && !r.authors.length) errors.authors = 'Add at least one author'
  }
  if (Object.keys(errors).length) throw fieldsError(errors)
  if (data.doi === '') data.doi = undefined
  // the department of the first staff author, when none is picked
  if (!id && !data.departmentId) {
    const first = data.authors?.find((a) => a.userId)
    const dep = first && staff.get(String(first.userId))?.departmentIds?.[0]
    if (dep) data.departmentId = dep
  }
  if (!id) {
    const p = await ResearchPublication.create({ ...data, createdBy: auth.user?.name })
    await audit(AUDIT('research_publication', p, `Added ${RESEARCH_PUB_TYPE_BY[p.type]?.label.toLowerCase() ?? 'publication'} “${p.title}” (${p.year})`, { action: 'CREATE' }), req)
    return getPublication(p._id, auth)
  }
  const p = await findInScope(ResearchPublication, id, auth, PUB_OWN, 'Publication')
  const before = p.toObject()
  for (const [k, v] of Object.entries(data)) p.set(k, v === null || v === '' ? undefined : v)
  await p.save()
  const changes = diffFields(before, p.toObject(), ['title', 'type', 'venue', 'year', 'doi', 'indexing', 'impactFactor', 'citations', 'departmentId'])
  await audit(AUDIT('research_publication', p, `Changed publication “${p.title}”`, { changes }), req)
  return getPublication(p._id, auth)
}

export async function deletePublication(id, auth, req) {
  const p = await findInScope(ResearchPublication, id, auth, PUB_OWN, 'Publication')
  await p.deleteOne()
  await audit(AUDIT('research_publication', p, `Deleted publication “${p.title}” (${p.year})`, { action: 'DELETE' }), req)
  return { id: String(p._id) }
}

// import / export

const cell = (v) => (v === null || v === undefined ? '' : String(v).trim())
const norm = (s) => cell(s).toLowerCase().replace(/[^a-z0-9]/g, '')
function pickFrom(list, raw) {
  const v = norm(raw)
  if (!v) return undefined
  return list.find((x) => norm(x.value) === v || norm(x.label) === v)?.value ?? null
}

/**
 * Publications from a sheet (columns: RESEARCH_PUB_COLUMNS). Authors "A; B": a name that matches a member of staff
 * exactly is linked to them. Department: its code or name. Indexing: "Scopus; UGC-CARE". A row whose DOI is already
 * in the list (or twice in the file) is refused. A dry run checks every row and saves nothing.
 */
export async function importPublications(rows, { dryRun }, auth, req) {
  const [staff, depts, dois] = await Promise.all([
    User.find({ active: true }).select('name departmentIds').lean(),
    Department.find().select('name code').lean(),
    ResearchPublication.distinct('doi'),
  ])
  const staffByName = new Map()
  for (const u of staff) {
    const k = norm(u.name)
    staffByName.set(k, staffByName.has(k) ? null : u) // two staff with one name: don't guess
  }
  const deptBy = new Map()
  for (const d of depts) { deptBy.set(norm(d.code), d); deptBy.set(norm(d.name), d) }
  const taken = new Set(dois.filter(Boolean))
  const seen = new Set()
  const out = rows.map((f, i) => {
    const errors = []
    const type = pickFrom(RESEARCH_PUB_TYPES, f.type) ?? (cell(f.type) ? null : 'JOURNAL')
    const names = researchSplitNames(f.authors)
    const authors = names.map((n) => { const u = staffByName.get(norm(n)); return u ? { userId: u._id, name: u.name } : { name: n } })
    const indexing = researchSplitNames(cell(f.indexing).replace(/,/g, ';')).map((x) => pickFrom(RESEARCH_INDEXING, x))
    const dept = cell(f.department) ? deptBy.get(norm(f.department)) : null
    const year = Number(cell(f.year))
    const doi = cell(f.doi) ? normDoi(f.doi) : undefined
    const doc = {
      title: cell(f.title), type, authors, venue: cell(f.venue) || undefined, year,
      volume: cell(f.volume) || undefined, issue: cell(f.issue) || undefined, pages: cell(f.pages) || undefined,
      doi: doi || undefined, issn: cell(f.issn) ? normIssn(f.issn) : undefined, isbn: cell(f.isbn) || undefined,
      indexing: [...new Set(indexing.filter(Boolean))],
      impactFactor: cell(f.impactFactor) ? Number(cell(f.impactFactor)) : undefined,
      citations: cell(f.citations) ? Number(cell(f.citations)) : 0,
      departmentId: dept?._id ?? (authors.find((a) => a.userId) && staff.find((u) => String(u._id) === String(authors.find((a) => a.userId).userId))?.departmentIds?.[0]) ?? undefined,
    }
    if (doc.title.length < 3) errors.push({ field: 'title', message: 'Enter the title' })
    if (type === null) errors.push({ field: 'type', message: `No type "${cell(f.type)}"` })
    if (!authors.length) errors.push({ field: 'authors', message: 'Name the authors' })
    if (!(Number.isInteger(year) && year >= 1950 && year <= 2100)) errors.push({ field: 'year', message: 'Use a year like 2024' })
    if (cell(f.doi) && !doi) errors.push({ field: 'doi', message: 'Not a DOI (10.xxxx/…)' })
    else if (doi && (taken.has(doi) || seen.has(doi))) errors.push({ field: 'doi', message: taken.has(doi) ? 'Already in the list' : 'Twice in this file' })
    if (doc.issn && !isValidIssn(doc.issn)) errors.push({ field: 'issn', message: 'Not a valid ISSN' })
    if (indexing.includes(null)) errors.push({ field: 'indexing', message: 'Use Scopus, Web of Science, UGC-CARE, PubMed or Other' })
    if (cell(f.department) && !dept) errors.push({ field: 'department', message: `No department "${cell(f.department)}"` })
    if (doc.impactFactor !== undefined && !(doc.impactFactor >= 0 && doc.impactFactor < 1000)) errors.push({ field: 'impactFactor', message: 'Not a number' })
    if (!(Number.isInteger(doc.citations) && doc.citations >= 0)) errors.push({ field: 'citations', message: 'A whole number' })
    if (doi) seen.add(doi)
    const linked = authors.filter((a) => a.userId).length
    return { row: i + 1, fields: f, errors, doc, note: linked ? `${linked} author(s) matched to staff` : undefined }
  })
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let imported = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    try {
      await ResearchPublication.create({ ...r.doc, createdBy: auth.user?.name })
      imported++
    } catch (e) {
      errors.push({ row: r.row, field: e.code === 11000 ? 'doi' : 'title', message: e.code === 11000 ? 'Already in the list' : e.message })
    }
  }
  if (imported) await audit({ action: 'IMPORT', module: 'research', entityType: 'research_publication', entityName: `${imported} publications`, summary: `Imported ${imported} publication(s) from a file` }, req)
  return { imported, errors }
}

/** The publications in view as a CSV (same columns as the import, so a file can go round). */
export async function exportPublications(q, auth) {
  const { rows } = await listPublications(q, auth)
  const head = ['Title', 'Type', 'Authors', 'Journal / venue', 'Year', 'Volume', 'Issue', 'Pages', 'DOI', 'ISSN', 'ISBN', 'Indexing', 'Impact factor', 'Citations', 'Department']
  const lines = rows.map((p) => [
    p.title, RESEARCH_PUB_TYPE_BY[p.type]?.label ?? p.type, p.authors.map((a) => a.name).join('; '), p.venue, p.year, p.volume, p.issue, p.pages,
    p.doi, p.issn, p.isbn, (p.indexing ?? []).map((i) => RESEARCH_INDEXING_BY[i]?.label ?? i).join('; '), p.impactFactor, p.citations, p.department?.code ?? '',
  ])
  return [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\n')
}

// ───────────────────────────────────────────────────────── projects & grants

function projectOut(p, staff, depts) {
  const person = (id) => { const u = id && staff.get(String(id)); return u ? { id: String(u._id), name: u.name, designation: u.designation ?? null } : null }
  const d = p.departmentId ? depts.get(String(p.departmentId)) : null
  return {
    ...clean(p),
    piId: idStr(p.piId), pi: person(p.piId),
    coPiIds: (p.coPiIds ?? []).map(String), coPis: (p.coPiIds ?? []).map(person).filter(Boolean),
    departmentId: idStr(p.departmentId), department: d ? { id: String(d._id), name: d.name, code: d.code } : null,
    agencyLabel: RESEARCH_AGENCY_BY[p.agency]?.label ?? p.agency,
    ...projectUtilisation(p),
  }
}

export async function listProjects(q, auth) {
  const f = { ...scopeFilter(auth, PROJECT_OWN) }
  const and = []
  if (q.status) and.push({ status: q.status })
  if (q.agency) and.push({ agency: q.agency })
  if (q.departmentId) and.push({ departmentId: oid(q.departmentId) })
  if (q.search) { const re = new RegExp(escapeRegex(q.search), 'i'); and.push({ $or: [{ title: re }, { agencyName: re }, { scheme: re }, { referenceNo: re }] }) }
  if (and.length) f.$and = and
  const rows = await ResearchProject.find(f).sort({ sanctionedOn: -1, createdAt: -1 }).limit(2000).lean()
  const [staff, depts] = await Promise.all([staffMap(rows.flatMap((p) => [p.piId, ...(p.coPiIds ?? [])])), deptMap()])
  const funded = rows.filter((p) => p.status !== 'APPLIED' && p.status !== 'REJECTED')
  const sum = (k, list = funded) => list.reduce((n, p) => n + (p[k] ?? 0), 0)
  const byAgency = new Map()
  for (const p of funded) byAgency.set(p.agency, (byAgency.get(p.agency) ?? 0) + (p.sanctioned ?? 0))
  return {
    rows: rows.map((p) => projectOut(p, staff, depts)),
    summary: {
      total: rows.length,
      funded: funded.length,
      sanctioned: sum('sanctioned'), received: sum('received'), utilised: sum('utilised'),
      byStatus: Object.keys(RESEARCH_PROJECT_STATUS).map((s) => ({ status: s, n: rows.filter((p) => p.status === s).length })),
      byAgency: [...byAgency].map(([agency, amount]) => ({ agency, label: RESEARCH_AGENCY_BY[agency]?.label ?? agency, amount })).sort((a, b) => b.amount - a.amount),
    },
  }
}

async function projectById(id, auth) {
  const p = (await findInScope(ResearchProject, id, auth, PROJECT_OWN, 'Project')).toObject()
  const [staff, depts] = await Promise.all([staffMap([p.piId, ...(p.coPiIds ?? [])]), deptMap()])
  return projectOut(p, staff, depts)
}

async function checkProject(next) {
  const errors = {}
  const people = [next.piId, ...(next.coPiIds ?? [])].filter(Boolean)
  const staff = await staffMap(people)
  if (next.piId && !staff.has(String(next.piId))) errors.piId = 'Pick a member of staff'
  if ((next.coPiIds ?? []).some((x) => !staff.has(String(x)))) errors.coPiIds = 'Pick members of staff'
  if ((next.coPiIds ?? []).some((x) => String(x) === String(next.piId))) errors.coPiIds = 'The PI is already on the project'
  if (next.departmentId && !(await Department.exists({ _id: next.departmentId }))) errors.departmentId = 'Pick a department'
  if ((next.utilised ?? 0) > Math.max(next.received ?? 0, 0) && (next.received ?? 0) > 0) errors.utilised = 'More than was received'
  if ((next.received ?? 0) > (next.sanctioned ?? 0) && (next.sanctioned ?? 0) > 0) errors.received = 'More than was sanctioned'
  if (next.startDate && next.endDate && next.endDate < next.startDate) errors.endDate = 'Ends before it starts'
  if (['SANCTIONED', 'ONGOING', 'COMPLETED'].includes(next.status) && !(next.sanctioned > 0)) errors.sanctioned = 'Enter the sanctioned amount'
  return { errors, staff }
}

export async function saveProject(id, input, auth, req) {
  if (!id) {
    const { errors, staff } = await checkProject(input)
    if (Object.keys(errors).length) throw fieldsError(errors)
    const departmentId = input.departmentId ?? staff.get(String(input.piId))?.departmentIds?.[0]
    const p = await ResearchProject.create({ ...input, departmentId, createdBy: auth.user?.name })
    await audit(AUDIT('research_project', p, `Added project “${p.title}” (${RESEARCH_AGENCY_BY[p.agency]?.label ?? p.agency})`, { action: 'CREATE' }), req)
    return projectById(p._id, auth)
  }
  const p = await findInScope(ResearchProject, id, auth, PROJECT_OWN, 'Project')
  const before = p.toObject()
  const next = { ...before, ...Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === null || v === '' ? undefined : v])) }
  const { errors } = await checkProject(next)
  if (Object.keys(errors).length) throw fieldsError(errors)
  for (const [k, v] of Object.entries(input)) p.set(k, v === null || v === '' ? undefined : v)
  await p.save()
  const changes = diffFields(before, p.toObject(), ['title', 'status', 'agency', 'sanctioned', 'received', 'utilised', 'startDate', 'endDate', 'piId'])
  await audit(AUDIT('research_project', p, `Changed project “${p.title}”`, { changes }), req)
  return projectById(p._id, auth)
}

export async function deleteProject(id, auth, req) {
  const p = await findInScope(ResearchProject, id, auth, PROJECT_OWN, 'Project')
  await p.deleteOne()
  await audit(AUDIT('research_project', p, `Deleted project “${p.title}”`, { action: 'DELETE' }), req)
  return { id: String(p._id) }
}

// ───────────────────────────────────────────────────────── Ph.D. scholars

function scholarOut(s, staff, depts) {
  const person = (id) => { const u = id && staff.get(String(id)); return u ? { id: String(u._id), name: u.name, designation: u.designation ?? null } : null }
  const d = s.departmentId ? depts.get(String(s.departmentId)) : null
  return {
    ...clean(s),
    guideId: idStr(s.guideId), guide: person(s.guideId), coGuideId: idStr(s.coGuideId), coGuide: person(s.coGuideId),
    departmentId: idStr(s.departmentId), department: d ? { id: String(d._id), name: d.name, code: d.code } : null,
  }
}

export async function listScholars(q, auth) {
  const f = { ...scopeFilter(auth, SCHOLAR_OWN) }
  const and = []
  if (q.status) and.push({ status: q.status })
  if (q.guideId) and.push({ guideId: oid(q.guideId) })
  if (q.search) { const re = new RegExp(escapeRegex(q.search), 'i'); and.push({ $or: [{ name: re }, { topic: re }, { enrolmentNo: re }] }) }
  if (and.length) f.$and = and
  const rows = await ResearchScholar.find(f).sort({ registrationDate: -1 }).limit(2000).lean()
  const [staff, depts] = await Promise.all([staffMap(rows.flatMap((s) => [s.guideId, s.coGuideId])), deptMap()])
  const byGuide = new Map()
  for (const s of rows) if (s.status !== 'DISCONTINUED') byGuide.set(String(s.guideId), (byGuide.get(String(s.guideId)) ?? 0) + 1)
  return {
    rows: rows.map((s) => scholarOut(s, staff, depts)),
    summary: {
      total: rows.length,
      byStatus: Object.keys(RESEARCH_SCHOLAR_STATUS).map((s) => ({ status: s, n: rows.filter((r) => r.status === s).length })),
      byGuide: [...byGuide].map(([guideId, n]) => ({ guideId, name: staff.get(guideId)?.name ?? '—', n })).sort((a, b) => b.n - a.n),
    },
  }
}

async function scholarById(id, auth) {
  const s = (await findInScope(ResearchScholar, id, auth, SCHOLAR_OWN, 'Scholar')).toObject()
  const [staff, depts] = await Promise.all([staffMap([s.guideId, s.coGuideId]), deptMap()])
  return scholarOut(s, staff, depts)
}

async function checkScholar(next) {
  const errors = {}
  const staff = await staffMap([next.guideId, next.coGuideId])
  if (next.guideId && !staff.has(String(next.guideId))) errors.guideId = 'Pick a member of staff'
  if (next.coGuideId && !staff.has(String(next.coGuideId))) errors.coGuideId = 'Pick a member of staff'
  if (next.coGuideId && String(next.coGuideId) === String(next.guideId)) errors.coGuideId = 'The guide can’t also be the co-guide'
  if (next.status === 'AWARDED' && !next.awardedOn) errors.awardedOn = 'Enter the date of the award'
  if (next.awardedOn && next.registrationDate && next.awardedOn < next.registrationDate) errors.awardedOn = 'Before the registration'
  if (next.departmentId && !(await Department.exists({ _id: next.departmentId }))) errors.departmentId = 'Pick a department'
  return { errors, staff }
}

export async function saveScholar(id, input, auth, req) {
  if (!id) {
    const { errors, staff } = await checkScholar(input)
    if (Object.keys(errors).length) throw fieldsError(errors)
    const departmentId = input.departmentId ?? staff.get(String(input.guideId))?.departmentIds?.[0]
    const s = await ResearchScholar.create({ ...input, departmentId, createdBy: auth.user?.name })
    await audit(AUDIT('research_scholar', s, `Registered Ph.D. scholar ${s.name}`, { action: 'CREATE' }), req)
    return scholarById(s._id, auth)
  }
  const s = await findInScope(ResearchScholar, id, auth, SCHOLAR_OWN, 'Scholar')
  const before = s.toObject()
  const next = { ...before, ...Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === null || v === '' ? undefined : v])) }
  const { errors } = await checkScholar(next)
  if (Object.keys(errors).length) throw fieldsError(errors)
  for (const [k, v] of Object.entries(input)) s.set(k, v === null || v === '' ? undefined : v)
  await s.save()
  const changes = diffFields(before, s.toObject(), ['name', 'status', 'guideId', 'coGuideId', 'topic', 'registrationDate', 'awardedOn'])
  await audit(AUDIT('research_scholar', s, `Changed Ph.D. scholar ${s.name}`, { changes }), req)
  return scholarById(s._id, auth)
}

export async function deleteScholar(id, auth, req) {
  const s = await findInScope(ResearchScholar, id, auth, SCHOLAR_OWN, 'Scholar')
  await s.deleteOne()
  await audit(AUDIT('research_scholar', s, `Removed Ph.D. scholar ${s.name}`, { action: 'DELETE' }), req)
  return { id: String(s._id) }
}
