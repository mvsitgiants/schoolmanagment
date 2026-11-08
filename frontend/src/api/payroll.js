import api from './client'

// Payroll API (/api/v1/payroll). Functions return the unwrapped `data`; paged lists return `{ data, meta, … }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/payroll'

export const fetchPayrollMeta = () => get(`${BASE}/meta`)
export const fetchPayrollStaff = () => get(`${BASE}/employees/options`)

export const fetchStatutory = () => get(`${BASE}/statutory`)
export const saveStatutory = (body) => put(`${BASE}/statutory`, body)

export const fetchStructures = (all) => get(`${BASE}/structures`, all ? { all: '1' } : undefined)
export const createStructure = (body) => post(`${BASE}/structures`, body)
export const updateStructure = (id, body) => put(`${BASE}/structures/${id}`, body)
export const deleteStructure = (id) => del(`${BASE}/structures/${id}`)

export const fetchAssignments = (params) => list(`${BASE}/assignments`, params)
export const fetchAssignmentHistory = (employeeId) => get(`${BASE}/assignments/${employeeId}`)
export const saveAssignment = (body) => post(`${BASE}/assignments`, body)
export const bulkAssign = (body) => post(`${BASE}/assignments/bulk`, body)
export const deleteAssignment = (id) => del(`${BASE}/assignments/${id}`)

export const fetchLoans = (params) => list(`${BASE}/loans`, params)
export const createLoan = (body) => post(`${BASE}/loans`, body)
export const updateLoan = (id, body) => put(`${BASE}/loans/${id}`, body)
export const closeLoan = (id, body) => post(`${BASE}/loans/${id}/close`, body)

export const fetchRuns = (params) => list(`${BASE}/runs`, params)
export const fetchRun = (id) => get(`${BASE}/runs/${id}`)
export const createRun = (body) => post(`${BASE}/runs`, body)
export const calculateRun = (id) => post(`${BASE}/runs/${id}/calculate`)
export const reopenRun = (id, reason) => post(`${BASE}/runs/${id}/reopen`, { reason })
export const approveRun = (id, note) => post(`${BASE}/runs/${id}/approve`, { note })
export const payRun = (id, body) => post(`${BASE}/runs/${id}/pay`, body)

export const fetchPayslips = (params) => list(`${BASE}/payslips`, params)
export const fetchPayslip = (id) => get(`${BASE}/payslips/${id}`)
export const editPayslipLop = (id, body) => post(`${BASE}/payslips/${id}/lop`, body)
export const addPayslipLine = (id, body) => post(`${BASE}/payslips/${id}/adjustments`, body)
export const removePayslipLine = (id, index) => del(`${BASE}/payslips/${id}/adjustments/${index}`)

export const fetchExportOptions = (runId) => get(`${BASE}/runs/${runId}/exports`)
/** Download one bank / statutory file; resolves to { rows, skipped } from the response headers. */
export async function downloadExport(runId, kind) {
  const res = await api.get(`${BASE}/runs/${runId}/exports/${kind}`, { responseType: 'blob' })
  const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? `${kind}.csv`
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
  return { rows: Number(res.headers['x-rows'] ?? 0), skipped: Number(res.headers['x-skipped'] ?? 0) }
}

export const fetchMyPayslips = () => get(`${BASE}/me/payslips`)
export const fetchMyPayslip = (id) => get(`${BASE}/me/payslips/${id}`)
export const fetchMyPayslipHtml = async (id) => (await api.get(`${BASE}/me/payslips/${id}/print`, { responseType: 'text' })).data
