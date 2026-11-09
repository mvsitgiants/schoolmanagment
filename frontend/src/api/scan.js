import api from './client'

// Scan API (/api/v1/scan): what a scanned code is, the phone gate scanners, a member of staff's punch code.
export const resolveCode = async (code) => (await api.post('/v1/scan/resolve', { code })).data.data
export const fetchGates = async () => (await api.get('/v1/scan/gates')).data.data
export const gateScan = async (id, code, direction) => (await api.post(`/v1/scan/gates/${id}`, { code, direction })).data.data
export const fetchPunchCode = async () => (await api.get('/v1/scan/punch-code')).data.data
/** Public: is this fee receipt genuine? */
export const verifyReceipt = async (code) => (await api.get(`/v1/public/verify/receipt/${encodeURIComponent(code)}`)).data.data
