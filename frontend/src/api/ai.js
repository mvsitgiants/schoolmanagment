import api, { apiUrl } from './client'
import { translateServerMessage } from '../i18n/serverMessage'

// AI assistant API (/api/v1/ai). Functions return the unwrapped `data`. The assistant's answer streams as
// server-sent events, read with fetch (axios can't stream a POST body back).
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data

const BASE = '/v1/ai'

/** Is AI set up here, and this month's use. */
export const fetchAiStatus = () => get(`${BASE}/status`)
export const fetchAiKey = () => get(`${BASE}/key`)
export const saveAiKey = (body) => put(`${BASE}/key`, body)

// question paper generator
export const fetchQpSetup = (examId) => get(`${BASE}/question-papers/setup`, { examId: examId || undefined })
export const fetchQpContext = (examPaperId) => get(`${BASE}/question-papers/papers/${examPaperId}`)
export const generateQuestions = (body) => post(`${BASE}/question-papers/generate`, body)
export const acceptQuestions = (body) => post(`${BASE}/question-papers/accept`, body)

// report card remarks
export const fetchRemarksSetup = (examId) => get(`${BASE}/remarks/setup`, { examId: examId || undefined })
export const fetchRemarkStudents = (examId, sectionId) => get(`${BASE}/remarks/students`, { examId, sectionId })
export const draftRemarks = (body) => post(`${BASE}/remarks/draft`, body)
export const saveAiRemarks = (body) => put(`${BASE}/remarks`, body)

/** An error from the server, shaped like the axios ones the screens already read (message, response.data.code). */
function streamError(status, body) {
  const message = translateServerMessage(body?.message) || body?.message || 'Something went wrong'
  const err = new Error(message)
  err.response = { status, data: { ...body, message } }
  return err
}

/**
 * Ask the assistant. `messages`: [{ role, content }] ending with the question. `on(event, data)` gets each event:
 * text { t } · tool { name, args, denied, failed } · refused · truncated · done { usage } · error { code, message }.
 * Resolves when the stream ends; `signal` stops it.
 */
export async function askAssistant(messages, on, { signal } = {}) {
  const send = () => fetch(apiUrl(`${BASE}/assistant/chat`), {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
  })
  let res = await send()
  if (res.status === 401) { // access token expired: refresh once (the axios client knows how), then again
    await api.post('/v1/auth/refresh')
    res = await send()
  }
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    throw streamError(res.status, body)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let cut
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const event = block.match(/^event: (.*)$/m)?.[1]
      const data = block.match(/^data: (.*)$/m)?.[1]
      if (!event) continue
      let parsed = null
      try { parsed = data ? JSON.parse(data) : null } catch { parsed = null }
      on(event, parsed)
    }
  }
}
