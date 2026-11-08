import api from './client'

// Transport API (/api/v1/transport). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/transport'

export const fetchVehicles = () => get(`${BASE}/vehicles`)
export const saveVehicle = (id, body) => (id ? patch(`${BASE}/vehicles/${id}`, body) : post(`${BASE}/vehicles`, body))
export const deleteVehicle = (id) => del(`${BASE}/vehicles/${id}`)
export const fetchVehicleTrail = (id, hours) => get(`${BASE}/vehicles/${id}/trail`, { hours })
export const fetchStaffLogins = () => get(`${BASE}/staff`)
export const fetchGpsHook = () => get(`${BASE}/gps-hook`)

export const fetchRoutes = (all = false) => get(`${BASE}/routes`, all ? { all: '1' } : {})
export const saveRoute = (id, body) => (id ? patch(`${BASE}/routes/${id}`, body) : post(`${BASE}/routes`, body))
export const deleteRoute = (id) => del(`${BASE}/routes/${id}`)

export const fetchAssignments = (params) => get(`${BASE}/assignments`, params)
export const assignStudent = (body) => post(`${BASE}/assignments`, body)
export const endAssignment = (id, to) => post(`${BASE}/assignments/${id}/end`, { to })
export async function downloadAssignments(params) {
  const res = await api.get(`${BASE}/assignments/export`, { params, responseType: 'blob' })
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = 'transport-students.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}

export const fetchBoard = (date) => get(`${BASE}/board`, date ? { date } : {})
export const fetchMyRoutes = () => get(`${BASE}/my-routes`)
export const startTrip = (routeId, kind) => post(`${BASE}/trips`, { routeId, kind })
export const fetchTrip = (id) => get(`${BASE}/trips/${id}`)
export const endTrip = (id) => post(`${BASE}/trips/${id}/end`)
export const sendPosition = (id, body) => post(`${BASE}/trips/${id}/position`, body)
export const markRide = (id, studentId, event) => post(`${BASE}/trips/${id}/rides`, { studentId, event })
