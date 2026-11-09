import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react'
import { Input, Modal } from '../system'
import Button from '../ui/Button'

// Scanning, for every screen that reads a code: the phone's camera (QR codes and the barcodes on ID
// cards, book labels and receipts), or a USB / Bluetooth scanner gun — those type the code and press
// Enter, so the same box takes them. The camera uses the browser's own BarcodeDetector where there is
// one (Chrome on Android) and ZXing otherwise (Safari on iPhone), loaded only when a scan starts.

const FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf', 'data_matrix']
const REPEAT_MS = 2500 // the same code again within this is the same card still in front of the camera

/** A short beep and a buzz, so the person scanning knows it read without looking at the screen. */
function feedback(ok = true) {
  try { navigator.vibrate?.(ok ? 60 : [40, 60, 40]) } catch { /* not on this device */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = feedback.ctx ?? (feedback.ctx = new Ctx())
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = ok ? 1250 : 330
    g.gain.value = 0.08
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.09 : 0.25))
  } catch { /* sound is a nicety */ }
}
export const scanFeedback = feedback

/** The card code inside a student ID card's QR link (…/verify/student/<code>); anything else as read. */
export function cardCodeOf(text) {
  const m = String(text ?? '').trim().match(/\/verify\/student\/([A-Za-z0-9]{6,20})\/?$/)
  return m ? m[1].toUpperCase() : String(text ?? '').trim()
}

/**
 * Point the camera at codes. `onCode(text)` fires once per code (a repeat of the same code within
 * a moment is ignored). Returns { state: 'starting' | 'on' | 'denied' | 'none' | 'error' }.
 */
function useCamera(videoRef, active, onCode) {
  const [state, setState] = useState('starting')
  const last = useRef({ text: '', at: 0 })
  const handler = useRef(onCode)
  handler.current = onCode
  useEffect(() => {
    if (!active) return undefined
    let stopped = false
    let stream = null
    let controls = null
    let frame = 0
    const hit = (text) => {
      const now = Date.now()
      if (!text || (text === last.current.text && now - last.current.at < REPEAT_MS)) return
      last.current = { text, at: now }
      handler.current(text)
    }
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('none'); return }
      try {
        const native = 'BarcodeDetector' in window ? (await window.BarcodeDetector.getSupportedFormats?.()) ?? [] : []
        if (native.includes('qr_code')) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
          if (stopped) return
          const video = videoRef.current
          video.srcObject = stream
          await video.play()
          const detector = new window.BarcodeDetector({ formats: FORMATS.filter((f) => native.includes(f)) })
          setState('on')
          const tick = async () => {
            if (stopped) return
            try {
              if (video.readyState >= 2) for (const c of await detector.detect(video)) hit(c.rawValue)
            } catch { /* a frame it couldn't read */ }
            frame = window.setTimeout(tick, 180)
          }
          tick()
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          if (stopped) return
          const reader = new BrowserMultiFormatReader()
          controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current, (result) => { if (result) hit(result.getText()) })
          if (stopped) controls.stop()
          else setState('on')
        }
      } catch (e) {
        if (!stopped) setState(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : e?.name === 'NotFoundError' ? 'none' : 'error')
      }
    }
    setState('starting')
    start()
    return () => {
      stopped = true
      window.clearTimeout(frame)
      controls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, videoRef])
  return { state }
}

/**
 * The scanner: the camera view with a frame, and a box for a scanner gun or typing the code.
 *   <ScanDialog open onClose title hint onCode={(text) => …} continuous>{recent results}</ScanDialog>
 * `continuous`: stays open for the next card (gate, class register, bus); otherwise it closes after a read.
 * `children`: shown under the camera — e.g. the last few scans and what each did.
 */
export function ScanDialog({ open, onClose, onCode, title, hint, continuous = false, children }) {
  const { t } = useTranslation('scan')
  const videoRef = useRef(null)
  const inputRef = useRef(null)
  const [camera, setCamera] = useState(true)
  const [typed, setTyped] = useState('')
  const take = useCallback((text) => {
    const code = String(text ?? '').trim()
    if (!code) return
    feedback(true)
    onCode(code)
    if (!continuous) onClose()
  }, [onCode, continuous, onClose])
  const { state } = useCamera(videoRef, open && camera, take)
  useEffect(() => { if (open && !camera) inputRef.current?.focus() }, [open, camera])
  if (!open) return null
  const message = { starting: t('scan.camera.starting'), denied: t('scan.camera.denied'), none: t('scan.camera.none'), error: t('scan.camera.error') }[state]
  return (
    <Modal open onClose={onClose} size="md" title={title ?? t('scan.title')}>
      <div className="space-y-3">
        {camera && (
          <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3] sm:aspect-video">
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
            {state === 'on' ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[62%] w-[72%] rounded-2xl border-[3px] border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                <ScanLine className="absolute w-10 h-10 text-white/70 animate-pulse" aria-hidden />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white/85">
                <CameraOff className="w-8 h-8 text-white/60" aria-hidden />
                <p>{message}</p>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-ink-muted">{hint ?? t('scan.hint')}</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); take(typed); setTyped(''); inputRef.current?.focus() }}>
          <Input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('scan.typePlaceholder')} aria-label={t('scan.typeLabel')} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <Button type="submit" variant="secondary" disabled={!typed.trim()}>{t('scan.go')}</Button>
        </form>
        <div className="flex justify-between gap-2">
          <Button size="sm" variant="ghost" icon={camera ? Keyboard : Camera} onClick={() => setCamera((v) => !v)}>{camera ? t('scan.useGun') : t('scan.useCamera')}</Button>
          {continuous && <Button size="sm" variant="secondary" onClick={onClose}>{t('scan.done')}</Button>}
        </div>
        {children}
      </div>
    </Modal>
  )
}
