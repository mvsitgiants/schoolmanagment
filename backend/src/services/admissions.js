import {
  APPLICATION_STATUS, CYCLE_STATUS, ENQUIRY_SOURCE_LABEL, ENQUIRY_STAGES, LIVE_APPLICATION, OPEN_STAGES, addDaysYmd, ageOn, mobile10, mobileVariants, rankApplicants, validateFormValues,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { AcademicYear, ClassLevel } from '../models/academics.js'
import { AdmissionCycle, Application, Enquiry, EntranceTest } from '../models/admissions.js'
import { FormTemplate } from '../models/forms.js'
import { Visitor } from '../models/frontOffice.js'
import { Tenant } from '../models/platform.js'
import { Branch } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { formVersion } from './forms.js'
import { humanDate, queueFamilyMessages } from './notify.js'
import { admitStudent } from './students.js'

// Admissions (module `admissions`). An admission cycle opens classes with seats; enquiries (the CRM pipeline: new →
// contacted → visit → visited → applied → admitted, or lost) are followed up and turn into applications; applicants
// may sit an entrance test; each class's merit list ranks them (test marks, an entered score, or first come) and seats
// are offered from the top; an accepted offer is admitted as a student through Students' own admitStudent(). Families
// apply online at /apply/<school> after proving their mobile with a one-time code, and check their applications there.
// Who sees which campus follows the role's data scope for `admissions` (BRANCH or ALL).

const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
const name3 = (c) => [c?.firstName, c?.middleName, c?.lastName].filter(Boolean).join(' ')

async function branchFilter(auth) {
  if (!auth || scopeOf(auth, 'admissions') === 'ALL' || !auth.user?.branchId) return {}
  const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
  return String(auth.user.branchId) === String(main) ? { branchId: { $in: [auth.user.branchId, null] } } : { branchId: auth.user.branchId }
}

async function classNames(ids) {
  return new Map((await ClassLevel.find({ _id: { $in: ids.filter(Boolean) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
}

/** "https://…/apply/<school>/status" — where families check their applications. */
async function statusLink() {
  const t = await Tenant.findById(getContext()?.tenantId).select('slug').lean()
  return t?.slug ? `${config.appUrl}/apply/${t.slug}/status` : ''
}

/** A message to a family that isn't a student yet: straight to the number / email given. */
async function tellFamily(event, { mobile, email, parentName, childName, className, data = {}, entity }) {
  await queueFamilyMessages(event, { to: { mobile, email }, data: { guardian: { name: parentName || 'Parent' }, applicant: { name: childName, class: className }, ...data }, entity })
}

// ───────────────────────────────────────────────────────── cycles

const cycleDto = (c, cls) => ({
  ...clean(c), academicYearId: c.academicYearId ? String(c.academicYearId) : null, formId: c.formId ? String(c.formId) : null, statusLabel: CYCLE_STATUS[c.status]?.label,
  classes: (c.classes ?? []).map((x) => ({ ...x, classId: String(x.classId), className: cls.get(String(x.classId))?.name ?? '?', order: cls.get(String(x.classId))?.order ?? 0 })).sort((a, b) => a.order - b.order),
})

export async function listCycles() {
  const rows = await AdmissionCycle.find().sort({ createdAt: -1 }).lean()
  const cls = await classNames(rows.flatMap((r) => r.classes.map((x) => x.classId)))
  const counts = await Application.aggregate([{ $group: { _id: { c: '$cycleId', k: '$classId', s: '$status' }, n: { $sum: 1 } } }])
  const forms = new Map()
  for (const r of rows) forms.set(String(r._id), await cycleForm(r))
  return rows.map((r) => {
    const d = cycleDto(r, cls)
    const f = forms.get(String(r._id))
    d.form = f ? { name: f.name, definition: f.definition } : null
    d.classes = d.classes.map((x) => {
      const mine = counts.filter((n) => String(n._id.c) === String(r._id) && String(n._id.k) === x.classId)
      const by = (s) => mine.filter((n) => s.includes(n._id.s)).reduce((a, n) => a + n.n, 0)
      return { ...x, applications: by(Object.keys(APPLICATION_STATUS)), offered: by(['OFFERED', 'ACCEPTED']), admitted: by(['ADMITTED']), live: by(LIVE_APPLICATION) }
    })
    return d
  })
}

async function cycleById(id) {
  if (!isOid(id)) throw notFound('Admission cycle')
  const c = await AdmissionCycle.findById(id)
  if (!c) throw notFound('Admission cycle')
  return c
}

export async function saveCycle(id, input, auth, req) {
  const ids = input.classes.map((x) => x.classId)
  if (new Set(ids).size !== ids.length) throw fieldsError({ classes: 'Each class once' })
  if ((await ClassLevel.countDocuments({ _id: { $in: ids } })) !== ids.length) throw fieldsError({ classes: 'Pick classes from the list' })
  if (input.opensOn && input.closesOn && input.closesOn < input.opensOn) throw fieldsError({ closesOn: 'After the opening day' })
  if (input.formId && !await FormTemplate.exists({ _id: input.formId, use: 'ADMISSION', status: 'PUBLISHED' })) throw fieldsError({ formId: 'Pick a published admission form' })
  const year = input.academicYearId ? await AcademicYear.findById(input.academicYearId).select('name').lean() : null
  const c = id ? await cycleById(id) : new AdmissionCycle({ createdBy: auth.user?.name })
  // a class with applications stays in the cycle
  if (id) {
    const used = (await Application.distinct('classId', { cycleId: c._id })).map(String)
    const dropped = used.filter((k) => !ids.includes(k))
    if (dropped.length) throw conflict('A class that already has applications can’t be taken out of the cycle.')
  }
  const kept = new Map((c.classes ?? []).map((x) => [String(x.classId), x]))
  Object.assign(c, {
    name: input.name, academicYearId: input.academicYearId || undefined, yearName: year?.name, opensOn: input.opensOn || undefined, closesOn: input.closesOn || undefined,
    formId: input.formId || undefined, instructions: input.instructions || undefined,
    classes: input.classes.map((x) => ({ ...x, meritPublishedAt: kept.get(x.classId)?.meritPublishedAt, meritPublishedBy: kept.get(x.classId)?.meritPublishedBy })),
  })
  await c.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'admissions', entityType: 'admission_cycle', entityId: String(c._id), entityName: c.name, summary: `${id ? 'Updated' : 'Set up'} admission cycle ${c.name} (${c.classes.length} classes, ${c.classes.reduce((n, x) => n + x.seats, 0)} seats)` }, req)
  return (await listCycles()).find((x) => x.id === String(c._id))
}

export async function setCycleStatus(id, status, req) {
  const c = await cycleById(id)
  if (status === 'OPEN' && !c.classes.length) throw conflict('Add the classes and their seats first.')
  c.status = status
  await c.save()
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'admission_cycle', entityId: String(c._id), entityName: c.name, summary: `${status === 'OPEN' ? 'Opened' : status === 'CLOSED' ? 'Closed' : 'Reset'} admission cycle ${c.name}` }, req)
  return (await listCycles()).find((x) => x.id === String(c._id))
}

/** Cycles open today (online application, enquiry pickers). */
async function openCycles() {
  const t = await today()
  return AdmissionCycle.find({ status: 'OPEN', $and: [{ $or: [{ opensOn: null }, { opensOn: { $lte: t } }] }, { $or: [{ closesOn: null }, { closesOn: { $gte: t } }] }] }).lean()
}

// ───────────────────────────────────────────────────────── enquiries (the CRM)

const enquiryDto = (e, cls) => ({
  ...clean(e), classId: e.classId ? String(e.classId) : null, cycleId: e.cycleId ? String(e.cycleId) : null, applicationId: e.applicationId ? String(e.applicationId) : null,
  className: cls?.get(String(e.classId))?.name ?? null, stageLabel: ENQUIRY_STAGES[e.stage]?.label, sourceLabel: ENQUIRY_SOURCE_LABEL[e.source] ?? e.source,
})

export async function listEnquiries(q, paging, auth) {
  const t = await today()
  const filter = { ...(await branchFilter(auth)) }
  if (q.stage) filter.stage = q.stage
  else if (q.open) filter.stage = { $in: OPEN_STAGES }
  if (q.source) filter.source = q.source
  if (q.classId) filter.classId = q.classId
  if (q.due) { filter.stage = { $in: OPEN_STAGES }; filter.nextFollowUpOn = { $lte: t } }
  if (q.mine) filter.assignedToId = auth.userId
  if (paging.search) {
    const re = new RegExp(escapeRegex(paging.search), 'i')
    filter.$or = [{ childName: re }, { parentName: re }, { mobile: re }, { enquiryNo: re }]
  }
  const [rows, total, stages] = await Promise.all([
    Enquiry.find(filter).sort(q.due ? { nextFollowUpOn: 1 } : { createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Enquiry.countDocuments(filter),
    Enquiry.aggregate([{ $match: { ...(await branchFilter(auth)), createdAt: { $gte: new Date(Date.now() - 365 * 864e5) } } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]),
  ])
  const cls = await classNames(rows.map((r) => r.classId))
  const res = listResponse(rows.map((r) => enquiryDto(r, cls)), total, paging)
  res.meta.stages = Object.fromEntries(stages.map((s) => [s._id, s.n]))
  res.meta.dueToday = await Enquiry.countDocuments({ ...(await branchFilter(auth)), stage: { $in: OPEN_STAGES }, nextFollowUpOn: { $lte: t } })
  return res
}

async function enquiryById(id, auth) {
  if (!isOid(id)) throw notFound('Enquiry')
  const e = await Enquiry.findOne({ _id: id, ...(await branchFilter(auth)) })
  if (!e) throw notFound('Enquiry')
  return e
}

export async function getEnquiry(id, auth) {
  const e = await enquiryById(id, auth)
  return enquiryDto(e.toObject(), await classNames([e.classId]))
}

/** A new enquiry (desk, phone, or the website). The family is thanked by the rule “Enquiry received”. */
export async function createEnquiry(input, auth, req, { website = false } = {}) {
  const mobile = mobile10(input.mobile)
  if (!mobile) throw fieldsError({ mobile: 'Enter a 10-digit mobile number' })
  const cfg = await getSettings('admissions')
  const t = await today()
  const cycle = input.cycleId ? await AdmissionCycle.findById(input.cycleId).lean() : (await openCycles())[0] ?? null
  const e = await Enquiry.create({
    enquiryNo: await nextNumber('ENQUIRY', { branchId: input.branchId || auth?.user?.branchId }), cycleId: cycle?._id, classId: input.classId || undefined,
    branchId: input.branchId || auth?.user?.branchId || undefined, childName: input.childName, dob: input.dob || undefined, gender: input.gender || undefined,
    parentName: input.parentName || undefined, mobile, email: input.email || undefined, locality: input.locality || undefined, currentSchool: input.currentSchool || undefined,
    source: website ? 'WEBSITE' : input.source || 'WALK_IN', campaign: input.campaign || undefined, stage: 'NEW',
    assignedToId: input.assignedToId || undefined, assignedTo: input.assignedTo || undefined,
    nextFollowUpOn: addDaysYmd(t, Number(cfg.followUpDays) || 0),
    followUps: input.note ? [{ type: 'NOTE', note: input.note, by: website ? 'Website' : auth?.user?.name, byId: auth?.userId }] : [],
    createdBy: website ? 'Website' : auth?.user?.name,
  })
  const cls = await classNames([e.classId])
  await tellFamily('admissions.enquiry', { mobile, email: e.email, parentName: e.parentName, childName: e.childName, className: cls.get(String(e.classId))?.name ?? '', entity: { type: 'enquiry', id: e._id } })
  await audit({ action: 'CREATE', module: 'admissions', entityType: 'enquiry', entityId: String(e._id), entityName: e.enquiryNo, summary: `Enquiry ${e.enquiryNo} for ${e.childName} (${ENQUIRY_SOURCE_LABEL[e.source]})` }, req)
  return enquiryDto(e.toObject(), cls)
}

export async function updateEnquiry(id, input, auth, req) {
  const e = await enquiryById(id, auth)
  if (input.stage === 'LOST' && !input.lostReason && !e.lostReason) throw fieldsError({ lostReason: 'Say why' })
  if (input.mobile) { const m = mobile10(input.mobile); if (!m) throw fieldsError({ mobile: 'Enter a 10-digit mobile number' }); input.mobile = m }
  const before = e.stage
  for (const k of ['childName', 'dob', 'gender', 'parentName', 'mobile', 'email', 'locality', 'currentSchool', 'classId', 'source', 'campaign', 'stage', 'lostReason', 'assignedToId', 'assignedTo', 'nextFollowUpOn']) {
    if (input[k] !== undefined) e[k] = input[k] === '' ? undefined : input[k]
  }
  await e.save()
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'enquiry', entityId: String(e._id), entityName: e.enquiryNo, summary: before !== e.stage ? `Enquiry ${e.enquiryNo}: ${ENQUIRY_STAGES[before]?.label} → ${ENQUIRY_STAGES[e.stage]?.label}` : `Updated enquiry ${e.enquiryNo}` }, req)
  return getEnquiry(id, auth)
}

/** Delete an enquiry made by mistake (a duplicate, a test entry). One that became an application stays — mark it lost instead. */
export async function deleteEnquiry(id, auth, req) {
  const e = await enquiryById(id, auth)
  if (e.applicationId || ['APPLIED', 'ADMITTED'].includes(e.stage) || await Application.exists({ enquiryId: e._id })) {
    throw conflict(`Enquiry ${e.enquiryNo} has become an application, so it stays on record. Mark it lost instead if it is no longer going ahead.`)
  }
  await Visitor.updateMany({ enquiryId: e._id }, { $unset: { enquiryId: 1, enquiryNo: 1 } })
  await e.deleteOne()
  await audit({ action: 'DELETE', module: 'admissions', entityType: 'enquiry', entityId: String(e._id), entityName: e.enquiryNo, summary: `Deleted enquiry ${e.enquiryNo} (${e.childName})` }, req)
  return { deleted: true }
}

/** Log a call / visit / note, move the stage on, and set the next follow-up day. */
export async function addFollowUp(id, { type, note, nextOn, stage }, auth, req) {
  const e = await enquiryById(id, auth)
  e.followUps.push({ type, note, by: auth.user?.name, byId: auth.userId })
  if (stage && !['APPLIED', 'ADMITTED'].includes(stage)) e.stage = stage
  else if (e.stage === 'NEW') e.stage = 'CONTACTED'
  e.nextFollowUpOn = nextOn || undefined
  await e.save()
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'enquiry', entityId: String(e._id), entityName: e.enquiryNo, summary: `Follow-up (${type.toLowerCase()}) on enquiry ${e.enquiryNo}${nextOn ? `; next on ${nextOn}` : ''}` }, req)
  return getEnquiry(id, auth)
}

// ───────────────────────────────────────────────────────── applications

const appDto = (a, cls) => ({
  ...clean(a), cycleId: String(a.cycleId), classId: String(a.classId), enquiryId: a.enquiryId ? String(a.enquiryId) : null, testId: a.testId ? String(a.testId) : null,
  studentId: a.studentId ? String(a.studentId) : null, childName: name3(a.child), className: cls?.get(String(a.classId))?.name ?? '?', statusLabel: APPLICATION_STATUS[a.status]?.label,
})

export async function listApplications(q, paging, auth) {
  const filter = { ...(await branchFilter(auth)) }
  if (q.cycleId) filter.cycleId = q.cycleId
  if (q.classId) filter.classId = q.classId
  if (q.status) filter.status = q.status
  if (q.testId) filter.testId = q.testId
  if (paging.search) {
    const re = new RegExp(escapeRegex(paging.search), 'i')
    filter.$or = [{ applicationNo: re }, { 'child.firstName': re }, { 'child.lastName': re }, { 'parent.name': re }, { 'parent.mobile': re }]
  }
  const [rows, total] = await Promise.all([Application.find(filter).sort({ submittedAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(), Application.countDocuments(filter)])
  const cls = await classNames(rows.map((r) => r.classId))
  return listResponse(rows.map((r) => appDto(r, cls)), total, paging)
}

async function applicationById(id, auth) {
  if (!isOid(id)) throw notFound('Application')
  const a = await Application.findOne({ _id: id, ...(await branchFilter(auth)) })
  if (!a) throw notFound('Application')
  return a
}

/** The cycle's extra admission form (its published version), or null. */
async function cycleForm(cycle) {
  if (!cycle?.formId) return null
  const f = await FormTemplate.findById(cycle.formId).select('name version status').lean()
  if (!f || f.status !== 'PUBLISHED') return null
  const v = await formVersion(f._id, f.version)
  return v ? { formId: String(f._id), version: f.version, name: f.name, definition: v.definition } : null
}

export async function getApplication(id, auth) {
  const a = await applicationById(id, auth)
  const [cycle, cls, test] = await Promise.all([AdmissionCycle.findById(a.cycleId).lean(), classNames([a.classId]), a.testId ? EntranceTest.findById(a.testId).lean() : null])
  const form = a.formId ? await formVersion(a.formId, a.formVersion) : null
  return { ...appDto(a.toObject(), cls), cycleName: cycle?.name ?? null, test: test ? { id: String(test._id), name: test.name, date: test.date, time: test.time, venue: test.venue, maxMarks: test.maxMarks } : null, form: form ? { definition: form.definition } : null }
}

/** Check a new application against its cycle: open, the class in it, the child's age, not applied twice. */
async function checkNew(input, { online }) {
  const cycle = isOid(input.cycleId) ? await AdmissionCycle.findById(input.cycleId).lean() : null
  if (!cycle) throw fieldsError({ cycleId: 'Pick the admission cycle' })
  if (cycle.status === 'CLOSED' || (online && cycle.status !== 'OPEN')) throw conflict('Admissions for this cycle are closed.')
  if (online && !(await openCycles()).some((c) => String(c._id) === String(cycle._id))) throw conflict('Online applications aren’t open on this date.')
  const cc = cycle.classes.find((x) => String(x.classId) === String(input.classId))
  if (!cc) throw fieldsError({ classId: 'This class isn’t taking admissions in this cycle' })
  const cfg = await getSettings('admissions')
  const errors = {}
  if (input.child?.dob && (cc.minAge || cc.maxAge)) {
    const [dd, mm] = String(cfg.ageCutoff || '31-03').split('-')
    const year = (cycle.yearName?.match(/\d{4}/)?.[0]) ?? (await today()).slice(0, 4)
    const age = ageOn(input.child.dob, `${year}-${mm}-${dd}`)
    if ((cc.minAge && age < cc.minAge) || (cc.maxAge && age > cc.maxAge)) errors['child.dob'] = `For this class the child must be ${cc.minAge ?? 0}–${cc.maxAge ?? '…'} years old on ${dd}-${mm}-${year}`
  }
  const dup = await Application.findOne({ cycleId: cycle._id, 'child.firstName': new RegExp(`^${escapeRegex(input.child.firstName)}$`, 'i'), 'child.dob': input.child.dob, 'parent.mobile': input.parent.mobile, status: { $ne: 'WITHDRAWN' } }).select('applicationNo').lean()
  if (dup) throw conflict(`This child has already applied in this cycle (application ${dup.applicationNo}).`)
  const form = await cycleForm(cycle)
  let answers
  if (form) {
    const r = validateFormValues(form.definition, input.answers ?? {})
    for (const [k, v] of Object.entries(r.errors)) errors[`answers.${k}`] = v
    answers = r.values
  }
  if (Object.keys(errors).length) throw fieldsError(errors)
  return { cycle, cc, form, answers }
}

export async function createApplication(input, auth, req, { online = false } = {}) {
  const mobile = mobile10(input.parent?.mobile)
  if (!mobile) throw fieldsError({ 'parent.mobile': 'Enter a 10-digit mobile number' })
  input.parent.mobile = mobile
  const { cycle, form, answers } = await checkNew(input, { online })
  const enquiry = input.enquiryId && isOid(input.enquiryId) ? await Enquiry.findById(input.enquiryId) : await Enquiry.findOne({ mobile: { $in: mobileVariants(mobile) }, stage: { $in: OPEN_STAGES } }).sort({ createdAt: -1 })
  const a = await Application.create({
    applicationNo: await nextNumber('APPLICATION', { branchId: input.branchId || enquiry?.branchId }), cycleId: cycle._id, classId: input.classId, branchId: input.branchId || enquiry?.branchId || undefined,
    enquiryId: enquiry?._id, channel: online ? 'ONLINE' : 'DESK', child: input.child, parent: input.parent, otherParent: input.otherParent, address: input.address,
    answers, formId: form?.formId, formVersion: form?.version, status: 'SUBMITTED', createdBy: online ? 'Online application' : auth?.user?.name,
  })
  if (enquiry) await Enquiry.updateOne({ _id: enquiry._id }, { $set: { stage: 'APPLIED', applicationId: a._id } })
  const cls = await classNames([a.classId])
  await tellFamily('admissions.application', { mobile, email: a.parent.email, parentName: a.parent.name, childName: name3(a.child), className: cls.get(String(a.classId))?.name ?? '', data: { application: { no: a.applicationNo, link: await statusLink() } }, entity: { type: 'application', id: a._id } })
  await audit({ action: 'CREATE', module: 'admissions', entityType: 'application', entityId: String(a._id), entityName: a.applicationNo, summary: `Application ${a.applicationNo} for ${name3(a.child)} (${cls.get(String(a.classId))?.name})${online ? ' — online' : ''}` }, req)
  return appDto(a.toObject(), cls)
}

export async function updateApplication(id, input, auth, req) {
  const a = await applicationById(id, auth)
  if (['ADMITTED', 'WITHDRAWN'].includes(a.status)) throw conflict(`This application is ${APPLICATION_STATUS[a.status].label.toLowerCase()}.`)
  for (const k of ['child', 'parent', 'otherParent', 'address']) if (input[k]) a[k] = { ...(a[k]?.toObject?.() ?? a[k] ?? {}), ...input[k] }
  if (input.score !== undefined) a.score = input.score === null ? undefined : input.score
  if (input.statusNote !== undefined) a.statusNote = input.statusNote || undefined
  await a.save()
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'application', entityId: String(a._id), entityName: a.applicationNo, summary: `Updated application ${a.applicationNo}` }, req)
  return getApplication(id, auth)
}

const MOVES = {
  UNDER_REVIEW: ['SUBMITTED', 'SHORTLISTED', 'WAITLISTED'],
  SHORTLISTED: ['SUBMITTED', 'UNDER_REVIEW', 'WAITLISTED'],
  WAITLISTED: ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'OFFERED'],
  REJECTED: ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'WAITLISTED', 'OFFERED'],
  WITHDRAWN: ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'WAITLISTED', 'OFFERED', 'ACCEPTED'],
  ACCEPTED: ['OFFERED'],
}

