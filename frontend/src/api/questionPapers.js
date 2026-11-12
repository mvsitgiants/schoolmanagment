import api from './client'

// Exams › Question papers API (/api/v1/exams/question-papers). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/exams/question-papers'

export const fetchPaperBoard = (examId) => get(`${BASE}/board`, { examId: examId || undefined })
export const fetchQuestionPaper = (id) => get(`${BASE}/${id}`)
export const startQuestionPaper = (examPaperId) => post(BASE, { examPaperId })
export const deleteQuestionPaper = (id) => del(`${BASE}/${id}`)

export const saveBlueprint = (id, body) => put(`${BASE}/${id}/blueprint`, body)
export const makeSets = (id, body) => post(`${BASE}/${id}/sets`, body)
export const saveSetQuestions = (id, setId, sections) => put(`${BASE}/${id}/sets/${setId}/questions`, { sections })
export const autoPickSet = (id, setId, body) => post(`${BASE}/${id}/sets/${setId}/auto-pick`, body ?? {})
export const replaceQuestion = (id, setId, body) => post(`${BASE}/${id}/sets/${setId}/replace`, body)
export const addFromBank = (id, setId, body) => post(`${BASE}/${id}/sets/${setId}/add`, body)
export const writeQuestion = (id, setId, body) => post(`${BASE}/${id}/sets/${setId}/write`, body)
export const fetchPaperBank = (id, params) => get(`${BASE}/${id}/bank`, params)
/** "Add from syllabus": the exam questions kept on the class + subject's syllabus topics (units → topics → questions). */
export const fetchPaperSyllabus = (id, params) => get(`${BASE}/${id}/syllabus`, params)
export const addFromSyllabus = (id, setId, body) => post(`${BASE}/${id}/sets/${setId}/add-syllabus`, body)

export const submitQuestionPaper = (id, note) => post(`${BASE}/${id}/submit`, { note })
export const recallQuestionPaper = (id) => post(`${BASE}/${id}/recall`)
export const approveQuestionPaper = (id, note) => post(`${BASE}/${id}/approve`, { note })
export const sendBackQuestionPaper = (id, note) => post(`${BASE}/${id}/send-back`, { note })
export const unlockQuestionPaper = (id, reason) => post(`${BASE}/${id}/unlock`, { reason })
