import api from './client'

// Reports API (/api/v1/reports): the library and saved reports.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/reports'

export const fetchReportLibrary = () => get(`${BASE}/library`)
export const runReport = (id, params, columns) => post(`${BASE}/run/${encodeURIComponent(id)}`, { params, columns })
export const fetchSavedReports = () => get(`${BASE}/saved`)
export const createSavedReport = (body) => post(`${BASE}/saved`, body)
export const updateSavedReport = (id, body) => patch(`${BASE}/saved/${id}`, body)
export const deleteSavedReport = (id) => del(`${BASE}/saved/${id}`)
export const runSavedReport = (id) => post(`${BASE}/saved/${id}/run`)
