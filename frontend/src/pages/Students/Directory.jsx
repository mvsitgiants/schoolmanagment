import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { GraduationCap, UserPlus } from 'lucide-react'
import { STUDENT_STATUS } from '@schoolgiant/shared'
import { ControlChip, DataTable, HeaderButton, ImportExportButtons, PageContainer, PageHeader, StatusPill, Toolbar } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchStudents, importStudents } from '../../api/students'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { readSheet } from '../../utils/readSheet'

export default function Directory() {
  const { t } = useTranslation('students')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { date } = useFormat()
  const [search, setSearch] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const params = { search: q || undefined, sectionId: sectionId || undefined, status, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['students', params], queryFn: () => fetchStudents(params), placeholderData: keepPreviousData })
  const rows = data?.data ?? []
  const meta = data?.meta
  const sections = useMemo(() => lookup?.sections ?? [], [lookup])
  const statusLabel = (s) => t(`students.status.${s}`, STUDENT_STATUS[s]?.label ?? s)
  const STATUS_KEYS = ['ACTIVE', 'LEFT', 'PASSED_OUT', 'INACTIVE', 'ALL']

  return (
    <PageContainer>
      <PageHeader icon={GraduationCap} title={t('students.directory.title')} subtitle={meta ? t('students.directory.count', { count: meta.total }) : t('students.directory.subtitle')}
        actions={<>
          {hasPermission('students.directory.import') && <ImportExportButtons resourceLabel={t('students.directory.resource')} requires="students.directory.import"
            onImport={async (file) => importStudents(await readSheet(file), true)} onCommit={(r) => importStudents(r, false)}
            templateHeaders={['admissionNo', 'firstName', 'lastName', 'gender', 'dob', 'class', 'section', 'rollNo', 'guardianName', 'guardianRelation', 'guardianMobile', 'guardianEmail', 'admissionDate']}
            templateSample={['', 'Aarav', 'Sharma', 'MALE', '2013-05-10', '8', 'A', '1', 'Neha Sharma', 'MOTHER', '9845012345', 'neha@example.com', '']}
            onDone={() => { qc.invalidateQueries({ queryKey: ['students'] }); qc.invalidateQueries({ queryKey: ['academic-classes'] }) }} />}
          {hasPermission('students.admit.create') && <HeaderButton icon={UserPlus} variant="primary" onClick={() => navigate('/students/admit')}>{t('students.directory.admit')}</HeaderButton>}
        </>} />
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="students"
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('students.directory.search')}
          right={<>
            <ControlChip label={t('students.directory.section')} value={sections.find((s) => s.id === sectionId)?.label ?? t('students.all')} active={!!sectionId}
              options={[t('students.all'), ...sections.map((s) => s.label)]} onChange={(v) => { setSectionId(sections.find((s) => s.label === v)?.id ?? ''); setPage(1) }} />
            <ControlChip label={t('students.directory.statusFilter')} value={statusLabel(status)} active={status !== 'ACTIVE'}
              options={STATUS_KEYS.map(statusLabel)} onChange={(v) => { setStatus(STATUS_KEYS.find((k) => statusLabel(k) === v) ?? 'ACTIVE'); setPage(1) }} />
          </>} />}
        columns={[
          { key: 'name', header: t('students.directory.student'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.admissionNo}</p></div> },
          { key: 'classShort', header: t('students.directory.class'), render: (v, r) => (v ? <span className="font-mono-num">{v}{r.rollNo ? <span className="text-ink-faint"> · {t('students.directory.roll', { no: r.rollNo })}</span> : ''}</span> : <span className="text-ink-faint">—</span>) },
          { key: 'gender', header: t('students.directory.gender'), mobileHidden: true, render: (v) => (v ? t(`students.genders.${v}`, v) : '—') },
          { key: 'dob', header: t('students.directory.dob'), mobileHidden: true, render: (v, r) => (v ? <span className="text-sm">{date(v)}<span className="text-ink-faint"> · {t('students.directory.age', { count: r.age })}</span></span> : '—') },
          { key: 'guardianName', header: t('students.directory.guardian'), render: (v, r) => (v ? <div><p className="text-sm text-ink">{v}</p>{r.guardianMobile && <p className="text-xs text-ink-faint font-mono-num">{r.guardianMobile}</p>}</div> : '—') },
          { key: 'status', header: t('students.status.title'), render: (v) => <StatusPill tone={STUDENT_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
        ]}
        onRowClick={hasPermission('students.profile.view') ? (r) => navigate(`/students/profile/${r.id}`) : undefined}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={GraduationCap}
        emptyTitle={q || sectionId || status !== 'ACTIVE' ? t('students.directory.noMatch') : t('students.directory.emptyTitle')}
        emptyHint={q || sectionId ? undefined : t('students.directory.emptyHint')}
      />
    </PageContainer>
  )
}
