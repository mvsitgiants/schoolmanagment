import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Baby, Star, Users, UsersRound } from 'lucide-react'
import { ColorChip, ContactCell, DataTable, PageContainer, PageHeader, PersonCell, StatCardRow, Toolbar } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAllGuardians, fetchGuardians } from '../../api/students'
import useUrlSearch from '../../hooks/useUrlSearch'

const PAGE = 50

/** Every parent and guardian of current students, one row per mobile number, with their children — a page at a time. */
export default function Guardians() {
  const { t } = useTranslation('students')
  const [search, setSearch] = useUrlSearch()
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['guardians', params], queryFn: () => fetchGuardians(params), placeholderData: keepPreviousData })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  // the tiles count every parent matching the search, not just this page
  const children = data?.counts?.children ?? 0
  const families = data?.counts?.siblings ?? 0
  return (
    <PageContainer>
      <PageHeader icon={Users} title={t('students.guardians.title')} subtitle={t('students.guardians.subtitle')} />
      {total > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: Users, tone: 'brand', label: t('students.guardians.summary.parents'), value: total },
          { icon: Baby, tone: 'sky', label: t('students.guardians.summary.children'), value: children },
          { icon: UsersRound, tone: 'violet', label: t('students.guardians.summary.siblings'), value: families, sub: t('students.guardians.summary.siblingsHint'), progress: (families / total) * 100 },
        ]} />
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="parents" exportAll={() => fetchAllGuardians({ search: q || undefined })}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('students.guardians.search')} />}
        columns={[
          { key: 'name', header: t('students.guardians.name'), mobilePrimary: true, render: (v, r) => (
            <span className="inline-flex max-w-full items-center gap-1.5">
              <PersonCell name={v} sub={r.relation ? t(`students.relations.${r.relation}`, r.relation) : undefined} size={34} />
              {r.primaryFor > 0 && <Star className="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label={t('students.form.primary')} />}
            </span>
          ) },
          { key: 'mobile', header: t('students.form.mobile'), render: (v) => <ContactCell phone={v} /> },
          { key: 'email', header: t('students.form.email'), mobileHidden: true, render: (v) => (v ? <span className="text-sm text-ink-muted">{v}</span> : <span className="text-ink-faint">—</span>) },
          { key: 'children', header: t('students.guardians.children'), sortAccessor: (r) => r.children.map((c) => [c.name, c.classShort].filter(Boolean).join(' · ')).join('; '), render: (v) => (
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
        pagination={total > PAGE ? { page: page - 1, size: PAGE, totalElements: total, totalPages: Math.ceil(total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
      />
      <p className="mt-3 text-xs text-ink-muted">{t('students.guardians.editNote')}</p>
    </PageContainer>
  )
}
