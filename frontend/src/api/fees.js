import api from './client'

// Fees API (/api/v1/fees). Amounts are paise. Functions return the unwrapped `data`; paged lists return `{ data, meta }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/fees'

/** Every row of a paged `{ rows, total }` list, for a CSV export: 100-row pages, four at a time, up to `max` rows. */
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

export const fetchFeeHeads = () => get(`${BASE}/heads`)
export const createFeeHead = (body) => post(`${BASE}/heads`, body)
export const updateFeeHead = (id, body) => patch(`${BASE}/heads/${id}`, body)
export const deleteFeeHead = (id) => del(`${BASE}/heads/${id}`)

export const fetchStructures = (yearId) => get(`${BASE}/structures`, { yearId: yearId || undefined })
export const createStructure = (body) => post(`${BASE}/structures`, body)
export const updateStructure = (id, body) => patch(`${BASE}/structures/${id}`, body)
export const deleteStructure = (id) => del(`${BASE}/structures/${id}`)
export const generateInvoices = (id) => post(`${BASE}/structures/${id}/generate`)

export const fetchFeeLedger = (studentId) => get(`${BASE}/students/${studentId}`)
export const collectFee = (body) => post(`${BASE}/collect`, body)

export const fetchInvoices = (params) => list(`${BASE}/invoices`, params)
export const fetchReceipts = (params) => list(`${BASE}/receipts`, params)
export const cancelReceipt = (id, reason) => post(`${BASE}/receipts/${id}/cancel`, { reason })
export const refundReceipt = (id, body) => post(`${BASE}/receipts/${id}/refund`, body)
export const fetchRefunds = (params) => get(`${BASE}/refunds`, params)
export const fetchAllRefunds = (params) => allRows(fetchRefunds, params)

export const fetchDues = (params) => get(`${BASE}/dues`, params)
export const fetchAllDues = (params) => allRows(fetchDues, params)
export const sendFeeReminders = (studentIds) => post(`${BASE}/dues/remind`, { studentIds })
/** Remind every family in the dues list for `filter` ({ classId, sectionId, overdueOnly, search }) — all of it, not one page. */
export const remindAllDues = (filter) => post(`${BASE}/dues/remind`, { all: filter })

export const fetchConcessions = (params) => get(`${BASE}/concessions`, params)
export const requestConcession = (body) => post(`${BASE}/concessions`, body)
export const decideConcession = (id, approve) => post(`${BASE}/concessions/${id}/decide`, { approve })
export const withdrawConcession = (id) => post(`${BASE}/concessions/${id}/withdraw`)

export const fetchDaySummary = (params) => get(`${BASE}/day-end`, params)
export const fetchDayClosings = (params) => get(`${BASE}/day-end/closings`, params)
export const closeFeeDay = (body) => post(`${BASE}/day-end/close`, body)
export const approveDayVariance = (id) => post(`${BASE}/day-end/${id}/approve`)

// online payment on the school's own Razorpay account (/api/v1/fees/online)
const ONLINE = '/v1/fees/online'
const put = async (url, body) => (await api.put(url, body)).data.data
export const fetchOnlineStatus = () => get(`${ONLINE}/status`)
export const fetchOnlineConfig = () => get(`${ONLINE}/config`)
export const saveOnlineConfig = (body) => put(`${ONLINE}/config`, body)
export const testOnlineConfig = () => post(`${ONLINE}/config/test`)
export const fetchOnlineOrders = (params) => list(`${ONLINE}/orders`, params)
export const syncOnlineOrder = (id) => post(`${ONLINE}/orders/${id}/sync`)
export const cancelOnlineOrder = (id) => post(`${ONLINE}/orders/${id}/cancel`)
export const refundOnlineOrder = (id, body) => post(`${ONLINE}/orders/${id}/refund`, body)
export const fetchStudentOnline = (studentId) => get(`${ONLINE}/students/${studentId}`)
export const createPaymentLink = (studentId, body) => post(`${ONLINE}/students/${studentId}/link`, body)
