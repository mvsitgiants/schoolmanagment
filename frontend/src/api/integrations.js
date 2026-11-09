import api from './client'

// API keys and outbound webhooks (/api/v1/core/api-keys, /api/v1/core/webhooks). Secrets go in
// and never come back. Payment gateway, SMS / WhatsApp and device calls join with the Integrations module.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body ?? {})).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

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
const put = async (url, body) => (await api.put(url, body)).data.data

// Integrations module (/api/v1/integrations)
const INT = '/v1/integrations'
export const fetchIntegrationMeta = () => get(`${INT}/meta`)

// payment gateway — the school's own Razorpay (the same config as Fees › Online payments)
export const fetchPayments = () => get(`${INT}/payments`)
export const savePayments = (body) => put(`${INT}/payments`, body)
export const testPayments = () => post(`${INT}/payments/test`)

// SMS & WhatsApp — provider settings are /core/notifications/messaging (api/core.js)
export const fetchMessagingIntegration = () => get(`${INT}/messaging`)
export const createMessagingUrls = () => post(`${INT}/messaging/urls`)
export const saveMessagingWebhook = (body) => put(`${INT}/messaging/webhook`, body)
export const testMessagingProvider = (channel) => post(`${INT}/messaging/test/${channel}`)
export const fetchMessagingTemplates = () => get(`${INT}/messaging/templates`)
/** { data, meta } */
export const fetchRecentSends = (params) => list(`${INT}/messaging/sends`, params)

// devices
export const fetchDevices = () => get(`${INT}/devices`)
export const fetchDeviceOptions = () => get(`${INT}/devices/options`)
export const fetchDevice = (id) => get(`${INT}/devices/${id}`)
export const createDevice = (body) => post(`${INT}/devices`, body)
export const updateDevice = (id, body) => patch(`${INT}/devices/${id}`, body)
export const deleteDevice = (id) => del(`${INT}/devices/${id}`)
export const rotateDeviceKey = (id) => post(`${INT}/devices/${id}/rotate-key`)
export const testDevicePunch = (id, body) => post(`${INT}/devices/${id}/test`, body)
export const createGpsUrl = () => post(`${INT}/devices/gps-url`)
/** { data, meta } */
export const fetchDevicePunches = (params) => list(`${INT}/devices/punches`, params)

// integration logs
/** { data, meta } */
export const fetchIntegrationLogs = (params) => list(`${INT}/logs`, params)
export const fetchIntegrationLog = (id) => get(`${INT}/logs/${id}`)
export const fetchProviderHealth = () => get(`${INT}/logs/health`)
export const retryIntegrationLog = (id) => post(`${INT}/logs/${id}/retry`)
