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
