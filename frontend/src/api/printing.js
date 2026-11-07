import api from './client'

// Print templates (engine E8): letterhead and per-document layouts (/api/v1/core/print*).
const get = async (url, params) => (await api.get(url, { params })).data.data

export const fetchLetterhead = () => get('/v1/core/print/letterhead')
export const saveLetterhead = async (body) => (await api.put('/v1/core/print/letterhead', body)).data.data
export const fetchPrintTemplates = () => get('/v1/core/print-templates')
export const createPrintTemplate = async (body) => (await api.post('/v1/core/print-templates', body)).data.data
export const updatePrintTemplate = async (id, body) => (await api.patch(`/v1/core/print-templates/${id}`, body)).data.data
export const deletePrintTemplate = async (id) => (await api.delete(`/v1/core/print-templates/${id}`)).data.data
export const fetchEffectivePrint = (docType) => get(`/v1/core/print/effective/${docType}`)
