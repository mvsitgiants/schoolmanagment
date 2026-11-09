import axios from 'axios'
import api, { API_BASE_URL, SERVER_DOWN_MESSAGE, isServerDown } from './client'

// Surveys & feedback API (/api/v1/surveys) and the public survey link. Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/surveys'

export const fetchQuestionnaires = () => get(`${BASE}/questionnaires`)
export const fetchSurveys = () => get(BASE)
export const fetchSurvey = (id) => get(`${BASE}/${id}`)
export const saveSurvey = (id, body) => (id ? patch(`${BASE}/${id}`, body) : post(BASE, body))
export const deleteSurvey = (id) => del(`${BASE}/${id}`)
export const publishSurvey = (id, notify) => post(`${BASE}/${id}/publish`, { notify })
export const remindSurvey = (id) => post(`${BASE}/${id}/remind`)
export const closeSurvey = (id, closed) => post(`${BASE}/${id}/close`, { closed })
export const fetchSurveyResults = (id, sectionId) => get(`${BASE}/${id}/results`, { sectionId: sectionId || undefined })
export async function downloadSurveyCsv(id, name) {
  const res = await api.get(`${BASE}/${id}/responses.csv`, { responseType: 'blob' })
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}

// staff filling a survey
export const fetchMySurveys = () => get(`${BASE}/mine`)
export const fetchMySurvey = (id) => get(`${BASE}/mine/${id}`)
export const answerMySurvey = (id, values) => post(`${BASE}/mine/${id}/respond`, { values })

// ───────────────────────────────────────────────────────── the public link (no sign-in)
const open = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } })
open.interceptors.response.use((r) => r, (err) => Promise.reject(Object.assign(err, {
  message: isServerDown(err) ? SERVER_DOWN_MESSAGE : err?.response?.data?.message || err.message || 'Something went wrong',
  status: err?.response?.status,
  fields: err?.response?.data?.details?.fields,
})))
const pub = (slug, token) => `/v1/public/surveys/${encodeURIComponent(String(slug).toLowerCase())}/${encodeURIComponent(token)}`
export const fetchPublicSurvey = async (slug, token) => (await open.get(pub(slug, token))).data.data
export const answerPublicSurvey = async (slug, token, body) => (await open.post(pub(slug, token), body)).data.data
