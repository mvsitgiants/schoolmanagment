import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FormField, Input, Select } from '../system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchStudents } from '../../api/students'

/** Find a student by name or admission number, then pick one. `preset` keeps an already chosen student in the list. */
export default function StudentPicker({ value, onChange, preset, error, required = true }) {
  const { t } = useTranslation('fees')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found } = useQuery({ queryKey: ['students', 'fee-pick', q], queryFn: () => fetchStudents({ search: q, pageSize: 20 }), enabled: q.length >= 2 })
  const options = [...(preset ? [preset] : []), ...(found?.data ?? []).filter((s) => s.id !== preset?.id)]
  return (
    <>
      <FormField label={t('fees.picker.find')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('fees.picker.findPlaceholder')} /></FormField>
      <FormField label={t('fees.picker.student')} required={required} error={error}>
        <Select value={value} onChange={(e) => onChange(e.target.value, options.find((s) => s.id === e.target.value))}>
          <option value="">{q.length >= 2 || preset ? t('fees.picker.pick') : t('fees.picker.typeFirst')}</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.classShort ?? '—'} · {s.admissionNo}</option>)}
        </Select>
      </FormField>
    </>
  )
}