export async function setApplicationStatus(id, { status, note }, auth, req) {
  const a = await applicationById(id, auth)
  if (!MOVES[status]?.includes(a.status)) throw conflict(`An application that is ${APPLICATION_STATUS[a.status].label.toLowerCase()} can’t become ${APPLICATION_STATUS[status]?.label.toLowerCase()}.`)
  const before = a.status
  a.status = status
  if (note) a.statusNote = note
  if (status === 'ACCEPTED') a.acceptedAt = new Date()
  await a.save()
  if (status === 'WITHDRAWN' && a.enquiryId) await Enquiry.updateOne({ _id: a.enquiryId, stage: 'APPLIED' }, { $set: { stage: 'LOST', lostReason: note || 'Withdrew the application' } })
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'application', entityId: String(a._id), entityName: a.applicationNo, summary: `Application ${a.applicationNo}: ${APPLICATION_STATUS[before].label} → ${APPLICATION_STATUS[status].label}${note ? ` (${note})` : ''}` }, req)
  return getApplication(id, auth)
}

/** An offered (or accepted) applicant joins: a student record through Students' admission, in the section picked. */
export async function admitApplicant(id, { sectionId, admissionNo }, auth, req) {
  const a = await applicationById(id, auth)
  if (!['OFFERED', 'ACCEPTED'].includes(a.status)) throw conflict('Only an applicant with an offered seat can be admitted.')
  const student = await admitStudent({
    firstName: a.child.firstName, middleName: a.child.middleName || undefined, lastName: a.child.lastName || undefined, dob: a.child.dob || undefined, gender: a.child.gender || undefined,
    bloodGroup: a.child.bloodGroup || undefined, category: a.child.category || undefined, religion: a.child.religion || undefined, motherTongue: a.child.motherTongue || undefined,
    sectionId, admissionNo: admissionNo || undefined,
    address: a.address?.line ? { line: a.address.line, city: a.address.city, state: a.address.state, pincode: a.address.pincode } : undefined,
    previousSchool: a.child.previousSchool?.name ? a.child.previousSchool : undefined,
    guardians: [
      { name: a.parent.name, relation: a.parent.relation || undefined, mobile: a.parent.mobile, email: a.parent.email || undefined, occupation: a.parent.occupation || undefined, isPrimary: true },
      ...(a.otherParent?.name ? [{ name: a.otherParent.name, relation: a.otherParent.relation || undefined, mobile: a.otherParent.mobile || undefined }] : []),
    ],
  }, auth, req)
  Object.assign(a, { status: 'ADMITTED', studentId: student.id, admittedAt: new Date(), admittedBy: auth.user?.name })
  await a.save()
  if (a.enquiryId) await Enquiry.updateOne({ _id: a.enquiryId }, { $set: { stage: 'ADMITTED' } })
  await audit({ action: 'APPROVE', module: 'admissions', entityType: 'application', entityId: String(a._id), entityName: a.applicationNo, studentId: student.id, summary: `Admitted applicant ${a.applicationNo} as ${student.admissionNo}` }, req)
  return { application: await getApplication(id, auth), student: { id: student.id, admissionNo: student.admissionNo, name: student.name } }
}

