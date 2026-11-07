import api from './client'

// Integrations (/api/v1/integrations) and Administration › API keys & webhooks
// (/api/v1/core/api-keys, /api/v1/core/webhooks). Secrets go in and never come back:
// configs answer { set, last4 } for each secret. Money is paise.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body ?? {})).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

export const fetchIntegrationMeta = () => get('/v1/integrations/meta')

// payment gateway
export const fetchPayments = () => get('/v1/integrations/payments')
export const savePayments = (body) => put('/v1/integrations/payments', body)
export const testPayments = () => post('/v1/integrations/payments/test')
/** { data, meta } */
export const fetchGatewayOrders = (params) => list('/v1/integrations/payments/transactions', params)
export const syncGatewayOrder = (id) => post(`/v1/integrations/payments/transactions/${id}/sync`)
export const cancelGatewayLink = (id) => post(`/v1/integrations/payments/transactions/${id}/cancel`)
export const refundGatewayOrder = (id, body) => post(`/v1/integrations/payments/transactions/${id}/refund`, body)
// …from a bill (Billing)
export const fetchBillOnlinePayments = (invoiceId) => get(`/v1/billing/bills/${invoiceId}/online-payments`)
export const createBillPaymentLink = (invoiceId, body) => post(`/v1/billing/bills/${invoiceId}/payment-link`, body)

// SMS & WhatsApp (credentials themselves: /core/messaging, see api/core.js)
export const fetchMessagingIntegration = () => get('/v1/integrations/messaging')
export const saveMessagingWebhook = (body) => put('/v1/integrations/messaging/webhook', body)
export const testMessagingProvider = (channel) => post(`/v1/integrations/messaging/test/${channel}`)

// ABDM
export const fetchAbdm = () => get('/v1/integrations/abdm')
export const saveAbdm = (body) => put('/v1/integrations/abdm', body)
export const testAbdm = () => post('/v1/integrations/abdm/test')
export const startAbhaFlow = (body) => post('/v1/integrations/abdm/abha/start', body)
export const confirmAbhaFlow = (flowId, body) => post(`/v1/integrations/abdm/abha/${flowId}/confirm`, body)
export const linkCareContexts = (body) => post('/v1/integrations/abdm/care-contexts', body)

// devices
export const fetchDevices = () => get('/v1/integrations/devices')
export const fetchDeviceLabTests = () => get('/v1/integrations/devices/lab-tests')
export const createDevice = (body) => post('/v1/integrations/devices', body)
export const updateDevice = (id, body) => patch(`/v1/integrations/devices/${id}`, body)
export const rotateDeviceKey = (id) => post(`/v1/integrations/devices/${id}/rotate-key`)
export const deleteDevice = (id) => del(`/v1/integrations/devices/${id}`)

// PACS (Orthanc)
export const fetchPacs = () => get('/v1/integrations/pacs')
export const savePacs = (body) => put('/v1/integrations/pacs', body)
export const testPacs = () => post('/v1/integrations/pacs/test')
export const newPacsPushSecret = () => post('/v1/integrations/pacs/push-secret')

// logs
export const fetchIntegrationLogs = (params) => list('/v1/integrations/logs', params)
export const fetchIntegrationLog = (id) => get(`/v1/integrations/logs/${id}`)

// API keys & webhooks
export const fetchApiKeysMeta = () => get('/v1/core/api-keys/meta')
export const fetchApiKeys = () => get('/v1/core/api-keys')
export const createApiKey = (body) => post('/v1/core/api-keys', body)
export const updateApiKey = (id, body) => patch(`/v1/core/api-keys/${id}`, body)
export const revokeApiKey = (id) => del(`/v1/core/api-keys/${id}`)
export const fetchWebhooks = () => get('/v1/core/webhooks')
export const createWebhook = (body) => post('/v1/core/webhooks', body)
export const updateWebhook = (id, body) => patch(`/v1/core/webhooks/${id}`, body)
export const deleteWebhook = (id) => del(`/v1/core/webhooks/${id}`)
export const rotateWebhookSecret = (id) => post(`/v1/core/webhooks/${id}/rotate-secret`)
export const testWebhook = (id) => post(`/v1/core/webhooks/${id}/test`)
/** { data, meta } */
export const fetchWebhookDeliveries = (id, params) => list(id ? `/v1/core/webhooks/${id}/deliveries` : '/v1/core/webhook-deliveries', params)
export const redeliverWebhook = (id) => post(`/v1/core/webhook-deliveries/${id}/redeliver`)
