import api from './client'

// Health & infirmary API (/api/v1/health). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/health'

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

// health records
export const fetchHealthRecords = (params) => get(`${BASE}/records`, params)
export const fetchHealthRecord = (studentId) => get(`${BASE}/records/${studentId}`)
export const saveHealthRecord = (studentId, body) => put(`${BASE}/records/${studentId}`, body)
export const deleteMeasurement = (studentId, date) => del(`${BASE}/records/${studentId}/measurements/${date}`)
export const fetchHealthBrief = (studentId) => get(`${BASE}/brief/${studentId}`)
export const fetchHealthStaff = () => get(`${BASE}/staff`)

// sick-room visits
export const fetchVisitBoard = () => get(`${BASE}/visits/board`)
export const fetchVisits = (params) => get(`${BASE}/visits`, params)
export const fetchAllVisits = (params) => allRows(fetchVisits, params)
export const createVisit = (body) => post(`${BASE}/visits`, body)
export const updateVisit = (id, body) => patch(`${BASE}/visits/${id}`, body)

// incidents
export const fetchIncidents = (params) => get(`${BASE}/incidents`, params)
export const fetchAllIncidents = (params) => allRows(fetchIncidents, params)
export const createIncident = (body) => post(`${BASE}/incidents`, body)
export const updateIncident = (id, body) => patch(`${BASE}/incidents/${id}`, body)
export const resolveIncident = (id, body) => post(`${BASE}/incidents/${id}/resolve`, body)