// ───────────────────────────────────────────────────────── entrance tests

export async function listTests(cycleId) {
  const rows = await EntranceTest.find(cycleId ? { cycleId } : {}).sort({ date: -1 }).lean()
  const [cls, counts] = await Promise.all([
    classNames(rows.flatMap((r) => r.classIds)),
    Application.aggregate([{ $match: { testId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: '$testId', n: { $sum: 1 }, marked: { $sum: { $cond: [{ $or: [{ $ne: ['$testMarks', null] }, { $eq: ['$testAbsent', true] }] }, 1, 0] } } } }]),
  ])
  return rows.map((r) => ({ ...clean(r), cycleId: String(r.cycleId), classIds: r.classIds.map(String), classes: r.classIds.map((id) => cls.get(String(id))?.name).filter(Boolean), applicants: counts.find((c) => String(c._id) === String(r._id))?.n ?? 0, marked: counts.find((c) => String(c._id) === String(r._id))?.marked ?? 0 }))
}

export async function saveTest(id, input, auth, req) {
  const cycle = await cycleById(input.cycleId)
  if (input.classIds.some((k) => !cycle.classes.some((x) => String(x.classId) === k))) throw fieldsError({ classIds: 'Pick classes of this cycle' })
  const t = id ? await EntranceTest.findById(id) : new EntranceTest({ createdBy: auth.user?.name })
  if (!t) throw notFound('Entrance test')
  Object.assign(t, { cycleId: cycle._id, name: input.name, classIds: input.classIds, date: input.date, time: input.time || undefined, venue: input.venue || undefined, maxMarks: input.maxMarks, instructions: input.instructions || undefined })
  await t.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'admissions', entityType: 'entrance_test', entityId: String(t._id), entityName: t.name, summary: `${id ? 'Updated' : 'Scheduled'} ${t.name} on ${t.date}` }, req)
  return (await listTests(String(cycle._id))).find((x) => x.id === String(t._id))
}

