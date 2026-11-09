import api from './client'

// Dashboard API (/api/v1/dashboard).
export const fetchCommandCentre = async () => (await api.get('/v1/dashboard/command')).data.data
/** Home: the institution at a glance for a period (`from`, `to` as YYYY-MM-DD). */
export const fetchOverview = async (params) => (await api.get('/v1/dashboard/overview', { params })).data.data
