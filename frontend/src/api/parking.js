import api from './client'

// Parking API (/api/v1/parking): areas, vehicles & passes, the gate. Functions return the unwrapped `data`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data

const BASE = '/v1/parking'
const clean = (p = {}) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false))

// areas
export const fetchParkingMeta = () => get(`${BASE}/meta`)
export const fetchParkingAreas = (all = false) => get(`${BASE}/areas`, clean({ all: all ? '1' : '' }))
export const saveParkingArea = (id, body) => (id ? put(`${BASE}/areas/${id}`, body) : post(`${BASE}/areas`, body))
export const deleteParkingArea = (id) => del(`${BASE}/areas/${id}`)

// vehicles & passes
export const findParkingPeople = (kind, search) => get(`${BASE}/people`, { kind, search })
export const fetchVehicles = (params) => get(`${BASE}/vehicles`, clean(params))
export const fetchVehicle = (id) => get(`${BASE}/vehicles/${id}`)
export const saveVehicle = (id, body) => (id ? put(`${BASE}/vehicles/${id}`, body) : post(`${BASE}/vehicles`, body))
export const renewVehicle = (id) => post(`${BASE}/vehicles/${id}/renew`)
export const revokeVehicle = (id, reason) => post(`${BASE}/vehicles/${id}/revoke`, { reason })
export const deleteVehicle = (id) => del(`${BASE}/vehicles/${id}`)

/** Every pass of a filter (for stickers or a CSV): 100-row pages, up to 1000. */
export async function fetchAllVehicles(params) {
  const out = []
  for (let page = 1; page <= 10; page++) {
    const r = await fetchVehicles({ ...params, page, pageSize: 100 })
    out.push(...r.rows)
    if (out.length >= r.total) break
  }
  return out
}

// the gate
export const fetchGate = () => get(`${BASE}/gate`)
export const gateLookup = (q) => get(`${BASE}/gate/lookup`, { q })
export const fetchGateLog = (params) => get(`${BASE}/gate/log`, clean(params))
export const parkIn = (body) => post(`${BASE}/gate/in`, body)
export const parkOut = (id) => post(`${BASE}/gate/${id}/out`)
/** A sticker or plate read at the gate: in / out recorded at once (`direction` IN · OUT · AUTO). */
export const gateScan = (code, direction) => post(`${BASE}/gate/scan`, { code, direction })
