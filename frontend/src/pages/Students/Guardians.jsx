import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Baby, Star, Users, UsersRound } from 'lucide-react'
import { ColorChip, ContactCell, DataTable, PageContainer, PageHeader, PersonCell, StatCardRow, Toolbar } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchGuardians } from '../../api/students'

/** Every parent and guardian of current students, one row per mobile number, with their children. */
export default function Guardians() {
  const { t } = useTranslation('students')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['guardians', q], queryFn: () => fetchGuardians(q) })
  const children = new Set(rows.flatMap((r) => r.children.map((c) => c.id))).size
  const families = rows.filter((r) => r.children.length > 1).length
  return (
    <PageContainer>
      <PageHeader icon={Users} title={t('students.guardians.title')} subtitle={t('students.guardians.subtitle')} />
      {rows.length > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: Users, tone: 'brand', label: t('students.guardians.summary.parents'), value: rows.length },
          { icon: Baby, tone: 'sky', label: t('students.guardians.summary.children'), value: children },
          { icon: UsersRound, tone: 'violet', label: t('students.guardians.summary.siblings'), value: families, sub: t('students.guardians.summary.siblingsHint'), progress: (families / rows.length) * 100 },
        ]} />
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="parents"
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('students.guardians.search')} />}
        columns={[
          { key: 'name', header: t('students.guardians.name'), mobilePrimary: true, render: (v, r) => (
            <span className="inline-flex max-w-full items-center gap-1.5">
              <PersonCell name={v} sub={r.relation ? t(`students.relations.${r.relation}`, r.relation) : undefined} size={34} />
              {r.primaryFor > 0 && <Star className="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label={t('students.form.primary')} />}
            </span>
          ) },
          { key: 'mobile', header: t('students.form.mobile'), render: (v) => <ContactCell phone={v} /> },
          { key: 'email', header: t('students.form.email'), mobileHidden: true, render: (v) => (v ? <span className="text-sm text-ink-muted">{v}</span> : <span className="text-ink-faint">—</span>) },
          { key: 'children', header: t('students.guardians.children'), render: (v) => (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {v.map((c) => (
                <Link key={c.id} to={`/students/profile/${c.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
                  {c.name}{c.classShort && <ColorChip label={c.classShort} />}
                </Link>
              ))}
            </div>
          ) },
        ]}
        emptyIcon={Users} emptyTitle={q ? t('students.directory.noMatch') : t('students.guardians.empty')}
      />
      <p className="mt-3 text-xs text-ink-muted">{t('students.guardians.editNote')}</p>
    </PageContainer>
  )
}
