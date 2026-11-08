import api from './client'

// Communication hub API (/api/v1/communication).
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/communication'

export const previewAudience = (audience) => post(`${BASE}/audience/preview`, { audience })

export const fetchNotices = (params) => list(`${BASE}/notices`, params)
export const createNotice = (body) => post(`${BASE}/notices`, body)
export const updateNotice = (id, body) => patch(`${BASE}/notices/${id}`, body)
export const deleteNotice = (id) => del(`${BASE}/notices/${id}`)
export const publishNotice = (id, channels) => post(`${BASE}/notices/${id}/publish`, { channels })
export const withdrawNotice = (id) => post(`${BASE}/notices/${id}/withdraw`)

export const fetchBroadcasts = (params) => list(`${BASE}/broadcasts`, params)
export const sendBroadcast = (body) => post(`${BASE}/broadcasts`, body)

export const fetchMessageLog = (params) => list(`${BASE}/log`, params)
export const retryLoggedMessage = (id) => post(`${BASE}/log/${id}/retry`)

export const fetchConversations = (params) => get(`${BASE}/chat`, params)
export const fetchChatUnread = () => get(`${BASE}/chat/unread`)
export const fetchConversation = (id) => get(`${BASE}/chat/${id}`)
export const replyConversation = (id, text) => post(`${BASE}/chat/${id}/reply`, { text })
export const startConversation = (studentId, text) => post(`${BASE}/chat/start`, { studentId, text })
export const moderateConversation = (id, body) => post(`${BASE}/chat/${id}/moderate`, body)
