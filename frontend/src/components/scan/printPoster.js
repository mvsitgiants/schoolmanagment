import QRCode from 'qrcode'

/**
 * Print an A4 poster with a big QR code: a heading, a line of instructions, the QR and the address under it
 * ("Scan to enquire", the parent app). Every text comes from the caller (already translated).
 */
export async function printQrPoster({ title, text, url, footer }) {
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
  const w = window.open('', '_blank', 'width=640,height=820')
  if (!w) return
  const doc = w.document
  doc.title = title
  const box = doc.createElement('div')
  box.style.cssText = 'font-family:system-ui,sans-serif;text-align:center;padding:48px 32px'
  const h = doc.createElement('h1'); h.textContent = title; h.style.cssText = 'font-size:34px;margin:0 0 12px'
  const p = doc.createElement('p'); p.textContent = text; p.style.cssText = 'font-size:19px;line-height:1.5;max-width:480px;margin:0 auto 24px'
  const qr = doc.createElement('div'); qr.innerHTML = svg.replace('<svg ', '<svg width="340" height="340" ') // qrcode's own SVG for our URL
  const u = doc.createElement('p'); u.textContent = url; u.style.cssText = 'font-family:monospace;font-size:15px;margin-top:16px;word-break:break-all'
  box.append(h, p, qr, u)
  if (footer) { const f = doc.createElement('p'); f.textContent = footer; f.style.cssText = 'font-size:16px;margin-top:28px;color:#444'; box.append(f) }
  doc.body.append(box)
  setTimeout(() => w.print(), 300)
}
