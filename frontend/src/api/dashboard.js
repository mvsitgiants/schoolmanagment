import api from './client'

// Dashboard API (/api/v1/dashboard).
export const fetchCommandCentre = async () => (await api.get('/v1/dashboard/command')).data.data
