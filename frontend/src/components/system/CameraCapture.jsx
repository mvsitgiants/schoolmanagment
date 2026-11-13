import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, RotateCw } from 'lucide-react'
import Modal from './Modal'
import Button from '../ui/Button'

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

/** Draw an image (or video frame) onto a canvas, turned `turns` quarter-turns, at most 2000px on its long side. */
function toCanvas(source, w, h, turns) {
  const scale = Math.min(1, 2000 / Math.max(w, h))
  const sw = Math.round(w * scale)
  const sh = Math.round(h * scale)
  const side = turns % 2 === 1
  const c = document.createElement('canvas')
  c.width = side ? sh : sw
  c.height = side ? sw : sh
  const g = c.getContext('2d')
  g.translate(c.width / 2, c.height / 2)
  g.rotate((turns * Math.PI) / 2)
  g.drawImage(source, -sw / 2, -sh / 2, sw, sh)
  return c
}

/**
 * Take a photo with the camera and hand it back as a JPEG File (at most 2000px on its long side). Phones open their camera
 * app; computers show the webcam and take a snapshot, or a photo can be chosen. The photo can be turned before adding.
 * No AI: the picture is kept exactly as taken. `square`: a square guide on the webcam and a square preview (the caller crops). Wording can be changed per use (title, hint, frame, addLabel, fileName).
 */
export default function CameraCapture({ onClose, onPhoto, busy, title, hint, frame, addLabel, fileName, square = false }) {
  const { t } = useTranslation('ui')
  const video = useRef(null)
  const input = useRef(null)
  const [stream, setStream] = useState(null)
  const [failed, setFailed] = useState(false)
  const [shot, setShot] = useState(null) // { img: HTMLImageElement | HTMLCanvasElement, w, h }
  const [turns, setTurns] = useState(0)
  const [preview, setPreview] = useState('')
  const touch = isTouch()

  useEffect(() => {
    if (touch || shot) return undefined
    let live = null
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) { setFailed(true); return undefined }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => { if (cancelled) { s.getTracks().forEach((x) => x.stop()); return } live = s; setStream(s); if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) } })
      .catch(() => setFailed(true))
    return () => { cancelled = true; live?.getTracks().forEach((x) => x.stop()) }
  }, [touch, shot])

  useEffect(() => {
    if (!shot) { setPreview(''); return }
    setPreview(toCanvas(shot.img, shot.w, shot.h, turns).toDataURL('image/jpeg', 0.7))
  }, [shot, turns])

  const snap = () => {
    const v = video.current
    if (!v?.videoWidth) return
    const c = toCanvas(v, v.videoWidth, v.videoHeight, 0)
    stream?.getTracks().forEach((x) => x.stop())
    setStream(null)
    setTurns(0)
    setShot({ img: c, w: c.width, h: c.height })
  }
  const fromFile = (file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => { setTurns(0); setShot({ img, w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }
  const add = () => {
    toCanvas(shot.img, shot.w, shot.h, turns).toBlob((blob) => {
      if (blob) onPhoto(new File([blob], `${fileName ?? t('ui.camera.fileName')}-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.85)
  }

  return (
    <Modal open onClose={onClose} size="lg" title={title ?? t('ui.camera.title')} footer={shot ? <>
      <Button variant="secondary" icon={Camera} onClick={() => { setShot(null); if (touch) input.current?.click() }}>{t('ui.camera.retake')}</Button>
      <Button loading={busy} onClick={add}>{addLabel ?? t('ui.camera.add')}</Button>
    </> : <Button variant="secondary" onClick={onClose}>{t('ui.common.cancel')}</Button>}>
      <div className="min-h-[60dvh] space-y-3 sm:min-h-0">
        {shot ? (
          <>
            <div className="grid place-items-center rounded-lg border border-border bg-bg p-2">
              {preview && <img src={preview} alt={t('ui.camera.preview')} className={square ? 'aspect-square w-64 max-w-full rounded-xl object-cover' : 'max-h-[55dvh] w-auto max-w-full rounded'} />}
            </div>
            <div className="flex justify-center">
              <Button variant="secondary" icon={RotateCw} onClick={() => setTurns((n) => (n + 1) % 4)}>{t('ui.camera.rotate')}</Button>
            </div>
          </>
        ) : touch || failed ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-700"><Camera className="h-7 w-7" aria-hidden /></span>
            <p className="max-w-xs text-sm text-ink-muted">{failed && !touch ? t('ui.camera.noCamera') : hint ?? t('ui.camera.hint')}</p>
            <Button icon={Camera} onClick={() => input.current?.click()}>{touch ? t('ui.camera.open') : t('ui.camera.choose')}</Button>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-lg border border-border bg-black">
              <video ref={video} playsInline muted className="aspect-video w-full object-contain" />
              {square && <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square h-[80%] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" aria-hidden />}
            </div>
            <p className="text-center text-xs text-ink-muted">{frame ?? t('ui.camera.frame')}</p>
            <div className="flex justify-center"><Button icon={Camera} disabled={!stream} onClick={snap}>{t('ui.camera.snap')}</Button></div>
          </>
        )}
        <input ref={input} type="file" accept="image/*" capture={touch ? 'environment' : undefined} className="hidden" onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </Modal>
  )
}
