import api from './client'
import { downloadBlob } from '../utils/download'

// Institution workspace API (/api/v1/core). Every function returns the unwrapped `data`
// (lists with paging return `{ data, meta }`).

const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
export const importUsers = (rows, dryRun) => post('/v1/core/users/import', { rows, dryRun })
export const importDepartments = (rows, dryRun) => post('/v1/core/departments/import', { rows, dryRun })
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url, body) => (await api.delete(url, { data: body })).data.data

// settings & setup
export const fetchSettings = () => get('/v1/core/settings')
export const saveSettings = (body) => patch('/v1/core/settings', body)
export const fetchSetup = () => get('/v1/core/setup')
export const fetchNotifications = () => get('/v1/core/notifications')

// branches & departments
export const fetchBranches = () => get('/v1/core/branches')
export const createBranch = (body) => post('/v1/core/branches', body)
export const updateBranch = (id, body) => patch(`/v1/core/branches/${id}`, body)
export const deleteBranch = (id) => del(`/v1/core/branches/${id}`)
export const fetchDepartments = () => get('/v1/core/departments')
export const createDepartment = (body) => post('/v1/core/departments', body)
export const updateDepartment = (id, body) => patch(`/v1/core/departments/${id}`, body)
export const deleteDepartment = (id) => del(`/v1/core/departments/${id}`)

// users
export const fetchUsers = (params) => list('/v1/core/users', params)
export const fetchUserLookup = () => get('/v1/core/users/lookup')
export const fetchUser = (id) => get(`/v1/core/users/${id}`)
export const createUser = (body) => post('/v1/core/users', body)
export const updateUser = (id, body) => patch(`/v1/core/users/${id}`, body)
export const setUserActive = (id, active) => post(`/v1/core/users/${id}/${active ? 'activate' : 'deactivate'}`)
export const resetUserPassword = (id) => post(`/v1/core/users/${id}/reset-password`)
export const resendUserInvite = (id) => post(`/v1/core/users/${id}/invite`)
export const revokeUserSessions = (id) => post(`/v1/core/users/${id}/revoke-sessions`)

// roles & permissions
export const fetchCatalog = () => get('/v1/core/permissions/catalog')
export const fetchRoles = () => get('/v1/core/roles')
export const fetchRole = (id) => get(`/v1/core/roles/${id}`)
export const createRole = (body) => post('/v1/core/roles', body)
export const updateRole = (id, body) => patch(`/v1/core/roles/${id}`, body)
export const deleteRole = (id, moveMembersTo) => del(`/v1/core/roles/${id}`, moveMembersTo ? { moveMembersTo } : {})
export const cloneRole = (id) => post(`/v1/core/roles/${id}/clone`)
export const fetchRoleMembers = (id) => get(`/v1/core/roles/${id}/members`)
export const fetchRoleHistory = (id) => get(`/v1/core/roles/${id}/history`)
export const compareRoles = (ids) => get('/v1/core/roles-compare', { ids: ids.join(',') })
export const fetchRoleTemplates = () => get('/v1/core/role-templates')
export const createRolesFromTemplates = (codes) => post('/v1/core/roles/from-templates', { codes })

// modules & subscription
export const fetchModules = () => get('/v1/core/modules')
export const setModuleEnabled = (id, enabled) => post(`/v1/core/modules/${id}`, { enabled })
export const fetchPlans = () => get('/v1/core/plans')
export const fetchSubscription = () => get('/v1/core/subscription')
export const fetchInvoice = (id) => get(`/v1/core/subscription/invoices/${id}`)
export const previewPlan = (planCode, cycle, coupon) => post('/v1/core/subscription/preview', { planCode, cycle, coupon })
export const changePlan = (planCode, cycle, coupon) => post('/v1/core/subscription/change-plan', { planCode, cycle, coupon })
export const subscribe = (planCode, cycle, coupon) => post('/v1/core/subscription/subscribe', { planCode, cycle, coupon })
export const fetchInvoiceDocument = (id) => get(`/v1/core/subscription/invoices/${id}/document`)
/** The invoice PDF (server-made; needs Gotenberg — features.pdf). */
export async function downloadInvoicePdf(inv) {
  const res = await api.get(`/v1/core/subscription/invoices/${inv.id}/pdf`, { responseType: 'blob' })
  downloadBlob(res, `${inv.number}.pdf`)
}
export const startInvoicePayment = (id) => post(`/v1/core/subscription/invoices/${id}/pay`)
export const confirmInvoicePayment = (id, body) => post(`/v1/core/subscription/invoices/${id}/confirm`, body)

// audit
export const fetchAudit = (params) => list('/v1/core/audit', params)
export const fetchRecordAuditLog = (entityId) => get(`/v1/core/audit/entity/${entityId}`)

// number series, settings, custom fields
export const fetchNumberSeries = () => get('/v1/core/number-series')
export const saveNumberSeries = async (docType, body) => (await api.put(`/v1/core/number-series/${docType}`, body)).data.data
export const fetchModuleSettings = () => get('/v1/core/settings/modules')
export const saveModuleSettings = (module, body) => patch(`/v1/core/settings/modules/${module}`, body)
export const fetchCustomFields = (entity) => get('/v1/core/custom-fields', { entity })
export const createCustomField = (body) => post('/v1/core/custom-fields', body)
export const updateCustomField = (id, body) => patch(`/v1/core/custom-fields/${id}`, body)
export const deleteCustomField = (id) => del(`/v1/core/custom-fields/${id}`)

// notifications (the bell) and family messages — engine E12
export const markNotificationsRead = (ids) => post('/v1/core/notifications/read', ids ? { ids } : {})
export const fetchMessaging = () => get('/v1/core/messaging')
export const saveMessagingChannel = async (channel, body) => (await api.put(`/v1/core/messaging/${channel}`, body)).data.data
export const sendTestMessage = (channel, to) => post(`/v1/core/messaging/${channel}/test`, { to })
export const fetchNotificationRules = () => get('/v1/core/notification-rules')
export const saveNotificationRule = async (event, channels) => (await api.put(`/v1/core/notification-rules/${event}`, { channels })).data.data
export const fetchMessages = (params) => list('/v1/core/messages', params)
export const retryMessage = (id) => post(`/v1/core/messages/${id}/retry`)

// approvals — engine E8
export const fetchApprovals = (box, params) => get('/v1/core/approvals', { box, ...params })
/** Paged inbox (send page & pageSize): { data, meta }. */
export const fetchApprovalsPage = async (box, params) => (await api.get('/v1/core/approvals', { params: { box, ...params } })).data
export const fetchApproval = (id) => get(`/v1/core/approvals/${id}`)
export const requestApproval = (type, payload, reason) => post('/v1/core/approvals', { type, payload, reason })
export const approveRequest = (id, note) => post(`/v1/core/approvals/${id}/approve`, { note })
export const rejectRequest = (id, note) => post(`/v1/core/approvals/${id}/reject`, { note })
export const withdrawRequest = (id) => post(`/v1/core/approvals/${id}/withdraw`)
export const fetchApprovalRules = () => get('/v1/core/approval-rules')
export const saveApprovalRule = async (type, body) => (await api.put(`/v1/core/approval-rules/${type}`, body)).data.data
export const fetchMasters = () => get('/v1/core/masters')
