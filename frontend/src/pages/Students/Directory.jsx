import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { GraduationCap, UserPlus, UsersRound } from 'lucide-react'
import { STUDENT_STATUS } from '@schoolgiant/shared'
import { ColorChip, ContactCell, ControlChip, DataTable, GenderTag, HeaderButton, ImportExportButtons, PageContainer, PageHeader, PersonCell, SideNavLayout, StackCell, StatCardRow, StatusPill, Toolbar } from '../../components/system'
import { ClassNav, SectionPills, useClassSections } from '../../components/students/ClassNav'
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
  const [searchParams] = useSearchParams() // ?sectionId= / ?classId= — e.g. from the Class board
  const [search, setSearch] = useState('')
  const [sectionId, setSectionId] = useState(() => searchParams.get('sectionId') ?? '')
  const [pickedClassId, setClassId] = useState(() => searchParams.get('classId') ?? '')
  const [gender, setGender] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const classList = useClassSections(lookup)
  // a section link (?sectionId=, from the Class board) opens its class in the side list with that section picked
  const classId = pickedClassId || classList.find((c) => c.sections.some((s) => s.id === sectionId))?.id || ''
  const pickClass = (id) => { setClassId(id); setSectionId(''); setPage(1) }
  const params = { search: q || undefined, sectionId: sectionId || undefined, classId: sectionId ? undefined : classId || undefined, gender: gender || undefined, status, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['students', params], queryFn: () => fetchStudents(params), placeholderData: keepPreviousData })
  const rows = data?.data ?? []
  const meta = data?.meta
  const statusLabel = (s) => t(`students.status.${s}`, STUDENT_STATUS[s]?.label ?? s)
  const STATUS_KEYS = ['ACTIVE', 'LEFT', 'PASSED_OUT', 'INACTIVE', 'ALL']
  const GENDER_KEYS = ['', 'MALE', 'FEMALE', 'OTHER']
  const genderLabel = (g) => (g ? t(`students.genders.${g}`, g) : t('students.all'))
  const summary = data?.summary
  const genders = summary?.genders ?? {}
  const classes = summary?.classes ?? []
  const everyone = Object.values(genders).reduce((n, v) => n + v, 0)
  const pickedClass = classes.find((c) => c.id === classId)
  const countOf = useMemo(() => new Map(classes.map((c) => [c.id, c.count])), [classes])
  const current = classList.find((c) => c.id === classId)

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
      <SideNavLayout nav={classList.length > 1 && (
        <ClassNav title={t('students.directory.classes')} classes={classList} value={classId} onChange={pickClass}
          all={{ label: t('students.directory.allClasses'), count: summary ? everyone : undefined }}
          item={(c) => ({ count: summary ? countOf.get(c.id) ?? 0 : undefined, hint: t('students.directory.sectionCount', { count: c.sections.length }) })} />
      )}>
      {summary && everyone > 0 && (
        // the class list beside (or above, on a phone) carries each class's strength; these two are the school at a glance
        // (StatCardRow has no two-tile column count of its own yet, so it is set here)
        <StatCardRow className="lg:!grid-cols-2" items={[
          { icon: GraduationCap, tone: 'brand', label: t('students.directory.summary.total'), value: pickedClass ? pickedClass.count : everyone,
            sub: pickedClass ? t('students.directory.summary.ofSchool', { name: pickedClass.name, count: everyone }) : t('students.directory.summary.inClasses', { count: classes.length }),
            progress: pickedClass ? (pickedClass.count / everyone) * 100 : undefined },
          { icon: UsersRound, tone: 'violet', label: t('students.directory.summary.genderMix'), value: `${genders.MALE ?? 0} : ${genders.FEMALE ?? 0}`,
            segments: [
              { label: t('students.directory.summary.boys'), value: genders.MALE ?? 0, tone: 'info' },
              { label: t('students.directory.summary.girls'), value: genders.FEMALE ?? 0, tone: 'pink' },
              { label: t('students.genders.OTHER'), value: genders.OTHER ?? 0, tone: 'violet' },
              { label: t('students.directory.summary.unset'), value: genders.UNSET ?? 0, tone: 'neutral' },
            ] },
        ]} />
      )}
      <SectionPills sections={current?.sections} value={sectionId} onChange={(id) => { setSectionId(id); setPage(1) }}
        allLabel={t('students.directory.allSections', { name: current?.name })} label={(sec) => t('students.directory.sectionN', { name: sec.name })} />
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="students"
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('students.directory.search')}
          right={<>
            <ControlChip label={t('students.directory.gender')} value={genderLabel(gender)} active={!!gender}
              options={GENDER_KEYS.map(genderLabel)} onChange={(v) => { setGender(GENDER_KEYS.find((k) => genderLabel(k) === v) ?? ''); setPage(1) }} />
            <ControlChip label={t('students.directory.statusFilter')} value={statusLabel(status)} active={status !== 'ACTIVE'}
              options={STATUS_KEYS.map(statusLabel)} onChange={(v) => { setStatus(STATUS_KEYS.find((k) => statusLabel(k) === v) ?? 'ACTIVE'); setPage(1) }} />
          </>} />}
        columns={[
          { key: 'name', header: t('students.directory.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} size={34} /> },
          { key: 'classShort', header: t('students.directory.class'), mobileTrail: true, render: (v, r) => <ColorChip label={v} seed={r.classId} sub={r.rollNo ? t('students.directory.roll', { no: r.rollNo }) : undefined} /> },
          { key: 'gender', header: t('students.directory.gender'), mobileHidden: true, render: (v) => <GenderTag value={v} label={v ? t(`students.genders.${v}`, v) : undefined} /> },
          { key: 'dob', header: t('students.directory.dob'), mobileHidden: true, render: (v, r) => (v ? <StackCell title={date(v)} sub={t('students.directory.age', { count: r.age })} /> : <span className="text-ink-faint">—</span>) },
          { key: 'guardianName', header: t('students.directory.guardian'), render: (v, r) => <ContactCell name={v} phone={r.guardianMobile} /> },
          { key: 'status', header: t('students.status.title'), mobilePrimary: status !== 'ACTIVE', render: (v) => <StatusPill tone={STUDENT_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
        ]}
        onRowClick={hasPermission('students.profile.view') ? (r) => navigate(`/students/profile/${r.id}`) : undefined}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={GraduationCap}
        emptyTitle={q || sectionId || classId || gender || status !== 'ACTIVE' ? t('students.directory.noMatch') : t('students.directory.emptyTitle')}
        emptyHint={q || sectionId || classId || gender ? undefined : t('students.directory.emptyHint')}
      />
      </SideNavLayout>
    </PageContainer>
  )
}
