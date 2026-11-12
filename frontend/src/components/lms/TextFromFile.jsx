import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, FileUp, Languages, ScanText, Trash2 } from 'lucide-react'
import { FormField, Modal, Note, ProgressBar, SegmentedControl, Textarea } from '../system'
import Button from '../ui/Button'
import { krutiToUnicode } from '../../utils/krutiDev'
import { OCR_MAX_PAGES, closeOcr, readPdf, readPhoto, textToHtml } from '../../utils/ocr'
import { CameraCapture } from '../homework/HubTools'

const LANGS = ['hin+eng', 'eng', 'hin']
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isImage = (f) => /^image\/(jpeg|png|webp)$/.test(f.type)

/**
 * Get text from a photo or PDF, on the device (no AI): pick a PDF or photos of pages (or take them), read them page by
 * page, check and correct the text next to each page, then add it to the content. `onAdd(html)`.
 */
export default function TextFromFile({ onClose, onAdd }) {
  const { t } = useTranslation('lms')
  const files = useRef(null)
  const [camera, setCamera] = useState(false) // the live camera (webcam on a computer, the camera app on a phone)
  const [langs, setLangs] = useState('hin+eng')
  const [step, setStep] = useState('PICK') // PICK · READING · REVIEW
  const [pages, setPages] = useState([]) // { text, how, kruti, preview, original }
  const [progress, setProgress] = useState({ page: 0, of: 0, pct: 0 })
  const [note, setNote] = useState(null) // { tone, text }
  const stop = useRef(false)
  useEffect(() => () => { stop.current = true; closeOcr() }, [])

  /** Read a PDF or photos; `append` adds them after the pages already read (another photo). */
  const read = async (list, { append = false } = {}) => {
    const pdf = list.find(isPdf)
    const photos = list.filter(isImage)
    if (!pdf && !photos.length) { setNote({ tone: 'warning', text: t('lms.ocr.wrongType') }); return }
    setNote(null)
    const base = append ? pages.length : 0
    if (!append) setPages([])
    setStep('READING')
    stop.current = false
    const add = (p) => setPages((x) => { const next = [...x]; next[p.index] = { ...p, original: p.text, text: p.kruti ? krutiToUnicode(p.text) : p.text }; return next })
    try {
      if (pdf) {
        setProgress({ page: 0, of: 0, pct: 0 })
        const r = await readPdf(pdf, {
          langs,
          onPage: (p) => { add(p); setProgress({ page: p.index + 1, of: p.total, pct: 0 }) },
          onProgress: (i, pct) => setProgress((x) => ({ ...x, page: i + 1, pct })),
        })
        if (r.pages > r.read) setNote({ tone: 'info', text: t('lms.ocr.firstPages', { count: r.read, total: r.pages }) })
      } else {
        for (const [i, f] of photos.slice(0, OCR_MAX_PAGES).entries()) {
          if (stop.current) return
          setProgress({ page: i + 1, of: Math.min(photos.length, OCR_MAX_PAGES), pct: 0 })
          const p = await readPhoto(f, { langs, onProgress: (pct) => setProgress((x) => ({ ...x, pct })) })
          add({ ...p, index: base + i, kruti: false })
        }
        if (photos.length > OCR_MAX_PAGES) setNote({ tone: 'info', text: t('lms.ocr.firstPages', { count: OCR_MAX_PAGES, total: photos.length }) })
      }
      if (!stop.current) setStep('REVIEW')
    } catch {
      if (stop.current) return
      setStep('PICK')
      setNote({ tone: 'danger', text: t('lms.ocr.failed') })
    }
  }
  const pick = (e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) read(list) }
  const put = (i, patch) => setPages((x) => x.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const kept = pages.filter((p) => p && p.text.trim())
  const reading = step === 'READING'
  const overall = progress.of ? Math.round(((progress.page - 1 + progress.pct) / progress.of) * 100) : 0

  return (
    <Modal open onClose={onClose} size="xl" title={t('lms.ocr.title')}
      footer={step === 'REVIEW' ? <>
        <Button variant="secondary" onClick={() => { setStep('PICK'); setPages([]); setNote(null) }}>{t('lms.ocr.again')}</Button>
        <Button variant="secondary" icon={Camera} onClick={() => setCamera(true)}>{t('lms.ocr.anotherPhoto')}</Button>
        <Button icon={ScanText} disabled={!kept.length} onClick={() => { onAdd(kept.map((p) => textToHtml(p.text)).join('')); onClose() }}>{t('lms.ocr.add')}</Button>
      </> : <Button variant="secondary" onClick={onClose}>{t('lms.ocr.cancel')}</Button>}>
      <div className="space-y-4">
        {note && <Note tone={note.tone}>{note.text}</Note>}

        {step === 'PICK' && (
          <>
            <p className="text-sm text-ink-muted">{t('lms.ocr.help')}</p>
            <FormField label={t('lms.ocr.language')} hint={t('lms.ocr.languageHint')}>
              <SegmentedControl value={langs} onChange={setLangs} options={LANGS.map((v) => ({ value: v, label: t(`lms.ocr.langs.${v}`) }))} />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <input ref={files} type="file" multiple accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
              <Button icon={FileUp} onClick={() => files.current?.click()}>{t('lms.ocr.choose')}</Button>
              <Button variant="secondary" icon={Camera} onClick={() => setCamera(true)}>{t('lms.ocr.camera')}</Button>
            </div>
            <ul className="list-disc space-y-1 ps-5 text-xs text-ink-muted">
              <li>{t('lms.ocr.tipPdf')}</li>
              <li>{t('lms.ocr.tipPhoto')}</li>
              <li>{t('lms.ocr.tipMaths')}</li>
              <li>{t('lms.ocr.tipFirstTime')}</li>
            </ul>
          </>
        )}

        {reading && (
          <div className="space-y-2 py-4">
            <p className="text-sm font-medium text-ink">{progress.of ? t('lms.ocr.readingPage', { page: Math.max(1, progress.page), of: progress.of }) : t('lms.ocr.opening')}</p>
            <ProgressBar value={overall} tone="brand" />
            <p className="text-xs text-ink-faint">{t('lms.ocr.readingHint')}</p>
          </div>
        )}

        {(reading || step === 'REVIEW') && pages.some(Boolean) && (
          <div className="space-y-4">
            {step === 'REVIEW' && <Note tone="warning">{t('lms.ocr.check')}</Note>}
            {pages.map((p, i) => p && (
              <div key={i} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-ink">{t('lms.ocr.page', { n: i + 1 })} <span className="font-normal text-ink-faint">· {t(`lms.ocr.how.${p.how}`)}</span></p>
                  {p.preview && <img src={p.preview} alt={t('lms.ocr.page', { n: i + 1 })} className="max-h-72 w-full rounded border border-border bg-white object-contain" />}
                </div>
                <div className="space-y-2">
                  <Textarea rows={10} dir="auto" value={p.text} disabled={reading} onChange={(e) => put(i, { text: e.target.value })} aria-label={t('lms.ocr.textOf', { n: i + 1 })} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {p.how === 'TEXT' ? (
                      <label className="inline-flex items-center gap-2 text-xs text-ink-muted">
                        <input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={!!p.kruti} disabled={reading}
                          onChange={(e) => put(i, { kruti: e.target.checked, text: e.target.checked ? krutiToUnicode(p.original) : p.original })} />
                        <Languages className="h-3.5 w-3.5" aria-hidden />{t('lms.ocr.kruti')}
                      </label>
                    ) : p.how === 'REPAIRED' && p.copied ? (
                      <label className="inline-flex items-center gap-2 text-xs text-ink-muted">
                        <input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={!!p.useCopied} disabled={reading}
                          onChange={(e) => put(i, { useCopied: e.target.checked, text: e.target.checked ? p.copied : p.original })} />
                        {t('lms.ocr.useCopied')}
                      </label>
                    ) : <span />}
                    <Button size="sm" variant="ghost" icon={Trash2} disabled={reading} onClick={() => setPages((x) => x.map((y, j) => (j === i ? null : y)))}>{t('lms.ocr.removePage')}</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {camera && <CameraCapture onClose={() => setCamera(false)} onPhoto={(file) => { setCamera(false); read([file], { append: step === 'REVIEW' }) }} />}
    </Modal>
  )
}
