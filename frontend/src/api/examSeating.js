import api from './client'

// Exam seating & invigilation API (/api/v1/exams/seating). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/exams/seating'

export const fetchSeatingSessions = (examId) => get(`${BASE}/exams/${examId}`)
export const fetchSeatingSession = (examId, date, startTime) => get(`${BASE}/exams/${examId}/session`, { date, startTime })
export const generateSeating = (examId, body) => post(`${BASE}/exams/${examId}/generate`, body)
export const generateAllSeating = (examId, body) => post(`${BASE}/exams/${examId}/generate-all`, body)
export const moveSeats = (planId, moves) => post(`${BASE}/plans/${planId}/moves`, { moves })
export const unlockSeats = (planId, body) => post(`${BASE}/plans/${planId}/unlock`, body)
export const setInvigilators = (planId, body) => put(`${BASE}/plans/${planId}/invigilators`, body)
export const autoInvigilators = (planId) => post(`${BASE}/plans/${planId}/invigilators/auto`, {})
export const publishSeating = (planId) => post(`${BASE}/plans/${planId}/publish`, {})
export const unpublishSeating = (planId) => post(`${BASE}/plans/${planId}/unpublish`, {})
export const deleteSeating = (planId) => del(`${BASE}/plans/${planId}`)
export const fetchMyDuties = () => get(`${BASE}/mine`)
