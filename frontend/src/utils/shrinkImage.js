/** The image types an upload may be (SVG is never taken: it can carry script). */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * A chosen image → a small data URL stored inline (the institution logo, an employee's photo), so it shows everywhere
 * without a sign-in: prints and PDFs, the parent app, public pages. WebP where the browser can encode it.
 *
 *   maxSide   longest side in px; when the result is over `maxBytes` it retries at ¾ and ½ of that
 *   maxBytes  the most the image file may weigh (before base64)
 *   square    crop to the centre square first (photos); a browser without WebP then falls back to JPEG on white,
 *             not PNG, so a photo still fits — without it the fallback is PNG (logos keep their transparency)
 *
 * Resolves to null when even the smallest size is too big.
 */
export async function shrinkImage(file, { maxSide = 512, maxBytes = 300 * 1024, square = false, quality = 0.9 } = {}) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    const w = img.naturalWidth, h = img.naturalHeight
    const crop = square ? Math.min(w, h) : null
    const src = square ? { x: Math.round((w - crop) / 2), y: Math.round((h - crop) / 2), w: crop, h: crop } : { x: 0, y: 0, w, h }
    for (const side of [maxSide, Math.round(maxSide * 0.75), Math.round(maxSide * 0.5)]) {
      const scale = Math.min(1, side / Math.max(src.w, src.h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(src.w * scale))
      canvas.height = Math.max(1, Math.round(src.h * scale))
      const ctx = canvas.getContext('2d')
      if (square) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
      ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height)
      let out = canvas.toDataURL('image/webp', quality) // a PNG where WebP isn't supported
      if (square && !out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', quality)
      if (out.length * 0.75 <= maxBytes) return out
    }
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
