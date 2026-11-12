import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eraser, PenLine, Undo2 } from 'lucide-react'
import { FormField, Modal, SegmentedControl } from '../system'
import Button from '../ui/Button'

const INKS = { BLUE: '#1d3b8f', BLACK: '#1b1b1b' }
const PAD_HEIGHT = 200
const LINE = 2.6

/** Draw strokes (lists of [x, y] points) on a 2D context, scaled and shifted. */
function paint(ctx, strokes, color, { scale = 1, dx = 0, dy = 0 } = {}) {
  ctx.lineWidth = LINE * scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  for (const s of strokes) {
    const pts = s.map(([x, y]) => [(x - dx) * scale, (y - dy) * scale])
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); continue }
    ctx.beginPath()
    ctx.moveTo(...pts[0])
    // smooth: a curve through the midpoints, each point a control point
    for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2)
    ctx.lineTo(...pts[pts.length - 1])
    ctx.stroke()
  }
}

/** The signature cut to its ink (a little margin), on a transparent background, as a PNG data URL. */
function toPng(strokes, color) {
  const all = strokes.flat()
  const pad = LINE * 2
  const minX = Math.min(...all.map((p) => p[0])) - pad
  const minY = Math.min(...all.map((p) => p[1])) - pad
  const w = Math.max(...all.map((p) => p[0])) + pad - minX
  const h = Math.max(...all.map((p) => p[1])) + pad - minY
  const scale = Math.min(3, 900 / w, 360 / h) // sharp when printed, still a small file
  const c = document.createElement('canvas')
  c.width = Math.ceil(w * scale)
  c.height = Math.ceil(h * scale)
  paint(c.getContext('2d'), strokes, color, { scale, dx: minX, dy: minY })
  return c.toDataURL('image/png')
}

/**
 * Sign on the screen (finger, stylus or mouse) — the signature printed on documents, like signing on paper and scanning
 * it. Saved cut to the ink, on a transparent background, so it sits over the signature line and the seal.
 */
export default function SignatureModal({ open, onClose, onUse }) {
  const { t } = useTranslation('admin')
  const ref = useRef(null)
  const live = useRef(null) // the stroke being drawn
  const [strokes, setStrokes] = useState([])
  const [ink, setInk] = useState('BLUE')

  const redraw = (list = strokes) => {
    const c = ref.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const ctx = c.getContext('2d')
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    paint(ctx, live.current ? [...list, live.current] : list, INKS[ink])
  }
  useEffect(() => {
    if (!open) return
    const c = ref.current
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = PAD_HEIGHT * ratio
    redraw()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redraw() }, [strokes, ink]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) { setStrokes([]); live.current = null } }, [open])

  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); live.current = [pos(e)]; redraw() }
  const move = (e) => { if (!live.current) return; live.current.push(pos(e)); redraw() }
  const up = () => { if (!live.current) return; const s = live.current; live.current = null; setStrokes((x) => [...x, s]) }

  const empty = !strokes.length
  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('admin.printImage.signature.title')}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('admin.printImage.cancel')}</Button>
        <Button icon={PenLine} disabled={empty} onClick={() => { onUse(toPng(strokes, INKS[ink])); onClose() }}>{t('admin.printImage.signature.use')}</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">{t('admin.printImage.signature.help')}</p>
        <div className="relative">
          <canvas ref={ref} style={{ height: PAD_HEIGHT }} aria-label={t('admin.printImage.signature.pad')}
            className="w-full rounded-lg border border-dashed border-border bg-white touch-none cursor-crosshair"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
          {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-faint">{t('admin.printImage.signature.signHere')}</span>}
          <span className="pointer-events-none absolute start-6 end-6 bottom-10 border-b border-ink-faint/40" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <FormField label={t('admin.printImage.signature.ink')}>
            <SegmentedControl value={ink} onChange={setInk} options={Object.keys(INKS).map((k) => ({ value: k, label: t(`admin.printImage.inks.${k}`) }))} />
          </FormField>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={Undo2} disabled={empty} onClick={() => setStrokes((x) => x.slice(0, -1))}>{t('admin.printImage.signature.undo')}</Button>
            <Button size="sm" variant="ghost" icon={Eraser} disabled={empty} onClick={() => setStrokes([])}>{t('admin.printImage.signature.clear')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
