import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** A QR code drawn in the browser (UPI payment, a staff punch code). `value` is the text it carries. */
export default function QrCode({ value, size = 200, label, className }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    if (!value) { setSvg(''); return undefined }
    QRCode.toString(String(value), { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }).then((s) => { if (live) setSvg(s) }).catch(() => setSvg(''))
    return () => { live = false }
  }, [value])
  return (
    <div role="img" aria-label={label} className={className} style={{ width: size, height: size }}
      // qrcode's own SVG output for our value — no user markup goes in
      dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg width="100%" height="100%" ') }} />
  )
}
