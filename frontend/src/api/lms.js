import api from './client'

// Learning (LMS) API (/api/v1/lms). Functions return the unwrapped `data`; paged lists return `{ data, meta, … }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/lms'

export const fetchLmsLookup = () => get(`${BASE}/lookup`)

export const fetchCourses = (params) => get(`${BASE}/courses`, params)
export const fetchCourse = (id) => get(`${BASE}/courses/${id}`)
export const createCourse = (body) => post(`${BASE}/courses`, body)
export const updateCourse = (id, body) => patch(`${BASE}/courses/${id}`, body)
export const saveOutline = (id, units) => put(`${BASE}/courses/${id}/outline`, { units })
export const setCourseStatus = (id, status) => post(`${BASE}/courses/${id}/status`, { status })
export const deleteCourse = (id) => del(`${BASE}/courses/${id}`)
export const fetchCourseProgress = (id) => get(`${BASE}/courses/${id}/progress`)

export const fetchLiveClasses = (params) => get(`${BASE}/live`, params)
export const createLiveClass = (body) => post(`${BASE}/live`, body)
export const updateLiveClass = (id, body) => patch(`${BASE}/live/${id}`, body)
export const startLiveClass = (id) => post(`${BASE}/live/${id}/start`)
export const endLiveClass = (id, recordingUrl) => post(`${BASE}/live/${id}/end`, { recordingUrl })
export const cancelLiveClass = (id, body) => post(`${BASE}/live/${id}/cancel`, body)
export const fetchLiveAttendance = (id) => get(`${BASE}/live/${id}/attendance`)

export const fetchQuestions = (params) => list(`${BASE}/questions`, params)
export const fetchQuestion = (id) => get(`${BASE}/questions/${id}`)
export const createQuestion = (body) => post(`${BASE}/questions`, body)
export const updateQuestion = (id, body) => put(`${BASE}/questions/${id}`, body)
export const deleteQuestion = (id) => del(`${BASE}/questions/${id}`)
export const importQuestions = (rows, dryRun) => post(`${BASE}/questions/import`, { rows, dryRun })
// the questions written on a class's syllabus topics (Teaching hub), copied into the bank → { added, already, topics }
export const questionsFromTopics = (body) => post(`${BASE}/questions/from-topics`, body)

// teaching content: create, my content, library
export const fetchContentTopics = (classId, subjectId) => get(`${BASE}/content/topics`, { classId, subjectId })
export const fetchContentStudents = (classId) => get(`${BASE}/content/students`, { classId })
export const fetchTopicContentCount = (topicId) => get(`${BASE}/content/topic-count`, { topicId })
export const fetchMyContent = (params) => list(`${BASE}/content/mine`, params)
export const fetchContentLibrary = (params) => list(`${BASE}/content`, params)
export const fetchContent = (id) => get(`${BASE}/content/${id}`)
export const createContent = (body) => post(`${BASE}/content`, body)
export const updateContent = (id, body) => put(`${BASE}/content/${id}`, body)
export const deleteContent = (id) => del(`${BASE}/content/${id}`)
