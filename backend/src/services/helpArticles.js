import { MODULES } from '@schoolgiant/shared'
import { HelpArticle } from '../models/platform.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'
import { STARTER_HELP_ARTICLES } from '../seed/helpArticles.js'

// Help articles: short how-tos the SchoolGiant team writes once for every school (Superadmin › Help articles). A school's
// Help & support page searches them, offers the ones for the screen the person came from, and counts "was this
// helpful". English is the article; a translation is shown when the reader's language has one.

const PAGE_IDS = new Set(MODULES.flatMap((m) => (m.pages ?? []).map((p) => `${m.id}.${p.id}`)))
const MODULE_IDS = new Set(MODULES.map((m) => m.id))

/** The article in a language: its translation where there is one, else the English. */
function localized(a, lang) {
  const tr = lang && lang !== 'en' ? (a.translations instanceof Map ? a.translations.get(lang) : a.translations?.[lang]) : null
  return { title: tr?.title || a.title, summary: tr?.summary || a.summary || '', body: tr?.body || a.body || '', translated: !!tr?.title }
}
const listItem = (a, lang) => { const l = localized(a, lang); return { slug: a.slug, title: l.title, summary: l.summary, module: a.module ?? null, pages: a.pages ?? [] } }

// ───────────────────────────────────────────────────────── schools (published only)

/**
 * Published articles: matching `q` (any language), or those for a screen (`page` "<module>.<page>", then its module),
 * else the first ones in order.
 */
export async function searchArticles({ q, page, lang, limit = 20 }) {
  const filter = { published: true }
  if (q?.trim()) {
    const re = new RegExp(escapeRegex(q.trim()), 'i')
    filter.$or = [{ title: re }, { summary: re }, { body: re }, ...['hi', 'kn'].flatMap((l) => [{ [`translations.${l}.title`]: re }, { [`translations.${l}.body`]: re }])]
  }
  let rows = await HelpArticle.find(filter).sort({ order: 1, title: 1 }).limit(200).lean()
  let forPage = []
  if (page) {
    const mod = page.split('.')[0]
    forPage = rows.filter((a) => a.pages?.includes(page))
    if (!forPage.length) forPage = rows.filter((a) => a.module === mod)
  }
  rows = rows.slice(0, limit)
  return { forPage: forPage.slice(0, 6).map((a) => listItem(a, lang)), rows: rows.map((a) => listItem(a, lang)) }
}

export async function readArticle(slug, lang) {
  const a = await HelpArticle.findOneAndUpdate({ slug: String(slug).toLowerCase(), published: true }, { $inc: { views: 1 } }, { new: true }).lean()
  if (!a) throw notFound('Help article')
  return { slug: a.slug, module: a.module ?? null, updatedAt: a.updatedAt, ...localized(a, lang) }
}

export async function articleFeedback(slug, helpful) {
  const r = await HelpArticle.updateOne({ slug: String(slug).toLowerCase(), published: true }, { $inc: { [helpful ? 'helpful.yes' : 'helpful.no']: 1 } })
  if (!r.matchedCount) throw notFound('Help article')
  return { ok: true }
}

// ───────────────────────────────────────────────────────── the team (Superadmin › Help articles)

const teamDto = (a) => ({
  id: String(a._id), slug: a.slug, title: a.title, summary: a.summary ?? '', body: a.body ?? '', module: a.module ?? '', pages: a.pages ?? [],
  translations: Object.fromEntries(a.translations instanceof Map ? a.translations : Object.entries(a.translations ?? {})),
  published: !!a.published, order: a.order ?? 100, views: a.views ?? 0, helpful: a.helpful ?? { yes: 0, no: 0 }, updatedBy: a.updatedBy ?? null, updatedAt: a.updatedAt,
})

export async function listArticlesForTeam() {
  const rows = await HelpArticle.find().sort({ order: 1, title: 1 }).lean()
  const have = new Set(rows.map((r) => r.slug))
  return { rows: rows.map(teamDto), starterLeft: STARTER_HELP_ARTICLES.filter((s) => !have.has(s.slug)).length }
}

function cleanInput(input) {
  const slug = String(input.slug || input.title || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
  if (!slug) throw badRequest('Give the article a title.', { fields: { title: 'Give the article a title' } })
  if (input.module && !MODULE_IDS.has(input.module)) throw badRequest('Pick a module from the list.', { fields: { module: 'Unknown module' } })
  const translations = {}
  for (const [lang, t] of Object.entries(input.translations ?? {})) if (t?.title?.trim()) translations[lang] = { title: t.title.trim(), summary: t.summary?.trim() || undefined, body: t.body ?? '' }
  return {
    slug, title: input.title.trim(), summary: input.summary?.trim() || undefined, body: input.body ?? '', module: input.module || undefined,
    pages: (input.pages ?? []).filter((p) => PAGE_IDS.has(p)), translations, published: !!input.published, order: Number(input.order) || 100,
  }
}

export async function saveArticle(id, input, auth) {
  const data = { ...cleanInput(input), updatedBy: auth.user?.name }
  const clash = await HelpArticle.findOne({ slug: data.slug }).select('_id').lean()
  if (clash && String(clash._id) !== String(id ?? '')) throw conflict('Another article has this web name. Change the title or the web name.')
  const a = id ? await HelpArticle.findByIdAndUpdate(id, { $set: data }, { new: true }) : await HelpArticle.create(data)
  if (!a) throw notFound('Help article')
  return teamDto(a.toObject())
}

export async function deleteArticle(id) {
  const r = await HelpArticle.deleteOne({ _id: id })
  if (!r.deletedCount) throw notFound('Help article')
  return { ok: true }
}

/** Add the starter articles (written for this product) that are not there yet — unpublished, for the team to read first. */
export async function addStarterArticles(auth) {
  const have = new Set((await HelpArticle.find().select('slug').lean()).map((r) => r.slug))
  const add = STARTER_HELP_ARTICLES.filter((s) => !have.has(s.slug))
  if (add.length) await HelpArticle.insertMany(add.map((s, i) => ({ ...s, published: false, order: s.order ?? (i + 1) * 10, updatedBy: auth.user?.name })))
  return { added: add.length }
}
