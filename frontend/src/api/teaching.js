import api from './client'

// Subject hub (homework.hub): one place to build a class + subject — units, topics, student content, questions.
const BASE = '/v1/teaching/hub'
const data = (r) => r.data.data

export const fetchHub = (classId, subjectId, unitId, topicId) => api.get(BASE, { params: { classId, subjectId, unitId, topicId } }).then(data)
export const fetchHubStudents = (classId, subjectId) => api.get(`${BASE}/students`, { params: { classId, subjectId } }).then(data)
export const addHubUnit = (body) => api.post(`${BASE}/units`, body).then(data)
export const saveHubUnit = (id, body) => api.put(`${BASE}/units/${id}`, body).then(data)
export const deleteHubUnit = (id, classId, subjectId) => api.delete(`${BASE}/units/${id}`, { params: { classId, subjectId } }).then(data)
export const orderHubTopics = (unitId, body) => api.put(`${BASE}/units/${unitId}/order`, body).then(data)
export const publishHubUnit = (unitId, body) => api.post(`${BASE}/units/${unitId}/publish`, body).then(data)
export const addHubTopic = (body) => api.post(`${BASE}/topics`, body).then(data)
export const saveHubTopic = (id, body) => api.put(`${BASE}/topics/${id}`, body).then(data)
export const deleteHubTopic = (id, classId, subjectId) => api.delete(`${BASE}/topics/${id}`, { params: { classId, subjectId } }).then(data)
/** The LMS item behind a topic / sub-topic's content (made as a draft if missing); files and pictures hang off it. */
export const ensureHubItem = (topicId, body) => api.post(`${BASE}/topics/${topicId}/item`, body).then(data)
/** Copy a topic's own files (added from the syllabus page) onto its student content; `fileIds` left out = all. */
export const copyHubTopicFiles = (topicId, body) => api.post(`${BASE}/topics/${topicId}/copy-files`, body).then(data)
