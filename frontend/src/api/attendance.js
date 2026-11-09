import api from './client'

// Student attendance API (/api/v1/attendance). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data

const BASE = '/v1/attendance'

export const fetchAttendanceBoard = (date) => get(`${BASE}/board`, { date: date || undefined })
export const fetchSheet = ({ sectionId, date, period = 0 }) => get(`${BASE}/sheet`, { sectionId, date, period })
export const saveSheet = (body) => put(`${BASE}/sheet`, body)
export const fetchRegister = (sectionId, month) => get(`${BASE}/register`, { sectionId, month })
export const fetchAttendanceReport = ({ from, to, sectionId }) => get(`${BASE}/reports`, { from, to, sectionId: sectionId || undefined })
export const fetchSubjectReport = ({ from, to, sectionId }) => get(`${BASE}/subject-report`, { from, to, sectionId })

export const fetchStudentLeave = (params) => get(`${BASE}/leave`, params)
export const applyStudentLeave = (body) => post(`${BASE}/leave`, body)
export const decideStudentLeave = (id, approve, note) => post(`${BASE}/leave/${id}/decide`, { approve, note })
export const cancelStudentLeave = (id) => post(`${BASE}/leave/${id}/cancel`)
