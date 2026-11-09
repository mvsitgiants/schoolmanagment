import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BellRing, IndianRupee, Users } from 'lucide-react'
import { formatINR, formatINRCompact } from '@schoolgiant/shared'
import { BulkActionBar, ContactCell, ControlChip, DataTable, DateCell, Money, PageContainer, PageHeader, PersonCell, SideNavLayout, StatCardRow, Toolbar, useConfirm, ColorChip } from '../../components/system'
import { ClassNav, SectionPills, useClassSections } from '../../components/students/ClassNav'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAllDues, fetchDues, remindAllDues, sendFeeReminders } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50

/** Families with fees outstanding — pick some (or all) and send them a reminder. */
export default function Dues() {
  const { t } = useTranslation('fees')
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [classId, setClassId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState([])
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const classes = useClassSections(lookup)
  const cls = classes.find((c) => c.id === classId)
  // the server pages the list and filters it by class / section / search; its `summary` (the tiles and totals) is over
  // the whole filter and its `classes` (the class list's figures) over every due, whichever class is picked
  const filter = { classId: classId || undefined, sectionId: sectionId || undefined, overdueOnly: overdueOnly || undefined, search: q || undefined }
  const params = { ...filter, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['fee-dues', params], queryFn: () => fetchDues(params), placeholderData: keepPreviousData })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const sum = data?.summary ?? { students: 0, overdueStudents: 0, due: 0, overdue: 0 }
  const byClass = useMemo(() => new Map((data?.classes ?? []).map((c) => [c.classId, c])), [data])
  const everyClass = (data?.classes ?? []).reduce((m, c) => ({ students: m.students + c.students, due: m.due + c.due }), { students: 0, due: 0 })
  const reset = () => { setPage(1); setSelected([]) }
  const pickClass = (id) => { setClassId(id); setSectionId(''); reset() }
  const totalDue = sum.due
  const totalOverdue = sum.overdue
  const canSend = hasPermission('fees.dues.send')
  const remind = useMutation({
    mutationFn: (send) => send(),
    onSuccess: (res) => { setSelected([]); showSuccess(t('fees.dues.sent', { count: res.sent })) },
    onError: (e) => showError(e.message),
  })
  // picked rows go by id; "remind all" sends the filter, so the server reminds everyone in the list, not just this page
  const ask = async (count, send) => {
    if (await confirm({ title: t('fees.dues.remindConfirm.title', { count }), message: t('fees.dues.remindConfirm.message'), confirmLabel: t('fees.dues.remind') })) remind.mutate(send)
  }

  return (
    <PageContainer>
      <PageHeader icon={IndianRupee} title={t('fees.dues.title')} subtitle={t('fees.dues.subtitle')}
        actions={canSend && rows.length > 0 && <Button icon={BellRing} variant="secondary" loading={remind.isPending} onClick={() => ask(total, () => remindAllDues(filter))}>{t('fees.dues.remindAll', { count: total })}</Button>} />
      <SideNavLayout nav={classes.length > 1 && (
        // each class: families with dues, what they owe (red count when some of it is overdue)
        <ClassNav title={t('fees.dues.classes')} classes={classes} value={classId} onChange={pickClass}
          all={{ label: t('fees.dues.allClasses'), count: everyClass.students, hint: formatINRCompact(everyClass.due) }}
          item={(c) => {
            const d = byClass.get(c.id)
            return { count: d?.students ?? 0, countTone: d?.overdue ? 'danger' : undefined, hint: d ? t('fees.dues.classDue', { amount: formatINRCompact(d.due) }) : t('fees.dues.nothingDue') }
          }} />
      )}>
      <StatCardRow items={[
        { icon: Users, tone: 'brand', label: t('fees.dues.students'), value: sum.students,
          sub: t('fees.dues.overdueStudents', { count: sum.overdueStudents }) },
        { icon: IndianRupee, label: t('fees.dues.totalDue'), value: formatINRCompact(totalDue), tone: totalDue ? 'warning' : 'success', sub: formatINR(totalDue) },
        { icon: AlertTriangle, label: t('fees.dues.totalOverdue'), value: formatINRCompact(totalOverdue), tone: totalOverdue ? 'danger' : 'neutral',
          sub: t('fees.dues.overdueShare', { pct: totalDue > 0 ? Math.round((totalOverdue / totalDue) * 100) : 0 }), progress: totalDue > 0 ? (totalOverdue / totalDue) * 100 : 0,
          onClick: () => { setOverdueOnly(!overdueOnly); reset() }, className: overdueOnly ? 'ring-2 ring-danger-300' : undefined },
      ]} />
      <SectionPills sections={cls?.sections} value={sectionId} onChange={(id) => { setSectionId(id); reset() }}
        allLabel={t('fees.dues.allSections', { name: cls?.name })} label={(sec) => t('fees.dues.sectionN', { name: sec.name })} />
      <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
        {canSend && <Button size="sm" icon={BellRing} loading={remind.isPending} onClick={() => ask(selected.length, () => sendFeeReminders(selected))}>{t('fees.dues.remind')}</Button>}
      </BulkActionBar>
      <DataTable
        rows={rows}
        rowKey="studentId"
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="fee-dues" exportAll={() => fetchAllDues(filter)}
        pagination={total > PAGE ? { page: page - 1, size: PAGE, totalElements: total, totalPages: Math.ceil(total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
        selectable={canSend} selectedIds={selected} onSelectionChange={setSelected}
        rowTone={(r) => (r.overdue ? 'danger' : undefined)}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); reset() }} searchPlaceholder={t('fees.dues.search')} right={
          <ControlChip label={t('fees.dues.overdueOnly')} value={overdueOnly ? t('fees.yes') : t('fees.no')} active={overdueOnly}
            options={[t('fees.no'), t('fees.yes')]} onChange={(v) => { setOverdueOnly(v === t('fees.yes')); reset() }} />
        } />}
        columns={[
          { key: 'name', header: t('fees.dues.student'), mobilePrimary: true, render: (v, r) => <span className="flex items-center gap-2 min-w-0"><PersonCell name={v} sub={r.admissionNo} size={32} />{r.classShort && <ColorChip label={r.classShort} seed={r.classId ?? r.classShort} />}</span> },
          { key: 'guardianName', header: t('fees.dues.guardian'), mobileHidden: true, render: (v, r) => <ContactCell name={v} phone={r.guardianMobile} /> },
          { key: 'oldestDue', header: t('fees.dues.since'), nowrap: true, render: (v, r) => <DateCell value={v} tone={r.overdue > 0 ? 'danger' : undefined} /> },
          { key: 'invoices', header: t('fees.dues.installments'), align: 'right', mobileHidden: true },
          { key: 'overdue', header: t('fees.dues.overdue'), align: 'right', mobilePrimary: true, render: (v) => (v ? <Money value={v} paise tone="danger" /> : <span className="text-ink-faint">—</span>) },
          { key: 'due', header: t('fees.dues.due'), align: 'right', mobileTrail: true, render: (v) => <Money value={v} paise className="font-semibold" /> },
        ]}
        onRowClick={hasPermission('fees.collect.view') ? (r) => navigate(`/fees/collect?student=${r.studentId}`) : undefined}
        totals={{ overdue: formatINR(totalOverdue), due: formatINR(totalDue) }}
        totalsLabel={t('fees.dues.total')}
        emptyIcon={IndianRupee} emptyTitle={t('fees.dues.empty')} emptyHint={t('fees.dues.emptyHint')}
      />
      </SideNavLayout>
    </PageContainer>
  )
}
