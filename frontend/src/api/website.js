import axios from 'axios'
import api, { API_BASE_URL, SERVER_DOWN_MESSAGE, isServerDown } from './client'

// Website API (/api/v1/website) for staff, and the public site (/api/v1/public/site/:slug) for visitors.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/website'

export const fetchSitePages = () => get(`${BASE}/pages`)
export const fetchSitePage = (id) => get(`${BASE}/pages/${id}`)
export const createSitePage = (body) => post(`${BASE}/pages`, body)
export const saveSitePage = (id, body) => patch(`${BASE}/pages/${id}`, body)
export const deleteSitePage = (id) => del(`${BASE}/pages/${id}`)
export const reorderSitePages = (ids) => put(`${BASE}/pages/order`, { ids })
export const previewSitePage = (id) => get(`${BASE}/pages/${id}/preview`)
export const publishSitePage = (id) => post(`${BASE}/pages/${id}/publish`)
export const unpublishSitePage = (id) => post(`${BASE}/pages/${id}/unpublish`)
export const fetchSiteSettings = () => get(`${BASE}/site`)
export const saveSiteSettings = (body) => put(`${BASE}/site`, body)
export const fetchSiteImages = () => get(`${BASE}/images`)
export const uploadSiteImage = (body) => post(`${BASE}/images`, body)
export const deleteSiteImage = (id) => del(`${BASE}/images/${id}`)
/** A picture for the staff screens (session cookie). */
export const staffImageUrl = (id) => `${API_BASE_URL}${BASE}/images/${id}`

// ───────────────────────────────────────────────────────── the public site — no sign-in
const open = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } })
open.interceptors.response.use((r) => r, (err) => Promise.reject(Object.assign(err, {
  message: isServerDown(err) ? SERVER_DOWN_MESSAGE : err?.response?.data?.message || err.message || 'Something went wrong',
  status: err?.response?.status, code: err?.response?.data?.code,
})))
const pub = (slug) => `/v1/public/site/${encodeURIComponent(String(slug).toLowerCase())}`
export const publicSitePage = async (slug, page) => (await open.get(page ? `${pub(slug)}/pages/${encodeURIComponent(page)}` : pub(slug))).data.data
export const publicImageUrl = (slug, id) => `${API_BASE_URL}${pub(slug)}/images/${id}`
