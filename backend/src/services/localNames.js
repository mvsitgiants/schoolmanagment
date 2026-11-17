import {
  GUARDIAN_RELATIONS, LOCAL_NAME_KIND_BY, LOCAL_SUGGEST_BATCH, LOCAL_TEXT_MAX, localKey, localNameLanguages, sectionLabel,
} from '@schoolgiant/shared'
import { LocalText } from '../models/localNames.js'
import { ClassLevel, GradingScheme, Section, Subject } from '../models/academics.js'
import { Exam, ExamType } from '../models/exams.js'
import { FeeHead, FeeStructure } from '../models/fees.js'
import { Employee } from '../models/hrms.js'
import { PrintLetterhead } from '../models/printing.js'
import { Student, studentName } from '../models/students.js'
import { Branch, User } from '../models/tenant.js'
import { Tenant } from '../models/platform.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest } from '../platform/errors.js'
import { audit } from '../platform/audit.js'
import { AI_MODELS, aiStatus, callModel, jsonFormat, jsonOf } from './aiClient.js'

// Names in other languages (core/local-names). Each language keeps a glossary of the institution's own texts keyed by
// the English as saved; this page lists the English texts each kind of record holds beside their saved local text.
// printing: glossaryFor(lang) + localize() put the local text into a document printed in that language.

const LANGS = () => localNameLanguages().map((l) => l.code)
const checkLang = (lang) => {
  if (!LANGS().includes(lang)) throw badRequest('Pick a language other than English.', { fields: { lang: 'Not a language' } })
  return lang
}
const RELATION = Object.fromEntries(GUARDIAN_RELATIONS.map((r) => [r.value, r.label]))
const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

