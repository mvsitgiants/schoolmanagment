import api from './client'

// Students API (/api/v1/students). Functions return the unwrapped `data`; lists with paging
// return `{ data, meta }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data

const BASE = '/v1/students'

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

export const fetchStudents = (params) => list(BASE, params)
export const fetchStudent = (id, { reveal = false } = {}) => get(`${BASE}/${id}`, reveal ? { reveal: 1 } : undefined)
/** Student 360: the student's school life — a section per module the caller may see (attendance, fees, exams …). */
export const fetchStudentOverview = (id) => get(`${BASE}/${id}/overview`)
export const admitStudent = (body) => post(BASE, body)
export const updateStudent = (id, body) => patch(`${BASE}/${id}`, body)
export const setStudentStatus = (id, status) => post(`${BASE}/${id}/status`, { status })
export const importStudents = (rows, dryRun) => post(`${BASE}/import`, { rows, dryRun })
/** One page of parents: `{ rows, total, page, pageSize, counts }`. */
export const fetchGuardians = (params) => get(`${BASE}/guardians`, params)
export const fetchAllGuardians = (params) => allRows(fetchGuardians, params)

export const fetchPromotion = (fromSectionId, toYearId) => get(`${BASE}/promotion`, { fromSectionId, toYearId: toYearId || undefined })
export const runPromotion = (body) => post(`${BASE}/promotion`, body)

/** One page of the TC register: `{ rows, total, page, pageSize, counts }` (counts by status, for the tiles). */
export const fetchTcs = (params) => get(`${BASE}/tc`, params)
export const requestTc = (body) => post(`${BASE}/tc`, body)
/** Correct a TC still waiting for approval. */
export const updateTc = (id, body) => patch(`${BASE}/tc/${id}`, body)
/** What the school already knows for a new TC: subjects, working / present days, fees paid up to, concession, last exam. */
export const fetchTcPrefill = (studentId) => get(`${BASE}/tc/prefill`, { studentId })
export const issueTc = (id) => post(`${BASE}/tc/${id}/issue`)
export const cancelTc = (id, reason) => post(`${BASE}/tc/${id}/cancel`, { reason })

export const fetchIdCardList = (sectionId) => get(`${BASE}/id-cards`, { sectionId })
export const fetchStudentPhoto = (id) => get(`${BASE}/${id}/photo`)
export const saveStudentPhoto = async (id, photo) => (await api.put(`${BASE}/${id}/photo`, { photo })).data.data
/** No sign-in needed: the QR on a student ID card. */
export const verifyStudentCard = async (code) => (await api.get(`/v1/public/verify/student/${encodeURIComponent(code)}`)).data.data