/** Delete a test scheduled by mistake. Once applicants are put down for it (their families are told), it stays — change the date instead. */
export async function deleteTest(id, req) {
  const t = isOid(id) ? await EntranceTest.findById(id) : null
  if (!t) throw notFound('Entrance test')
  const n = await Application.countDocuments({ testId: t._id })
  if (n) throw conflict(`${n} applicant${n === 1 ? ' is' : 's are'} down for ${t.name} and their families have been told. Change the date or details instead.`)
  await t.deleteOne()
  await audit({ action: 'DELETE', module: 'admissions', entityType: 'entrance_test', entityId: String(t._id), entityName: t.name, summary: `Deleted the entrance test ${t.name} (${t.date})` }, req)
  return { deleted: true }
}

/** Put applicants down for a test (all live applicants of its classes when none are named) and tell their families. */
export async function assignTest(testId, applicationIds, auth, req) {
  const t = isOid(testId) ? await EntranceTest.findById(testId).lean() : null
  if (!t) throw notFound('Entrance test')
  const filter = { cycleId: t.cycleId, classId: { $in: t.classIds }, status: { $in: LIVE_APPLICATION }, ...(applicationIds?.length ? { _id: { $in: applicationIds } } : { testId: null }) }
  const apps = await Application.find(filter).lean()
  const cls = await classNames(apps.map((a) => a.classId))
  const when = `${humanDate(t.date)}${t.time ? `, ${t.time}` : ''}`
  for (const a of apps) {
    await Application.updateOne({ _id: a._id }, { $set: { testId: t._id }, $unset: { testMarks: 1, testAbsent: 1 } })
    await tellFamily('admissions.test', { mobile: a.parent.mobile, email: a.parent.email, parentName: a.parent.name, childName: name3(a.child), className: cls.get(String(a.classId))?.name ?? '', data: { application: { no: a.applicationNo }, test: { name: t.name, when, venue: t.venue ?? '' } }, entity: { type: 'application', id: a._id } })
  }
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'entrance_test', entityId: String(t._id), entityName: t.name, summary: `Put ${apps.length} applicant(s) down for ${t.name}` }, req)
  return { assigned: apps.length }
}

