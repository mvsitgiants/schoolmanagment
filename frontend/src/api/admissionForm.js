import axios from 'axios'
import { API_BASE_URL, SERVER_DOWN_MESSAGE, isServerDown } from './client'

// A family's admission form, opened from the link the school sent (/admission-form/:slug/:token) — no sign-in.
const open = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } })
open.interceptors.response.use((r) => r, (err) => Promise.reject(Object.assign(err, {
  message: isServerDown(err) ? SERVER_DOWN_MESSAGE : err?.response?.data?.message || err.message || 'Something went wrong',
  status: err?.response?.status, code: err?.response?.data?.code, fields: err?.response?.data?.details?.fields,
})))
const base = (slug, token) => `/v1/public/admission-form/${encodeURIComponent(String(slug).toLowerCase())}/${encodeURIComponent(token)}`

export const fetchFamilyForm = async (slug, token) => (await open.get(base(slug, token))).data.data
export const submitFamilyForm = async (slug, token, body) => (await open.post(base(slug, token), body)).data.data
export const uploadFamilyFile = async (slug, token, file, { category, side, title } = {}) => (await open.post(`${base(slug, token)}/files`, file, {
  params: { category, side: side || undefined, title: title || undefined },
  headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'file') },
})).data.data
export const removeFamilyFile = async (slug, token, fileId) => (await open.delete(`${base(slug, token)}/files/${fileId}`)).data.data
