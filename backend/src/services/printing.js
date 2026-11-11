import { LETTERHEAD_DEFAULTS, PRINT_DOCS, PRINT_DOC_BY, printDefaults } from '@schoolgiant/shared'
import { Tenant } from '../models/platform.js'
import { PrintLetterhead, PrintTemplate } from '../models/printing.js'
import { audit } from '../platform/audit.js'
import { clean, withTransaction } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { getContext } from '../platform/context.js'
import { getSettings } from '../platform/settings.js'
import { templateError } from '../documents/engine.js'

// Print templates (engine E8). The web prints documents itself; this decides how: the
// letterhead (institution-wide) and, per document, the template marked default — or the
// built-in layout when the institution has not made one.

const LAYOUT = ['align', 'showLogo', 'showContacts', 'ids', 'tagline', 'accentColor', 'footerText', 'sealUrl', 'signatures']

async function institution() {
  const t = await Tenant.findById(getContext().tenantId).select('name profile').lean()
  return { name: t.name, ...t.profile }
}

/** Letterhead layout merged over the defaults, plus the profile details it prints. */
export async function getLetterhead() {
  const saved = await PrintLetterhead.findOne({ key: 'MAIN' }).lean()
  const layout = { ...LETTERHEAD_DEFAULTS, ...Object.fromEntries(LAYOUT.filter((k) => saved?.[k] !== undefined && saved?.[k] !== null).map((k) => [k, saved[k]])) }
  return { ...layout, institution: await institution(), updatedAt: saved?.updatedAt ?? null, updatedBy: saved?.updatedBy ?? null }
}

export async function saveLetterhead(input, auth, req) {
  await PrintLetterhead.findOneAndUpdate({ key: 'MAIN' }, { $set: { ...input, updatedBy: auth.user?.name } }, { upsert: true, setDefaultsOnInsert: true })
  await audit({ action: 'UPDATE', module: 'core', entityType: 'letterhead', entityName: 'Letterhead', summary: 'Changed the printed letterhead' }, req)
  return getLetterhead()
}

/** The built-in layout of a document; the staff ID card turns sideways with its setting (Settings › Staff & HR). */
async function builtInTemplate(docType, hrms) {
  const t = printDefaults(docType)
  if (docType === 'HR_ID_CARD' && (hrms ?? await getSettings('hrms')).idCardOrientation === 'LANDSCAPE') t.paper = 'CARD_LANDSCAPE'
  return t
}

/** Every document with its templates; documents with none show the built-in layout. */
export async function listTemplates() {
  const [rows, hrms] = await Promise.all([PrintTemplate.find().sort({ docType: 1, isDefault: -1, name: 1 }).lean().then(clean), getSettings('hrms')])
  return Promise.all(PRINT_DOCS.map(async (d) => ({ ...d, templates: rows.filter((t) => t.docType === d.value), builtIn: await builtInTemplate(d.value, hrms) })))
}

export async function saveTemplate(id, input, auth, req) {
  const before = id ? await PrintTemplate.findById(id) : null
  if (id && !before) throw notFound('Print template')
  const docType = input.docType ?? before.docType
  if (!PRINT_DOC_BY[docType]) throw badRequest('Pick the document this template prints.', { fields: { docType: 'Unknown document' } })
  if (await PrintTemplate.exists({ docType, name: input.name ?? before?.name, ...(id && { _id: { $ne: id } }) })) throw conflict(`There is already a ${PRINT_DOC_BY[docType].label.toLowerCase()} template with this name.`, { fields: { name: 'Already used' } })
  // the first template of a document becomes its default
  // a campus's own template is never the institution's default — it prints that campus's records only
  const forCampus = !!(input.branchId !== undefined ? input.branchId : before?.branchId)
  const makeDefault = forCampus ? false : input.isDefault ?? (before ? before.isDefault : !await PrintTemplate.exists({ docType, branchId: null }))
  if (!forCampus && before?.isDefault && input.isDefault === false) throw badRequest('Make another template the default instead.', { fields: { isDefault: 'One template must be the default' } })
  if (makeDefault && input.active === false) throw badRequest('The default template must stay in use.', { fields: { active: 'Default' } })
  if (input.body) {
    const err = templateError(input.body)
    if (err) throw badRequest(`The template has a mistake: ${err}`, { fields: { body: err } })
  }
  if (input.body !== undefined && !String(input.body ?? '').trim()) input.body = undefined

  const doc = await withTransaction(async () => {
    if (makeDefault) await PrintTemplate.updateMany({ docType, isDefault: true, ...(id && { _id: { $ne: id } }) }, { $set: { isDefault: false } })
    const t = before ?? new PrintTemplate({ docType })
    Object.assign(t, input, { docType, isDefault: makeDefault, updatedBy: auth.user?.name })
    await t.save()
    return t
  })
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'core', entityType: 'print_template', entityId: String(doc._id), entityName: doc.name, summary: `${id ? 'Changed' : 'Added'} the ${PRINT_DOC_BY[docType].label.toLowerCase()} template “${doc.name}”${doc.isDefault ? ' (default)' : ''}` }, req)
  return clean(doc.toObject())
}

/** Delete a template. When the default goes, the next one takes over (or the built-in layout). */
export async function deleteTemplate(id, auth, req) {
  const t = await PrintTemplate.findById(id)
  if (!t) throw notFound('Print template')
  await withTransaction(async () => {
    await PrintTemplate.deleteOne({ _id: t._id })
    if (t.isDefault) {
      const next = await PrintTemplate.findOne({ docType: t.docType, active: true }).sort({ updatedAt: -1 })
      if (next) { next.isDefault = true; await next.save() }
    }
  })
  await audit({ action: 'DELETE', module: 'core', entityType: 'print_template', entityId: String(t._id), entityName: t.name, summary: `Deleted the ${PRINT_DOC_BY[t.docType]?.label.toLowerCase() ?? t.docType} template “${t.name}”` }, req)
  return { id: String(t._id) }
}

/** What a printer needs for one document: letterhead + the default template. */
export async function effectiveTemplate(docType) {
  if (!PRINT_DOC_BY[docType]) throw notFound('Document type')
  const saved = await PrintTemplate.findOne({ docType, isDefault: true, active: true }).lean()
  return { letterhead: await getLetterhead(), template: saved ? { ...printDefaults(docType), ...clean(saved), builtIn: false } : await builtInTemplate(docType) }
}
