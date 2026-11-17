import { createHash, randomBytes } from 'node:crypto'
import { ADMISSION_FORM_STATUS, DEFAULT_ADMISSION_DOCS, FILE_CATEGORIES, addDaysYmd, sectionLabel } from '@schoolgiant/shared'
import { config } from '../config.js'
import { ClassLevel, Section } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { Tenant } from '../models/platform.js'
import { AdmissionForm } from '../models/students.js'
import { Branch } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { decrypt, encrypt } from '../platform/crypto.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { getSetting, getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { listFiles, storeFile } from './files.js'
import { queueFamilyMessages } from './notify.js'

// New admission › Send form to family. The office sends a link by SMS / WhatsApp / email (or copies it); the family fills
// in the child's admission form on their phone, adds the documents, looks it over and sends it. It then waits on
// New admission until someone there opens it, checks it and admits — the form's files move to the new student
// (students.admitStudent, fromFormId). The link is a random token; only its hash is kept, so a new link is made when
// it is sent again. It works till the day "Links sent to families work for (days)" gives (Settings › Administration).

const EVENT = 'students.admissionForm'
const FAMILY = 'Family (admission form)'
const MAX_FILES = 40
const hash = (token) => createHash('sha256').update(String(token)).digest('hex')
const today = async () => (await institutionNow()).date
const digits = (v) => String(v ?? '').replace(/\D/g, '')

async function schoolSlug() {
  return (await Tenant.findById(getContext()?.tenantId).select('slug').lean())?.slug ?? ''
}
const linkFor = (slug, token) => `${config.appUrl}/admission-form/${slug}/${token}`

/** SENT forms past their last day show as EXPIRED; nothing is stored for that. */
const statusOf = (f, onYmd) => (f.status === 'SENT' && f.expiresOn < onYmd ? 'EXPIRED' : f.status)

async function placeOf({ sectionId, branchId }) {
  if (sectionId) {
    const section = await Section.findById(sectionId).lean()
    if (!section) throw badRequest('Pick a class and section', { fields: { sectionId: 'Pick a class and section' } })
    const cls = await ClassLevel.findById(section.classId).lean()
    return { sectionId: section._id, branchId: section.branchId ?? null, classLabel: sectionLabel(cls, section) }
  }
  return { sectionId: undefined, branchId: branchId ?? null, classLabel: undefined }
}

/** The campus a form is for (its section's, else the one picked, else the main one). */
async function campusOf(f) {
  return f.branchId ? Branch.findById(f.branchId).lean() : Branch.findOne({ isDefault: true }).lean()
}

