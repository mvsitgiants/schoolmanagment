import api from './client'

// Alumni API (/api/v1/alumni). Functions return the unwrapped `data` (lists: { data, total, … }).
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

const BASE = '/v1/alumni'

export const fetchAlumniMeta = () => get(`${BASE}/meta`)
export const fetchAlumni = (params) => list(`${BASE}/directory`, params)
export const fetchAlumnus = (id) => get(`${BASE}/directory/${id}`)
export const saveAlumnus = (id, body) => (id ? patch(`${BASE}/directory/${id}`, body) : post(`${BASE}/directory`, body))
export const deleteAlumnus = (id) => del(`${BASE}/directory/${id}`)
export const exportAlumni = (params) => download(`${BASE}/directory/export`, params, 'alumni.csv')
export const fetchLeaverYears = () => get(`${BASE}/directory/leavers`)
export const fetchLeavers = (year) => get(`${BASE}/directory/leavers`, { year })
export const importLeavers = (body) => post(`${BASE}/directory/import-leavers`, body)

export const fetchDonations = (params) => list(`${BASE}/donations`, params)
export const fetchDonationSummary = (params) => get(`${BASE}/donations/summary`, params)
export const exportDonations = (params) => download(`${BASE}/donations/export`, params, 'alumni-donations.csv')
export const createDonation = (body) => post(`${BASE}/donations`, body)