export async function testSheet(testId) {
  const t = isOid(testId) ? await EntranceTest.findById(testId).lean() : null
  if (!t) throw notFound('Entrance test')
  const apps = await Application.find({ testId: t._id }).sort({ applicationNo: 1 }).lean()
  const cls = await classNames(apps.map((a) => a.classId))
  return { test: (await listTests(String(t.cycleId))).find((x) => x.id === String(t._id)), rows: apps.map((a) => ({ id: String(a._id), applicationNo: a.applicationNo, childName: name3(a.child), className: cls.get(String(a.classId))?.name ?? '?', marks: a.testMarks ?? null, absent: !!a.testAbsent, status: a.status })) }
}

/** Marks for a test; for classes ranked on the test, the merit score becomes the percentage. */
export async function saveTestMarks(testId, entries, auth, req) {
  const t = isOid(testId) ? await EntranceTest.findById(testId) : null
  if (!t) throw notFound('Entrance test')
  if (t.marksLocked) throw conflict('Marks of this test are locked.')
  const errors = {}
  entries.forEach((e, i) => { if (!e.absent && e.marks !== null && e.marks !== undefined && (e.marks < 0 || e.marks > t.maxMarks)) errors[`entries.${i}.marks`] = `0 to ${t.maxMarks}` })
  if (Object.keys(errors).length) throw fieldsError(errors, 'Some marks need fixing.')
  const cycle = await AdmissionCycle.findById(t.cycleId).lean()
  const apps = await Application.find({ _id: { $in: entries.map((e) => e.applicationId) }, testId: t._id }).select('classId').lean()
  const basisOf = new Map(cycle.classes.map((x) => [String(x.classId), x.meritBasis]))
  for (const e of entries) {
    const a = apps.find((x) => String(x._id) === e.applicationId)
    if (!a) continue
    const marks = e.absent || e.marks === null || e.marks === undefined ? null : Number(e.marks)
    const set = { testMarks: marks, testAbsent: !!e.absent }
    if (basisOf.get(String(a.classId)) === 'TEST') set.score = e.absent ? 0 : marks === null ? undefined : Math.round((marks / t.maxMarks) * 10000) / 100
    await Application.updateOne({ _id: a._id }, set.score === undefined ? { $set: { testMarks: marks, testAbsent: !!e.absent }, $unset: { score: 1 } } : { $set: set })
  }
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'entrance_test', entityId: String(t._id), entityName: t.name, summary: `Entered marks of ${entries.length} applicant(s) for ${t.name}` }, req)
  return testSheet(testId)
}

