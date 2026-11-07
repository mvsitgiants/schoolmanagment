import api from './client'

// Certificates API (/api/v1/certificates) and the public verify check.
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data

const BASE = '/v1/certificates'

export const fetchCertificates = (params) => list(BASE, params)
export const previewCertificate = (body) => post(`${BASE}/preview`, body)
export const issueCertificates = (body) => post(BASE, body)
export const cancelCertificate = (id, reason) => post(`${BASE}/${id}/cancel`, { reason })

/** No sign-in needed: anyone holding the certificate can check it. */
export const verifyCertificate = async (code) => (await api.get(`/v1/public/verify/certificate/${encodeURIComponent(code)}`)).data.data
