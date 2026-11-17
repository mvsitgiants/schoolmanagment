import { Router } from 'express'
import { LOCAL_NAME_KINDS, LOCAL_SUGGEST_BATCH, LOCAL_TEXT_MAX } from '@schoolgiant/shared'
import { requirePermission } from '../../platform/middleware.js'
import { objectId, z } from '../../platform/validate.js'
import { can } from '../../platform/access.js'
import { forbidden } from '../../platform/errors.js'
import { exportLocalNames, importLocalNames, listLocalNames, lookupLocalNames, saveLocalNames, suggestLocalNames } from '../../services/localNames.js'

// Names in other languages: /api/v1/core/local-names/:lang/*
const router = Router()
const kinds = LOCAL_NAME_KINDS.map((k) => k.value)
const lang = z.string().trim().regex(/^[a-z]{2,3}$/, 'Pick a language')
const text = z.string().trim().max(LOCAL_TEXT_MAX)

router.get('/local-names/:lang', requirePermission('core.local-names.view'), async (req, res) => {
  const q = z.object({
    kind: z.enum(kinds), branchId: objectId.optional(), q: z.string().trim().max(100).optional(),
    missing: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  }).parse(req.query)
  res.json({ data: await listLocalNames({ ...q, lang: lang.parse(req.params.lang) }) })
})

router.put('/local-names/:lang', requirePermission('core.local-names.edit'), async (req, res) => {
  const body = z.object({
    kind: z.enum(kinds).default('phrases'),
    entries: z.array(z.object({ english: text.min(1), value: text.default(''), suggested: z.boolean().optional() })).min(1).max(5000),
  }).parse(req.body)
  res.json({ data: await saveLocalNames({ ...body, lang: lang.parse(req.params.lang) }, req.auth, req) })
})

router.get('/local-names/:lang/export', requirePermission('core.local-names.export'), async (req, res) => {
  const q = z.object({ kind: z.enum([...kinds, 'all']).default('all'), branchId: objectId.optional() }).parse(req.query)
  const code = lang.parse(req.params.lang)
  res.type('text/csv').attachment(`names-${code}-${q.kind}.csv`).send(`﻿${await exportLocalNames({ ...q, lang: code })}`)
})

router.post('/local-names/:lang/import', requirePermission('core.local-names.import'), async (req, res) => {
  const body = z.object({
    kind: z.enum(kinds).default('phrases'),
    rows: z.array(z.object({ english: z.string().default(''), value: z.string().default('') })).max(20_000),
    dryRun: z.boolean().default(true),
  }).parse(req.body)
  res.json({ data: await importLocalNames({ ...body, lang: lang.parse(req.params.lang) }, req.auth, req) })
})

/** AI drafts for texts still missing, for staff to check before saving. */
router.post('/local-names/:lang/suggest', requirePermission('core.local-names.edit'), async (req, res) => {
  const body = z.object({ kind: z.enum(kinds), texts: z.array(text.min(1)).min(1).max(LOCAL_SUGGEST_BATCH) }).parse(req.body)
  res.json({ data: await suggestLocalNames({ ...body, lang: lang.parse(req.params.lang) }, req.auth) })
})

// ── From the record forms: a student's, a subject's … name in the language, saved with the record. Each kind needs the
// permissions of its own records (the admissions desk names a new student without the Administration page).
const KIND_PERMS = {
  students: { view: ['students.directory.view', 'students.profile.view', 'students.admit.create'], edit: ['students.admit.create', 'students.profile.edit'] },
  parents: { view: ['students.directory.view', 'students.profile.view', 'students.guardians.view', 'students.admit.create'], edit: ['students.admit.create', 'students.profile.edit', 'students.guardians.edit'] },
  staff: { view: ['hrms.employees.view'], edit: ['hrms.employees.create', 'hrms.employees.edit'] },
  school: { view: ['core.profile.view', 'core.branches.view'], edit: ['core.profile.edit', 'core.branches.edit'] },
  classes: { view: ['academics.classes.view'], edit: ['academics.classes.create', 'academics.classes.edit'] },
  subjects: { view: ['academics.subjects.view'], edit: ['academics.subjects.create', 'academics.subjects.edit'] },
  exams: { view: ['exams.schedule.view'], edit: ['exams.schedule.create', 'exams.schedule.edit', 'exams.setup.edit'] },
  fees: { view: ['fees.structures.view'], edit: ['fees.structures.create', 'fees.structures.edit'] },
  phrases: { view: ['core.local-names.view'], edit: ['core.local-names.edit'] },
}
const allowed = (auth, kind, mode) => [...KIND_PERMS[kind][mode], `core.local-names.${mode}`].some((p) => can(auth, p))

/** The saved text in the language for each English text given: { english: local }. */
router.post('/local-names/:lang/lookup', async (req, res) => {
  const body = z.object({ kind: z.enum(kinds), texts: z.array(text).max(200) }).parse(req.body)
  if (!allowed(req.auth, body.kind, 'view')) throw forbidden()
  res.json({ data: await lookupLocalNames({ lang: lang.parse(req.params.lang), texts: body.texts }) })
})

/** Save names typed on a record's form: [{ english, value }] (an empty value removes it). */
router.put('/local-names/:lang/record', async (req, res) => {
  const body = z.object({ kind: z.enum(kinds), entries: z.array(z.object({ english: text.min(1), value: text.default('') })).min(1).max(50) }).parse(req.body)
  if (!allowed(req.auth, body.kind, 'edit')) throw forbidden()
  res.json({ data: await saveLocalNames({ ...body, lang: lang.parse(req.params.lang) }, req.auth, req) })
})

export default router