// ───────────────────────────────────────────────────────── merit lists and seats

const STILL_IN = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'ADMITTED']

/** A class's merit list in a cycle: everyone still in, ranked, with the seats and how many are taken. */
export async function meritList(cycleId, classId) {
  const cycle = await cycleById(cycleId)
  const cc = cycle.classes.find((x) => String(x.classId) === String(classId))
  if (!cc) throw notFound('Class')
  const apps = await Application.find({ cycleId: cycle._id, classId, status: { $in: STILL_IN } }).lean()
  const ranks = new Map(rankApplicants(apps.map((a) => ({ id: String(a._id), score: a.score, submittedAt: a.submittedAt.toISOString() })), cc.meritBasis).map((r) => [r.id, r.rank]))
  const taken = apps.filter((a) => ['OFFERED', 'ACCEPTED', 'ADMITTED'].includes(a.status)).length
  const cls = await classNames([classId])
  const rows = apps.map((a) => ({ ...appDto(a, cls), rank: ranks.get(String(a._id)) })).sort((a, b) => a.rank - b.rank)
  return {
    cycle: { id: String(cycle._id), name: cycle.name }, class: { id: String(classId), name: cls.get(String(classId))?.name ?? '?', seats: cc.seats, meritBasis: cc.meritBasis, publishedAt: cc.meritPublishedAt ?? null, publishedBy: cc.meritPublishedBy ?? null },
    taken, left: Math.max(0, cc.seats - taken), rows, missingScores: cc.meritBasis === 'FIRST_COME' ? 0 : rows.filter((r) => !Number.isFinite(r.score) && LIVE_APPLICATION.includes(r.status)).length,
  }
}

