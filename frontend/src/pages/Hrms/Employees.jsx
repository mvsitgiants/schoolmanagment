import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Briefcase, Bus, CreditCard, Download, Presentation, ShieldCheck, UserPlus, Users, UsersRound, Wrench } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, EMPLOYEE_STATUSES } from '@schoolgiant/shared'
import { ColorChip, ContactCell, ControlChip, DataTable, DateCell, PersonCell, StackCell, HeaderButton, ImportExportButtons, PageContainer, PageHeader, StatCardRow, StatusPill, Toolbar, useConfirm } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { exportEmployees, fetchEmployees, importEmployees, recordsFromLogins } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { printDocuments } from '../../components/print/printDocument'
import { useFormat } from '../../context/SettingsContext'
import { readSheet } from '../../utils/readSheet'
import { useHrLabels } from '../../components/hrms/HrKit'

// each staff category's icon and colour, on the tiles and in the table
const CATEGORY_LOOK = {
  TEACHING: { icon: Presentation, tone: 'brand' },
  ADMIN: { icon: Briefcase, tone: 'violet' },
  SUPPORT: { icon: Wrench, tone: 'orange' },
  TRANSPORT: { icon: Bus, tone: 'info' },
  SECURITY: { icon: ShieldCheck, tone: 'pink' },
  OTHER: { icon: UsersRound, tone: 'sky' },
}

