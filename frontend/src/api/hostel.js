import api from './client'

// Hostel API (/api/v1/hostel). Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/hostel'

// the bed board, blocks, rooms and beds
export const fetchHostelBoard = () => get(`${BASE}/board`)
export const fetchHostelBlocks = () => get(`${BASE}/blocks`)
export const saveHostelBlock = (id, body) => (id ? patch(`${BASE}/blocks/${id}`, body) : post(`${BASE}/blocks`, body))
export const deleteHostelBlock = (id) => del(`${BASE}/blocks/${id}`)
export const fetchHostelStaff = () => get(`${BASE}/staff`)
export const saveHostelRoom = (id, body) => (id ? patch(`${BASE}/rooms/${id}`, body) : post(`${BASE}/rooms`, body))
export const addHostelRooms = (body) => post(`${BASE}/rooms/bulk`, body)
export const deleteHostelRoom = (id) => del(`${BASE}/rooms/${id}`)
export const setBedState = (roomId, bedId, body) => post(`${BASE}/rooms/${roomId}/beds/${bedId}/state`, body)

// allotment
export const fetchAllotments = (params) => get(`${BASE}/allotments`, params)
export const fetchHostelHistory = (studentId) => get(`${BASE}/students/${studentId}/history`)
export const allotBed = (body) => post(`${BASE}/allotments`, body)
export const moveAllotment = (id, body) => post(`${BASE}/allotments/${id}/move`, body)
export const checkoutAllotment = (id, body) => post(`${BASE}/allotments/${id}/checkout`, body)

// outpasses
export const fetchOutpasses = (params) => get(`${BASE}/outpasses`, params)
export const createOutpass = (body) => post(`${BASE}/outpasses`, body)
export const decideOutpass = (id, body) => post(`${BASE}/outpasses/${id}/decide`, body)
export const markOutpassOut = (id) => post(`${BASE}/outpasses/${id}/out`)
export const markOutpassIn = (id) => post(`${BASE}/outpasses/${id}/in`)
export const cancelOutpass = (id, body) => post(`${BASE}/outpasses/${id}/cancel`, body ?? {})

// mess
export const fetchMess = (params) => get(`${BASE}/mess`, params)
export const saveMessMenu = (body) => put(`${BASE}/mess/menu`, body)
export const clearMessMenu = (blockId) => del(`${BASE}/mess/menu/${blockId}`)
export const saveMealCount = (body) => put(`${BASE}/mess/counts`, body)
