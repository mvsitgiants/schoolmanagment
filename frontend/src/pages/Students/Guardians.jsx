import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Star, Users } from 'lucide-react'
import { DataTable, PageContainer, PageHeader, Toolbar } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchGuardians } from '../../api/students'

/** Every parent and guardian of current students, one row per mobile number, with their children. */
export default function Guardians() {
  const { t } = useTranslation('students')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['guardians', q], queryFn: () => fetchGuardians(q) })
  return (
    <PageContainer>
      <PageHeader icon={Users} title={t('students.guardians.title')} subtitle={t('students.guardians.subtitle')} />
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="parents"
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('students.guardians.search')} />}
        columns={[
          { key: 'name', header: t('students.guardians.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink flex items-center gap-1">{v}{r.primaryFor > 0 && <Star className="w-3.5 h-3.5 text-brand-500" aria-label={t('students.form.primary')} />}</p>{r.relation && <p className="text-xs text-ink-faint">{t(`students.relations.${r.relation}`, r.relation)}</p>}</div> },
          { key: 'mobile', header: t('students.form.mobile'), render: (v) => (v ? <span className="font-mono-num">{v}</span> : '—') },
          { key: 'email', header: t('students.form.email'), mobileHidden: true, render: (v) => v || '—' },
          { key: 'children', header: t('students.guardians.children'), render: (v) => <div className="flex flex-wrap gap-x-3 gap-y-1">{v.map((c) => <Link key={c.id} to={`/students/profile/${c.id}`} onClick={(e) => e.stopPropagation()} className="text-sm text-brand-600 hover:underline">{c.name} <span className="text-ink-faint font-mono-num">{c.classShort}</span></Link>)}</div> },
        ]}
        emptyIcon={Users} emptyTitle={q ? t('students.directory.noMatch') : t('students.guardians.empty')}
      />
      <p className="mt-3 text-xs text-ink-muted">{t('students.guardians.editNote')}</p>
    </PageContainer>
  )
}
