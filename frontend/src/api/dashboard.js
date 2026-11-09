import api from './client'

// Dashboard API (/api/v1/dashboard).
/** Home: the institution at a glance for a period (`from`, `to` as YYYY-MM-DD). */
export const fetchOverview = async (params) => (await api.get('/v1/dashboard/overview', { params })).data.data
/** Live campus: every section right now, teachers' presence, syllabus, priorities, the next 7 days. `at` HH:MM, `date` YYYY-MM-DD, `branchId`. */
export const fetchLiveCampus = async (params) => (await api.get('/v1/dashboard/live', { params })).data.data
export const globalSearch = async (q) => (await api.get('/v1/dashboard/search', { params: { q } })).data.data