/** Fix the ranks on the applications (what families and staff see) and mark the list published. */
export async function publishMerit(cycleId, classId, auth, req) {
  const list = await meritList(cycleId, classId)
  await Application.bulkWrite(list.rows.map((r) => ({ updateOne: { filter: { _id: r.id }, update: { $set: { rank: r.rank } } } })))
  await AdmissionCycle.updateOne({ _id: cycleId, 'classes.classId': classId }, { $set: { 'classes.$.meritPublishedAt': new Date(), 'classes.$.meritPublishedBy': auth.user?.name } })
  await audit({ action: 'APPROVE', module: 'admissions', entityType: 'admission_cycle', entityId: String(cycleId), entityName: `${list.cycle.name} · ${list.class.name}`, summary: `Published the merit list of ${list.class.name} (${list.rows.length} applicants)` }, req)
  return meritList(cycleId, classId)
}

/**
 * Offer the seats left to the next applicants in rank order; everyone below stays on (or goes onto) the waiting list.
 * Each offered family is told, with the last day to accept.
 */
export async function allotSeats(cycleId, classId, auth, req) {
  const list = await meritList(cycleId, classId)
  if (!list.class.publishedAt) throw conflict('Publish the merit list first.')
  if (list.missingScores) throw conflict(`${list.missingScores} applicant(s) have no score yet.`)
  const cfg = await getSettings('admissions')
  const until = addDaysYmd(await today(), Number(cfg.offerDays) || 7)
  const waiting = list.rows.filter((r) => LIVE_APPLICATION.includes(r.status))
  const offer = waiting.slice(0, list.left)
  const wait = waiting.slice(list.left)
  const link = await statusLink()
  for (const r of offer) {
    await Application.updateOne({ _id: r.id }, { $set: { status: 'OFFERED', offer: { at: new Date(), by: auth.user?.name, until } } })
    await tellFamily('admissions.offer', { mobile: r.parent.mobile, email: r.parent.email, parentName: r.parent.name, childName: r.childName, className: list.class.name, data: { application: { no: r.applicationNo, link }, offer: { until: humanDate(until) } }, entity: { type: 'application', id: r.id } })
  }
  await Application.updateMany({ _id: { $in: wait.map((r) => r.id) } }, { $set: { status: 'WAITLISTED' } })
  await audit({ action: 'APPROVE', module: 'admissions', entityType: 'admission_cycle', entityId: String(cycleId), entityName: `${list.cycle.name} · ${list.class.name}`, summary: `Offered ${offer.length} seat(s) in ${list.class.name}; ${wait.length} on the waiting list` }, req)
  return { offered: offer.length, waitlisted: wait.length, list: await meritList(cycleId, classId) }
}

