import api from './client'

// Library API (/api/v1/library). Functions return the unwrapped `data` (lists: { data, total, … }).
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data
async function download(url, params, name) {
  const res = await api.get(url, { params, responseType: 'blob' })
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}

const BASE = '/v1/library'

export const fetchLibraryMeta = () => get(`${BASE}/meta`)
export const fetchTitles = (params) => list(`${BASE}/titles`, params)
export const fetchTitle = (id) => get(`${BASE}/titles/${id}`)
export const saveTitle = (id, body) => (id ? patch(`${BASE}/titles/${id}`, body) : post(`${BASE}/titles`, body))
export const deleteTitle = (id) => del(`${BASE}/titles/${id}`)
export const addCopies = (id, body) => post(`${BASE}/titles/${id}/copies`, body)
export const updateCopy = (id, body) => patch(`${BASE}/copies/${id}`, body)
export const deleteCopy = (id) => del(`${BASE}/copies/${id}`)
export const lookupIsbn = (isbn) => get(`${BASE}/isbn/${encodeURIComponent(isbn)}`)
export const importCatalogue = (rows, dryRun) => post(`${BASE}/titles/import`, { rows, dryRun })
export const exportCatalogue = () => download(`${BASE}/titles/export`, {}, 'library-catalogue.csv')

export const fetchDesk = () => get(`${BASE}/desk`)
export const searchBorrowers = (search) => get(`${BASE}/borrowers`, { search })
export const fetchBorrower = (params) => get(`${BASE}/borrower`, params)
export const fetchCopyByCode = (code) => get(`${BASE}/copies/by-code/${encodeURIComponent(code)}`)
export const issueBooks = (body) => post(`${BASE}/issue`, body)
export const returnBook = (body) => post(`${BASE}/return`, body)
export const fetchLoans = (params) => list(`${BASE}/loans`, params)
export const renewLoan = (id) => post(`${BASE}/loans/${id}/renew`)
export const markLost = (id, body) => post(`${BASE}/loans/${id}/lost`, body)

export const fetchFines = (params) => list(`${BASE}/fines`, params)
export const exportFines = (params) => download(`${BASE}/fines/export`, params, 'library-fines.csv')
export const createFine = (body) => post(`${BASE}/fines`, body)
export const collectFines = (body) => post(`${BASE}/fines/collect`, body)
export const waiveFine = (id, reason) => post(`${BASE}/fines/${id}/waive`, { reason })
export const cancelFinePayment = (id, reason) => post(`${BASE}/fines/${id}/cancel-payment`, { reason })

// stock check (Library › Catalogue › Stock check)
export const fetchStockChecks = async () => (await api.get('/v1/library/stock-checks')).data.data
export const fetchStockCheck = async (id) => (await api.get(`/v1/library/stock-checks/${id}`)).data.data
export const startStockCheck = async (body) => (await api.post('/v1/library/stock-checks', body)).data.data
export const scanStock = async (id, code) => (await api.post(`/v1/library/stock-checks/${id}/scan`, { code })).data.data
export const closeStockCheck = async (id) => (await api.post(`/v1/library/stock-checks/${id}/close`)).data.data
