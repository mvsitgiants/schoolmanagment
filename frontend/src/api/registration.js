import api from './client'

// Semester registration API (/api/v1/registration). Every function returns the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data

const BASE = '/v1/registration'

export const fetchRegistrationLookup = () => get(`${BASE}/lookup`)
export const fetchWindows = (params) => get(`${BASE}/windows`, params)
export const fetchWindow = (id) => get(`${BASE}/windows/${id}`)
export const createWindow = (body) => post(`${BASE}/windows`, body)
export const updateWindow = (id, body) => patch(`${BASE}/windows/${id}`, body)
export const fetchRosters = (id) => get(`${BASE}/windows/${id}/rosters`)
export const fetchRoster = (id, courseId) => get(`${BASE}/windows/${id}/rosters/${courseId}`)

export const fetchRegistrations = (id, status) => get(`${BASE}/windows/${id}/registrations`, { status: status || undefined })
export const fetchRegistrationForm = (id, studentId) => get(`${BASE}/windows/${id}/students/${studentId}`)
export const saveRegistration = (id, studentId, courseIds) => put(`${BASE}/windows/${id}/students/${studentId}`, { courseIds })
export const decideRegistrations = (ids, action, note) => post(`${BASE}/decide`, { ids, action, note: note || undefined })
