import api from './client'

// Scholarships API (/api/v1/scholarships): schemes and their checklist, applications, checking documents, decisions.
// Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/scholarships'
const clean = (p = {}) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false))
const item = (id, key) => `${BASE}/applications/${id}/items/${encodeURIComponent(key)}`

export const fetchScholarshipMeta = () => get(`${BASE}/meta`)

// schemes
export const fetchSchemes = (all = false) => get(`${BASE}/schemes`, clean({ all: all ? '1' : '' }))
export const fetchScheme = (id) => get(`${BASE}/schemes/${id}`)
export const saveScheme = (id, body) => (id ? put(`${BASE}/schemes/${id}`, body) : post(`${BASE}/schemes`, body))
export const deleteScheme = (id) => del(`${BASE}/schemes/${id}`)
export const fetchEligibleStudents = (id, params) => get(`${BASE}/schemes/${id}/eligible`, clean(params))

// applications
export const fetchApplications = (params) => get(`${BASE}/applications`, clean(params))
export const fetchApplication = (id) => get(`${BASE}/applications/${id}`)
export const previewApplication = (params) => get(`${BASE}/applications/preview`, clean(params))
export const createApplication = (body) => post(`${BASE}/applications`, body)
export const createApplications = (body) => post(`${BASE}/applications/bulk`, body)
export const updateApplication = (id, body) => put(`${BASE}/applications/${id}`, body)
export const tellFamilies = (ids) => post(`${BASE}/applications/tell-family`, { ids })
export const decideApplications = (ids, approve, note) => post(`${BASE}/applications/decide`, { ids, approve, note })
export const withdrawApplication = (id, reason) => post(`${BASE}/applications/${id}/withdraw`, { reason })
export const updatePortal = (ids, body) => post(`${BASE}/applications/portal`, { ids, ...body })
export const recordMoney = (rows, body) => post(`${BASE}/applications/money`, { rows, ...body })
export const fetchScholarshipReport = (params) => get(`${BASE}/report`, clean(params))

// one checklist line
export const documentFor = (id, key) => post(`${item(id, key)}/doc`)
export const saveDocument = (id, key, body) => put(item(id, key), body)
export const checkDocument = (id, key, body) => post(`${item(id, key)}/check`, body)
export const markOriginalSeen = (id, key) => post(`${item(id, key)}/original`)
export const markAllOriginalsSeen = (id) => post(`${BASE}/applications/${id}/originals`)

// visit times for originals
export const fetchVisitDays = (all = false) => get(`${BASE}/visits`, clean({ all: all ? '1' : '' }))
export const fetchVisitBookings = (id) => get(`${BASE}/visits/${id}/bookings`)
export const saveVisitDay = (id, body) => (id ? put(`${BASE}/visits/${id}`, body) : post(`${BASE}/visits`, body))
export const deleteVisitDay = (id) => del(`${BASE}/visits/${id}`)
