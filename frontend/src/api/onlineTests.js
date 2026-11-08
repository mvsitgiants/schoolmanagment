import api from './client'

// Online tests API (/api/v1/online-tests). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/online-tests'

export const fetchTests = (params) => get(`${BASE}/tests`, params)
export const fetchTest = (id) => get(`${BASE}/tests/${id}`)
export const createTest = (body) => post(`${BASE}/tests`, body)
export const updateTest = (id, body) => patch(`${BASE}/tests/${id}`, body)
export const deleteTest = (id) => del(`${BASE}/tests/${id}`)
export const addTestQuestions = (id, questionIds) => post(`${BASE}/tests/${id}/questions`, { questionIds })
export const pickTestQuestions = (id, body) => post(`${BASE}/tests/${id}/questions/pick`, body)
export const setTestQuestions = (id, items) => put(`${BASE}/tests/${id}/questions`, { items })
export const publishTest = (id, notify) => post(`${BASE}/tests/${id}/publish`, { notify })
export const closeTest = (id) => post(`${BASE}/tests/${id}/close`)
export const releaseResults = (id) => post(`${BASE}/tests/${id}/release`)
export const fetchTestAttempts = (id) => get(`${BASE}/tests/${id}/attempts`)
export const fetchAttempt = (id) => get(`${BASE}/attempts/${id}`)
export const evaluateAttempt = (id, body) => post(`${BASE}/attempts/${id}/evaluate`, body)
/** The results as CSV. */
export async function downloadResults(id) {
  const res = await api.get(`${BASE}/tests/${id}/attempts/export`, { responseType: 'blob' })
  const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? 'results.csv'
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}
