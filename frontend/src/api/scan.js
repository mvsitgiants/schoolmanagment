import api from './client'

// Scan API (/api/v1/scan): what a scanned code is, the phone gate scanners, a member of staff's punch code.
export const resolveCode = async (code) => (await api.post('/v1/scan/resolve', { code })).data.data
export const fetchGates = async () => (await api.get('/v1/scan/gates')).data.data
export const gateScan = async (id, code, direction) => (await api.post(`/v1/scan/gates/${id}`, { code, direction })).data.data
export const fetchPunchCode = async () => (await api.get('/v1/scan/punch-code')).data.data
/** Public: is this fee receipt genuine? */
export const verifyReceipt = async (code) => (await api.get(`/v1/public/verify/receipt/${encodeURIComponent(code)}`)).data.data
/** My workspace › check in / check out from the phone (geofenced; Settings › Staff & HR). */
export const fetchSelfAttendance = async () => (await api.get('/v1/scan/self')).data.data
export const selfPunch = async (body) => (await api.post('/v1/scan/self', body)).data.data