/** Staff & HR › Staff: everyone on the staff, with or without a login. */
export default function Employees() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('CURRENT')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  // staff picked for ID cards (none picked: the cards of everyone on this page)
  const [picked, setPicked] = useState([])
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, status, category: category || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['employees', params], queryFn: () => fetchEmployees(params), placeholderData: keepPreviousData })
  const rows = data?.data ?? []
  const meta = data?.meta
  const counts = data?.counts ?? {}
  const refresh = () => { qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['hrms-meta'] }) }
  const fromLogins = useMutation({ mutationFn: recordsFromLogins, onSuccess: (r) => { refresh(); showSuccess(t('hrms.employees.fromLoginsDone', { count: r.made })) }, onError: (e) => showError(e.message) })
  const STATUS = ['CURRENT', 'ACTIVE', 'NOTICE', 'EXITED', 'ALL']
  const statusName = (s) => (s === 'CURRENT' || s === 'ALL' ? t(`hrms.employees.filter.${s}`) : L.status(s))

  return (
    <PageContainer>
      <PageHeader icon={UsersRound} title={t('hrms.employees.title')} subtitle={meta ? t('hrms.employees.count', { count: meta.total }) : t('hrms.employees.subtitle')}
        actions={<>
          {hasPermission('hrms.employees.create') && <HeaderButton icon={Users} onClick={async () => { if (await confirm({ title: t('hrms.employees.fromLogins'), message: t('hrms.employees.fromLoginsHint'), confirmLabel: t('hrms.employees.fromLoginsGo') })) fromLogins.mutate() }}>{t('hrms.employees.fromLogins')}</HeaderButton>}
          {hasPermission('hrms.employees.import') && <ImportExportButtons resourceLabel={t('hrms.employees.resource')} requires="hrms.employees.import"
            onImport={async (file) => importEmployees(await readSheet(file), true)} onCommit={(r) => importEmployees(r, false)}
            templateHeaders={['employeeCode', 'name', 'designation', 'category', 'employmentType', 'joiningDate', 'gender', 'dob', 'mobile', 'email']}
            templateSample={['', 'Meena Iyer', 'TGT English', 'TEACHING', 'PERMANENT', '2024-06-01', 'FEMALE', '1990-02-14', '9845012345', 'meena@example.com']}
            onDone={refresh} />}
          {hasPermission('hrms.employees.export') && <HeaderButton icon={Download} onClick={() => exportEmployees({ status, category: category || undefined, search: q || undefined }).catch((e) => showError(e.message))}>{t('hrms.employees.export')}</HeaderButton>}
          {rows.length > 0 && <HeaderButton icon={CreditCard} onClick={async () => {
            const ids = picked.length ? picked : rows.filter((r) => r.status !== 'EXITED').map((r) => r.id)
            if (!ids.length) return
            const r = await printDocuments('STAFF_ID_CARD', ids, { preparing: t('hrms.employees.idCardsPreparing') })
            if (r?.error) showError(r.error)
          }}>{picked.length ? t('hrms.employees.idCardsPicked', { count: picked.length }) : t('hrms.employees.idCards')}</HeaderButton>}
          <HeaderButton icon={UserPlus} variant="primary" requires="hrms.employees.create" onClick={() => navigate('/hrms/employees/new')}>{t('hrms.employees.new')}</HeaderButton>
        </>} />
      {Object.keys(counts).length > 0 && (
        <StatCardRow className="mb-4" items={EMPLOYEE_CATEGORIES.filter((c) => counts[c.value]).map((c) => ({
          label: L.category(c.value), value: counts[c.value], ...CATEGORY_LOOK[c.value],
          progress: (counts[c.value] / Object.values(counts).reduce((n, v) => n + v, 0)) * 100,
          onClick: () => { setCategory(category === c.value ? '' : c.value); setPage(1) },
          className: category === c.value ? 'ring-2 ring-brand-400' : category ? 'opacity-60 hover:opacity-100' : undefined,
        }))} />
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('hrms.employees.search')}
          right={<>
            <ControlChip label={t('hrms.employees.category')} value={category ? L.category(category) : t('hrms.all')} active={!!category}
              options={[t('hrms.all'), ...EMPLOYEE_CATEGORIES.map((c) => L.category(c.value))]} onChange={(v) => { setCategory(EMPLOYEE_CATEGORIES.find((c) => L.category(c.value) === v)?.value ?? ''); setPage(1) }} />
            <ControlChip label={t('hrms.employees.status')} value={statusName(status)} active={status !== 'CURRENT'}
              options={STATUS.map(statusName)} onChange={(v) => { setStatus(STATUS.find((s) => statusName(s) === v) ?? 'CURRENT'); setPage(1) }} />
          </>} />}
        columns={[
          { key: 'name', header: t('hrms.employees.person'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.employeeCode} size={34} /> },
          { key: 'designation', header: t('hrms.employees.designation'), render: (v, r) => <StackCell title={v ?? '—'} sub={[L.employment(r.employmentType), r.department].filter(Boolean).join(' · ')} /> },
          { key: 'category', header: t('hrms.employees.category'), mobileHidden: true, render: (v) => <ColorChip label={L.category(v)} icon={CATEGORY_LOOK[v]?.icon} tone={CATEGORY_LOOK[v]?.tone} /> },
          { key: 'mobile', header: t('hrms.employees.mobile'), mobileHidden: true, render: (v) => <ContactCell phone={v} /> },
          { key: 'joiningDate', header: t('hrms.employees.joined'), mobileHidden: true, nowrap: true, render: (v) => <DateCell value={v} /> },
          { key: 'hasLogin', header: t('hrms.employees.loginCol'), mobileHidden: true, render: (v) => (v ? <StatusPill tone="success">{t('hrms.employees.hasLogin')}</StatusPill> : <span className="text-xs text-ink-faint">{t('hrms.employees.noLogin')}</span>) },
          { key: 'status', header: t('hrms.employees.status'), render: (v, r) => <span><StatusPill tone={EMPLOYEE_STATUSES[v]?.tone}>{L.status(v)}</StatusPill>{r.lastWorkingDate && v !== 'ACTIVE' && <span className="block text-[11px] text-ink-faint mt-0.5">{t('hrms.employees.lastDay', { date: date(r.lastWorkingDate) })}</span>}</span> },
        ]}
        selectable selectedIds={picked} onSelectionChange={setPicked}
        onRowClick={(r) => navigate(`/hrms/employees/${r.id}`)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={UsersRound}
        emptyTitle={q || category || status !== 'CURRENT' ? t('hrms.employees.noMatch') : t('hrms.employees.emptyTitle')}
        emptyHint={q || category ? undefined : t('hrms.employees.emptyHint')}
      />
    </PageContainer>
  )
}