// ───────────────────────────────────────────────────────── for the family (public /apply/<school>)

/** What the application page shows: the school, the cycles open today with their classes, the extra form. */
export async function publicAdmissions(tenant) {
  const cfg = await getSettings('admissions')
  const cycles = cfg.onlineApplication ? await openCycles() : []
  const cls = await classNames(cycles.flatMap((c) => c.classes.map((x) => x.classId)))
  const out = []
  for (const c of cycles) {
    const form = await cycleForm(c)
    out.push({ id: String(c._id), name: c.name, yearName: c.yearName ?? null, closesOn: c.closesOn ?? null, instructions: c.instructions ?? null, form: form ? { name: form.name, definition: form.definition } : null, classes: cycleDto(c, cls).classes.map((x) => ({ classId: x.classId, className: x.className, minAge: x.minAge ?? null, maxAge: x.maxAge ?? null, testRequired: !!x.testRequired })) })
  }
  const p = tenant.profile ?? {}
  return { school: { name: tenant.name, city: p.city ?? null, logoUrl: p.logoUrl ?? null, primaryColor: p.primaryColor ?? null, phone: p.phone ?? null }, onlineApplication: !!cfg.onlineApplication, applyNeedsCode: !!cfg.applyNeedsCode, websiteEnquiry: cfg.websiteEnquiry !== false, ageCutoff: cfg.ageCutoff, cycles: out, enquiryClasses: [...cls.values()].sort((a, b) => a.order - b.order).map((c) => ({ id: String(c._id), name: c.name })) }
}

/** A family's applications on their (verified) mobile number. */
export async function familyApplications(mobile) {
  const rows = await Application.find({ 'parent.mobile': { $in: mobileVariants(mobile10(mobile)) } }).sort({ submittedAt: -1 }).limit(20).lean()
  const [cls, tests] = await Promise.all([classNames(rows.map((r) => r.classId)), EntranceTest.find({ _id: { $in: rows.map((r) => r.testId).filter(Boolean) } }).lean()])
  return rows.map((a) => {
    const t = tests.find((x) => String(x._id) === String(a.testId))
    return {
      id: String(a._id), applicationNo: a.applicationNo, childName: name3(a.child), className: cls.get(String(a.classId))?.name ?? '?', status: a.status, statusLabel: APPLICATION_STATUS[a.status]?.label,
      submittedAt: a.submittedAt, rank: a.rank ?? null, offerUntil: a.offer?.until ?? null,
      test: t ? { name: t.name, date: t.date, time: t.time ?? null, venue: t.venue ?? null } : null,
    }
  })
}

/** The family accepts an offered seat (before it runs out). */
export async function familyAcceptOffer(mobile, applicationId) {
  if (!isOid(applicationId)) throw notFound('Application')
  const a = await Application.findOne({ _id: applicationId, 'parent.mobile': { $in: mobileVariants(mobile10(mobile)) } })
  if (!a) throw notFound('Application')
  if (a.status !== 'OFFERED') throw conflict('There is no seat offer to accept on this application.')
  if (a.offer?.until && a.offer.until < await today()) throw new AppError(409, 'The time to accept this offer has passed. Please call the school.', { code: 'OFFER_EXPIRED' })
  Object.assign(a, { status: 'ACCEPTED', acceptedAt: new Date() })
  await a.save()
  await audit({ action: 'UPDATE', module: 'admissions', entityType: 'application', entityId: String(a._id), entityName: a.applicationNo, summary: `The family accepted the seat offered on ${a.applicationNo} (online)` }, null)
  return familyApplications(mobile)
}
