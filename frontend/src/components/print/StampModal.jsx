import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Stamp } from 'lucide-react'
import { FormField, Input, Modal, SegmentedControl } from '../system'
import Button from '../ui/Button'

const INKS = { BLUE: '#1f3fa6', VIOLET: '#5b2a86', RED: '#b3261e', BLACK: '#222222' }
const FONT = '"Inter", Arial, Helvetica, "Noto Sans Devanagari", sans-serif'
const SIZE = 600 // the round seal's canvas (square); printed about 22 mm across

/** The largest font size (up to `max`) at which `text` fits in `width`. */
function fit(ctx, text, width, max, weight = 700) {
  let size = max
  ctx.font = `${weight} ${size}px ${FONT}`
  const w = ctx.measureText(text).width
  if (w > width) size = Math.max(10, Math.floor((size * width) / w))
  ctx.font = `${weight} ${size}px ${FONT}`
  return size
}

function star(ctx, cx, cy, r) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.42 : r
    ctx[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a))
  }
  ctx.closePath()
  ctx.fill()
}

/** A round seal: two rings, the name (and place) around them with stars between, one or two lines (or a star) inside. */
function drawRound(c, { ring, place, centre1, centre2, ink }) {
  c.width = SIZE
  c.height = SIZE
  const ctx = c.getContext('2d')
  const mid = SIZE / 2
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  const outer = 284
  const inner = 186
  ctx.lineWidth = 10
  ctx.beginPath(); ctx.arc(mid, mid, outer, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(mid, mid, outer - 13, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 5
  ctx.beginPath(); ctx.arc(mid, mid, inner, 0, Math.PI * 2); ctx.stroke()

  // text around the ring: the parts with a star after each, spread over the whole circle, the name centred at the top
  const parts = [ring, place].map((x) => x.trim().toUpperCase()).filter(Boolean)
  if (parts.length) {
    const radius = (outer - 13 + inner) / 2
    const gap = '   ' // room for a star
    const text = parts.map((p) => p + gap).join('')
    const size = fit(ctx, text, Math.PI * 2 * radius * 0.94, 52)
    ctx.font = `700 ${size}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const chars = [...text]
    const widths = chars.map((ch) => ctx.measureText(ch).width)
    const total = widths.reduce((a, b) => a + b, 0)
    const nameShare = [...parts[0]].reduce((a, _, i) => a + widths[i], 0) / total
    let a = -Math.PI / 2 - nameShare * Math.PI // the name's middle at the top
    chars.forEach((ch, i) => {
      const step = (widths[i] / total) * Math.PI * 2
      const at = a + step / 2
      a += step
      const x = mid + radius * Math.cos(at)
      const y = mid + radius * Math.sin(at)
      if (ch === ' ') return
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(at + Math.PI / 2)
      ctx.fillText(ch, 0, 0)
      ctx.restore()
    })
    // the stars, in the middle of each gap
    let used = 0
    for (const p of parts) {
      const start = used + [...p].length
      const span = widths.slice(start, start + gap.length).reduce((x, y) => x + y, 0)
      const before = widths.slice(0, start).reduce((x, y) => x + y, 0)
      const at = -Math.PI / 2 - nameShare * Math.PI + ((before + span / 2) / total) * Math.PI * 2
      star(ctx, mid + radius * Math.cos(at), mid + radius * Math.sin(at), size * 0.36)
      used = start + gap.length
    }
  }

  const lines = [centre1, centre2].map((x) => x.trim()).filter(Boolean)
  if (!lines.length) { star(ctx, mid, mid, 54); return }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const width = inner * 2 * 0.78
  const sizes = lines.map((l) => fit(ctx, l, width, lines.length === 1 ? 64 : 50))
  const size = Math.min(...sizes)
  ctx.font = `700 ${size}px ${FONT}`
  const lineH = size * 1.25
  lines.forEach((l, i) => ctx.fillText(l, mid, mid + (i - (lines.length - 1) / 2) * lineH))
  // a short rule above and below, as on most school seals
  ctx.lineWidth = 3
  const half = (lines.length * lineH) / 2 + 14
  for (const y of [mid - half, mid + half]) { ctx.beginPath(); ctx.moveTo(mid - 70, y); ctx.lineTo(mid + 70, y); ctx.stroke() }
}

/** A rectangular stamp: a double border with up to three centred lines (the first one bold). */
function drawRect(c, { line1, line2, line3, ink }) {
  const W = 720
  const H = 300
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 8
  ctx.strokeRect(8, 8, W - 16, H - 16)
  ctx.lineWidth = 3
  ctx.strokeRect(24, 24, W - 48, H - 48)
  const lines = [[line1, 700, 58], [line2, 600, 44], [line3, 600, 44]].map(([s, w, m]) => [s.trim(), w, m]).filter(([s]) => s)
  if (!lines.length) return
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const sized = lines.map(([s, w, m]) => [s, w, fit(ctx, s, W - 90, m, w)])
  const heights = sized.map(([, , z]) => z * 1.3)
  let y = H / 2 - heights.reduce((a, b) => a + b, 0) / 2
  sized.forEach(([s, w, z], i) => {
    ctx.font = `${w} ${z}px ${FONT}`
    ctx.fillText(s, W / 2, y + heights[i] / 2)
    y += heights[i]
  })
}

/**
 * Make the school seal on the screen, for a school without a scanned one: a round rubber stamp (the name around the
 * rings, one or two lines inside) or a rectangular one, in the ink colour of their stamp pad. Saved as a transparent PNG.
 * `defaults`: { name, place } — usually the institution's (or campus's) name and city.
 */
export default function StampModal({ open, onClose, onUse, defaults = {} }) {
  const { t } = useTranslation('admin')
  const ref = useRef(null)
  const [f, setF] = useState(() => ({
    shape: 'ROUND', ink: 'BLUE', ring: defaults.name ?? '', place: defaults.place ?? '', centre1: '', centre2: '',
    line1: (defaults.name ?? '').toUpperCase(), line2: defaults.place ?? '', line3: '',
  }))
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
  useEffect(() => {
    if (!open || !ref.current) return
    const draw = () => (f.shape === 'ROUND' ? drawRound : drawRect)(ref.current, { ...f, ink: INKS[f.ink] })
    draw()
    document.fonts?.ready.then(draw) // the web font may arrive after the first draw
  }, [open, f])

  const ready = f.shape === 'ROUND' ? !!(f.ring.trim() || f.place.trim()) : !!(f.line1.trim() || f.line2.trim() || f.line3.trim())
  return (
    <Modal open={open} onClose={onClose} size="xl" title={t('admin.printImage.stamp.title')}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('admin.printImage.cancel')}</Button>
        <Button icon={Stamp} disabled={!ready} onClick={() => { onUse(ref.current.toDataURL('image/png')); onClose() }}>{t('admin.printImage.stamp.use')}</Button>
      </>}>
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">{t('admin.printImage.stamp.help')}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <FormField label={t('admin.printImage.stamp.shape')}>
              <SegmentedControl value={f.shape} onChange={set('shape')} options={['ROUND', 'RECT'].map((v) => ({ value: v, label: t(`admin.printImage.stamp.shapes.${v}`) }))} />
            </FormField>
            <FormField label={t('admin.printImage.stamp.ink')}>
              <SegmentedControl value={f.ink} onChange={set('ink')} options={Object.keys(INKS).map((k) => ({ value: k, label: t(`admin.printImage.inks.${k}`) }))} />
            </FormField>
          </div>
          {f.shape === 'ROUND' ? (
            <>
              <FormField label={t('admin.printImage.stamp.ring')} hint={t('admin.printImage.stamp.ringHint')}><Input value={f.ring} onChange={set('ring')} maxLength={60} /></FormField>
              <FormField label={t('admin.printImage.stamp.place')}><Input value={f.place} onChange={set('place')} maxLength={30} /></FormField>
              <FormField label={t('admin.printImage.stamp.centre')} hint={t('admin.printImage.stamp.centreHint')}>
                <div className="grid gap-2">
                  <Input value={f.centre1} onChange={set('centre1')} maxLength={20} placeholder={t('admin.printImage.stamp.centre1Example')} />
                  <Input value={f.centre2} onChange={set('centre2')} maxLength={20} placeholder={t('admin.printImage.stamp.centre2Example')} />
                </div>
              </FormField>
            </>
          ) : (
            <FormField label={t('admin.printImage.stamp.lines')} hint={t('admin.printImage.stamp.linesHint')}>
              <div className="grid gap-2">
                <Input value={f.line1} onChange={set('line1')} maxLength={60} />
                <Input value={f.line2} onChange={set('line2')} maxLength={60} />
                <Input value={f.line3} onChange={set('line3')} maxLength={60} placeholder={t('admin.printImage.stamp.line3Example')} />
              </div>
            </FormField>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('admin.printImage.stamp.preview')}</p>
          <div className="rounded-lg border border-border bg-white p-4 flex items-center justify-center">
            <canvas ref={ref} aria-label={t('admin.printImage.stamp.preview')} className={f.shape === 'ROUND' ? 'w-64 h-64' : 'w-full max-w-sm h-auto'} />
          </div>
          <p className="text-xs text-ink-faint">{t('admin.printImage.stamp.printNote')}</p>
        </div>
      </div>
    </Modal>
  )
}
