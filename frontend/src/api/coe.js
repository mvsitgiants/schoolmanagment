import api from './client'

// Exam controller API (/api/v1/coe). Every function returns the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data

const BASE = '/v1/coe'

export const fetchCoeLookup = () => get(`${BASE}/lookup`)

// sessions
export const fetchSessions = () => get(`${BASE}/sessions`)
export const fetchSessionBoard = (id) => get(`${BASE}/sessions/${id}`)
export const createSession = (body) => post(`${BASE}/sessions`, body)
export const updateSession = (id, body) => patch(`${BASE}/sessions/${id}`, body)
export const prepareSheets = (id) => post(`${BASE}/sessions/${id}/prepare`)
export const computeResults = (id) => post(`${BASE}/sessions/${id}/compute`)
export const publishResults = (id) => post(`${BASE}/sessions/${id}/publish`)

// mark sheets
export const fetchSheet = (id, reveal) => get(`${BASE}/sheets/${id}`, { reveal: reveal ? '1' : undefined })
export const saveSheet = (id, entries) => put(`${BASE}/sheets/${id}`, { entries })
export const lockSheet = (id) => post(`${BASE}/sheets/${id}/lock`)
export const unlockSheet = (id, reason) => post(`${BASE}/sheets/${id}/unlock`, { reason })
export const proposeModeration = (id, body) => post(`${BASE}/sheets/${id}/moderation`, body)
export const decideModeration = (id, approve) => post(`${BASE}/sheets/${id}/moderation/decide`, { approve })

// results
export const fetchSessionResults = (id, params) => get(`${BASE}/sessions/${id}/results`, params)
export const fetchResult = (id) => get(`${BASE}/results/${id}`)

// revaluation
export const fetchRevaluations = (params) => get(`${BASE}/revaluations`, params)
export const fetchRevaluationCandidates = (sessionId, search) => get(`${BASE}/revaluations/candidates`, { sessionId, search: search || undefined })
export const requestRevaluation = (body) => post(`${BASE}/revaluations`, body)
export const actOnRevaluation = (id, body) => post(`${BASE}/revaluations/${id}/act`, body)
