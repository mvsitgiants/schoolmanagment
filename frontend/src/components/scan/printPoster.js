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

/**
 * Print a sheet of QR cards (3 × 4 per A4 page): each with its code as a QR and a big label under it — visitor badges
 * (VB-1 … VB-50) and the like. `items` [{ code, label, sub? }], `heading`: printed on each card above the QR.
 */
export async function printQrCards({ title, heading, items }) {
  const svgs = await Promise.all(items.map((it) => QRCode.toString(it.code, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })))
  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) return
  const doc = w.document
  doc.title = title
  const style = doc.createElement('style')
  style.textContent = '@page{size:A4;margin:8mm}body{margin:0;font-family:system-ui,sans-serif}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.card{border:1px dashed #999;border-radius:4mm;padding:4mm;text-align:center;break-inside:avoid;height:62mm;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center}.h{font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:.06em}.q svg{width:34mm;height:34mm}.l{font-size:20pt;font-weight:800;letter-spacing:.06em;margin-top:2mm}.s{font-size:8pt;color:#555}'
  doc.head.append(style)
  const grid = doc.createElement('div'); grid.className = 'grid'
  items.forEach((it, i) => {
    const c = doc.createElement('div'); c.className = 'card'
    const h = doc.createElement('div'); h.className = 'h'; h.textContent = heading
    const q = doc.createElement('div'); q.className = 'q'; q.innerHTML = svgs[i] // qrcode's own SVG for our code
    const l = doc.createElement('div'); l.className = 'l'; l.textContent = it.label
    c.append(h, q, l)
    if (it.sub) { const s = doc.createElement('div'); s.className = 's'; s.textContent = it.sub; c.append(s) }
    grid.append(c)
  })
  doc.body.append(grid)
  setTimeout(() => w.print(), 400)
}
