import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIcon, PenLine, Stamp, Trash2, Upload } from 'lucide-react'
import { FormField } from '../system'
import Button from '../ui/Button'
import { IMAGE_TYPES, shrinkImage } from '../../utils/shrinkImage'
import SignatureModal from './SignatureModal'
import StampModal from './StampModal'

/**
 * Upload an image printed on documents — the school seal, a signature, a campus logo. Kept as a small data URL (WebP keeps
 * the transparent background of a scanned seal or signature). `value` '' = none.
 * `make`: 'signature' also lets them sign on the screen; 'stamp' lets them make a seal from the school's name
 * (`stampDefaults` { name, place }) — for a school without a scan.
 */
export default function PrintImageField({ label, hint, value, onChange, disabled, error, wide = false, make, stampDefaults }) {
  const { t } = useTranslation('admin')
  const input = useRef(null)
  const [problem, setProblem] = useState(null)
  const [making, setMaking] = useState(false)
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) { setProblem(t('admin.printImage.typeError')); return }
    const data = await shrinkImage(file, { maxSide: 600, maxBytes: 300 * 1024 }).catch(() => null)
    if (!data) { setProblem(t('admin.printImage.tooBig')); return }
    setProblem(null)
    onChange(data)
  }
  return (
    <FormField label={label} hint={hint} error={problem || error}>
      <div className="flex items-center gap-3">
        <span className={`${wide ? 'w-28' : 'w-14'} h-14 shrink-0 rounded-lg border border-dashed border-border bg-white flex items-center justify-center overflow-hidden`}>
          {value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <ImageIcon className="w-5 h-5 text-ink-faint" />}
        </span>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={pick} />
          <Button size="sm" variant="secondary" icon={Upload} disabled={disabled} onClick={() => input.current?.click()}>{value ? t('admin.printImage.replace') : t('admin.printImage.upload')}</Button>
          {make === 'signature' && <Button size="sm" variant="secondary" icon={PenLine} disabled={disabled} onClick={() => setMaking(true)}>{t('admin.printImage.draw')}</Button>}
          {make === 'stamp' && <Button size="sm" variant="secondary" icon={Stamp} disabled={disabled} onClick={() => setMaking(true)}>{t('admin.printImage.makeStamp')}</Button>}
          {value && <Button size="sm" variant="ghost" icon={Trash2} disabled={disabled} onClick={() => { setProblem(null); onChange('') }}>{t('admin.printImage.remove')}</Button>}
        </div>
      </div>
      {making && make === 'signature' && <SignatureModal open onClose={() => setMaking(false)} onUse={(v) => { setProblem(null); onChange(v) }} />}
      {making && make === 'stamp' && <StampModal open defaults={stampDefaults} onClose={() => setMaking(false)} onUse={(v) => { setProblem(null); onChange(v) }} />}
    </FormField>
  )
}
