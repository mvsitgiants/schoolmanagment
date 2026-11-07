import { FORM_USE_LABEL, STARTER_FORMS, checkFormDefinition, formFields } from '@schoolgiant/shared'
import { FormTemplate, FormVersion } from '../models/forms.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'

// Form builder (docs/00 §7 E6). Designs are edited freely; publishing checks the design,
// freezes it as version N and makes it the one doctors fill. Filled forms keep their
// version, so editing a form never changes what an old record says.

/** Starter forms for an institution that has none — published as version 1. */
export async function ensureStarterForms() {
  if (await FormTemplate.exists({})) return
  const by = 'Starter set'
  for (const f of STARTER_FORMS) {
    const form = await FormTemplate.create({ ...f, status: 'PUBLISHED', version: 1, changedSincePublish: false, publishedAt: new Date(), publishedBy: by, updatedBy: by, starter: true })
    await FormVersion.create({ formId: form._id, version: 1, code: f.code, name: f.name, use: f.use, definition: f.definition, publishedBy: by })
  }
}

const summaryOf = (f) => ({
  id: String(f._id), code: f.code, name: f.name, description: f.description, use: f.use, useLabel: FORM_USE_LABEL[f.use] ?? f.use,
  specialities: f.specialities ?? [], status: f.status, version: f.version, changedSincePublish: f.changedSincePublish,
  fields: formFields(f.definition).length, sections: (f.definition?.sections ?? []).length,
  publishedAt: f.publishedAt, publishedBy: f.publishedBy, updatedAt: f.updatedAt, updatedBy: f.updatedBy, starter: f.starter,
})

export async function listForms({ status, use, search } = {}) {
  await ensureStarterForms()
  const filter = {}
  if (status) filter.status = status
  else filter.status = { $ne: 'ARCHIVED' }
  if (use) filter.use = use
  if (search) filter.$or = [{ name: new RegExp(escapeRegex(search), 'i') }, { code: new RegExp(escapeRegex(search), 'i') }]
  return (await FormTemplate.find(filter).sort({ name: 1 }).lean()).map(summaryOf)
}

export async function getForm(id) {
  const f = await FormTemplate.findById(id).lean()
  if (!f) throw notFound('Form')
  const versions = await FormVersion.find({ formId: f._id }).select('version publishedAt publishedBy').sort({ version: -1 }).lean()
  return { ...summaryOf(f), definition: f.definition, versions: clean(versions) }
}

export async function createForm(input, req) {
  if (await FormTemplate.exists({ code: input.code })) throw conflict(`The code ${input.code} is already used by another form.`, { fields: { code: 'Already used' } })
  const f = await FormTemplate.create({ ...input, definition: input.definition ?? { sections: [{ title: 'Details', columns: 2, fields: [] }] }, updatedBy: getContext()?.userName })
  await audit({ action: 'CREATE', module: 'core', entityType: 'form', entityId: String(f._id), entityName: f.name, summary: `Created the form “${f.name}”` }, req)
  return getForm(f._id)
}

export async function updateForm(id, input, req) {
  const f = await FormTemplate.findById(id)
  if (!f) throw notFound('Form')
  if (f.status === 'ARCHIVED') throw conflict('Bring the form back from the archive before changing it.')
  if (input.code && input.code !== f.code && await FormTemplate.exists({ code: input.code })) throw conflict(`The code ${input.code} is already used by another form.`, { fields: { code: 'Already used' } })
  for (const k of ['code', 'name', 'description', 'use', 'specialities', 'definition']) if (input[k] !== undefined) f[k] = input[k]
  if (input.definition) { f.markModified('definition'); f.changedSincePublish = true }
  f.updatedBy = getContext()?.userName
  await f.save()
  return getForm(f._id)
}

/** Check the design and freeze it as the next version. */
export async function publishForm(id, req) {
  const f = await FormTemplate.findById(id)
  if (!f) throw notFound('Form')
  if (f.status === 'ARCHIVED') throw conflict('Bring the form back from the archive before publishing it.')
  const errors = checkFormDefinition(f.definition)
  if (Object.keys(errors).length) throw badRequest('The form isn’t ready to publish.', { fields: errors })
  const by = getContext()?.userName
  const version = f.version + 1
  await FormVersion.create({ formId: f._id, version, code: f.code, name: f.name, use: f.use, definition: f.definition, publishedBy: by })
  Object.assign(f, { version, status: 'PUBLISHED', changedSincePublish: false, publishedAt: new Date(), publishedBy: by })
  await f.save()
  await audit({ action: 'UPDATE', module: 'core', entityType: 'form', entityId: String(f._id), entityName: f.name, summary: `Published “${f.name}” version ${version}` }, req)
  return getForm(f._id)
}

export async function archiveForm(id, archived, req) {
  const f = await FormTemplate.findById(id)
  if (!f) throw notFound('Form')
  f.status = archived ? 'ARCHIVED' : f.version ? 'PUBLISHED' : 'DRAFT'
  await f.save()
  await audit({ action: 'UPDATE', module: 'core', entityType: 'form', entityId: String(f._id), entityName: f.name, summary: archived ? `Archived “${f.name}”` : `Brought back “${f.name}”` }, req)
  return getForm(f._id)
}

export async function duplicateForm(id, req) {
  const f = await FormTemplate.findById(id).lean()
  if (!f) throw notFound('Form')
  let code = `${f.code}_COPY`.slice(0, 24)
  for (let i = 2; await FormTemplate.exists({ code }); i++) code = `${f.code.slice(0, 20)}_${i}`
  return createForm({ code, name: `${f.name} (copy)`, description: f.description, use: f.use, specialities: f.specialities, definition: f.definition }, req)
}

/** Forms doctors can add, at their latest published version. */
export async function publishedForms(uses = ['OPD_CONSULT', 'ASSESSMENT']) {
  await ensureStarterForms()
  const forms = await FormTemplate.find({ status: 'PUBLISHED', use: { $in: uses } }).sort({ name: 1 }).lean()
  const versions = await FormVersion.find({ $or: forms.map((f) => ({ formId: f._id, version: f.version })) }).lean()
  const byForm = new Map(versions.map((v) => [String(v.formId), v]))
  return forms.filter((f) => byForm.has(String(f._id))).map((f) => ({
    formId: String(f._id), version: f.version, code: f.code, name: f.name, use: f.use, description: f.description,
    specialities: f.specialities ?? [], definition: byForm.get(String(f._id)).definition,
  }))
}

/** One frozen version (to check and summarise a filled form). */
export async function formVersion(formId, version) {
  if (!isOid(formId)) return null
  return FormVersion.findOne({ formId, version }).lean()
}
