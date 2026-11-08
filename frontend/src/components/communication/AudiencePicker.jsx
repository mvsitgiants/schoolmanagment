import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { AUDIENCE_KINDS } from '@schoolgiant/shared'
import { SegmentedControl } from '../system'
import StudentPicker from '../fees/StudentPicker'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAcademicLookup } from '../../api/academics'
import { previewAudience } from '../../api/communication'

/** Who a notice or message is for: the whole school, classes, sections or picked students — with a live count. */
export default function AudiencePicker({ value, onChange, disabled = false }) {
  const { t } = useTranslation('communication')
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [picked, setPicked] = useState([]) // students picked, for their names
  const key = useDebouncedValue(JSON.stringify(value), 300)
  const { data: count } = useQuery({ queryKey: ['audience-count', key], queryFn: () => previewAudience(JSON.parse(key)), retry: false })
  const set = (patch) => onChange({ ...value, ...patch })
  const toggle = (field, id) => set({ [field]: value[field].includes(id) ? value[field].filter((x) => x !== id) : [...value[field], id] })
  const chip = 'inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg'
  const box = 'rounded border-border text-brand-500 focus:ring-brand-500'

  return (
    <div className="space-y-3">
      <SegmentedControl value={value.kind} onChange={(kind) => !disabled && set({ kind })} options={AUDIENCE_KINDS.map((k) => ({ value: k.value, label: t(`communication.audience.${k.value}`, k.label) }))} />
      {value.kind === 'CLASSES' && (
        <div className="flex flex-wrap gap-2">
          {(lookup?.classes ?? []).map((c) => <label key={c.id} className={chip}><input type="checkbox" disabled={disabled} checked={value.classIds.includes(c.id)} onChange={() => toggle('classIds', c.id)} className={box} />{c.name}</label>)}
        </div>
      )}
      {value.kind === 'SECTIONS' && (
        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
          {(lookup?.sections ?? []).map((s) => <label key={s.id} className={chip}><input type="checkbox" disabled={disabled} checked={value.sectionIds.includes(s.id)} onChange={() => toggle('sectionIds', s.id)} className={box} />{s.short}</label>)}
        </div>
      )}
      {value.kind === 'STUDENTS' && (
        <div className="space-y-2">
          {!disabled && <div className="grid sm:grid-cols-2 gap-3"><StudentPicker value="" required={false} onChange={(id, s) => { if (id && !value.studentIds.includes(id)) { set({ studentIds: [...value.studentIds, id] }); setPicked((p) => [...p, s]) } }} /></div>}
          <div className="flex flex-wrap gap-2">
            {value.studentIds.map((id) => {
              const s = picked.find((x) => x?.id === id)
              return <button key={id} type="button" disabled={disabled} onClick={() => set({ studentIds: value.studentIds.filter((x) => x !== id) })} className="rounded-full bg-brand-50 text-brand-700 px-3 py-1 text-sm">{s ? `${s.name} · ${s.classShort ?? ''}` : t('communication.audience.oneStudent')} ×</button>
            })}
          </div>
        </div>
      )}
      {count && <p className="flex items-center gap-1.5 text-sm text-ink-muted"><Users size={14} />{count.tooMany ? t('communication.audience.tooMany') : t('communication.audience.count', { count: count.students })}</p>}
    </div>
  )
}

export const emptyAudience = () => ({ kind: 'ALL', classIds: [], sectionIds: [], studentIds: [] })
