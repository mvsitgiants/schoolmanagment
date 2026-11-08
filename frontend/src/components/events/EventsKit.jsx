import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ImageOff } from 'lucide-react'
import { AUDIENCES, CALENDAR_SOURCES, EVENT_KIND_BY } from '@schoolgiant/shared'
import { FormField, Select, TONE } from '../system'
import { fetchAcademicLookup } from '../../api/academics'
import { downloadFile } from '../../api/files'

export function useEventLabels() {
  const { t } = useTranslation('events')
  return {
    kind: (v) => t(`events.kinds.${v}`),
    source: (v) => t(`events.sources.${v}`),
    audience: (v) => t(`events.audiences.${v}`),
    reply: (v) => t(`events.replyKinds.${v}`),
    ptm: (v) => t(`events.ptmStatus.${v}`),
    booking: (v) => t(`events.bookingStatus.${v}`),
    mode: (v) => t(`events.modes.${v}`),
  }
}

/** The colour of a calendar item: its event kind, or its source (holiday, exam, meeting). */
export const toneOf = (item) => (item.source === 'EVENT' ? EVENT_KIND_BY[item.kind]?.tone : CALENDAR_SOURCES[item.source]?.tone) ?? 'neutral'
export const chipClass = (tone) => `${TONE[tone]?.bg ?? TONE.neutral.bg} ${TONE[tone]?.text ?? TONE.neutral.text}`

export const useAcademicLookup = () => useQuery({ queryKey: ['academics', 'lookup'], queryFn: fetchAcademicLookup, staleTime: 5 * 60_000 })

/** Who something is for: everyone, some classes, some sections, or staff only (`staff`: offer the last). */
export function AudienceFields({ value, onChange, errors = {}, staff = true }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const { data: lookup } = useAcademicLookup()
  const toggle = (key, id) => onChange({ ...value, [key]: value[key].includes(id) ? value[key].filter((x) => x !== id) : [...value[key], id] })
  const chip = (key, id, label) => (
    <label key={id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
      <input type="checkbox" checked={value[key].includes(id)} onChange={() => toggle(key, id)} className="rounded border-border text-brand-500" />{label}
    </label>
  )
  return (
    <div className="space-y-2">
      <FormField label={t('events.form.audience')}>
        <Select value={value.audience} onChange={(e) => onChange({ ...value, audience: e.target.value })}>
          {AUDIENCES.filter((a) => staff || a.value !== 'STAFF').map((a) => <option key={a.value} value={a.value}>{L.audience(a.value)}</option>)}
        </Select>
      </FormField>
      {value.audience === 'CLASSES' && <div><div className="flex flex-wrap gap-2">{(lookup?.classes ?? []).map((c) => chip('classIds', c.id, c.name))}</div>{errors.classIds && <p className="mt-1 text-xs text-danger-600">{errors.classIds}</p>}</div>}
      {value.audience === 'SECTIONS' && <div><div className="flex flex-wrap gap-2">{(lookup?.sections ?? []).map((s) => chip('sectionIds', s.id, s.short))}</div>{errors.sectionIds && <p className="mt-1 text-xs text-danger-600">{errors.sectionIds}</p>}</div>}
    </div>
  )
}

/** A photo that needs the signed-in session to load (files engine): fetched once, shown from memory. */
export function AuthPhoto({ fileId, alt = '', className = '' }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url = null
    let live = true
    downloadFile(fileId).then((res) => { if (!live) return; url = URL.createObjectURL(res.data); setSrc(url) }).catch(() => live && setFailed(true))
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [fileId])
  if (failed) return <div className={`flex items-center justify-center bg-black/[0.04] text-ink-faint ${className}`}><ImageOff className="w-5 h-5" /></div>
  if (!src) return <div className={`bg-black/[0.04] animate-pulse ${className}`} />
  return <img src={src} alt={alt} className={`object-cover ${className}`} />
}