/** Each kind's English texts: [{ english, where }] (where = what it is, for the reader). `branchId` narrows to one campus. */
const SOURCES = {
  async students({ branchId }) {
    const filter = branchId ? { branchId } : {}
    const [rows, sections, classes] = await Promise.all([
      Student.find(filter).select('firstName middleName lastName sectionId admissionNo').sort({ firstName: 1, lastName: 1 }).lean(),
      Section.find(branchId ? { branchId } : {}).select('classId name').lean(),
      ClassLevel.find().select('name code').lean(),
    ])
    const cls = new Map(classes.map((c) => [String(c._id), c]))
    const sec = new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s)]))
    return rows.map((s) => ({ english: studentName(s), where: [sec.get(String(s.sectionId)), s.admissionNo].filter(Boolean).join(' · ') }))
  },
  async parents({ branchId }) {
    const rows = await Student.find(branchId ? { branchId } : {}).select('firstName middleName lastName guardians').lean()
    return rows.flatMap((s) => (s.guardians ?? []).map((g) => ({ english: g.name, where: `${RELATION[g.relation] ?? 'Guardian'} · ${studentName(s)}` })))
  },
  async staff({ branchId }) {
    const [emps, users] = await Promise.all([
      Employee.find(branchId ? { branchId } : {}).select('name designation').lean(),
      branchId ? [] : User.find({ active: { $ne: false } }).select('name designation').lean(),
    ])
    return [...emps, ...users].map((e) => ({ english: e.name, where: e.designation ?? '' }))
  },
  async school({ branchId }) {
    const tenant = await Tenant.findById(getContext().tenantId).select('name profile').lean()
    const p = tenant?.profile ?? {}
    const lh = await PrintLetterhead.findOne({ key: 'MAIN' }).select('tagline footerText').lean()
    const branches = await Branch.find(branchId ? { _id: branchId } : {}).lean()
    const out = branchId ? [] : [
      { english: tenant?.name, where: 'Institution name' }, { english: p.legalName, where: 'Legal name' }, { english: p.trustName, where: 'Trust / society' },
      { english: p.board, where: 'Board' }, { english: p.addressLine, where: 'Address' }, { english: p.city, where: 'City' }, { english: p.state, where: 'State' },
      { english: lh?.tagline, where: 'Letterhead tagline' }, { english: lh?.footerText, where: 'Letterhead footer' },
    ]
    for (const b of branches) {
      const id = b.identity ?? {}
      out.push({ english: b.name, where: 'Campus name' }, { english: id.printName, where: `${b.name} · Name printed` }, { english: id.board, where: `${b.name} · Board` },
        { english: b.addressLine, where: `${b.name} · Address` }, { english: b.city, where: `${b.name} · City` }, { english: b.state, where: `${b.name} · State` },
        { english: id.principalName, where: `${b.name} · Principal` })
    }
    return out
  },
  async classes({ branchId }) {
    const [sections, classes] = await Promise.all([Section.find(branchId ? { branchId } : {}).select('classId name').lean(), ClassLevel.find().select('name code order').sort({ order: 1 }).lean()])
    const cls = new Map(classes.map((c) => [String(c._id), c]))
    const used = branchId ? new Set(sections.map((s) => String(s.classId))) : null
    return [
      ...classes.filter((c) => !used || used.has(String(c._id))).map((c) => ({ english: c.name, where: 'Class' })),
      ...sections.map((s) => ({ english: sectionLabel(cls.get(String(s.classId)), s), where: 'Section' })),
    ]
  },
  async subjects() {
    return (await Subject.find().select('name code').sort({ name: 1 }).lean()).map((s) => ({ english: s.name, where: s.code ?? '' }))
  },
  async exams() {
    const [exams, types] = await Promise.all([Exam.find().select('name').sort({ startDate: -1 }).lean(), ExamType.find().select('name').lean()])
    return [...exams.map((e) => ({ english: e.name, where: 'Exam' })), ...types.map((t) => ({ english: t.name, where: 'Exam type' }))]
  },
  async fees() {
    const [heads, structures] = await Promise.all([FeeHead.find().select('name code').lean(), FeeStructure.find().select('name installments').lean()])
    return [
      ...heads.map((h) => ({ english: h.name, where: 'Fee head' })),
      ...structures.flatMap((s) => (s.installments ?? []).map((i) => ({ english: i.name, where: `Instalment · ${s.name}` }))),
    ]
  },
  async phrases({ lang }) {
    const [schemes, own] = await Promise.all([GradingScheme.find().select('name bands').lean(), LocalText.find({ lang, kind: 'phrases' }).select('english').lean()])
    return [
      ...schemes.flatMap((g) => (g.bands ?? []).filter((b) => b.remark).map((b) => ({ english: b.remark, where: `Grade ${b.grade} · ${g.name}` }))),
      ...own.map((t) => ({ english: t.english, where: '' })),
    ]
  },
}

/** One kind's English texts beside their local text: { rows: [{ key, english, where, value, suggested, saved }], total, missing }. */
export async function listLocalNames({ lang, kind, branchId, q, missing, limit = 500 }) {
  checkLang(lang)
  if (!SOURCES[kind]) throw badRequest('Pick what to show.', { fields: { kind: 'Unknown' } })
  const raw = await SOURCES[kind]({ lang, branchId: branchId && isOid(branchId) ? branchId : null })
  // one row per distinct English text (two siblings share their parents); the first "where" is kept
  const byKey = new Map()
  for (const r of raw) {
    const english = clean(r.english)
    if (!english || english.length > LOCAL_TEXT_MAX) continue
    const key = localKey(english)
    if (!byKey.has(key)) byKey.set(key, { key, english, where: r.where ?? '' })
  }
  const saved = new Map((await LocalText.find({ lang, key: { $in: [...byKey.keys()] } }).lean()).map((t) => [t.key, t]))
  let rows = [...byKey.values()].map((r) => ({ ...r, value: saved.get(r.key)?.value ?? '', suggested: !!saved.get(r.key)?.suggested }))
  const counts = { total: rows.length, missing: rows.filter((r) => !r.value).length }
  const needle = clean(q).toLowerCase()
  if (needle) rows = rows.filter((r) => r.key.includes(needle) || r.value.toLowerCase().includes(needle) || r.where.toLowerCase().includes(needle))
  if (missing) rows = rows.filter((r) => !r.value)
  // the "Fill with AI" button shows only where AI is set up — typing and Excel always work
  const aiReady = !!(await aiStatus().catch(() => null))?.configured
  return { ...counts, aiReady, shown: Math.min(rows.length, limit), rows: rows.slice(0, limit) }
}

