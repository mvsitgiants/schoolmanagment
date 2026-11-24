import api from './client'
import { downloadBlob } from '../utils/download'

// The document library (/api/v1/document-library): every file in one place, many downloaded as one ZIP.
// (/api/v1/documents is the print engine — api/documents.js.)
const BASE = '/v1/document-library'
const clean = (p = {}) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false))

export const fetchLibraryMeta = async () => (await api.get(`${BASE}/meta`)).data.data
export const fetchLibrary = async (params) => (await api.get(BASE, { params: clean(params) })).data.data

/**
 * Download as one ZIP: picked files ({ ids }), a student ({ studentId }), a staff member ({ employeeId }) or a class
 * ({ classId | sectionId, kinds }). `name` names the ZIP.
 */
export async function downloadZip(body) {
  let res
  try {
    res = await api.post(`${BASE}/zip`, clean(body), { responseType: 'blob' })
  } catch (err) {
    // the server's reason ("more than 2000 files…") arrives as a blob too: read it back
    const data = err.response?.data
    if (data instanceof Blob) {
      try { const j = JSON.parse(await data.text()); err.message = j.message || err.message } catch { /* keep the message */ }
    }
    throw err
  }
  downloadBlob(res, `${(body.name || 'documents').replace(/\s+/g, '-')}.zip`)
}

// what is still to come, what was issued, what was removed
export const fetchMissing = async (params) => (await api.get(`${BASE}/missing`, { params: clean(params) })).data.data
export const fetchExpiring = async (params) => (await api.get(`${BASE}/expiring`, { params: clean(params) })).data.data
export const tellMissing = async (studentIds) => (await api.post(`${BASE}/missing/tell`, { studentIds })).data.data
export const fetchIssued = async (params) => (await api.get(`${BASE}/issued`, { params: clean(params) })).data.data
export const fetchRemoved = async (params) => (await api.get(`${BASE}/bin`, { params: clean(params) })).data.data
export const restoreFile = async (id) => (await api.post(`${BASE}/bin/${id}/restore`)).data.data
export const fetchStorage = async () => (await api.get(`${BASE}/storage`)).data.data
