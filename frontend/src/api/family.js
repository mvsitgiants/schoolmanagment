import axios from 'axios'
import api, { API_BASE_URL, SERVER_DOWN_MESSAGE, isServerDown } from './client'

// The parent & student app. Staff screens (App settings, App content) use the normal client.
const get = async (url, params) => (await api.get(url, { params })).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
export const fetchAppLink = () => get('/v1/portal/link')
export const fetchAppSettings = () => get('/v1/portal/settings')
export const saveAppSettings = (body) => put('/v1/portal/settings', body)
export const fetchAppContent = () => get('/v1/portal/content')
export const saveAppContent = (body) => put('/v1/portal/content', body)

// ───────────────────────────────────────────────────────── the families' side
// Its own client: a family is not a staff user, so none of the staff client's refresh-and-redirect
// handling applies. The session is an httpOnly cookie scoped to /api/v1/family/<school>; a 401
// just means "show the sign-in screen".

const family = axios.create({ baseURL: API_BASE_URL, withCredentials: true, headers: { 'Content-Type': 'application/json' } })
family.interceptors.response.use((r) => r, (err) => Promise.reject(Object.assign(err, {
  message: isServerDown(err) ? SERVER_DOWN_MESSAGE : err?.response?.data?.message || err.message || 'Something went wrong',
  status: err?.response?.status,
  code: err?.response?.data?.code,
})))

// lower-case: the session cookie is scoped to the exact (lower-case) path of the school
const base = (slug) => `/v1/family/${encodeURIComponent(String(slug).toLowerCase())}`
const fget = async (slug, path, params) => (await family.get(`${base(slug)}${path}`, { params })).data.data
const fpost = async (slug, path, body) => (await family.post(`${base(slug)}${path}`, body)).data.data

export const familyInfo = (slug) => fget(slug, '')
export const familySendCode = (slug, mobile) => fpost(slug, '/otp', { mobile })
export const familyVerify = (slug, challengeId, code) => fpost(slug, '/verify', { challengeId, code })
export const familyMe = (slug) => fget(slug, '/me')
export const familyLogout = (slug) => fpost(slug, '/logout')

const st = (id) => `/students/${encodeURIComponent(id)}`
export const familyHome = (slug, id) => fget(slug, `${st(id)}/home`)
export const familyAttendance = (slug, id, month) => fget(slug, `${st(id)}/attendance`, { month: month || undefined })
export const familyApplyLeave = (slug, id, body) => fpost(slug, `${st(id)}/leave`, body)
export const familyCancelLeave = (slug, id, leaveId) => fpost(slug, `${st(id)}/leave/${leaveId}/cancel`)
export const familyHomework = (slug, id, when) => fget(slug, `${st(id)}/homework`, { when: when || undefined })
export const familyFees = (slug, id) => fget(slug, `${st(id)}/fees`)
export const familyResults = (slug, id) => fget(slug, `${st(id)}/results`)
export const familyCertificates = (slug, id) => fget(slug, `${st(id)}/certificates`)
export const familyProfile = (slug, id) => fget(slug, `${st(id)}/profile`)

/** Links opened in a new tab (the session cookie goes with them). */
export const familyFileUrl = (slug, id, homeworkId, fileId) => `${API_BASE_URL}${base(slug)}${st(id)}/homework/${homeworkId}/files/${fileId}`
export const familyDocUrl = (slug, docType, recordId) => `${API_BASE_URL}${base(slug)}/doc/${docType}/${recordId}`
export const familyManifestUrl = (slug) => `${API_BASE_URL}${base(slug)}/manifest.webmanifest`

// notices and chat (Communication hub)
export const familyNotices = (slug, id) => fget(slug, `${st(id)}/notices`)
export const familyReadNotice = (slug, id, noticeId) => fpost(slug, `${st(id)}/notices/${noticeId}/read`)
export const familyNoticeFileUrl = (slug, id, noticeId, fileId) => `${API_BASE_URL}${base(slug)}${st(id)}/notices/${noticeId}/files/${fileId}`
export const familyChatTeachers = (slug, id) => fget(slug, `${st(id)}/chat/teachers`)
export const familyChats = (slug, id) => fget(slug, `${st(id)}/chat`)
export const familyChatThread = (slug, id, conversationId) => fget(slug, `${st(id)}/chat/${conversationId}`)
export const familyChatSend = (slug, id, body) => fpost(slug, `${st(id)}/chat`, body)

// pay fees online (the school's own Razorpay account)
export const familyPayStart = (slug, id) => fpost(slug, `${st(id)}/pay`)
export const familyPayVerify = (slug, id, body) => fpost(slug, `${st(id)}/pay/verify`, body)
