import api from './client'

// Exams & report cards API (/api/v1/exams). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/exams'

export const fetchExamTypes = () => get(`${BASE}/types`)
export const createExamType = (body) => post(`${BASE}/types`, body)
export const updateExamType = (id, body) => patch(`${BASE}/types/${id}`, body)
export const deleteExamType = (id) => del(`${BASE}/types/${id}`)

export const fetchExams = (yearId) => get(BASE, { yearId: yearId || undefined })
export const fetchExam = (id) => get(`${BASE}/${id}`)
export const createExam = (body) => post(BASE, body)
export const updateExam = (id, body) => patch(`${BASE}/${id}`, body)
export const deleteExam = (id) => del(`${BASE}/${id}`)
export const suggestPapers = (id, classId) => get(`${BASE}/${id}/classes/${classId}/suggest`)
export const savePapers = (id, classId, papers) => put(`${BASE}/${id}/classes/${classId}/papers`, { papers })
export const scheduleExam = (id) => post(`${BASE}/${id}/schedule`)
export const unscheduleExam = (id) => post(`${BASE}/${id}/unschedule`)

export const fetchCandidates = (id, sectionId) => get(`${BASE}/${id}/candidates`, { sectionId })

export const fetchMarksBoard = (id) => get(`${BASE}/${id}/marks`)
export const fetchMarkSheet = (paperId, sectionId) => get(`${BASE}/marks/${paperId}/${sectionId}`)
export const saveMarkSheet = (paperId, sectionId, entries) => put(`${BASE}/marks/${paperId}/${sectionId}`, { entries })
export const lockMarkSheet = (paperId, sectionId) => post(`${BASE}/marks/${paperId}/${sectionId}/lock`)
export const unlockMarkSheet = (paperId, sectionId, reason) => post(`${BASE}/marks/${paperId}/${sectionId}/unlock`, { reason })

// year-end results (all published exams of the year, by exam-type weightage)
export const fetchYearOverview = () => get(`${BASE}/year-results`)
export const fetchYearSheet = (classId, sectionId) => get(`${BASE}/year-results/classes/${classId}`, { sectionId })
export const publishYear = (classId) => post(`${BASE}/year-results/classes/${classId}/publish`)
export const unpublishYear = (classId) => post(`${BASE}/year-results/classes/${classId}/unpublish`)
export const fetchResults = (id, sectionId) => get(`${BASE}/${id}/results`, { sectionId })
export const publishResults = (id) => post(`${BASE}/${id}/publish`)
export const unpublishResults = (id) => post(`${BASE}/${id}/unpublish`)
export const saveRemarks = (id, sectionId, remarks) => put(`${BASE}/${id}/remarks`, { sectionId, remarks })
export const sendReportCards = (id, body) => post(`${BASE}/${id}/report-cards/send`, body)
export const holdCandidates = (id, body) => post(`${BASE}/${id}/holds`, body)
export const releaseCandidates = (id, body) => post(`${BASE}/${id}/holds/release`, body)
