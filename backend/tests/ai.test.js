import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pctChange, splitByMix } from '@schoolgiant/shared'
import { AiUsage } from '../src/models/ai.js'
import { Question } from '../src/models/lms.js'
import { runAsTenant } from '../src/platform/context.js'
import { setAiDriver } from '../src/services/aiClient.js'
import { runTool } from '../src/services/aiTools.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// The AI module never calls out in tests: with no driver it is "not set up" (409); with the driver below the
// model's answers are canned and every request it got is kept in `calls` for the assertions.

let app
let h
let admin
let cls
let section
let exam
let english
let examPaper
let aarav
let diya
const calls = []

const msg = (content, extra = {}) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'test-model', content, stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 80 }, ...extra })
const text = (t) => ({ type: 'text', text: t })

function reply(feature, params) {
  if (feature === 'QUESTION_PAPERS') {
    return msg([text(JSON.stringify({ questions: [
      { type: 'MCQ', text: 'Which is a noun?', options: [{ text: 'Run', correct: false }, { text: 'Table', correct: true }, { text: 'Quickly', correct: false }, { text: 'Blue', correct: false }], answers: [], explanation: 'A table is a thing.', chapter: 'Grammar', difficulty: 'EASY', bloom: 'REMEMBER' },
      { type: 'MCQ', text: 'Pick the verb.', options: [{ text: 'Sing', correct: true }, { text: 'Song', correct: false }, { text: 'Singer', correct: false }, { text: 'Sung', correct: false }], answers: [], explanation: 'Sing is an action.', chapter: 'Grammar', difficulty: 'MEDIUM', bloom: 'UNDERSTAND' },
      { type: 'SHORT', text: 'What is a metaphor? Give an example.', options: [], answers: ['A comparison without like or as, e.g. "Time is a thief".'], explanation: 'Definition 1, example 1', chapter: 'Poetry', difficulty: 'HARD', bloom: 'APPLY' },
    ] }))])
  }
  if (feature === 'REMARKS') {
    const facts = JSON.parse(params.messages[0].content.split('\n\n').at(-1))
    return msg([text(JSON.stringify({ remarks: facts.map((f) => ({ ref: f.ref, remark: `${f.firstName} works steadily; keep revising every day.` })) }))])
  }
  // ASSISTANT: look the student up first, then answer from the tool result
  const last = params.messages.at(-1)
  if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
    const found = JSON.parse(last.content[0].content)
    return msg([text(`I found ${found.matches.length} student: ${found.matches[0].name} in ${found.matches[0].class}.`)])
  }
  return msg([text('Let me look.'), { type: 'tool_use', id: 'toolu_1', name: 'student_lookup', input: { name: 'Aarav' } }], { stop_reason: 'tool_use' })
}

/** Read a server-sent-events body into [{ event, data }]. */
const sse = (res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c }); res.on('end', () => cb(null, d)) }
const events = (body) => String(body).split('\n\n').filter(Boolean).map((block) => {
  const ev = block.match(/^event: (.*)$/m)?.[1]
  const data = block.match(/^data: (.*)$/m)?.[1]
  return { event: ev, data: data ? JSON.parse(data) : null }
})

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.AI_MONTHLY_TOKEN_CAP
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  const add = async (firstName, rollNo, mobile) => (await admin.post('/api/v1/students').send({ firstName, rollNo, sectionId: section.id, gender: firstName === 'Diya' ? 'FEMALE' : 'MALE', guardians: [{ name: `Parent ${firstName}`, mobile }] })).body.data
  aarav = await add('Aarav', '1', '9845000041')
  diya = await add('Diya', '2', '9845000042')
  const types = (await admin.get('/api/v1/exams/types')).body.data
  exam = (await admin.post('/api/v1/exams').send({ name: 'Half-yearly', examTypeId: types.find((t) => t.code === 'HY').id, classIds: [cls.id] })).body.data
  english = (await admin.get(`/api/v1/exams/${exam.id}/classes/${cls.id}/suggest`)).body.data.find((s) => s.subject === 'English')
  const saved = (await admin.put(`/api/v1/exams/${exam.id}/classes/${cls.id}/papers`).send({ papers: [
    { subjectId: english.subjectId, date: data.year.startDate, startTime: '09:00', endTime: '12:00', maxMarks: 80, passMarks: 27 },
  ] })).body.data
  examPaper = saved.classes[0].papers[0]
})
afterAll(async () => {
  setAiDriver(null)
  await stopDb()
})

describe('helpers', () => {
  it('splits a count by the difficulty mix and measures change', () => {
    expect(splitByMix(10, { EASY: 30, MEDIUM: 50, HARD: 20 })).toEqual({ EASY: 3, MEDIUM: 5, HARD: 2 })
    expect(splitByMix(3, { EASY: 1, MEDIUM: 1, HARD: 1 })).toEqual({ EASY: 1, MEDIUM: 1, HARD: 1 })
    expect(Object.values(splitByMix(7, { EASY: 33, MEDIUM: 33, HARD: 34 })).reduce((a, b) => a + b)).toBe(7)
    expect(pctChange(62.5, 70)).toBe(7.5)
    expect(pctChange(null, 70)).toBeNull()
  })
})

