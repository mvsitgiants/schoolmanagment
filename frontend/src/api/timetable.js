import api from './client'

// Timetable API (/api/v1/timetable). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/timetable'

export const fetchTimetableTeachers = (yearId) => get(`${BASE}/teachers`, { yearId })
export const fetchMyTimetable = () => get(`${BASE}/mine`)

export const fetchBells = () => get(`${BASE}/bells`)
export const createBell = (body) => post(`${BASE}/bells`, body)
export const updateBell = (id, body) => put(`${BASE}/bells/${id}`, body)
export const deleteBell = (id) => del(`${BASE}/bells/${id}`)

export const fetchRooms = () => get(`${BASE}/rooms`)
export const fetchRoomBoard = (at) => get(`${BASE}/rooms/board`, at ? { at } : undefined)
export const createRoom = (body) => post(`${BASE}/rooms`, body)
export const updateRoom = (id, body) => put(`${BASE}/rooms/${id}`, body)
export const deleteRoom = (id) => del(`${BASE}/rooms/${id}`)

export const fetchTimetableOverview = (yearId) => get(BASE, { yearId })
export const startTimetableDraft = (yearId) => post(`${BASE}/draft`, { yearId })
export const saveTimetableRules = (id, body) => put(`${BASE}/${id}/rules`, body)
export const generateTimetable = (id, seed) => post(`${BASE}/${id}/generate`, seed ? { seed } : {})
export const fetchTimetableGrid = (id, view, of) => get(`${BASE}/${id}/grid`, { view, of })
export const fetchTeacherLoad = (id) => get(`${BASE}/${id}/load`)
export const setTimetableCell = (id, body) => put(`${BASE}/${id}/cell`, body)
export const lockTimetableSection = (id, sectionId, locked) => post(`${BASE}/${id}/lock`, { sectionId, locked })
export const publishTimetable = (id, effectiveFrom) => post(`${BASE}/${id}/publish`, effectiveFrom ? { effectiveFrom } : {})

export const fetchSubstitutions = (date) => get(`${BASE}/substitutions`, { date })
export const fetchAwayTeachers = (date) => get(`${BASE}/substitutions/away`, { date })
export const fetchSubstitutionNeeds = (date, absentIds) => post(`${BASE}/substitutions/needs`, { date, absentIds })
export const createSubstitution = (body) => post(`${BASE}/substitutions`, body)
export const deleteSubstitution = (id) => del(`${BASE}/substitutions/${id}`)
