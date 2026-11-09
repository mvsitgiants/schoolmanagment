import api from './client'

// Research API (/api/v1/research): publications, projects & grants, Ph.D. scholars. Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data
const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined))

const BASE = '/v1/research'

export const fetchResearchMeta = () => get(`${BASE}/meta`)

export const fetchPublications = (params) => get(`${BASE}/publications`, clean(params))
export const savePublication = (id, body) => (id ? patch(`${BASE}/publications/${id}`, body) : post(`${BASE}/publications`, body))
export const deletePublication = (id) => del(`${BASE}/publications/${id}`)
export const importPublications = (rows, dryRun) => post(`${BASE}/publications/import`, { rows, dryRun })
/** The publications in view as a CSV (resolves to the file's text; ImportExportButtons saves it). */
export const exportPublications = async (params) => (await api.get(`${BASE}/publications/export`, { params: clean(params), responseType: 'blob' })).data

export const fetchProjects = (params) => get(`${BASE}/projects`, clean(params))
export const saveProject = (id, body) => (id ? patch(`${BASE}/projects/${id}`, body) : post(`${BASE}/projects`, body))
export const deleteProject = (id) => del(`${BASE}/projects/${id}`)

export const fetchScholars = (params) => get(`${BASE}/scholars`, clean(params))
export const saveScholar = (id, body) => (id ? patch(`${BASE}/scholars/${id}`, body) : post(`${BASE}/scholars`, body))
export const deleteScholar = (id) => del(`${BASE}/scholars/${id}`)
