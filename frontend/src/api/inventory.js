import api from './client'

// Store & assets API (/api/v1/inventory). Functions return the unwrapped `data` (lists: { data, total, … }).
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

const BASE = '/v1/inventory'

export const fetchInventoryMeta = () => get(`${BASE}/meta`)

// items
export const fetchItems = (params) => list(`${BASE}/items`, params)
export const fetchItem = (id, params) => get(`${BASE}/items/${id}`, params)
export const saveItem = (id, body) => (id ? patch(`${BASE}/items/${id}`, body) : post(`${BASE}/items`, body))
export const deleteItem = (id) => del(`${BASE}/items/${id}`)
export const importItems = (rows, dryRun) => post(`${BASE}/items/import`, { rows, dryRun })
export const exportItems = (params) => download(`${BASE}/items/export`, params, 'store-items.csv')

// stock
export const fetchStock = (params) => get(`${BASE}/stock`, params)
export const exportStock = (params) => download(`${BASE}/stock/export`, params, 'store-stock.csv')
export const importOpeningStock = (rows, dryRun, branchId) => post(`${BASE}/stock/import`, { rows, dryRun, branchId })
export const fetchMoves = (params) => list(`${BASE}/moves`, params)
export const issueStock = (body) => post(`${BASE}/stock/issue`, body)
export const returnStock = (body) => post(`${BASE}/stock/return`, body)
export const adjustStock = (body) => post(`${BASE}/stock/adjust`, body)
export const fetchCounts = (params) => get(`${BASE}/counts`, params)
export const fetchCount = (id) => get(`${BASE}/counts/${id}`)
export const startCount = (body) => post(`${BASE}/counts`, body)
export const saveCount = (id, lines) => patch(`${BASE}/counts/${id}`, { lines })
export const postCount = (id) => post(`${BASE}/counts/${id}/post`)
export const cancelCount = (id) => post(`${BASE}/counts/${id}/cancel`)

// vendors & purchase orders
export const fetchVendors = (params) => get(`${BASE}/vendors`, params)
export const saveVendor = (id, body) => (id ? patch(`${BASE}/vendors/${id}`, body) : post(`${BASE}/vendors`, body))
export const deleteVendor = (id) => del(`${BASE}/vendors/${id}`)
export const fetchPos = (params) => list(`${BASE}/purchase-orders`, params)
export const exportPos = (params) => download(`${BASE}/purchase-orders/export`, params, 'purchase-orders.csv')
export const fetchPo = (id) => get(`${BASE}/purchase-orders/${id}`)
export const savePo = (id, body) => (id ? patch(`${BASE}/purchase-orders/${id}`, body) : post(`${BASE}/purchase-orders`, body))
export const submitPo = (id) => post(`${BASE}/purchase-orders/${id}/submit`)
export const approvePo = (id, note) => post(`${BASE}/purchase-orders/${id}/approve`, { note })
export const sendBackPo = (id, reason) => post(`${BASE}/purchase-orders/${id}/send-back`, { reason })
export const cancelPo = (id, reason) => post(`${BASE}/purchase-orders/${id}/cancel`, { reason })
export const receivePo = (id, body) => post(`${BASE}/purchase-orders/${id}/receive`, body)

// sales
export const searchSaleStudents = (search) => get(`${BASE}/students`, { search })
export const fetchSales = (params) => list(`${BASE}/sales`, params)
export const exportSales = (params) => download(`${BASE}/sales/export`, params, 'store-sales.csv')
export const createSale = (body) => post(`${BASE}/sales`, body)
export const cancelSale = (id, reason) => post(`${BASE}/sales/${id}/cancel`, { reason })

// assets
export const fetchAssets = (params) => get(`${BASE}/assets`, params)
export const fetchAsset = (id) => get(`${BASE}/assets/${id}`)
export const saveAsset = (id, body) => (id ? patch(`${BASE}/assets/${id}`, body) : post(`${BASE}/assets`, body))
export const deleteAsset = (id) => del(`${BASE}/assets/${id}`)
export const addMaintenance = (id, body) => post(`${BASE}/assets/${id}/maintenance`, body)
export const removeMaintenance = (id, entryId) => del(`${BASE}/assets/${id}/maintenance/${entryId}`)
export const disposeAsset = (id, body) => post(`${BASE}/assets/${id}/dispose`, body)
