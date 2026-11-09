import api from './client'

// Front office API (/api/v1/frontoffice): visitor log, gate passes, complaints. Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data

const BASE = '/v1/frontoffice'
const clean = (p = {}) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false))

/** Every row of a paged list, for a CSV export: 100-row pages, four at a time, up to `max` rows. */
async function allRows(fetchPage, params, max = 5000) {
  const size = 100
  const first = await fetchPage({ ...params, page: 1, pageSize: size })
  const pages = Math.min(Math.ceil((first.total ?? 0) / size), Math.ceil(max / size))
  const out = [...(first.rows ?? [])]
  for (let p = 2; p <= pages; p += 4) {
    const batch = await Promise.all(Array.from({ length: Math.min(4, pages - p + 1) }, (_, i) => fetchPage({ ...params, page: p + i, pageSize: size })))
    for (const r of batch) out.push(...(r.rows ?? []))
  }
  return out
}

// pickers
export const fetchFoStaff = (search) => get(`${BASE}/staff`, clean({ search }))
export const findFoStudents = (search) => get(`${BASE}/students`, { search })

// visitor log
export const fetchVisitorDesk = () => get(`${BASE}/visitors/desk`)
export const fetchVisitors = (params) => get(`${BASE}/visitors`, clean(params))
export const fetchAllVisitors = (params) => allRows(fetchVisitors, params)
export const fetchVisitor = (id) => get(`${BASE}/visitors/${id}`)
export const lookupVisitor = (mobile) => get(`${BASE}/visitors/lookup`, { mobile })
export const checkInVisitor = (body) => post(`${BASE}/visitors`, body)
export const checkOutVisitor = (id) => post(`${BASE}/visitors/${id}/checkout`)
export const enquiryFromVisit = (id, body) => post(`${BASE}/visitors/${id}/enquiry`, body)

// gate passes
export const fetchGatePasses = (params) => get(`${BASE}/gate-passes`, clean(params))
export const fetchPassesToApprove = () => get(`${BASE}/gate-passes/to-approve`)
export const fetchGatePass = (id) => get(`${BASE}/gate-passes/${id}`)
export const fetchPassHistory = (studentId) => get(`${BASE}/gate-passes/history/${studentId}`)
export const createGatePass = (body) => post(`${BASE}/gate-passes`, body)
export const decideGatePass = (id, approve, note) => post(`${BASE}/gate-passes/${id}/decide`, { approve, note })
export const passLeft = (id) => post(`${BASE}/gate-passes/${id}/left`)
export const passReturned = (id) => post(`${BASE}/gate-passes/${id}/returned`)
export const cancelGatePass = (id, reason) => post(`${BASE}/gate-passes/${id}/cancel`, { reason })

// complaints
export const fetchComplaints = (params) => get(`${BASE}/complaints`, clean(params))
export const fetchAllComplaints = (params) => allRows(fetchComplaints, params)
export const fetchComplaint = (id) => get(`${BASE}/complaints/${id}`)
export const raiseComplaint = (body) => post(`${BASE}/complaints`, body)
export const assignComplaint = (id, assignedToId, note) => post(`${BASE}/complaints/${id}/assign`, { assignedToId, note })
export const setComplaintStatus = (id, body) => post(`${BASE}/complaints/${id}/status`, body)
export const addComplaintNote = (id, note) => post(`${BASE}/complaints/${id}/notes`, { note })
