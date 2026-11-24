import { SCHOLARSHIP_DOC_FILE_CATEGORY, SCHOLARSHIP_DOC_TYPE_BY, SCHOLARSHIP_OPEN, formatINR, scholarshipDocValidTill, scholarshipFamilyStep, scholarshipValueText, scholarshipVisitTimes } from '@schoolgiant/shared'
import { Attachment } from '../models/engines.js'
import { ScholarshipApplication, ScholarshipDocument, ScholarshipScheme, ScholarshipVisitDay } from '../models/scholarships.js'
import { Student, studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { institutionNow } from '../platform/time.js'
import { yearOrCurrent } from './academics.js'
import { storeFile } from './files.js'
import { need, studentFor } from './portal.js'
import { docLabel, eligibilityChecks, factsOf, freeVisitTimes, lastAward, linesOf, papersOnFile, refreshStudent, renewalEligibility, say, startApplication, walletOf } from './scholarships.js'

// The family app › Scholarships (feature SCHOLARSHIPS). One visit or none:
//   · the schemes this child can apply for, with the documents asked for — and which of them are already with the
//     school (checked earlier and still good), so the family only gathers what is really missing;
//   · applying from the phone; sending each document as a photo; when one is sent back, the reason, and sending
//     only that one again;
//   · where each application stands (applied · documents · checking · decision) and what to do next;
//   · once every copy is checked, booking a time to show the originals, and a QR the desk scans.

const FEATURE = 'SCHOLARSHIPS'
const MAX_FILES = 5 // waiting to be checked, per document
const today = async () => (await institutionNow()).date
const digits = (m) => String(m ?? '').replace(/\D/g, '').slice(-10)

const FILE_CATEGORY = SCHOLARSHIP_DOC_FILE_CATEGORY // the kind each document is filed as on the student's record

async function child(f, studentId) {
  need(f, FEATURE)
  const s = await Student.findById(studentFor(f, studentId)._id).lean()
  if (!s) throw notFound('Student')
  return s
}

/** Who did it, as the office reads it: the parent by name (from the mobile signed in), or the student. */
function whoOf(f, s) {
  if (f.session?.kind === 'STUDENT') return `${studentName(s)} (student, app)`
  const g = (s.guardians ?? []).find((x) => digits(x.mobile) && digits(x.mobile) === digits(f.session?.mobile))
  return `${g?.name ?? 'Parent'} (app)`
}

/** The family as the one acting, for the shared scholarship code (logs, the concession an auto-approval makes). */
const standIn = (f, s) => ({ tenantId: f.tenant._id, user: { name: whoOf(f, s) }, userId: undefined, fullAccess: false, permissions: [] })

async function familyApp(f, studentId, appId) {
  const s = await child(f, studentId)
  const app = isOid(appId) ? await ScholarshipApplication.findOne({ _id: appId, studentId: s._id }) : null
  if (!app) throw notFound('Application')
  return { s, app }
}

async function familyLine(f, studentId, appId, key) {
  const { s, app } = await familyApp(f, studentId, appId)
  if (!SCHOLARSHIP_OPEN.includes(app.status)) throw conflict('This application is already decided.')
  const item = app.items.find((i) => i.key === key)
  if (!item) throw notFound('Document')
  return { s, app, item }
}

/** Everything the Scholarships screen shows for one child. */
export async function familyScholarships(f, studentId) {
  const s = await child(f, studentId)
  const year = await yearOrCurrent().catch(() => null)
  if (!year) return { schemes: [], applications: [], visitTimes: [] }
  const t = await today()
  const [schemes, apps, facts] = await Promise.all([
    ScholarshipScheme.find({ active: true }).sort({ name: 1 }).lean(),
    ScholarshipApplication.find({ studentId: s._id, $or: [{ academicYearId: year._id }, { status: 'APPROVED' }] }).sort({ createdAt: -1 }).lean(),
    factsOf([s], year).then((m) => m.get(String(s._id))),
  ])
  const schemeOf = new Map(schemes.map((x) => [String(x._id), x]))
  for (const id of apps.map((a) => String(a.schemeId)).filter((id) => !schemeOf.has(id))) {
    const x = await ScholarshipScheme.findById(id).lean()
    if (x) schemeOf.set(id, x)
  }
  const applied = new Set(apps.filter((a) => String(a.academicYearId) === String(year._id) && !['WITHDRAWN', 'NOT_APPROVED'].includes(a.status)).map((a) => String(a.schemeId)))
  const [wallet, onFile] = await Promise.all([walletOf([s._id]), papersOnFile(s._id)])
  const lines = await linesOf(apps, t)

  // the family's own files still waiting to be checked (they may take one back)
  const docIds = [...wallet.values()].map((d) => String(d._id))
  const files = docIds.length ? await Attachment.find({ entityType: 'scholarship_doc', entityId: { $in: docIds }, 'deleted.at': null }).select('entityId fileName createdAt uploadedById').sort({ createdAt: 1 }).lean() : []
  const docById = new Map([...wallet.values()].map((d) => [String(d._id), d]))
  const filesOf = (doc) => (doc ? files.filter((a) => a.entityId === String(doc._id)).map((a) => ({
    id: String(a._id), name: a.fileName, at: a.createdAt,
    removable: !a.uploadedById && (!docById.get(a.entityId)?.checkedAt || new Date(a.createdAt) > new Date(docById.get(a.entityId).checkedAt)),
  })) : [])

  // a scheme the child held last year is a renewal: checked by the renewal rule, and shown first
  const candidates = schemes.filter((x) => x.familyApply !== false && (!x.lastDate || x.lastDate >= t) && !applied.has(String(x._id)))
  const lastOf = new Map(await Promise.all(candidates.map(async (x) => [String(x._id), await lastAward(x, s._id, year)])))
  const open = candidates
    .map((x) => ({ x, prev: lastOf.get(String(x._id)), checks: lastOf.get(String(x._id)) ? renewalEligibility(x, facts) : eligibilityChecks(x, facts) }))
    .filter((r) => !r.checks.some((c) => c.ok === false))
    .sort((a, b) => Number(!a.prev) - Number(!b.prev))
    .map(({ x, prev }) => ({
      renewal: prev ? { applicationNo: prev.applicationNo, portalId: prev.portal?.applicationId ?? null } : null,
      id: String(x._id), name: x.name, description: x.description ?? null, provider: x.provider, benefit: x.benefit, kind: x.kind, value: x.value, valueText: scholarshipValueText(x, formatINR),
      lastDate: x.lastDate ?? null, needsIncome: !!x.eligibility?.maxIncome, maxIncome: x.eligibility?.maxIncome ?? null,
      documents: (x.documents ?? []).map((d) => {
        const doc = wallet.get(`${s._id}|${d.key}`)
        const good = doc?.status === 'ACCEPTED' && (!doc.validTill || doc.validTill >= t)
        // the school holds this paper already (given at admission): it is taken from there, not asked for again
        return { key: d.key, label: docLabel(d), type: d.type, required: d.required, originalNeeded: d.originalNeeded, note: d.note ?? null, have: good, onFile: !good && onFile.has(FILE_CATEGORY[d.type]) }
      }),
    }))

  const applications = apps.map((a) => {
    const x = schemeOf.get(String(a.schemeId))
    const mine = lines.get(String(a._id)) ?? []
    const isOpen = SCHOLARSHIP_OPEN.includes(a.status)
    const { step, next } = scholarshipFamilyStep(a.status, mine.filter((l) => l.required || l.state !== 'MISSING').map((l) => l.state))
    return {
      id: String(a._id), applicationNo: a.applicationNo, status: a.status, step, next, open: isOpen,
      scheme: x ? { name: x.name, kind: x.kind, value: x.value, valueText: scholarshipValueText(x, formatINR), benefit: x.benefit, lastDate: x.lastDate ?? null } : null,
      decisionNote: a.status === 'NOT_APPROVED' ? a.decisionNote ?? null : null, decidedAt: a.decidedAt ?? null, createdAt: a.createdAt,
      items: mine.map((l) => ({
        key: l.key, label: l.label, required: l.required, originalNeeded: l.originalNeeded, note: l.note ?? null, state: l.state,
        reason: l.state === 'NOT_ACCEPTED' ? l.doc?.reason ?? null : null, reasonNote: l.state === 'NOT_ACCEPTED' ? l.doc?.reasonNote ?? null : null,
        validTill: l.doc?.validTill ?? null, issuedOn: l.doc?.issuedOn ?? null, needsIssueDate: !!SCHOLARSHIP_DOC_TYPE_BY[l.type]?.validMonths,
        canSend: isOpen && !['ACCEPTED', 'ORIGINAL_DUE'].includes(l.state), files: filesOf(l.doc),
      })),
      visit: a.visit?.dayId ? { dayId: String(a.visit.dayId), date: a.visit.date, time: a.visit.time, place: a.visit.place ?? null, attended: !!a.visit.attended } : null,
      canBook: isOpen && next === 'SHOW_ORIGINALS' && !a.visit?.dayId,
    }
  })
  const visitTimes = applications.some((a) => a.canBook) ? await freeVisitTimes(s.branchId) : []
  return { year: { id: String(year._id), name: year.name }, schemes: open, applications, visitTimes }
}

/** Apply for a scheme from the app (income from the certificate when the scheme has a limit). */
export async function familyApply(f, studentId, schemeId, { familyIncome } = {}, req) {
  const s = await child(f, studentId)
  const scheme = isOid(schemeId) ? await ScholarshipScheme.findById(schemeId).lean() : null
  if (!scheme || !scheme.active) throw notFound('Scholarship')
  if (scheme.familyApply === false) throw forbidden('For this scholarship, the office starts the application. Please speak to the office.')
  if (scheme.lastDate && scheme.lastDate < await today()) throw conflict('The last day to apply for this scholarship has passed.')
  if (scheme.eligibility?.maxIncome && familyIncome == null && !(await lastAward(scheme, s._id, await yearOrCurrent()))) throw badRequest('Enter the family income from the income certificate.', { fields: { familyIncome: 'Needed for this scholarship' } })
  const year = await yearOrCurrent()
  const renewedFrom = await lastAward(scheme, s._id, year) // last year's scholarship of this scheme: this continues it
  await startApplication({ s, scheme, year, familyIncome, source: 'FAMILY', renewedFrom: renewedFrom ?? undefined }, standIn(f, s), req)
  return familyScholarships(f, studentId)
}

/** Send one document as a photo or PDF (only what is missing or was sent back). */
export async function familySendDocument(f, studentId, appId, key, { fileName, issuedOn, number }, buffer, req) {
  const { s, app, item } = await familyLine(f, studentId, appId, key)
  const t = await today()
  const line = (await linesOf([app.toObject()], t)).get(String(app._id)).find((l) => l.key === key)
  if (['ACCEPTED', 'ORIGINAL_DUE'].includes(line.state)) throw conflict('This document is already checked and correct — nothing to send.')
  const doc = (await ScholarshipDocument.findOne({ studentId: s._id, key })) ?? new ScholarshipDocument({ studentId: s._id, key, type: item.type, label: item.type === 'OTHER' ? item.label : undefined, status: 'NEW' })
  if (!doc.isNew) {
    const since = doc.checkedAt ? { createdAt: { $gt: doc.checkedAt } } : {}
    if (await Attachment.countDocuments({ entityType: 'scholarship_doc', entityId: String(doc._id), 'deleted.at': null, ...since }) >= MAX_FILES) throw conflict(`Up to ${MAX_FILES} photos can wait to be checked. Remove one first.`)
  }
  const who = whoOf(f, s)
  if (line.state === 'EXPIRED') { doc.status = 'SUBMITTED'; doc.issuedOn = undefined; doc.validTill = undefined }
  if (issuedOn) { doc.issuedOn = issuedOn; doc.validTill = scholarshipDocValidTill(doc.type, issuedOn) || undefined }
  if (number) doc.number = number
  doc.log.push({ at: new Date(), by: who, text: 'Sent from the app' })
  await doc.save()
  await storeFile({
    entityType: 'scholarship_doc', entityId: doc._id, studentId: s._id, recordName: `${docLabel(item)} · ${studentName(s)} (${s.admissionNo})`,
    category: FILE_CATEGORY[item.type] ?? 'OTHER', title: docLabel(item), fileName,
  }, buffer, { tenantId: String(f.tenant._id), name: who }, req)
  say(app, who, `${docLabel(item)} sent from the app`)
  await app.save()
  await refreshStudent(s._id, standIn(f, s), req)
  return familyScholarships(f, studentId)
}

/** Take back a photo the family sent that hasn't been checked yet (a wrong picture). */
export async function familyRemoveDocumentFile(f, studentId, appId, key, fileId, req) {
  const { s } = await familyLine(f, studentId, appId, key)
  const doc = await ScholarshipDocument.findOne({ studentId: s._id, key })
  const a = doc && isOid(fileId) ? await Attachment.findOne({ _id: fileId, entityType: 'scholarship_doc', entityId: String(doc._id), 'deleted.at': null }) : null
  if (!a) throw notFound('File')
  if (a.uploadedById || (doc.checkedAt && a.createdAt <= doc.checkedAt)) throw conflict('This file has already been checked by the school, so it stays.')
  a.deleted = { at: new Date(), by: whoOf(f, s), reason: 'Taken back by the family' }
  await a.save()
  await audit({ action: 'DELETE', module: 'scholarships', entityType: 'attachment', entityId: String(a._id), entityName: a.fileName, studentId: s._id, summary: `The family took back “${a.fileName}” (${docLabel(doc)})` }, req)
  return familyScholarships(f, studentId)
}

/** Book a time to show the originals — only once every copy is checked online. */
export async function familyBookVisit(f, studentId, appId, { dayId, time }, req) {
  const { s, app } = await familyApp(f, studentId, appId)
  if (!SCHOLARSHIP_OPEN.includes(app.status)) throw conflict('This application is already decided.')
  const now = await institutionNow()
  const lines = (await linesOf([app.toObject()], now.date)).get(String(app._id))
  if (scholarshipFamilyStep(app.status, lines.filter((l) => l.required || l.state !== 'MISSING').map((l) => l.state)).next !== 'SHOW_ORIGINALS') throw conflict('A time can be booked once every document is checked and only the originals are left.')
  const day = isOid(dayId) ? await ScholarshipVisitDay.findById(dayId).lean() : null
  if (!day || !day.active || day.date < now.date || (day.branchId && String(day.branchId) !== String(s.branchId ?? ''))) throw notFound('Visit day')
  if (!scholarshipVisitTimes(day).includes(time) || (day.date === now.date && time <= now.time)) throw badRequest('Pick one of the times shown.')
  const taken = await ScholarshipApplication.countDocuments({ _id: { $ne: app._id }, 'visit.dayId': day._id, 'visit.time': time, status: { $in: SCHOLARSHIP_OPEN } })
  if (taken >= (day.perSlot ?? 1)) throw conflict('This time has just been taken. Please pick another.')
  const who = whoOf(f, s)
  app.visit = { dayId: day._id, date: day.date, time, place: day.place || undefined, bookedBy: who, bookedAt: new Date(), attended: false }
  say(app, who, `Booked a time to show the originals: ${day.date} ${time}`)
  await app.save()
  await audit({ action: 'CREATE', module: 'scholarships', entityType: 'scholarship_visit', entityId: String(app._id), entityName: app.applicationNo, studentId: s._id, summary: `The family booked ${day.date} ${time} to show the originals for ${app.applicationNo}` }, req)
  return familyScholarships(f, studentId)
}

export async function familyCancelVisit(f, studentId, appId, req) {
  const { s, app } = await familyApp(f, studentId, appId)
  if (!app.visit?.dayId) throw conflict('No time is booked.')
  const was = `${app.visit.date} ${app.visit.time}`
  app.visit = undefined
  say(app, whoOf(f, s), `Cancelled the booked time (${was})`)
  await app.save()
  await audit({ action: 'CANCEL', module: 'scholarships', entityType: 'scholarship_visit', entityId: String(app._id), entityName: app.applicationNo, studentId: s._id, summary: `The family cancelled the visit (${was}) for ${app.applicationNo}` }, req)
  return familyScholarships(f, studentId)
}
