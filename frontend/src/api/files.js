import api from './client'

// Files and discussion on any record — a student, a receipt, a staff record (engine E15).
const get = async (url, params) => (await api.get(url, { params })).data.data

export const fetchFiles = (entityType, entityId) => get('/v1/files', { entityType, entityId })
export const fetchStudentFiles = (studentId, includeDeleted) => get('/v1/files', { studentId, includeDeleted: includeDeleted ? '1' : undefined })
export const uploadFile = async (entityType, entityId, file, { category, title, side } = {}) => (await api.post('/v1/files', file, {
  params: { entityType, entityId, category, title: title || undefined, side: side || undefined },
  headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'file') },
})).data.data
export const downloadFile = (id) => api.get(`/v1/files/${id}/content`, { responseType: 'blob' })
/** The office checked a document against the original: VERIFIED, REJECTED (note says why) or PENDING again. */
export const verifyFile = async (id, status, note) => (await api.patch(`/v1/files/${id}/verify`, { status, note: note || undefined })).data.data
export const deleteFile = async (id, reason) => (await api.delete(`/v1/files/${id}`, { data: { reason } })).data.data

export const fetchComments = (entityType, entityId) => get('/v1/comments', { entityType, entityId })
export const addComment = async (entityType, entityId, body, parentId) => (await api.post('/v1/comments', { entityType, entityId, body, parentId: parentId || null })).data.data
export const editComment = async (id, body) => (await api.patch(`/v1/comments/${id}`, { body })).data.data
export const deleteComment = async (id) => (await api.delete(`/v1/comments/${id}`)).data.data