function formDto(f, onYmd, extra = {}) {
  const status = statusOf(f, onYmd)
  const d = f.data ?? {}
  return {
    id: String(f._id), status, statusLabel: ADMISSION_FORM_STATUS[status]?.label,
    childName: [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') || f.childName || '',
    parentName: d.guardians?.find((g) => g?.name)?.name || f.parentName || '', mobile: f.mobile ?? null, email: f.email ?? null,
    sectionId: f.sectionId ? String(f.sectionId) : null, branchId: f.branchId ? String(f.branchId) : null, classLabel: f.classLabel ?? null,
    channels: f.channels ?? [], expiresOn: f.expiresOn, sentAt: f.createdAt, openedAt: f.openedAt ?? null, submittedAt: f.submittedAt ?? null,
    studentId: f.studentId ? String(f.studentId) : null, createdBy: f.createdBy ?? null,
    ...extra,
  }
}

/** Send (or send again) the link on the channels picked; reports what each channel did. */
async function sendLink(f, link, channels) {
  if (!channels?.length) return []
  const rows = await queueFamilyMessages(EVENT, {
    to: { mobile: f.mobile, email: f.email },
    data: { guardian: { name: f.parentName || 'Parent' }, applicant: { name: f.childName || 'your child', class: f.classLabel || '' }, form: { link, until: f.expiresOn } },
    entity: { type: 'admission_form', id: f._id },
    pick: channels,
  })
  return rows.map((r) => ({ channel: r.channel, status: r.status, reason: r.reason ?? null, to: r.to ?? null }))
}

function checkContact({ mobile, email, channels = [] }) {
  const fields = {}
  if (channels.some((c) => c === 'SMS' || c === 'WHATSAPP') && digits(mobile).length < 10) fields.mobile = 'Enter the mobile number to send an SMS or WhatsApp'
  if (channels.includes('EMAIL') && !email) fields.email = 'Enter the email address to send an email'
  if (Object.keys(fields).length) throw badRequest('Some details need fixing.', { fields })
}

// ───────────────────────────────────────────────────────── the office

export async function createAdmissionForm(input, auth, req) {
  checkContact(input)
  const place = await placeOf(input)
  const token = randomBytes(24).toString('base64url')
  const days = Number(await getSetting('core', 'familyLinkDays')) || 30
  const f = await AdmissionForm.create({
    tokenHash: hash(token), ...place,
    childName: input.childName || undefined, parentName: input.parentName || undefined,
    mobile: digits(input.mobile).slice(-10) || undefined, email: input.email || undefined,
    channels: input.channels ?? [], expiresOn: addDaysYmd(await today(), days),
    createdBy: auth.user?.name, createdById: auth.userId,
  })
  const link = linkFor(await schoolSlug(), token)
  const messages = await sendLink(f, link, input.channels)
  await audit({ action: 'CREATE', module: 'students', entityType: 'admission_form', entityId: String(f._id), entityName: f.childName || f.parentName || 'admission form', summary: `Sent an admission form to ${[f.parentName, f.mobile, f.email].filter(Boolean).join(', ') || 'a family'}${f.classLabel ? ` for ${f.classLabel}` : ''}` }, req)
  return { form: formDto(f.toObject(), await today()), link, messages }
}

/** A new link (the old one stops working), a fresh expiry, and the message again. */
export async function resendAdmissionForm(id, { channels = [], mobile, email }, auth, req) {
  const f = await AdmissionForm.findById(id)
  if (!f) throw notFound('Admission form')
  if (f.status === 'ADMITTED' || f.status === 'CANCELLED') throw conflict('This form is closed.')
  if (mobile !== undefined) f.mobile = digits(mobile).slice(-10) || undefined
  if (email !== undefined) f.email = email || undefined
  checkContact({ mobile: f.mobile, email: f.email, channels })
  const token = randomBytes(24).toString('base64url')
  f.tokenHash = hash(token)
  f.expiresOn = addDaysYmd(await today(), Number(await getSetting('core', 'familyLinkDays')) || 30)
  f.channels = [...new Set([...(f.channels ?? []), ...channels])]
  await f.save()
  const link = linkFor(await schoolSlug(), token)
  const messages = await sendLink(f, link, channels)
  await audit({ action: 'UPDATE', module: 'students', entityType: 'admission_form', entityId: String(f._id), entityName: f.childName || 'admission form', summary: 'Sent the admission form link again' }, req)
  return { form: formDto(f.toObject(), await today()), link, messages }
}

export async function cancelAdmissionForm(id, auth, req) {
  const f = await AdmissionForm.findById(id)
  if (!f) throw notFound('Admission form')
  if (f.status === 'ADMITTED') throw conflict('This form was already admitted.')
  Object.assign(f, { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: auth.user?.name })
  await f.save()
  await audit({ action: 'DELETE', module: 'students', entityType: 'admission_form', entityId: String(f._id), entityName: f.childName || 'admission form', summary: 'Cancelled the admission form link' }, req)
  return formDto(f.toObject(), await today())
}

/** Forms waiting or filled (newest first); `status` narrows to one. */
export async function listAdmissionForms({ status } = {}) {
  const on = await today()
  const filter = status === 'EXPIRED' ? { status: 'SENT', expiresOn: { $lt: on } }
    : status === 'SENT' ? { status: 'SENT', expiresOn: { $gte: on } }
      : status ? { status } : { status: { $in: ['SENT', 'SUBMITTED'] } }
  const rows = await AdmissionForm.find(filter).sort({ submittedAt: -1, createdAt: -1 }).limit(200).lean()
  const counts = new Map((await Attachment.aggregate([
    { $match: { entityType: 'admission_form', entityId: { $in: rows.map((r) => String(r._id)) }, 'deleted.at': null } },
    { $group: { _id: '$entityId', n: { $sum: 1 } } },
  ])).map((c) => [c._id, c.n]))
  return rows.map((r) => formDto(r, on, { fileCount: counts.get(String(r._id)) ?? 0 }))
}

/** One form with what the family filled in (Aadhaar readable for the office) and the files they added. */
export async function getAdmissionForm(id, auth) {
  const f = await AdmissionForm.findById(id).lean()
  if (!f) throw notFound('Admission form')
  const { aadhaarEnc, ...data } = f.data ?? {}
  let aadhaar = ''
  try { aadhaar = aadhaarEnc ? decrypt(aadhaarEnc) : '' } catch { aadhaar = '' }
  return formDto(f, await today(), {
    data: f.data ? { ...data, aadhaar } : null,
    localNames: f.localNames ?? null,
    files: await listFiles({ entityType: 'admission_form', entityId: String(f._id) }, auth),
  })
}

// ───────────────────────────────────────────────────────── the family (no sign-in: the token is the key)

const closedLink = (message) => new AppError(410, message, { code: 'FORM_CLOSED' })

async function byToken(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token ?? ''))) throw closedLink('This link isn’t right. Ask the school to send it again.')
  const f = await AdmissionForm.findOne({ tokenHash: hash(token) })
  if (!f) throw closedLink('This link isn’t right or was replaced by a newer one. Ask the school to send it again.')
  if (f.status === 'ADMITTED') throw closedLink('The school has already admitted your child with this form. Thank you!')
  if (f.status === 'CANCELLED') throw closedLink('The school has closed this form. Please contact the school.')
  if (f.expiresOn < await today()) throw closedLink('This link has expired. Ask the school to send it again.')
  return f
}