/** Save local texts: [{ english, value, suggested? }] — an empty value removes the entry. */
export async function saveLocalNames({ lang, kind = 'phrases', entries }, auth, req) {
  checkLang(lang)
  let saved = 0
  let removed = 0
  for (const e of entries) {
    const english = clean(e.english)
    const value = clean(e.value)
    if (!english) continue
    const key = localKey(english)
    if (!value) {
      removed += (await LocalText.deleteOne({ lang, key })).deletedCount ?? 0
      continue
    }
    await LocalText.updateOne({ lang, key }, {
      $set: { english, value, suggested: !!e.suggested, updatedBy: auth.user?.name },
      $setOnInsert: { kind: LOCAL_NAME_KIND_BY[kind] ? kind : 'phrases' },
    }, { upsert: true })
    saved++
  }
  forgetGlossary()
  await audit({ action: 'UPDATE', module: 'core', entityType: 'local_names', entityId: lang, entityName: `Names in ${lang}`, summary: `Saved ${saved} and removed ${removed} ${lang} name${saved + removed === 1 ? '' : 's'} (${LOCAL_NAME_KIND_BY[kind]?.label ?? kind})` }, req)
  return { saved, removed }
}

/** The saved local text of each English text: { english: local } (texts with none are left out). */
export async function lookupLocalNames({ lang, texts }) {
  checkLang(lang)
  const wanted = new Map(texts.map((t) => [localKey(t), clean(t)]).filter(([k]) => k))
  const rows = await LocalText.find({ lang, key: { $in: [...wanted.keys()] } }).select('key value').lean()
  return Object.fromEntries(rows.map((r) => [wanted.get(r.key), r.value]))
}

// ───────────────────────────────────────────────────────── CSV (fill in Excel)

const csvCell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
/** English, the local text and where it comes from, for every row of a kind (or every saved entry when kind is 'all'). */
export async function exportLocalNames({ lang, kind, branchId }) {
  checkLang(lang)
  const rows = kind === 'all'
    ? (await LocalText.find({ lang }).sort({ kind: 1, english: 1 }).lean()).map((t) => ({ english: t.english, value: t.value, where: LOCAL_NAME_KIND_BY[t.kind]?.label ?? '' }))
    : (await listLocalNames({ lang, kind, branchId, limit: 100_000 })).rows
  return ['English,Translation,Where', ...rows.map((r) => [r.english, r.value, r.where].map(csvCell).join(','))].join('\n')
}

/** Rows from a filled-in sheet: [{ english, value }]. `dryRun` counts what would change without saving. */
export async function importLocalNames({ lang, kind, rows, dryRun }, auth, req) {
  checkLang(lang)
  const entries = rows.map((r) => ({ english: clean(r.english), value: clean(r.value) })).filter((r) => r.english && r.value)
  const tooLong = entries.filter((r) => r.english.length > LOCAL_TEXT_MAX || r.value.length > LOCAL_TEXT_MAX).length
  const usable = entries.filter((r) => r.english.length <= LOCAL_TEXT_MAX && r.value.length <= LOCAL_TEXT_MAX)
  if (dryRun) return { ready: usable.length, skipped: rows.length - usable.length, tooLong }
  const res = await saveLocalNames({ lang, kind, entries: usable }, auth, req)
  return { ...res, skipped: rows.length - usable.length, tooLong }
}

// ───────────────────────────────────────────────────────── AI suggestions

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { ref: { type: 'integer' }, text: { type: 'string' } }, required: ['ref', 'text'], additionalProperties: false } } },
  required: ['items'], additionalProperties: false,
}

