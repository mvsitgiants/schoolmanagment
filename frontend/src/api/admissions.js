import axios from 'axios'
import api, { API_BASE_URL, SERVER_DOWN_MESSAGE, isServerDown } from './client'

// Admissions API (/api/v1/admissions). Paged lists return { data, meta }; the rest the unwrapped data.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/admissions'

export const fetchCycles = () => get(`${BASE}/cycles`)
export const createCycle = (body) => post(`${BASE}/cycles`, body)
export const updateCycle = (id, body) => patch(`${BASE}/cycles/${id}`, body)
export const setCycleStatus = (id, status) => post(`${BASE}/cycles/${id}/status`, { status })

export const fetchEnquiries = (params) => list(`${BASE}/enquiries`, params)
export const fetchEnquiry = (id) => get(`${BASE}/enquiries/${id}`)
export const createEnquiry = (body) => post(`${BASE}/enquiries`, body)
export const updateEnquiry = (id, body) => patch(`${BASE}/enquiries/${id}`, body)
export const deleteEnquiry = (id) => del(`${BASE}/enquiries/${id}`)
export const addFollowUp = (id, body) => post(`${BASE}/enquiries/${id}/follow-ups`, body)

export const fetchApplications = (params) => list(`${BASE}/applications`, params)
export const fetchApplication = (id) => get(`${BASE}/applications/${id}`)
export const createApplication = (body) => post(`${BASE}/applications`, body)
export const updateApplication = (id, body) => patch(`${BASE}/applications/${id}`, body)
export const setApplicationStatus = (id, status, note) => post(`${BASE}/applications/${id}/status`, { status, note })
export const admitApplicant = (id, body) => post(`${BASE}/applications/${id}/admit`, body)

export const fetchTests = (cycleId) => get(`${BASE}/tests`, { cycleId: cycleId || undefined })
export const createTest = (body) => post(`${BASE}/tests`, body)
export const updateTest = (id, body) => patch(`${BASE}/tests/${id}`, body)
export const deleteTest = (id) => del(`${BASE}/tests/${id}`)
export const assignTest = (id, applicationIds) => post(`${BASE}/tests/${id}/assign`, { applicationIds })
export const fetchTestMarks = (id) => get(`${BASE}/tests/${id}/marks`)
export const saveTestMarks = (id, entries) => put(`${BASE}/tests/${id}/marks`, { entries })

export const fetchMerit = (cycleId, classId) => get(`${BASE}/merit/${cycleId}/${classId}`)
export const publishMerit = (cycleId, classId) => post(`${BASE}/merit/${cycleId}/${classId}/publish`)
export const allotSeats = (cycleId, classId) => post(`${BASE}/merit/${cycleId}/${classId}/allot`)

// ───────────────────────────────────────────────────────── the families' side (/apply/:slug) — no sign-in
const open = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } })
open.interceptors.response.use((r) => r, (err) => Promise.reject(Object.assign(err, {
  message: isServerDown(err) ? SERVER_DOWN_MESSAGE : err?.response?.data?.message || err.message || 'Something went wrong',
  status: err?.response?.status, code: err?.response?.data?.code, fields: err?.response?.data?.details?.fields,
})))
const pb = (slug) => `/v1/public/admissions/${encodeURIComponent(String(slug).toLowerCase())}`
export const publicAdmissions = async (slug) => (await open.get(pb(slug))).data.data
export const publicEnquiry = async (slug, body) => (await open.post(`${pb(slug)}/enquiry`, body)).data.data
export const publicSendCode = async (slug, mobile) => (await open.post(`${pb(slug)}/otp`, { mobile })).data.data
export const publicVerify = async (slug, challengeId, code) => (await open.post(`${pb(slug)}/verify`, { challengeId, code })).data.data
export const publicApply = async (slug, body) => (await open.post(`${pb(slug)}/apply`, body)).data.data
export const publicMyApplications = async (slug, pass) => (await open.post(`${pb(slug)}/applications`, { pass })).data.data
export const publicAcceptOffer = async (slug, pass, id) => (await open.post(`${pb(slug)}/applications/${id}/accept`, { pass })).data.data
