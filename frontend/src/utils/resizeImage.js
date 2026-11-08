/**
 * Shrink a photo in the browser before it is uploaded (gallery albums): the longer side down to `max` pixels, saved as
 * JPEG. Files that are already small, or that the browser can't read, go up as they are.
 */
export async function resizeImage(file, { max = 1600, quality = 0.85, minBytes = 400 * 1024 } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < minBytes) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
