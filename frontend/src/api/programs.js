import api from './client'

// Programs & OBE API (/api/v1/programs). Every function returns the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/programs'

export const fetchProgramLookup = () => get(`${BASE}/lookup`)
export const fetchProgramStaff = () => get(`${BASE}/staff`)

// regulations
export const fetchRegulations = () => get(`${BASE}/regulations`)
export const createRegulation = (body) => post(`${BASE}/regulations`, body)
export const updateRegulation = (id, body) => patch(`${BASE}/regulations/${id}`, body)
export const deleteRegulation = (id) => del(`${BASE}/regulations/${id}`)

// programs
export const fetchPrograms = () => get(BASE)
export const fetchProgram = (id) => get(`${BASE}/${id}`)
export const createProgram = (body) => post(BASE, body)
export const updateProgram = (id, body) => patch(`${BASE}/${id}`, body)
export const deleteProgram = (id) => del(`${BASE}/${id}`)

// courses
export const createCourse = (body) => post(`${BASE}/courses`, body)
export const updateCourse = (id, body) => patch(`${BASE}/courses/${id}`, body)
export const deleteCourse = (id) => del(`${BASE}/courses/${id}`)

// students in a program
export const fetchEnrolments = (programId, params) => get(`${BASE}/${programId}/students`, params)
export const fetchEnrolmentCandidates = (search) => get(`${BASE}/candidates`, { search: search || undefined })
export const enrolStudents = (programId, body) => post(`${BASE}/${programId}/students`, body)
export const updateEnrolment = (id, body) => patch(`${BASE}/enrolments/${id}`, body)
export const updateEnrolments = (ids, body) => patch(`${BASE}/enrolments`, { ids, ...body })
export const deleteEnrolment = (id) => del(`${BASE}/enrolments/${id}`)

// outcomes
export const fetchOutcomes = (programId) => get(`${BASE}/${programId}/outcomes`)
export const saveProgramOutcomes = (programId, outcomes) => put(`${BASE}/${programId}/outcomes`, { outcomes })
export const saveCourseOutcomes = (courseId, body) => put(`${BASE}/courses/${courseId}/outcomes`, body)

// attainment
export const fetchAttainment = (programId, sessionId) => get(`${BASE}/${programId}/attainment`, { sessionId: sessionId || undefined })
