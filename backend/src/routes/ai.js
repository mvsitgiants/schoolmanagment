import { AI_MAX_QUESTIONS, AI_MAX_TURNS, BLOOM_LEVELS, DIFFICULTY, QUESTION_TYPES, REMARK_LENGTHS, REMARK_TONES } from '@schoolgiant/shared'
import { Router } from 'express'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { chat } from '../services/aiAssistant.js'
import { aiStatus, ensureConfigured, requireAi } from '../services/aiClient.js'
import { getConfig, maskConfig, saveConfig } from '../services/integrationsCommon.js'
import { accept, generate, paperContext, setup } from '../services/aiQuestionPapers.js'
import { draftRemarks, remarkStudents, remarksSetup, saveAllRemarks } from '../services/aiRemarks.js'

// AI assistant: /api/v1/ai/* — the assistant chat, the question paper generator and report card remarks.
// Without a key (services/aiClient.js) every route but /status answers 409 AI_UNAVAILABLE.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('ai'))

const VIEW_ANY = ['ai.assistant.view', 'ai.question-papers.view', 'ai.remarks.view']

/** Is AI set up here, and this month's use (the screens start with this). */
router.get('/status', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await aiStatus() })
})

// the institution's own Claude key (write-only: the screen sees whether it is set and its last 4) — before the
// "AI must be set up" gate below, since this is how it gets set up
router.get('/key', requirePermission('core.settings.edit', 'integrations.payments.configure'), async (req, res) => {
  res.json({ data: maskConfig(await getConfig('ANTHROPIC')) })
})
router.put('/key', requirePermission('core.settings.edit', 'integrations.payments.configure'), async (req, res) => {
  const body = z.object({ enabled: z.boolean().default(true), apiKey: z.string().trim().max(300).nullable().optional() }).parse(req.body)
  await saveConfig('ANTHROPIC', { enabled: body.enabled, secrets: body.apiKey === undefined ? {} : { apiKey: body.apiKey } }, req)
  res.json({ data: { key: maskConfig(await getConfig('ANTHROPIC')), status: await aiStatus() } })
})

router.use(async (req, res, next) => {
  await ensureConfigured()
  next()
})

// ───────────────────────────────────────────────────────── assistant (server-sent events)

const chatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(6000) })).min(1).max(AI_MAX_TURNS * 2)
    .refine((m) => m[0].role === 'user' && m.at(-1).role === 'user', 'Start and end with a question'),
})
router.post('/assistant/chat', requirePermission('ai.assistant.ask'), async (req, res) => {
  const body = chatSchema.parse(req.body)
  await requireAi() // a 409 / 429 answers as JSON, before the stream starts
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders?.()
  const ac = new AbortController()
  res.on('close', () => { if (!res.writableEnded) ac.abort() })
  const send = (event, data) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  try {
    await chat(body, req.auth, { send, signal: ac.signal })
  } catch (err) {
    send('error', { code: err?.code ?? 'AI_ERROR', message: err?.status && err.status < 500 ? err.message : 'The AI service could not answer. Try again.' })
  }
  res.end()
})

// ───────────────────────────────────────────────────────── question paper generator

router.get('/question-papers/setup', requirePermission('ai.question-papers.view'), async (req, res) => {
  res.json({ data: await setup({ examId: req.query.examId ? objectId.parse(req.query.examId) : undefined }, req.auth) })
})
router.get('/question-papers/papers/:examPaperId', requirePermission('ai.question-papers.view'), async (req, res) => {
  res.json({ data: await paperContext(objectId.parse(req.params.examPaperId), req.auth) })
})

const levels = Object.keys(DIFFICULTY)
const generateSchema = z.object({
  examPaperId: objectId,
  chapters: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  topics: optionalText(1500),
  rows: z.array(z.object({
    type: z.enum(Object.keys(QUESTION_TYPES)),
    count: z.coerce.number().int().min(1).max(AI_MAX_QUESTIONS),
    marks: z.coerce.number().min(0.25).max(100),
  })).min(1).max(6),
  mix: z.object(Object.fromEntries(levels.map((l) => [l, z.coerce.number().min(0).max(100).default(0)]))).default({ EASY: 30, MEDIUM: 50, HARD: 20 }),
  blooms: z.array(z.enum(BLOOM_LEVELS)).max(6).default([]),
})
router.post('/question-papers/generate', requirePermission('ai.question-papers.create'), async (req, res) => {
  res.json({ data: await generate(generateSchema.parse(req.body), req.auth) })
})

const draftQuestion = z.object({
  type: z.enum(Object.keys(QUESTION_TYPES)),
  text: z.string().trim().min(3, 'Write the question').max(5000),
  options: z.array(z.object({ text: z.string().trim().max(1000).default(''), correct: z.boolean().default(false) })).max(8).default([]),
  answers: z.array(z.string().trim().max(2000)).max(10).default([]),
  explanation: optionalText(3000),
  chapter: optionalText(120),
  difficulty: z.enum(levels).default('MEDIUM'),
  bloom: z.enum(BLOOM_LEVELS).optional().or(z.literal('').transform(() => undefined)),
  marks: z.coerce.number().min(0.25).max(100),
})
router.post('/question-papers/accept', requirePermission('ai.question-papers.create'), async (req, res) => {
  const body = z.object({ examPaperId: objectId, questions: z.array(draftQuestion).min(1).max(AI_MAX_QUESTIONS), sendToPaper: z.boolean().default(false) }).parse(req.body)
  res.status(201).json({ data: await accept(body, req.auth, req) })
})

// ───────────────────────────────────────────────────────── report card remarks

router.get('/remarks/setup', requirePermission('ai.remarks.view'), async (req, res) => {
  res.json({ data: await remarksSetup({ examId: req.query.examId ? objectId.parse(req.query.examId) : undefined }, req.auth) })
})
router.get('/remarks/students', requirePermission('ai.remarks.view'), async (req, res) => {
  const q = z.object({ examId: objectId, sectionId: objectId }).parse(req.query)
  res.json({ data: await remarkStudents(q, req.auth) })
})
router.post('/remarks/draft', requirePermission('ai.remarks.create'), async (req, res) => {
  const body = z.object({
    examId: objectId, sectionId: objectId,
    tone: z.enum(REMARK_TONES).default('WARM'), length: z.enum(REMARK_LENGTHS).default('SHORT'), includeRank: z.boolean().default(false),
    note: optionalText(300), candidateIds: z.array(objectId).max(300).optional(),
  }).parse(req.body)
  res.json({ data: await draftRemarks(body, req.auth) })
})
router.put('/remarks', requirePermission('ai.remarks.create'), async (req, res) => {
  const body = z.object({
    examId: objectId, sectionId: objectId,
    remarks: z.array(z.object({ candidateId: objectId, remark: optionalText(300) })).min(1).max(300),
  }).parse(req.body)
  res.json({ data: await saveAllRemarks(body, req.auth, req) })
})

export default router
