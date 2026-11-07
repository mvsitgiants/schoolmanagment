import api from './client'

// Platform owner console API (/api/v1/superadmin).

const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data

export const fetchDashboard = () => get('/v1/superadmin/dashboard')
export const fetchTenants = (params) => list('/v1/superadmin/tenants', params)
export const fetchTenant = (id) => get(`/v1/superadmin/tenants/${id}`)
export const provisionTenant = (body) => post('/v1/superadmin/tenants', body)
export const updateTenant = (id, body) => patch(`/v1/superadmin/tenants/${id}`, body)
export const changeTenantPlan = (id, body) => post(`/v1/superadmin/tenants/${id}/change-plan`, body)
export const recordInvoicePayment = (tenantId, invoiceId, body) => post(`/v1/superadmin/tenants/${tenantId}/invoices/${invoiceId}/pay`, body)
export const voidInvoice = (tenantId, invoiceId, reason) => post(`/v1/superadmin/tenants/${tenantId}/invoices/${invoiceId}/void`, { reason })
export const sendPaymentLink = (tenantId, invoiceId) => post(`/v1/superadmin/tenants/${tenantId}/invoices/${invoiceId}/payment-link`)
export const fetchAllInvoices = (params) => list('/v1/superadmin/invoices', params)
export const runBilling = () => post('/v1/superadmin/billing/run')
export const fetchSaPlans = () => get('/v1/superadmin/plans')
export const fetchSaCatalog = () => get('/v1/superadmin/catalog')
export const createPlan = (body) => post('/v1/superadmin/plans', body)
export const updatePlan = (code, body) => patch(`/v1/superadmin/plans/${code}`, body)
export const fetchSaRoleTemplates = () => get('/v1/superadmin/role-templates')
export const updateRoleTemplate = (code, body) => patch(`/v1/superadmin/role-templates/${code}`, body)
export const fetchPlatformSettings = () => get('/v1/superadmin/settings')
export const savePlatformSettings = (body) => patch('/v1/superadmin/settings', body)
export const sendPlatformTestEmail = (to) => post('/v1/superadmin/settings/test-email', { to })
export const sendPlatformTestSms = (to) => post('/v1/superadmin/settings/test-sms', { to })
export const testPlatformAbdm = () => post('/v1/superadmin/settings/abdm/test')
export const registerPlatformAbdmBridge = () => post('/v1/superadmin/settings/abdm/bridge')
export const fetchCoupons = () => get('/v1/superadmin/coupons')
export const createCoupon = (body) => post('/v1/superadmin/coupons', body)
export const updateCoupon = (id, body) => patch(`/v1/superadmin/coupons/${id}`, body)
export const fetchStaff = () => get('/v1/superadmin/staff')
export const createStaff = (body) => post('/v1/superadmin/staff', body)
export const updateStaff = (id, body) => patch(`/v1/superadmin/staff/${id}`, body)
export const resetStaffPassword = (id) => post(`/v1/superadmin/staff/${id}/reset-password`)
export const fetchPlatformAudit = (params) => list('/v1/superadmin/audit', params)
