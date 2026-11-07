/**
 * Save an axios blob response to disk as `filename` via a synthetic <a> click.
 *
 *   const res = await dmsApi.downloadVersion(version.id)
 *   downloadBlob(res, version.fileName)
 */
export function downloadBlob(res, filename) {
  const url = window.URL.createObjectURL(new Blob([res.data]))
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'download'
  link.click()
  window.URL.revokeObjectURL(url)
}
