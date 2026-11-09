import api from './client'

// Training & placements API (/api/v1/placements). Functions return the unwrapped `data` (lists: { data, … }).
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data
async function download(url, params, name) {
  const res = await api.get(url, { params, responseType: 'blob' })
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}

const BASE = '/v1/placements'

export const fetchPlacementsMeta = () => get(`${BASE}/meta`)
export const findPlacementStudents = (search) => get(`${BASE}/students`, { search })

export const fetchCompanies = (params) => list(`${BASE}/companies`, params)
export const fetchCompany = (id) => get(`${BASE}/companies/${id}`)
export const saveCompany = (id, body) => (id ? patch(`${BASE}/companies/${id}`, body) : post(`${BASE}/companies`, body))
export const deleteCompany = (id) => del(`${BASE}/companies/${id}`)

export const fetchDrives = (params) => list(`${BASE}/drives`, params)
export const fetchDrive = (id) => get(`${BASE}/drives/${id}`)
export const saveDrive = (id, body) => (id ? patch(`${BASE}/drives/${id}`, body) : post(`${BASE}/drives`, body))
export const setDriveStatus = (id, status) => post(`${BASE}/drives/${id}/status`, { status })
export const fetchDriveEligible = (id) => list(`${BASE}/drives/${id}/eligible`)
export const registerForDrive = (id, body) => post(`${BASE}/drives/${id}/registrations`, body)
export const withdrawFromDrive = (id, regId) => del(`${BASE}/drives/${id}/registrations/${regId}`)
export const saveRoundResults = (id, roundId, body) => put(`${BASE}/drives/${id}/rounds/${roundId}/results`, body)
export const selectCandidates = (id, body) => post(`${BASE}/drives/${id}/select`, body)

export const fetchOffers = (params) => list(`${BASE}/offers`, params)
export const fetchOffer = (id) => get(`${BASE}/offers/${id}`)
export const fetchOfferStats = (params) => get(`${BASE}/offers/stats`, params)
export const exportOffers = (params) => download(`${BASE}/offers/export`, params, 'placement-offers.csv')
export const createOffer = (body) => post(`${BASE}/offers`, body)
export const decideOffer = (id, body) => post(`${BASE}/offers/${id}/decision`, body)
