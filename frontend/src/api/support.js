import api from './client'

// Help & support. The school's side (/api/v1/support) and the team's (/api/v1/superadmin/support).
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const upload = async (url, file, params) => (await api.post(url, file, {
  params, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'file') },
})).data.data

// the school
export const fetchSupportContact = () => get('/v1/support/contact')
export const fetchMyTickets = (status) => get('/v1/support/tickets', { status: status || undefined })
export const fetchMyTicket = (id) => get(`/v1/support/tickets/${id}`)
export const createTicket = (body) => post('/v1/support/tickets', body)
export const replyTicket = (id, body) => post(`/v1/support/tickets/${id}/messages`, body)
export const solveTicket = (id, body) => post(`/v1/support/tickets/${id}/solve`, body ?? {})
export const uploadSupportFile = (file) => upload('/v1/support/files', file)
/** The file as a blob (for the document viewer); signed-in calls, so the session goes along. */
export const loadSupportFile = (id) => api.get(`/v1/support/files/${id}`, { responseType: 'blob' })

// the team (platform console)
export const fetchSupportInbox = (params) => get('/v1/superadmin/support', params)
export const fetchSupportStaff = () => get('/v1/superadmin/support/staff')
export const fetchTeamTicket = (id) => get(`/v1/superadmin/support/${id}`)
export const teamReply = (id, body) => post(`/v1/superadmin/support/${id}/messages`, body)
export const updateTeamTicket = (id, body) => patch(`/v1/superadmin/support/${id}`, body)
export const uploadTeamFile = (file, tenantId) => upload('/v1/superadmin/support/files', file, { tenantId })
export const loadTeamFile = (id) => api.get(`/v1/superadmin/support/files/${id}`, { responseType: 'blob' })