const familyFile = (a) => ({ id: a.id, category: a.category, categoryLabel: a.categoryLabel, side: a.side, title: a.title ?? null, fileName: a.fileName, size: a.size, contentType: a.contentType })

async function familyFiles(f) {
  const rows = await Attachment.find({ entityType: 'admission_form', entityId: String(f._id), 'deleted.at': null }).sort({ createdAt: 1 }).lean()
  return rows.map((a) => familyFile({ id: String(a._id), category: a.category, categoryLabel: FILE_CATEGORIES.find((c) => c.value === a.category)?.label, side: a.side, title: a.title, fileName: a.fileName, size: a.size, contentType: a.mime }))
}

/** What the family's page needs: the school, the class, what they filled before, the documents asked for. */
export async function publicAdmissionForm(tenant, token) {
  const f = await byToken(token)
  if (!f.openedAt) { f.openedAt = new Date(); await f.save() }
  const campus = await campusOf(f)
  const p = tenant.profile ?? {}
  const { aadhaarEnc, ...data } = f.data ?? {}
  let aadhaarLast4 = null
  try { aadhaarLast4 = aadhaarEnc ? decrypt(aadhaarEnc).slice(-4) : null } catch { aadhaarLast4 = null }
  const langs = ((await getSetting('core', 'namesAlsoIn')) ?? []).filter((c) => c && c !== 'en')
  const [first, ...rest] = String(f.childName ?? '').trim().split(/\s+/).filter(Boolean)
  return {
    school: { name: campus?.identity?.printName || tenant.name, logoUrl: campus?.identity?.logoUrl || p.logoUrl || null, primaryColor: p.primaryColor ?? null, phone: campus?.phone || p.phone || null },
    campus: campus?.name ?? null, classLabel: f.classLabel ?? null, expiresOn: f.expiresOn,
    submittedAt: f.submittedAt ?? null,
    // what they sent before, or the office's start (child's and parent's name, contact)
    data: f.data ? { ...data, aadhaar: '' } : {
      firstName: first ?? '', lastName: rest.join(' '),
      guardians: [{ name: f.parentName ?? '', relation: 'FATHER', mobile: f.mobile ?? '', email: f.email ?? '', isPrimary: true }, { name: '', relation: 'MOTHER' }],
    },
    aadhaarLast4,
    localNames: f.localNames ?? null,
    names: { languages: langs, required: !!campus?.localNameRequired && langs.length > 0 },
    documents: campus?.admissionDocs ?? DEFAULT_ADMISSION_DOCS,
    files: await familyFiles(f),
    ui: await (async () => { const c = await getSettings('core'); return { languages: c.enabledLanguages ?? [], defaultLanguage: c.defaultAppLanguage ?? 'en' } })(),
  }
}

/** The family sends (or sends again, until the school admits) the filled form. */
export async function publicSubmitAdmissionForm(token, { aadhaar, localNames, ...data }, req) {
  const f = await byToken(token)
  const keepAadhaar = !aadhaar && f.data?.aadhaarEnc
  f.data = { ...data, ...(aadhaar ? { aadhaarEnc: encrypt(digits(aadhaar)) } : keepAadhaar ? { aadhaarEnc: f.data.aadhaarEnc } : {}) }
  f.localNames = localNames ?? f.localNames
  f.status = 'SUBMITTED'
  f.submittedAt = new Date()
  f.submitCount = (f.submitCount ?? 0) + 1
  f.markModified('data')
  f.markModified('localNames')
  await f.save()
  const name = [data.firstName, data.lastName].filter(Boolean).join(' ')
  await audit({ action: 'UPDATE', module: 'students', entityType: 'admission_form', entityId: String(f._id), entityName: name, summary: `The family ${f.submitCount > 1 ? 'sent the admission form again' : 'filled in the admission form'} for ${name}` }, req)
  return { submittedAt: f.submittedAt, childName: name }
}

export async function publicUploadAdmissionFile(token, { category, side, title, fileName }, buffer, req) {
  const f = await byToken(token)
  if (await Attachment.countDocuments({ entityType: 'admission_form', entityId: String(f._id), 'deleted.at': null }) >= MAX_FILES) {
    throw conflict(`Up to ${MAX_FILES} files can be added. Remove one you don’t need first.`)
  }
  const a = await storeFile({ entityType: 'admission_form', entityId: f._id, studentId: null, recordName: `the admission form for ${f.childName || 'a child'}`, category, title, side, fileName }, buffer, { tenantId: String(f.tenantId), name: FAMILY }, req)
  return familyFile(a)
}

/** The family takes back a file they added (kept hidden, as every removed file is). */
export async function publicRemoveAdmissionFile(token, fileId) {
  const f = await byToken(token)
  const a = await Attachment.findOne({ _id: fileId, entityType: 'admission_form', entityId: String(f._id), 'deleted.at': null })
  if (!a) throw notFound('File')
  a.deleted = { at: new Date(), by: FAMILY, reason: 'Removed by the family' }
  await a.save()
  return { ok: true }
}

