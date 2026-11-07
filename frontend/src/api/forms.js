import api from './client'

// Form builder (/api/v1/core/forms) and the forms doctors fill (/api/v1/opd/forms).
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data

export const fetchForms = (params) => get('/v1/core/forms', params)
export const fetchForm = (id) => get(`/v1/core/forms/${id}`)
export const createForm = (body) => post('/v1/core/forms', body)
export const saveForm = async (id, body) => (await api.put(`/v1/core/forms/${id}`, body)).data.data
export const publishForm = (id) => post(`/v1/core/forms/${id}/publish`)
export const archiveForm = (id, archived = true) => post(`/v1/core/forms/${id}/archive`, { archived })
export const duplicateForm = (id) => post(`/v1/core/forms/${id}/duplicate`)

export const fetchConsultForms = () => get('/v1/opd/forms')
export const fetchFormVersion = (formId, version) => get(`/v1/opd/forms/${formId}/versions/${version}`)
