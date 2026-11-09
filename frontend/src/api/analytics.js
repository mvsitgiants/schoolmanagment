import api from './client'

// Analytics dashboards API (/api/v1/analytics). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data

const BASE = '/v1/analytics'
const compact = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''))

export const fetchAcademicAnalytics = (q) => get(`${BASE}/academics`, compact(q))
export const fetchFeeAnalytics = (q) => get(`${BASE}/fees`, compact(q))
export const fetchCampusAnalytics = (q) => get(`${BASE}/campuses`, compact(q))
