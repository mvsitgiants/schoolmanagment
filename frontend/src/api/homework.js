import api from './client'

// Homework & lessons API (/api/v1/homework). Functions return the unwrapped `data`; paged lists return `{ data, meta }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/homework'

export const fetchHomeworkLookup = () => get(`${BASE}/lookup`)
/** My workspace › My teaching: this week's lessons, homework to check, my classes against the year plan. */
export const fetchMyTeaching = () => get(`${BASE}/me`)

export const fetchSyllabusOverview = () => get(`${BASE}/syllabus/overview`)
export const fetchSyllabus = (classId, subjectId) => get(`${BASE}/syllabus`, { classId, subjectId })
export const saveSyllabus = (body) => put(`${BASE}/syllabus`, body)
export const markSyllabusTopics = (body) => post(`${BASE}/syllabus/progress`, body)

export const fetchLessonPlans = (params) => get(`${BASE}/lesson-plans`, params)
export const createLessonPlan = (body) => post(`${BASE}/lesson-plans`, body)
export const updateLessonPlan = (id, body) => patch(`${BASE}/lesson-plans/${id}`, body)
export const deleteLessonPlan = (id) => del(`${BASE}/lesson-plans/${id}`)
export const setLessonPlanStatus = (id, body) => post(`${BASE}/lesson-plans/${id}/status`, body)

export const fetchHomeworkList = (params) => list(BASE, params)
export const fetchHomework = (id) => get(`${BASE}/${id}`)
export const createHomework = (body) => post(BASE, body)
export const updateHomework = (id, body) => patch(`${BASE}/${id}`, body)
export const deleteHomework = (id) => del(`${BASE}/${id}`)
export const saveHomeworkSubmissions = (id, entries) => put(`${BASE}/${id}/submissions`, { entries })
