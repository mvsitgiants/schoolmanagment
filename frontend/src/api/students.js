import api from './client'

// Students API (/api/v1/students). Functions return the unwrapped `data`; lists with paging
// return `{ data, meta }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data

const BASE = '/v1/students'

export const fetchStudents = (params) => list(BASE, params)
export const fetchStudent = (id, { reveal = false } = {}) => get(`${BASE}/${id}`, reveal ? { reveal: 1 } : undefined)
export const admitStudent = (body) => post(BASE, body)
export const updateStudent = (id, body) => patch(`${BASE}/${id}`, body)
export const setStudentStatus = (id, status) => post(`${BASE}/${id}/status`, { status })
export const importStudents = (rows, dryRun) => post(`${BASE}/import`, { rows, dryRun })
export const fetchGuardians = (search) => get(`${BASE}/guardians`, { search: search || undefined })

export const fetchPromotion = (fromSectionId, toYearId) => get(`${BASE}/promotion`, { fromSectionId, toYearId: toYearId || undefined })
export const runPromotion = (body) => post(`${BASE}/promotion`, body)

export const fetchTcs = (status) => get(`${BASE}/tc`, { status: status || undefined })
export const requestTc = (body) => post(`${BASE}/tc`, body)
export const issueTc = (id) => post(`${BASE}/tc/${id}/issue`)
export const cancelTc = (id, reason) => post(`${BASE}/tc/${id}/cancel`, { reason })
