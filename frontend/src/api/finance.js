import api from './client'

// Accounts API (/api/v1/finance). Functions return the unwrapped `data`; paged lists return `{ data, meta, summary }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/finance'

export const fetchFinanceMeta = () => get(`${BASE}/meta`)
export const fetchFinanceSummary = () => get(`${BASE}/summary`)

export const fetchAccounts = () => get(`${BASE}/accounts`)
export const createAccount = (body) => post(`${BASE}/accounts`, body)
export const updateAccount = (id, body) => patch(`${BASE}/accounts/${id}`, body)
export const deleteAccount = (id) => del(`${BASE}/accounts/${id}`)
export const fetchFeeHeadMapping = () => get(`${BASE}/fee-heads`)
export const saveFeeHeadMapping = (rows) => put(`${BASE}/fee-heads`, { rows })

export const fetchJournals = (params) => list(`${BASE}/journals`, params)
export const fetchJournal = (id) => get(`${BASE}/journals/${id}`)
export const createJournal = (body) => post(`${BASE}/journals`, body)
export const updateJournal = (id, body) => patch(`${BASE}/journals/${id}`, body)
export const discardJournal = (id) => del(`${BASE}/journals/${id}`)
export const postJournal = (id) => post(`${BASE}/journals/${id}/post`)
export const reverseJournal = (id, body) => post(`${BASE}/journals/${id}/reverse`, body)
export const rebuildPostings = (body) => post(`${BASE}/postings/rebuild`, body)

export const fetchExpenseHeads = () => get(`${BASE}/expenses/heads`)
export const fetchExpenses = (params) => list(`${BASE}/expenses`, params)
export const fetchExpense = (id) => get(`${BASE}/expenses/${id}`)
export const createExpense = (body) => post(`${BASE}/expenses`, body)
export const updateExpense = (id, body) => patch(`${BASE}/expenses/${id}`, body)
export const decideExpense = (id, body) => post(`${BASE}/expenses/${id}/decide`, body)
export const payExpense = (id, body) => post(`${BASE}/expenses/${id}/pay`, body)
export const cancelExpense = (id, reason) => post(`${BASE}/expenses/${id}/cancel`, { reason })

export const fetchBankAccounts = () => get(`${BASE}/bank/accounts`)
export const createBankAccount = (body) => post(`${BASE}/bank/accounts`, body)
export const updateBankAccount = (id, body) => patch(`${BASE}/bank/accounts/${id}`, body)
export const fetchReconciliation = (id, params) => get(`${BASE}/bank/accounts/${id}/reconciliation`, params)
export const importStatement = (id, csv) => post(`${BASE}/bank/accounts/${id}/import`, { csv })
export const autoMatch = (id) => post(`${BASE}/bank/accounts/${id}/auto-match`)
export const matchLine = (lineId, body) => post(`${BASE}/bank/lines/${lineId}/match`, body)
export const unmatchLine = (lineId) => post(`${BASE}/bank/lines/${lineId}/unmatch`)

export const fetchReport = (kind, params) => get(`${BASE}/reports/${kind}`, params)
/** Download a report as CSV (or the Tally XML). */
export async function downloadReport(kind, params) {
  const res = await api.get(`${BASE}/reports/${kind}/export`, { params, responseType: 'blob' })
  const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? `${kind}.csv`
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}
