import api from './client'

// Staff chat & call bell (/api/v1/comms): calls & emergency alerts (paging), and staff chat. Live
// updates arrive over the socket (context/RealtimeContext.jsx, events page:* and chat:*); these
// calls load and act (chat sends go over the socket when it is connected, REST otherwise).
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data

// ── call bell
export const fetchPagingMeta = () => get('/v1/comms/paging/meta')
export const searchPagingDirectory = (search, { all } = {}) => get('/v1/comms/paging/directory', { search: search || undefined, all: all ? '1' : undefined })

export const createPageCall = (body) => post('/v1/comms/paging/calls', body)
export const fetchActiveCalls = () => get('/v1/comms/paging/calls/active')
export const fetchIncomingCalls = () => get('/v1/comms/paging/incoming')
export const fetchCallLog = (params) => get('/v1/comms/paging/calls', params)
export const exportCallLog = async (params) => (await api.get('/v1/comms/paging/calls/export', { params, responseType: 'blob' })).data
export const fetchPageCall = (id) => get(`/v1/comms/paging/calls/${id}`)
export const respondToCall = (id, body) => post(`/v1/comms/paging/calls/${id}/respond`, body)
export const closePageCall = (id, note) => post(`/v1/comms/paging/calls/${id}/close`, { note })

// ── emergency alerts (institution wording over the product defaults)
export const fetchPageCodes = () => get('/v1/comms/codes')
export const savePageCode = (code, body) => put(`/v1/comms/codes/${code}`, body)
export const resetPageCode = (code) => del(`/v1/comms/codes/${code}`)

// ── staff chat
const C = '/v1/comms/chat'
export const fetchChatChannels = () => get(`${C}/channels`)
export const fetchChatChannel = (id) => get(`${C}/channels/${id}`)
export const fetchChatMessages = (id, params) => get(`${C}/channels/${id}/messages`, params)
export const fetchChatMembers = (id, search) => get(`${C}/channels/${id}/members`, { search: search || undefined })
export const fetchChatFiles = (id) => get(`${C}/channels/${id}/files`)
export const fetchChatPeople = (search) => get(`${C}/people`, { search: search || undefined })
export const findDirectChat = (userId) => get(`${C}/direct/${userId}`)
/** Make the direct chat now (before its first message) — e.g. to attach a file to it. */
export const openDirectChat = (userId) => post(`${C}/direct/${userId}`)
export const searchChat = (q, channelId) => get(`${C}/search`, { q, channelId: channelId || undefined })
export const fetchChatSettings = () => get(`${C}/settings`)
export const fetchChatSources = () => get(`${C}/sources`)
export const saveChatSettings = (body) => put(`${C}/settings`, body)

export const createChatGroup = (body) => post(`${C}/channels`, { type: 'GROUP', ...body })
export const createAutoChatChannel = (type, sourceId) => post(`${C}/channels`, { type, sourceId: sourceId || undefined })
export const updateChatChannel = (id, body) => patch(`${C}/channels/${id}`, body)
export const updateChatPrefs = (id, body) => patch(`${C}/channels/${id}/me`, body)
export const addChatMembers = (id, userIds) => post(`${C}/channels/${id}/members`, { userIds })
export const setChatMemberRole = (id, userId, role) => patch(`${C}/channels/${id}/members/${userId}`, { role })
export const removeChatMember = (id, userId) => del(`${C}/channels/${id}/members/${userId}`)
export const deleteChatGroup = (id) => del(`${C}/channels/${id}`)

export const sendChatMessageRest = (id, body) => post(`${C}/channels/${id}/messages`, body)
export const sendDirectMessageRest = (userId, body) => post(`${C}/direct/${userId}/messages`, body)
export const markChatReadRest = (id, messageId) => post(`${C}/channels/${id}/read`, messageId ? { messageId } : {})
export const editChatMessageRest = (id, text, mentions) => patch(`${C}/messages/${id}`, { text, mentions })
export const deleteChatMessageRest = (id) => del(`${C}/messages/${id}`)
export const reactChatMessageRest = (id, emoji) => post(`${C}/messages/${id}/react`, { emoji })
export const pinChatMessageRest = (id, pinned) => post(`${C}/messages/${id}/pin`, { pinned })
export const uploadChatAttachment = async (id, file) => (await api.post(`${C}/channels/${id}/attachments`, file, {
  headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'file') },
})).data.data
