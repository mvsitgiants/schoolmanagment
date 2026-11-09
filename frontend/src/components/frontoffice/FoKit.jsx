import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Camera, RefreshCw, Search, X } from 'lucide-react'
import {
  FO_COMPLAINT_CATEGORY_BY, FO_COMPLAINT_PRIORITY_BY, FO_COMPLAINT_STATUS, FO_GATE_PASS_STATUS, FO_VISIT_PURPOSE_BY,
} from '@schoolgiant/shared'
import { Avatar, ColorChip, FormField, Input, Select, StatusPill } from '../system'
import { fetchFoStaff, findFoStudents } from '../../api/frontOffice'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { resizeImage } from '../../utils/resizeImage'

/** Words for the module's codes, from the locale file. */
export function useFoLabels() {
  const { t } = useTranslation('frontoffice')
  return {
    purpose: (v) => t(`frontoffice.purposes.${v}`, v ?? ''),
    idType: (v) => t(`frontoffice.idTypes.${v}`, v ?? ''),
    pass: (v) => t(`frontoffice.passStatus.${v}`, v ?? ''),
    complaint: (v) => t(`frontoffice.complaintStatus.${v}`, v ?? ''),
    category: (v) => t(`frontoffice.categories.${v}`, v ?? ''),
    priority: (v) => t(`frontoffice.priorities.${v}`, v ?? ''),
    source: (v) => t(`frontoffice.sources.${v}`, v ?? ''),
    step: (v) => t(`frontoffice.steps.${v}`, v ?? ''),
  }
}

export function PurposeChip({ value }) {
  const L = useFoLabels()
  return <ColorChip label={L.purpose(value)} tone={FO_VISIT_PURPOSE_BY[value]?.tone ?? 'neutral'} dot />
}
export function PassPill({ value }) {
  const L = useFoLabels()
  return <StatusPill tone={FO_GATE_PASS_STATUS[value]?.tone}>{L.pass(value)}</StatusPill>
}
export function ComplaintPill({ value }) {
  const L = useFoLabels()
  return <StatusPill tone={FO_COMPLAINT_STATUS[value]?.tone}>{L.complaint(value)}</StatusPill>
}
export function CategoryChip({ value }) {
  const L = useFoLabels()
  return <ColorChip label={L.category(value)} tone={FO_COMPLAINT_CATEGORY_BY[value]?.tone ?? 'neutral'} dot />
}
export function PriorityChip({ value }) {
  const L = useFoLabels()
  return <ColorChip label={L.priority(value)} tone={FO_COMPLAINT_PRIORITY_BY[value]?.tone ?? 'neutral'} />
}

/** A person's photo (data URL) or their initials, as a rounded square. */
export function Face({ photo, name, size = 56, className }) {
  return photo
    ? <img src={photo} alt="" className={clsx('shrink-0 rounded-xl object-cover ring-1 ring-border', className)} style={{ width: size, height: size }} />
    : <span className={clsx('shrink-0 inline-flex', className)}><Avatar name={name} size={size} soft /></span>
}

/** Read a file as a data URL. */
const asDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = reject
  r.readAsDataURL(file)
})

/**
 * Take a photo with the device camera (a phone or tablet opens it straight away; a desktop picks a file), shrunk to
 * a small JPEG before it is kept. `value` is the data URL.
 */
export function PhotoCapture({ value, onChange, label }) {
  const { t } = useTranslation('frontoffice')
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const small = await resizeImage(file, { max: 480, quality: 0.75, minBytes: 0 })
      onChange(await asDataUrl(small))
    } finally { setBusy(false) }
  }
  return (
    <FormField label={label ?? t('frontoffice.photo.label')} hint={t('frontoffice.photo.hint')}>
      <div className="flex items-center gap-3">
        {value
          ? <img src={value} alt="" className="h-20 w-20 rounded-xl object-cover ring-1 ring-border" />
          : <span className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border text-ink-faint"><Camera className="h-6 w-6" aria-hidden /></span>}
        <div className="flex flex-col gap-1.5">
          <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-ink hover:bg-bg disabled:opacity-50">
            {value ? <RefreshCw className="h-4 w-4" /> : <Camera className="h-4 w-4" />}{value ? t('frontoffice.photo.retake') : t('frontoffice.photo.take')}
          </button>
          {value && <button type="button" onClick={() => onChange('')} className="inline-flex h-8 items-center gap-1 text-xs text-danger-600"><X className="h-3.5 w-3.5" />{t('frontoffice.photo.remove')}</button>}
        </div>
        <input ref={ref} type="file" accept="image/*" capture="user" className="hidden" onChange={pick} />
      </div>
    </FormField>
  )
}

/** Staff to pick (whom to meet, assign to): one list, loaded once. */
export function useFoStaff() {
  return useQuery({ queryKey: ['frontoffice', 'staff'], queryFn: () => fetchFoStaff(), staleTime: 300_000 })
}

export function StaffSelect({ value, onChange, label, required, error, placeholder }) {
  const { t } = useTranslation('frontoffice')
  const { data = [] } = useFoStaff()
  return (
    <FormField label={label} required={required} error={error}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value, data.find((s) => s.id === e.target.value))}>
        <option value="">{placeholder ?? t('frontoffice.common.pickStaff')}</option>
        {data.map((s) => <option key={s.id} value={s.id}>{s.name}{s.designation ? ` · ${s.designation}` : ''}</option>)}
      </Select>
    </FormField>
  )
}

/** Find a student by name or admission number; the picked one shows as a card with a clear button. */
export function StudentFinder({ value, onChange, label, required, error }) {
  const { t } = useTranslation('frontoffice')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found = [], isFetching } = useQuery({ queryKey: ['frontoffice', 'students', q], queryFn: () => findFoStudents(q), enabled: q.length >= 2 && !value })
  return (
    <FormField label={label ?? t('frontoffice.common.student')} required={required} error={error}>
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2">
          <Avatar name={value.name} size={34} soft />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{value.name}</p>
            <p className="truncate text-xs text-ink-muted">{[value.classShort, value.admissionNo].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={() => onChange(null)} className="rounded-md p-1.5 text-ink-faint hover:bg-black/5 hover:text-ink" aria-label={t('frontoffice.common.clear')}><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('frontoffice.common.findStudent')} />
          </div>
          {q.length >= 2 && (
            <div className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {found.length === 0 && !isFetching && <p className="px-3 py-2 text-sm text-ink-faint">{t('frontoffice.common.noStudents')}</p>}
              {found.map((s) => (
                <button key={s.id} type="button" onClick={() => { onChange(s); setSearch('') }} className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-black/[0.02]">
                  <Avatar name={s.name} size={28} soft />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.name}</span>
                  {s.classShort && <ColorChip label={s.classShort} />}
                  <span className="text-xs text-ink-faint">{s.admissionNo}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </FormField>
  )
}

/** Pick one of a few options as big chips (purpose, category, priority). */
export function ChipPicker({ options, value, onChange, label, required, error }) {
  return (
    <FormField label={label} required={required} error={error}>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={clsx('min-h-[36px] rounded-full border px-3 text-sm transition', value === o.value ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-ink-muted hover:border-ink-faint hover:text-ink')}>
            {o.label}
          </button>
        ))}
      </div>
    </FormField>
  )
}
