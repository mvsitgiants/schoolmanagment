import api from './client'

// Printed documents, rendered on the server from Handlebars templates (/api/v1/documents).
export const fetchDocumentHtml = async (docType, id, params) => (await api.get(`/v1/documents/${docType}/${id}`, { params, responseType: 'text' })).data
export const fetchDocumentHelp = async (docType) => (await api.get(`/v1/documents/${docType}/help`)).data.data
export const previewDocument = async (docType, body) => (await api.post(`/v1/documents/${docType}/preview`, body, { responseType: 'text' })).data
/** Several records in one document (staff ID cards): the page and how many records were left out (people who have left). */
export const fetchDocumentsHtml = async (docType, ids, params) => {
  const res = await api.get(`/v1/documents/${docType}`, { params: { ...params, ids: ids.join(',') }, responseType: 'text' })
  return { html: res.data, skipped: Number(res.headers?.['x-skipped']) || 0 }
}

/** The file name a download response names (Content-Disposition), or the fallback. */
export function fileNameOf(headers, fallback) {
  const cd = String(headers?.['content-disposition'] ?? '')
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star) { try { return decodeURIComponent(star[1]) } catch { /* fall through */ } }
  const plain = /filename="([^"]+)"/i.exec(cd)
  return plain?.[1] || fallback
}

/** A JSON error sent back to a blob request: its message and code (the axios one is generic). */
export async function blobError(err) {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try { const j = JSON.parse(await data.text()); return Object.assign(new Error(j.message || err.message), { code: j.code, status: err.response.status }) } catch { /* not JSON */ }
  }
  return Object.assign(new Error(err?.message || 'The PDF could not be downloaded.'), { code: err?.response?.data?.code, status: err?.response?.status })
}

/** Save a PDF blob under its name. */
export function savePdf(blob, name) {
  const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/**
 * Download one record's document as a PDF (made on the server by Gotenberg). Rejects with
 * `code: 'PDF_UNAVAILABLE'` when the server can't make PDFs just now.
 */
export async function downloadDocumentPdf(docType, id) {
  let res
  try {
    res = Array.isArray(id)
      ? await api.get(`/v1/documents/${docType}`, { params: { format: 'pdf', ids: id.join(',') }, responseType: 'blob' }) // several records (staff ID cards)
      : await api.get(`/v1/documents/${docType}/${id}`, { params: { format: 'pdf' }, responseType: 'blob' })
  } catch (err) { throw await blobError(err) }
  savePdf(res.data, fileNameOf(res.headers, `${docType.toLowerCase()}.pdf`))
}
