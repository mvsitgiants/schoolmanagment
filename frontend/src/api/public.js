import axios from 'axios'
import api, { API_BASE_URL, SERVER_DOWN_MESSAGE, isServerDown } from './client'
import { blobError, fileNameOf } from './documents'

export async function fetchPublicPlans() {
  const res = await api.get('/v1/public/plans')
  return { plans: res.data.data, signupEnabled: res.data.meta?.signupEnabled !== false }
}

export const verifyPrescription = async (code) => (await api.get(`/v1/public/rx/${code}`)).data.data
export const verifyLabReport = async (code) => (await api.get(`/v1/public/lab/${code}`)).data.data

// links sent to patients (prescription, lab report)
export const openSharedDocument = async (token) => (await api.get(`/v1/public/share/${token}`)).data.data

// online booking — /book/:slug
export const fetchBookingInfo = async (slug) => (await api.get(`/v1/public/book/${slug}`)).data.data
export const fetchBookingSlots = async (slug, doctorId, date) => (await api.get(`/v1/public/book/${slug}/slots`, { params: { doctorId, date } })).data.data
/** `who`: { mobile } or { email } — whichever the institution allows (info.signIn). */
export const sendBookingOtp = async (slug, who) => (await api.post(`/v1/public/book/${slug}/otp`, who)).data.data
export const verifyBookingOtp = async (slug, challengeId, code) => (await api.post(`/v1/public/book/${slug}/verify`, { challengeId, code })).data.data
export const bookOnline = async (slug, body) => (await api.post(`/v1/public/book/${slug}/appointments`, body)).data.data
export const verifyRadReport = async (code) => (await api.get(`/v1/public/rad/${code}`)).data.data
// the QR on a staff ID card — /verify/staff/:token
export const verifyStaffCard = async (token) => (await api.get(`/v1/public/staff/${encodeURIComponent(token)}`)).data.data

// Imaging shared with an outside doctor — /r/:token. Its own client: the visitor is not a
// staff user, so the staff client's refresh-and-sign-in handling must never run here.
const share = axios.create({ baseURL: API_BASE_URL, withCredentials: false, headers: { 'Content-Type': 'application/json' } })
share.interceptors.response.use((r) => r, (err) => Promise.reject(Object.assign(err, {
  message: isServerDown(err) ? SERVER_DOWN_MESSAGE : err?.response?.data?.message || err.message || 'Something went wrong',
  status: err?.response?.status,
  code: err?.response?.data?.code,
})))
const sbase = (token) => `/v1/public/rshare/${encodeURIComponent(token)}`
const vbase = (token, pass) => `${sbase(token)}/${encodeURIComponent(pass)}`
export const fetchSharedImaging = async (token) => (await share.get(sbase(token))).data.data
export const openSharedImaging = async (token, pin) => (await share.post(`${sbase(token)}/open`, pin ? { pin } : {})).data.data
export const sharedImageList = async (token, pass) => (await share.get(`${vbase(token, pass)}/images`)).data.data
export const sharedImageUrl = (token, pass, imageId) => `${API_BASE_URL}${vbase(token, pass)}/images/${imageId}/content`
export const sharedPacsUrl = (token, pass, instanceId) => `${API_BASE_URL}${vbase(token, pass)}/pacs/${instanceId}/file`
export const sharedImageBlob = async (token, pass, imageId) => (await share.get(`${vbase(token, pass)}/images/${imageId}/content`, { responseType: 'blob' })).data
export const sharedPacsPreviewBlob = async (token, pass, instanceId) => (await share.get(`${vbase(token, pass)}/pacs/${instanceId}/preview`, { responseType: 'blob' })).data
/** The signed report as a PDF (rejects with code PDF_UNAVAILABLE when the server can't make one — print the page copy instead). */
export async function sharedReportPdf(token, pass) {
  try {
    const res = await share.get(`${vbase(token, pass)}/report.pdf`, { responseType: 'blob' })
    return { blob: res.data, fileName: fileNameOf(res.headers, 'report.pdf') }
  } catch (err) { throw await blobError(err) }
}

/** The maintenance / announcement banner (Superadmin › Settings), or null. */
export const fetchNotice = async () => (await api.get('/v1/public/notice')).data.data
