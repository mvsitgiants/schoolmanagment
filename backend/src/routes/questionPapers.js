import { Router } from 'express'
import { BLOOM_LEVELS, QP_SET_LETTERS, QP_SET_MODES, QUESTION_TYPES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  addFromBank, approvePaper, autoPickSet, bankList, board, createPaper, deletePaper, getPaper, makeSets, recallPaper, replaceQuestion,
  saveBlueprint, saveQuestions, sendBackPaper, submitPaper, unlockPaper, writeQuestion,
} from '../services/questionPapers.js'

// Exams › Question papers: /api/v1/exams/question-papers/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('exams'))

const P = (action) => `exams.question-papers.${action}`
const CHANGE = [P('edit'), P('create')]
const id = (req) => objectId.parse(req.params.id)
const setId = (req) => objectId.parse(req.params.setId)
const blankToUndefined = (schema) => schema.optional().or(z.literal('').transform(() => undefined)).or(z.null().transform(() => undefined))

const question = z.object({
  questionId: blankToUndefined(objectId),
  type: z.string().optional(), // always the section's type
  text: z.string().trim().max(5000),
  options: z.array(z.object({ text: z.string().trim().max(1000).default(''), correct: z.boolean().optional() })).max(8).optional(),
  answers: z.array(z.string().trim().max(5000)).max(10).optional(),
  explanation: optionalText(5000),
  chapter: optionalText(120),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  bloom: blankToUndefined(z.enum(BLOOM_LEVELS)),
})
const item = question.extend({ or: question.nullable().optional() })
const slot = { index: z.coerce.number().int().min(0).max(99).optional(), part: z.enum(['main', 'or']).optional() }

router.get('/board', requirePermission(P('view')), async (req, res) => {
  const q = z.object({ examId: objectId.optional(), yearId: objectId.optional() }).parse(req.query)
  res.json({ data: await board(q, req.auth) })
})
router.post('/', requirePermission(P('create')), async (req, res) => {
  res.status(201).json({ data: await createPaper(z.object({ examPaperId: objectId }).parse(req.body), req.auth, req) })
})
router.get('/:id', requirePermission(P('view')), async (req, res) => {
  res.json({ data: await getPaper(id(req), req.auth) })
})
router.delete('/:id', requirePermission(P('delete')), async (req, res) => {
  res.json({ data: await deletePaper(id(req), req.auth, req) })
})

router.put('/:id/blueprint', requirePermission(...CHANGE), async (req, res) => {
  const body = z.object({
    durationMin: z.coerce.number().int().min(0).max(600).optional().nullable().transform((v) => v || undefined),
    maxMarks: z.coerce.number().min(1).max(1000),
    instructions: optionalText(4000),
    sections: z.array(z.object({
      id: blankToUndefined(objectId),
      title: z.string().trim().min(1, 'Name the section').max(80),
      instructions: optionalText(1000),
      type: z.enum(Object.keys(QUESTION_TYPES)),
      count: z.coerce.number().int().min(1, 'At least one question').max(100),
      marks: z.coerce.number().min(0.5, 'Give each question marks').max(100),
      attempt: z.coerce.number().int().min(0).max(100).optional().nullable().transform((v) => v || undefined),
      choice: z.boolean().optional(),
    })).min(1, 'Add at least one section').max(12),
    chapters: z.array(z.object({ chapter: z.string().trim().max(120), weight: z.coerce.number().min(0).max(100) })).max(40).optional(),
    difficulty: z.object({ EASY: z.coerce.number().min(0).max(100), MEDIUM: z.coerce.number().min(0).max(100), HARD: z.coerce.number().min(0).max(100) }).partial().optional(),
  }).parse(req.body)
  res.json({ data: await saveBlueprint(id(req), body, req.auth, req) })
})

router.post('/:id/sets', requirePermission(...CHANGE), async (req, res) => {
  const body = z.object({
    count: z.coerce.number().int().min(1).max(QP_SET_LETTERS.length),
    mode: z.enum(Object.keys(QP_SET_MODES)),
    shuffleOptions: z.boolean().optional(),
  }).parse(req.body)
  res.json({ data: await makeSets(id(req), body, req.auth, req) })
})
router.put('/:id/sets/:setId/questions', requirePermission(...CHANGE), async (req, res) => {
  const body = z.object({ sections: z.array(z.object({ sectionId: objectId, items: z.array(item).max(100) })).max(12) }).parse(req.body)
  res.json({ data: await saveQuestions(id(req), setId(req), body, req.auth, req) })
})
router.post('/:id/sets/:setId/auto-pick', requirePermission(...CHANGE), async (req, res) => {
  const body = z.object({ sectionId: objectId.optional(), refill: z.boolean().optional(), seed: z.string().max(80).optional() }).parse(req.body ?? {})
  res.json({ data: await autoPickSet(id(req), setId(req), body, req.auth, req) })
})
router.post('/:id/sets/:setId/replace', requirePermission(...CHANGE), async (req, res) => {
  const body = z.object({ sectionId: objectId, index: z.coerce.number().int().min(0).max(99), part: z.enum(['main', 'or']).optional() }).parse(req.body)
  res.json({ data: await replaceQuestion(id(req), setId(req), body, req.auth, req) })
})
router.post('/:id/sets/:setId/add', requirePermission(...CHANGE), async (req, res) => {
  const body = z.object({ sectionId: objectId, questionIds: z.array(objectId).min(1).max(100), ...slot }).parse(req.body)
  res.json({ data: await addFromBank(id(req), setId(req), body, req.auth, req) })
})
router.post('/:id/sets/:setId/write', requirePermission(...CHANGE), async (req, res) => {
  const body = z.object({ sectionId: objectId, question, saveToBank: z.boolean().optional(), ...slot }).parse(req.body)
  res.json({ data: await writeQuestion(id(req), setId(req), body, req.auth, req) })
})
router.get('/:id/bank', requirePermission(P('view')), async (req, res) => {
  const q = z.object({
    sectionId: objectId.optional(), type: z.string().max(20).optional(), chapter: z.string().max(120).optional(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(), bloom: z.enum(BLOOM_LEVELS).optional(), search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(50).optional(),
  }).parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')))
  res.json({ data: await bankList(id(req), q, req.auth) })
})

// ───────────────────────────────────────────────────────── workflow

const note = z.object({ note: optionalText(500) })
router.post('/:id/submit', requirePermission(...CHANGE), async (req, res) => {
  res.json({ data: await submitPaper(id(req), note.parse(req.body ?? {}), req.auth, req) })
})
router.post('/:id/recall', requirePermission(...CHANGE), async (req, res) => {
  res.json({ data: await recallPaper(id(req), req.auth, req) })
})
router.post('/:id/approve', requirePermission(P('approve')), async (req, res) => {
  res.json({ data: await approvePaper(id(req), note.parse(req.body ?? {}), req.auth, req) })
})
router.post('/:id/send-back', requirePermission(P('approve')), async (req, res) => {
  const body = z.object({ note: z.string().trim().min(3, 'Say what to change').max(500) }).parse(req.body ?? {})
  res.json({ data: await sendBackPaper(id(req), body, req.auth, req) })
})
router.post('/:id/unlock', requirePermission(P('approve')), async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(3, 'Say why').max(500) }).parse(req.body ?? {})
  res.json({ data: await unlockPaper(id(req), body, req.auth, req) })
})

export default router
