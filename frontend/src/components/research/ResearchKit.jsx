import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, UserRound, X } from 'lucide-react'
import { RESEARCH_INDEXING_BY, RESEARCH_PROJECT_STATUS, RESEARCH_PUB_TYPE_BY, RESEARCH_SCHOLAR_STATUS } from '@schoolgiant/shared'
import { Avatar, FormField, Input, Select, StatusPill, Tag } from '../system'
import Button from '../ui/Button'
import { fetchResearchMeta } from '../../api/research'

/** Labels for the research lists (shared values → this namespace's text). */
export function useResearchLabels() {
  const { t } = useTranslation('research')
  return {
    type: (v) => t(`research.types.${v}`),
    indexing: (v) => t(`research.indexing.${v}`),
    agency: (v) => t(`research.agencies.${v}`),
    project: (v) => t(`research.projectStatus.${v}`),
    scholar: (v) => t(`research.scholarStatus.${v}`),
    mode: (v) => t(`research.modes.${v}`),
  }
}

/** Departments, staff and publication years for the pickers. */
export const useResearchMeta = () => useQuery({ queryKey: ['research', 'meta'], queryFn: fetchResearchMeta, staleTime: 60_000 })

export function PubTypeTag({ type }) {
  const L = useResearchLabels()
  return <Tag tone={RESEARCH_PUB_TYPE_BY[type]?.tone ?? 'neutral'}>{L.type(type)}</Tag>
}

export function IndexingTags({ list = [] }) {
  const L = useResearchLabels()
  if (!list.length) return <span className="text-ink-faint">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((i) => <Tag key={i} size="xs" tone={RESEARCH_INDEXING_BY[i]?.tone ?? 'neutral'}>{L.indexing(i)}</Tag>)}
    </span>
  )
}

export function ProjectPill({ status }) {
  const L = useResearchLabels()
  return <StatusPill tone={RESEARCH_PROJECT_STATUS[status]?.tone ?? 'neutral'}>{L.project(status)}</StatusPill>
}

export function ScholarPill({ status }) {
  const L = useResearchLabels()
  return <StatusPill tone={RESEARCH_SCHOLAR_STATUS[status]?.tone ?? 'neutral'}>{L.scholar(status)}</StatusPill>
}

/** Overlapping initials of a list of people (authors, co-PIs), with "+N" past `max`. */
export function PeopleStack({ people = [], max = 4, size = 26 }) {
  const shown = people.slice(0, max)
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={`${p.userId ?? p.id ?? ''}${p.name}${i}`} title={p.name} className={i ? '-ms-2' : ''}>
          <Avatar name={p.name} size={size} className="ring-2 ring-surface" soft={!(p.userId || p.id)} />
        </span>
      ))}
      {people.length > max && <span className="ms-1 text-[11px] font-semibold text-ink-muted">+{people.length - max}</span>}
    </span>
  )
}

/** A member of staff from the meta list. */
export function StaffSelect({ value, onChange, staff = [], placeholder, exclude = [], ...rest }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{placeholder}</option>
      {staff.filter((s) => !exclude.includes(s.id) || s.id === value).map((s) => <option key={s.id} value={s.id}>{s.designation ? `${s.name} · ${s.designation}` : s.name}</option>)}
    </Select>
  )
}

/** Several members of staff as removable chips, added one at a time (co-PIs). */
export function StaffChips({ value = [], onChange, staff = [], exclude = [], placeholder }) {
  const byId = new Map(staff.map((s) => [s.id, s]))
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 ps-0.5 pe-2 text-sm">
              <Avatar name={byId.get(id)?.name ?? '?'} size={22} />{byId.get(id)?.name ?? '—'}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="text-ink-faint hover:text-danger-600" aria-label={byId.get(id)?.name}><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
        </div>
      )}
      <StaffSelect value="" staff={staff} exclude={[...value, ...exclude]} placeholder={placeholder} onChange={(id) => id && onChange([...value, id])} />
    </div>
  )
}

/**
 * The authors of a publication, in order: members of staff (picked, linked to their login) and people from outside
 * (typed). `value`: [{ userId?, name }].
 */
export function AuthorsField({ value = [], onChange, staff = [], error }) {
  const { t } = useTranslation('research')
  const [outside, setOutside] = useState('')
  const addOutside = () => {
    const name = outside.trim()
    if (!name) return
    onChange([...value, { userId: null, name }])
    setOutside('')
  }
  const move = (i, d) => {
    const next = [...value]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <FormField label={t('research.pubs.authors')} required error={error} hint={t('research.pubs.authorsHint')}>
      <div className="space-y-2">
        {value.length > 0 && (
          <ol className="divide-y divide-border rounded-xl border border-border">
            {value.map((a, i) => (
              <li key={`${a.userId ?? ''}${a.name}${i}`} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="w-5 text-center text-xs font-semibold text-ink-faint tabular-nums">{i + 1}</span>
                <Avatar name={a.name} size={26} soft={!a.userId} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.name}</span>
                <Tag size="xs" tone={a.userId ? 'brand' : 'neutral'} icon={a.userId ? UserRound : undefined}>{a.userId ? t('research.pubs.staff') : t('research.pubs.external')}</Tag>
                <button type="button" className="px-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('research.pubs.moveUp')}>↑</button>
                <button type="button" className="px-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={t('research.pubs.moveDown')}>↓</button>
                <button type="button" className="text-ink-faint hover:text-danger-600" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label={t('research.remove')}><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ol>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <StaffSelect value="" staff={staff} exclude={value.map((a) => a.userId).filter(Boolean)} placeholder={t('research.pubs.addStaff')}
            onChange={(id) => { const s = staff.find((x) => x.id === id); if (s) onChange([...value, { userId: s.id, name: s.name }]) }} aria-label={t('research.pubs.addStaff')} />
          <div className="flex gap-2">
            <Input value={outside} onChange={(e) => setOutside(e.target.value)} placeholder={t('research.pubs.addExternal')} aria-label={t('research.pubs.addExternal')}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOutside() } }} />
            <Button variant="secondary" icon={Plus} disabled={!outside.trim()} onClick={addOutside} aria-label={t('research.pubs.addExternal')} />
          </div>
        </div>
      </div>
    </FormField>
  )
}

/** Rupees typed, paise kept: '' stays empty. */
export const rupeesOf = (paise) => (paise === null || paise === undefined || paise === '' ? '' : String(Number(paise) / 100))
export const paiseOf = (rupees) => (rupees === '' || rupees === null || rupees === undefined ? 0 : Math.round(Number(rupees) * 100))
