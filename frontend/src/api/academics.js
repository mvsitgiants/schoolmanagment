import api from './client'

// Academic setup API (/api/v1/academics). Every function returns the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/academics'

/** Years, the current year, its sections and the subjects — for pickers on every screen. */
export const fetchAcademicLookup = () => get(`${BASE}/lookup`)

// years
export const fetchYears = () => get(`${BASE}/years`)
export const createYear = (body) => post(`${BASE}/years`, body)
export const updateYear = (id, body) => patch(`${BASE}/years/${id}`, body)
export const makeYearCurrent = (id) => post(`${BASE}/years/${id}/current`)
export const deleteYear = (id) => del(`${BASE}/years/${id}`)

// subjects
export const fetchSubjects = () => get(`${BASE}/subjects`)
export const createSubject = (body) => post(`${BASE}/subjects`, body)
export const updateSubject = (id, body) => patch(`${BASE}/subjects/${id}`, body)
export const deleteSubject = (id) => del(`${BASE}/subjects/${id}`)
export const importSubjects = (rows, dryRun) => post(`${BASE}/subjects/import`, { rows, dryRun })

// grading
export const fetchGrading = () => get(`${BASE}/grading`)
export const createGrading = (body) => post(`${BASE}/grading`, body)
export const updateGrading = (id, body) => patch(`${BASE}/grading/${id}`, body)
export const makeGradingDefault = (id) => post(`${BASE}/grading/${id}/default`)
export const deleteGrading = (id) => del(`${BASE}/grading/${id}`)

// classes and sections
export const fetchClasses = (yearId) => get(`${BASE}/classes`, { yearId: yearId || undefined })
export const createClass = (body) => post(`${BASE}/classes`, body)
export const updateClass = (id, body) => patch(`${BASE}/classes/${id}`, body)
export const deleteClass = (id) => del(`${BASE}/classes/${id}`)
export const importClasses = (rows, dryRun) => post(`${BASE}/classes/import`, { rows, dryRun })
export const quickSetupClasses = (body) => post(`${BASE}/classes/quick-setup`, body)
export const createSection = (body) => post(`${BASE}/sections`, body)
export const updateSection = (id, body) => patch(`${BASE}/sections/${id}`, body)
export const deleteSection = (id) => del(`${BASE}/sections/${id}`)

// teacher allocation
export const fetchAllocation = (classId, yearId) => get(`${BASE}/allocation`, { classId, yearId: yearId || undefined })
export const saveAllocation = (body) => put(`${BASE}/allocation`, body)
export const fetchTeachers = () => get(`${BASE}/teachers`)
