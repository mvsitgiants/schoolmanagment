import api from './client'

// Accreditation API (/api/v1/accreditation): reports (NAAC, NIRF, AISHE) metric by metric and the evidence repository.
// Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data
const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined))

const BASE = '/v1/accreditation'

export const fetchAccrMeta = () => get(`${BASE}/meta`)

export const fetchAccrReport = (framework, year) => get(`${BASE}/reports`, { framework, year })
export const saveAccrMetric = (framework, year, code, body) => put(`${BASE}/reports/${framework}/${year}/metrics/${encodeURIComponent(code)}`, body)
/** The report as a CSV download. */
export async function exportAccrReport(framework, year) {
  const res = await api.get(`${BASE}/reports/export`, { params: { framework, year }, responseType: 'blob' })
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = `${framework}-${year}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}

export const fetchEvidence = (params) => get(`${BASE}/evidence`, clean(params))
export const fetchEvidenceItem = (id) => get(`${BASE}/evidence/${id}`)
export const saveEvidence = (id, body) => (id ? patch(`${BASE}/evidence/${id}`, body) : post(`${BASE}/evidence`, body))
export const setEvidenceDvv = (id, body) => post(`${BASE}/evidence/${id}/dvv`, body)
export const deleteEvidence = (id) => del(`${BASE}/evidence/${id}`)
