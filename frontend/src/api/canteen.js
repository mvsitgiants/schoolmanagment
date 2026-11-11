import axios from 'axios'
import api, { API_BASE_URL, SERVER_DOWN_MESSAGE, isServerDown } from './client'

// Canteen & wallet API (/api/v1/canteen). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/canteen'

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

// menu and specials
export const fetchMenu = () => get(`${BASE}/menu`)
export const saveMenuItem = (id, body) => (id ? patch(`${BASE}/menu/${id}`, body) : post(`${BASE}/menu`, body))
export const deleteMenuItem = (id) => del(`${BASE}/menu/${id}`)
export const setSoldOut = (id, soldOut) => post(`${BASE}/menu/${id}/sold-out`, { soldOut })
export const fetchSpecials = (params) => get(`${BASE}/specials`, params)
export const saveSpecial = (body) => post(`${BASE}/specials`, body)
export const deleteSpecial = (id) => del(`${BASE}/specials/${id}`)

// counter
export const fetchTodayMenu = (date) => get(`${BASE}/today`, { date: date || undefined })
export const findStudents = (q) => get(`${BASE}/find`, { q })
export const fetchOrders = (params) => get(`${BASE}/orders`, params)
export const fetchAllOrders = (params) => allRows(fetchOrders, params)
export const fetchPreorders = (date) => get(`${BASE}/preorders`, { date: date || undefined })
export const createOrder = (body) => post(`${BASE}/orders`, body)
export const orderReady = (id) => post(`${BASE}/orders/${id}/ready`)
export const orderCollected = (id) => post(`${BASE}/orders/${id}/collect`)
export const fetchTokenBoard = (branchId) => get(`${BASE}/tokens`, { branchId: branchId || undefined })
export const fetchDaySummary = (date) => get(`${BASE}/summary`, { date: date || undefined })

// wallets
export const fetchWallets = (params) => get(`${BASE}/wallets`, params)
export const fetchWallet = (studentId) => get(`${BASE}/wallets/${studentId}`)
export const topUpWallet = (studentId, body) => post(`${BASE}/wallets/${studentId}/topup`, body)
export const refundWallet = (studentId, body) => post(`${BASE}/wallets/${studentId}/refund`, body)
export const adjustWallet = (studentId, body) => post(`${BASE}/wallets/${studentId}/adjust`, body)
export const saveWalletControls = (studentId, body) => put(`${BASE}/wallets/${studentId}/controls`, body)
export const recheckTopup = (id) => post(`${BASE}/topups/${id}/recheck`)

// ───────────────────────────────────────────────────────── the family app (/app/:slug › Canteen)
// A family is not a staff user: its own client, cookie-scoped to /api/v1/family/<school> (as in api/family.js).
const family = axios.create({ baseURL: API_BASE_URL, withCredentials: true, headers: { 'Content-Type': 'application/json' } })
family.interceptors.response.use((r) => r, (err) => Promise.reject(Object.assign(err, {
  message: isServerDown(err) ? SERVER_DOWN_MESSAGE : err?.response?.data?.message || err.message || 'Something went wrong',
  status: err?.response?.status,
  code: err?.response?.data?.code,
})))
const fam = (slug, id) => `/v1/family/${encodeURIComponent(String(slug).toLowerCase())}/students/${encodeURIComponent(id)}/canteen`
export const familyCanteen = async (slug, id) => (await family.get(fam(slug, id))).data.data
export const familyCanteenControls = async (slug, id, body) => (await family.put(`${fam(slug, id)}/controls`, body)).data.data
export const familyPreorder = async (slug, id, body) => (await family.post(`${fam(slug, id)}/preorders`, body)).data.data
export const familyCancelPreorder = async (slug, id, orderId) => (await family.post(`${fam(slug, id)}/preorders/${orderId}/cancel`)).data.data
export const familyTopupStart = async (slug, id, amount) => (await family.post(`${fam(slug, id)}/topup`, { amount })).data.data
export const familyTopupVerify = async (slug, id, body) => (await family.post(`${fam(slug, id)}/topup/verify`, body)).data.data
