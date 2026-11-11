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
export const familyTimetable = (slug, id) => fget(slug, `${st(id)}/timetable`)
export const familyHomework = (slug, id, when) => fget(slug, `${st(id)}/homework`, { when: when || undefined })
export const familyFees = (slug, id) => fget(slug, `${st(id)}/fees`)
export const familyResults = (slug, id) => fget(slug, `${st(id)}/results`)
export const familyCertificates = (slug, id) => fget(slug, `${st(id)}/certificates`)
export const familyProfile = (slug, id) => fget(slug, `${st(id)}/profile`)

/** Links opened in a new tab (the session cookie goes with them). */
export const familyFileUrl = (slug, id, homeworkId, fileId) => `${API_BASE_URL}${base(slug)}${st(id)}/homework/${homeworkId}/files/${fileId}`
export const familyPushApi = (slug) => ({
  key: () => fget(slug, '/push/key'),
  save: (subscription) => fpost(slug, '/push', { subscription }),
  off: (endpoint) => fpost(slug, '/push/off', { endpoint }),
})
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

// learning (LMS)
export const familyLearning = (slug, id) => fget(slug, `${st(id)}/learning`)
export const familyCourse = (slug, id, courseId) => fget(slug, `${st(id)}/learning/courses/${courseId}`)
export const familyMarkItem = (slug, id, courseId, itemId, done) => fpost(slug, `${st(id)}/learning/courses/${courseId}/items/${itemId}`, { done })
export const familyJoinLive = (slug, id, liveId) => fpost(slug, `${st(id)}/learning/live/${liveId}/join`)
export const familyViewItem = (slug, id, courseId, itemId) => fpost(slug, `${st(id)}/learning/courses/${courseId}/items/${itemId}/view`, {})
export const familyItemFileUrl = (slug, id, courseId, itemId, fileId) => `${API_BASE_URL}${base(slug)}${st(id)}/learning/courses/${courseId}/items/${itemId}/files/${fileId}`

// online tests
export const familyTests = (slug, id) => fget(slug, `${st(id)}/tests`)
export const familyStartTest = (slug, id, testId) => fpost(slug, `${st(id)}/tests/${testId}/start`)
export const familyAttempt = (slug, id, attemptId) => fget(slug, `${st(id)}/attempts/${attemptId}`)
export const familySaveAnswer = async (slug, id, attemptId, body) => (await family.put(`${base(slug)}${st(id)}/attempts/${attemptId}/answers`, body)).data.data
export const familyTestEvent = (slug, id, attemptId, type) => fpost(slug, `${st(id)}/attempts/${attemptId}/events`, { type })
export const familySubmitTest = (slug, id, attemptId) => fpost(slug, `${st(id)}/attempts/${attemptId}/submit`)
export const familyTestResult = (slug, id, attemptId) => fget(slug, `${st(id)}/attempts/${attemptId}/result`)

// school bus (transport)
export const familyBus = (slug, id) => fget(slug, `${st(id)}/bus`)

// library
export const familyLibrary = (slug, id) => fget(slug, `${st(id)}/library`)
export const familyEbookFileUrl = (slug, id, titleId, fileId) => `${API_BASE_URL}${base(slug)}${st(id)}/library/ebooks/${titleId}/files/${fileId}`

// calendar, parent–teacher meetings, photos
export const familyCalendar = (slug, id, params) => fget(slug, `${st(id)}/calendar`, params)
export const familyEventReply = async (slug, id, eventId, body) => (await family.put(`${base(slug)}${st(id)}/events/${eventId}/reply`, body)).data.data
export const familyMeetings = (slug, id) => fget(slug, `${st(id)}/meetings`)
export const familyBookMeeting = (slug, id, sessionId, body) => fpost(slug, `${st(id)}/meetings/${sessionId}/book`, body)
export const familyCancelMeeting = async (slug, id, bookingId) => (await family.delete(`${base(slug)}${st(id)}/meetings/bookings/${bookingId}`)).data.data
export const familyAlbums = (slug, id) => fget(slug, `${st(id)}/albums`)
export const familyAlbum = (slug, id, albumId) => fget(slug, `${st(id)}/albums/${albumId}`)
export const familyPhotoUrl = (slug, id, albumId, fileId) => `${API_BASE_URL}${base(slug)}${st(id)}/albums/${albumId}/photos/${fileId}`

// hostel
export const familyHostel = (slug, id) => fget(slug, `${st(id)}/hostel`)
export const familyRequestOutpass = (slug, id, body) => fpost(slug, `${st(id)}/hostel/outpasses`, body)
export const familyCancelOutpass = (slug, id, outpassId) => fpost(slug, `${st(id)}/hostel/outpasses/${outpassId}/cancel`)

// health card
export const familyHealth = (slug, id) => fget(slug, `${st(id)}/health`)

// placements
export const familyPlacements = (slug, id) => fget(slug, `${st(id)}/placements`)
export const familyPlacementRegister = (slug, id, driveId, body) => fpost(slug, `${st(id)}/placements/${driveId}/register`, body)
export const familyPlacementWithdraw = (slug, id, driveId) => fpost(slug, `${st(id)}/placements/${driveId}/withdraw`)

// complaints (Front office)
export const familyComplaints = (slug, id) => fget(slug, `${st(id)}/complaints`)
export const familyRaiseComplaint = (slug, id, body) => fpost(slug, `${st(id)}/complaints`, body)

// surveys
export const familySurveys = (slug, id) => fget(slug, `${st(id)}/surveys`)
export const familySurvey = (slug, id, surveyId) => fget(slug, `${st(id)}/surveys/${surveyId}`)
export const familyAnswerSurvey = (slug, id, surveyId, values) => fpost(slug, `${st(id)}/surveys/${surveyId}`, { values })

// passes shown at school: event and meeting passes, early-pickup pass
export const familyPasses = (slug, studentId) => fget(slug, `/students/${studentId}/passes`)
export const familyPickupCreate = (slug, studentId, body) => fpost(slug, `/students/${studentId}/pickup-passes`, body)
export const familyPickupCancel = (slug, studentId, passId) => fpost(slug, `/students/${studentId}/pickup-passes/${passId}/cancel`, {})

// the student app: check in / out on the campus from the student's own phone (Settings › Attendance)
export const familySelfAttendance = (slug, studentId) => fget(slug, `/students/${studentId}/self-attendance`)
export const familySelfCheckIn = (slug, studentId, body) => fpost(slug, `/students/${studentId}/self-attendance`, body)