/**
 * Drafts the local text for English texts of one kind — names written in the language's script, other texts as an
 * Indian school writes them — for staff to check and save. Only the texts themselves are sent.
 */
export async function suggestLocalNames({ lang, kind, texts }, auth) {
  checkLang(lang)
  const language = localNameLanguages().find((l) => l.code === lang)
  const list = [...new Set(texts.map(clean).filter((t) => t && t.length <= LOCAL_TEXT_MAX))].slice(0, LOCAL_SUGGEST_BATCH)
  if (!list.length) return { suggestions: [] }
  const people = !!LOCAL_NAME_KIND_BY[kind]?.people
  const how = people
    ? `These are people's names (students, parents, staff) at an Indian school. Write each name in ${language.name} (${language.script} script) the way the person would write it — transliterate, do not translate. Keep initials as letters in ${language.script} script.`
    : `These are texts an Indian school prints on its documents (school and board names, addresses, class, subject, exam and fee names, grade remarks). Write each one as a school in India writes it in ${language.name} (${language.script} script), formally. Proper names (of the school, a society, a place) are written in ${language.script} script, not translated. Keep numbers, codes and brackets as they are.`
  const msg = await callModel('LOCAL_NAMES', {
    model: AI_MODELS.bulk,
    max_tokens: 6000,
    system: [{ type: 'text', text: `You write an institution's texts in ${language.name} for its printed documents. ${how} Answer with one item per text, matched by ref.` }],
    output_config: { effort: 'low', format: jsonFormat(SUGGEST_SCHEMA) },
    messages: [{ role: 'user', content: JSON.stringify(list.map((text, ref) => ({ ref, text }))) }],
  }, auth)
  const items = jsonOf(msg).items ?? []
  return { suggestions: items.filter((i) => list[i.ref] && clean(i.text)).map((i) => ({ english: list[i.ref], value: clean(i.text).slice(0, LOCAL_TEXT_MAX) })) }
}

// ───────────────────────────────────────────────────────── printing

const CODE = /^[A-Z0-9_.\-/]+$/ // one word in capitals: a code, not text
const glossaries = new Map() // `${tenantId}:${lang}` → { at, map }
const GLOSSARY_TTL = 60_000
/** Forget the cached glossaries (after a save). */
export const forgetGlossary = () => glossaries.clear()

/** key → local text for one language, cached for a minute (a class's hall tickets print with one read). */
export async function glossaryFor(lang) {
  if (!lang || lang === 'en' || !LANGS().includes(lang)) return null
  const cacheKey = `${getContext()?.tenantId}:${lang}`
  const hit = glossaries.get(cacheKey)
  if (hit && Date.now() - hit.at < GLOSSARY_TTL) return hit.map
  const map = new Map((await LocalText.find({ lang }).select('key value').lean()).map((t) => [t.key, t.value]))
  if (glossaries.size > 500) glossaries.clear()
  glossaries.set(cacheKey, { at: Date.now(), map })
  return map
}

/**
 * A document's data with the institution's own texts in the language: every string that is exactly a glossary entry's
 * English (any case and spacing) becomes its local text — or "local (English)" for BOTH. Anything else stays as saved.
 */
export function localize(value, glossary, mode = 'LOCAL') {
  if (!glossary?.size || mode === 'SAVED') return value
  const walk = (v, depth) => {
    if (typeof v === 'string') {
      // a code the templates test (FEMALE, PASS, GENERAL) is never a name, whatever the glossary holds
      if (v.length > LOCAL_TEXT_MAX || CODE.test(v)) return v
      const local = glossary.get(localKey(v))
      return local ? (mode === 'BOTH' ? `${local} (${v.trim()})` : local) : v
    }
    if (depth > 10 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    // plain data only: ids, dates and other objects pass through untouched
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return v
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]))
  }
  return walk(value, 0)
}
