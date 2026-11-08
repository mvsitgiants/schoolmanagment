import api from './client'

// Events & calendar API (/api/v1/events). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
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

const BASE = '/v1/events'

export const fetchCalendar = (from, to) => get(`${BASE}/calendar`, { from, to })
export const downloadIcs = (from, to) => download(`${BASE}/calendar.ics`, { from, to }, 'school-calendar.ics')
export const fetchEvents = (params) => get(`${BASE}/events`, params)
export const fetchEvent = (id) => get(`${BASE}/events/${id}`)
export const saveEvent = (id, body) => (id ? patch(`${BASE}/events/${id}`, body) : post(`${BASE}/events`, body))
export const deleteEvent = (id) => del(`${BASE}/events/${id}`)
export const publishEvent = (id, notify) => post(`${BASE}/events/${id}/publish`, { notify })
export const unpublishEvent = (id) => post(`${BASE}/events/${id}/unpublish`)
export const fetchReplies = (id, answer) => get(`${BASE}/events/${id}/replies`, answer ? { answer } : {})
export const exportReplies = (id) => download(`${BASE}/events/${id}/replies/export`, {}, 'event-replies.csv')
export const saveReply = (id, body) => put(`${BASE}/events/${id}/replies`, body)

export const fetchSessions = (when) => get(`${BASE}/ptm`, { when })
export const fetchMyMeetings = () => get(`${BASE}/ptm/mine`)
export const fetchClassTeachers = (classIds = [], sectionIds = []) => get(`${BASE}/ptm/class-teachers`, { classIds: classIds.join(','), sectionIds: sectionIds.join(',') })
export const fetchSession = (id) => get(`${BASE}/ptm/${id}`)
export const exportSession = (id) => download(`${BASE}/ptm/${id}/export`, {}, 'parent-teacher-meeting.csv')
export const saveSession = (id, body) => (id ? patch(`${BASE}/ptm/${id}`, body) : post(`${BASE}/ptm`, body))
export const deleteSession = (id) => del(`${BASE}/ptm/${id}`)
export const openBooking = (id, notify) => post(`${BASE}/ptm/${id}/open`, { notify })
export const setSessionStatus = (id, status) => post(`${BASE}/ptm/${id}/status`, { status })
export const bookSlot = (id, body) => post(`${BASE}/ptm/${id}/bookings`, body)
export const updateBooking = (id, body) => patch(`${BASE}/ptm/bookings/${id}`, body)

export const fetchAlbums = () => get(`${BASE}/albums`)
export const fetchAlbum = (id) => get(`${BASE}/albums/${id}`)
export const saveAlbum = (id, body) => (id ? patch(`${BASE}/albums/${id}`, body) : post(`${BASE}/albums`, body))
export const deleteAlbum = (id) => del(`${BASE}/albums/${id}`)