describe('without a key', () => {
  it('the status says not set up; every AI route answers 409 AI_UNAVAILABLE', async () => {
    const st = (await admin.get('/api/v1/ai/status').expect(200)).body.data
    expect(st).toMatchObject({ configured: false, source: null, models: { main: 'claude-sonnet-5-5', bulk: 'claude-haiku-5-5' } })
    for (const [method, url, body] of [
      ['get', '/api/v1/ai/question-papers/setup'],
      ['post', '/api/v1/ai/question-papers/generate', { examPaperId: examPaper.id, rows: [{ type: 'MCQ', count: 2, marks: 1 }] }],
      ['get', '/api/v1/ai/remarks/setup'],
      ['post', '/api/v1/ai/assistant/chat', { messages: [{ role: 'user', content: 'Hello' }] }],
    ]) {
      const res = await admin[method](url).send(body)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('AI_UNAVAILABLE')
    }
  })
})

describe('with the model (canned)', () => {
  beforeAll(() => setAiDriver({ create: async (params, { feature }) => { calls.push({ feature, params }); return reply(feature, params) } }))

  it('the status shows it is set up', async () => {
    const st = (await admin.get('/api/v1/ai/status')).body.data
    expect(st).toMatchObject({ configured: true, source: 'TEST' })
  })

  it('question papers: lists the exam papers, drafts questions with Sonnet (JSON schema), checks them', async () => {
    const s = (await admin.get(`/api/v1/ai/question-papers/setup?examId=${exam.id}`)).body.data
    expect(s.rows.map((r) => r.examPaperId)).toContain(examPaper.id)
    const ctx = (await admin.get(`/api/v1/ai/question-papers/papers/${examPaper.id}`)).body.data
    expect(ctx).toMatchObject({ subject: 'English', maxMarks: 80, paper: null })
    const res = await admin.post('/api/v1/ai/question-papers/generate').send({
      examPaperId: examPaper.id, chapters: ['Grammar', 'Poetry'], rows: [{ type: 'MCQ', count: 2, marks: 1 }, { type: 'SHORT', count: 1, marks: 3 }], mix: { EASY: 40, MEDIUM: 40, HARD: 20 },
    }).expect(200)
    const { drafts } = res.body.data
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toMatchObject({ type: 'MCQ', marks: 1, chapter: 'Grammar', difficulty: 'EASY', problems: {} })
    expect(drafts[2]).toMatchObject({ type: 'SHORT', marks: 3, options: [] })
    const call = calls.find((c) => c.feature === 'QUESTION_PAPERS').params
    expect(call.model).toBe('claude-sonnet-5-5')
    expect(call.output_config.format.type).toBe('json_schema')
    expect(call.messages[0].content).toContain('English')
  })

  it('accepting saves to the question bank tagged ai and fills the draft question paper', async () => {
    const qp = (await admin.post('/api/v1/exams/question-papers').send({ examPaperId: examPaper.id }).expect(201)).body.data
    const questions = [
      { type: 'MCQ', text: 'Which is a noun?', options: [{ text: 'Run' }, { text: 'Table', correct: true }, { text: 'Quickly' }, { text: 'Blue' }], marks: 1, difficulty: 'EASY', chapter: 'Grammar', bloom: 'REMEMBER' },
      { type: 'SHORT', text: 'What is a metaphor?', answers: ['A comparison without like or as.'], marks: 2, difficulty: 'HARD', chapter: 'Poetry' },
    ]
    const bad = await admin.post('/api/v1/ai/question-papers/accept').send({ examPaperId: examPaper.id, questions: [{ ...questions[0], options: [{ text: 'Only one' }] }] })
    expect(bad.status).toBe(400)
    const out = (await admin.post('/api/v1/ai/question-papers/accept').send({ examPaperId: examPaper.id, questions, sendToPaper: true }).expect(201)).body.data
    expect(out.saved).toBe(2)
    expect(out.paper).toMatchObject({ id: qp.id, added: 2, skipped: 0 })
    const bank = await runAsTenant(h.tenant._id, () => Question.find({ _id: { $in: out.questionIds } }).lean())
    expect(bank.every((q) => q.tags.includes('ai') && String(q.classId) === cls.id)).toBe(true)
    const paper = (await admin.get(`/api/v1/exams/question-papers/${qp.id}`)).body.data
    const items = paper.sets[0].sections.flatMap((s) => s.items)
    expect(items.map((i) => i.text)).toEqual(expect.arrayContaining(['Which is a noun?', 'What is a metaphor?']))
  })

  it('remarks: facts per student, drafts with Haiku in a batch (no contact details sent), saves through Exams', async () => {
    await admin.post(`/api/v1/exams/${exam.id}/schedule`).expect(200)
    await admin.put(`/api/v1/exams/marks/${examPaper.id}/${section.id}`).send({ entries: [{ studentId: aarav.id, marks: 72 }, { studentId: diya.id, marks: 30 }] }).expect(200)
    const setup = (await admin.get(`/api/v1/ai/remarks/setup?examId=${exam.id}`)).body.data
    expect(setup.sections.map((s) => s.id)).toContain(section.id)
    const st = (await admin.get(`/api/v1/ai/remarks/students?examId=${exam.id}&sectionId=${section.id}`)).body.data
    const a = st.rows.find((r) => r.firstName === 'Aarav')
    expect(a).toMatchObject({ pct: 90, result: 'PASS', subjects: [{ subject: 'English', pct: 90 }] })
    const drafts = (await admin.post('/api/v1/ai/remarks/draft').send({ examId: exam.id, sectionId: section.id, tone: 'FORMAL', length: 'SHORT' }).expect(200)).body.data.drafts
    expect(drafts).toHaveLength(2)
    expect(drafts.find((d) => d.candidateId === a.candidateId).remark).toMatch(/^Aarav works steadily/)
    const call = calls.filter((c) => c.feature === 'REMARKS').at(-1).params
    expect(call.model).toBe('claude-haiku-5-5')
    expect(call.messages[0].content).toContain('formal')
    expect(call.messages[0].content).not.toMatch(/9845000041|Parent Aarav|admission/i)
    // one row again
    const one = (await admin.post('/api/v1/ai/remarks/draft').send({ examId: exam.id, sectionId: section.id, candidateIds: [a.candidateId] })).body.data.drafts
    expect(one).toHaveLength(1)
    const saved = (await admin.put('/api/v1/ai/remarks').send({ examId: exam.id, sectionId: section.id, remarks: drafts }).expect(200)).body.data
    expect(saved.find((c) => c.name === 'Aarav').remark).toMatch(/^Aarav works steadily/)
  })

  it('assistant: streams, calls a tool with the user’s access, shows the call, answers from the result', async () => {
    const res = await admin.post('/api/v1/ai/assistant/chat').send({ messages: [{ role: 'user', content: 'Which class is Aarav in?' }] }).buffer(true).parse(sse).expect(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    const ev = events(res.body)
    expect(ev.find((e) => e.event === 'tool')).toMatchObject({ data: { name: 'student_lookup', args: { name: 'Aarav' }, denied: false } })
    const answer = ev.filter((e) => e.event === 'text').map((e) => e.data.t).join('')
    expect(answer).toContain('Aarav in 11-')
    expect(ev.at(-1).event).toBe('done')
    const second = calls.filter((c) => c.feature === 'ASSISTANT').at(-1).params
    const toolResult = second.messages.at(-1).content[0].content
    expect(toolResult).toContain('Aarav')
    expect(toolResult).not.toContain('9845000041')
    expect(second.tools.map((t) => t.name)).toEqual(['attendance_summary', 'fee_dues', 'exam_results', 'student_lookup', 'staff_on_leave', 'upcoming_events', 'timetable_today'])
    expect(second.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('a tool the role can’t use answers not_allowed', async () => {
    const auth = { tenantId: String(h.tenant._id), userId: String(h.user._id), user: { name: 'Teacher' }, permissions: ['ai.assistant.ask'], enabledModules: ['fees', 'students', 'ai'], dataScopes: { default: 'ALL' } }
    const r = await runAsTenant(h.tenant._id, () => runTool('fee_dues', {}, auth))
    expect(r).toMatchObject({ denied: true, result: { error: 'not_allowed' } })
    const off = await runAsTenant(h.tenant._id, () => runTool('staff_on_leave', {}, auth))
    expect(off.result.error).toBe('module_off')
    const invalid = await runAsTenant(h.tenant._id, () => runTool('staff_on_leave', { date: 'tomorrow' }, auth))
    expect(invalid).toMatchObject({ isError: true, result: { error: 'invalid_input' } })
  })

  it('usage is logged per institution and shown this month; a monthly cap stops further calls', async () => {
    const st = (await admin.get('/api/v1/ai/status')).body.data
    expect(st.usage.calls).toBeGreaterThanOrEqual(5)
    expect(st.usage.byFeature).toHaveProperty('QUESTION_PAPERS')
    expect(st.usage.byFeature).toHaveProperty('REMARKS')
    expect(st.usage.byFeature.ASSISTANT.calls).toBe(2)
    const rows = await runAsTenant(h.tenant._id, () => AiUsage.find().lean())
    expect(rows.every((r) => r.userName === 'Admin 1' || r.userName)).toBe(true)
    process.env.AI_MONTHLY_TOKEN_CAP = '100'
    try {
      const res = await admin.post('/api/v1/ai/remarks/draft').send({ examId: exam.id, sectionId: section.id })
      expect(res.status).toBe(429)
      expect(res.body.code).toBe('AI_CAP_REACHED')
    } finally {
      delete process.env.AI_MONTHLY_TOKEN_CAP
    }
  })

  it('another institution sees none of this one’s usage', async () => {
    const other = await newInstitution('GROWTH')
    const agent = await signIn(app, other.email, other.password)
    const st = (await agent.get('/api/v1/ai/status')).body.data
    expect(st.usage.calls).toBe(0)
  })
})
