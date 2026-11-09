import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BellRing, IndianRupee, Users } from 'lucide-react'
import { formatINR, formatINRCompact } from '@schoolgiant/shared'
import { BulkActionBar, ContactCell, ControlChip, DataTable, DateCell, Money, PageContainer, PageHeader, PersonCell, SideNavLayout, StatCardRow, useConfirm, ColorChip } from '../../components/system'
import { ClassNav, SectionPills, useClassSections } from '../../components/students/ClassNav'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchDues, sendFeeReminders } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/** Families with fees outstanding — pick some (or all) and send them a reminder. */
export default function Dues() {
  const { t } = useTranslation('fees')
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [classId, setClassId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [selected, setSelected] = useState([])
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const classes = useClassSections(lookup)
  const cls = classes.find((c) => c.id === classId)
  // the whole school's dues (one list, no paging) feed the class list's figures and the class view;
  // a section is asked of the server, as the rows carry the class but not the section
  const params = { overdueOnly: overdueOnly || undefined }
  const { data: all = [], isLoading: allLoading, error, refetch } = useQuery({ queryKey: ['fee-dues', params], queryFn: () => fetchDues(params) })
  const sectionParams = { ...params, sectionId }
  const { data: sectionRows = [], isLoading: sectionLoading } = useQuery({ queryKey: ['fee-dues', sectionParams], queryFn: () => fetchDues(sectionParams), enabled: !!sectionId })
  const rows = useMemo(() => (sectionId ? sectionRows : classId ? all.filter((r) => r.classId === classId) : all), [sectionId, sectionRows, classId, all])
  const isLoading = sectionId ? sectionLoading : allLoading
  const byClass = useMemo(() => all.reduce((m, r) => {
    const c = m.get(r.classId) ?? { students: 0, due: 0, overdue: 0 }
    m.set(r.classId, { students: c.students + 1, due: c.due + r.due, overdue: c.overdue + r.overdue })
    return m
  }, new Map()), [all])
  const pickClass = (id) => { setClassId(id); setSectionId(''); setSelected([]) }
  const totalDue = rows.reduce((n, r) => n + r.due, 0)
  const totalOverdue = rows.reduce((n, r) => n + r.overdue, 0)
  const canSend = hasPermission('fees.dues.send')
  const remind = useMutation({
    mutationFn: (ids) => sendFeeReminders(ids),
    onSuccess: (res) => { setSelected([]); showSuccess(t('fees.dues.sent', { count: res.sent })) },
    onError: (e) => showError(e.message),
  })
  const ask = async (ids) => {
    if (await confirm({ title: t('fees.dues.remindConfirm.title', { count: ids.length }), message: t('fees.dues.remindConfirm.message'), confirmLabel: t('fees.dues.remind') })) remind.mutate(ids)
  }

  return (
    <PageContainer>
      <PageHeader icon={IndianRupee} title={t('fees.dues.title')} subtitle={t('fees.dues.subtitle')}
        actions={canSend && rows.length > 0 && <Button icon={BellRing} variant="secondary" loading={remind.isPending} onClick={() => ask(rows.map((r) => r.studentId))}>{t('fees.dues.remindAll', { count: rows.length })}</Button>} />
      <SideNavLayout nav={classes.length > 1 && (
        // each class: families with dues, what they owe (red count when some of it is overdue)
        <ClassNav title={t('fees.dues.classes')} classes={classes} value={classId} onChange={pickClass}
          all={{ label: t('fees.dues.allClasses'), count: all.length, hint: formatINRCompact(all.reduce((n, r) => n + r.due, 0)) }}
          item={(c) => {
            const d = byClass.get(c.id)
            return { count: d?.students ?? 0, countTone: d?.overdue ? 'danger' : undefined, hint: d ? t('fees.dues.classDue', { amount: formatINRCompact(d.due) }) : t('fees.dues.nothingDue') }
          }} />
      )}>
      <StatCardRow items={[
        { icon: Users, tone: 'brand', label: t('fees.dues.students'), value: rows.length,
          sub: t('fees.dues.overdueStudents', { count: rows.filter((r) => r.overdue > 0).length }) },
        { icon: IndianRupee, label: t('fees.dues.totalDue'), value: formatINRCompact(totalDue), tone: totalDue ? 'warning' : 'success', sub: formatINR(totalDue) },
        { icon: AlertTriangle, label: t('fees.dues.totalOverdue'), value: formatINRCompact(totalOverdue), tone: totalOverdue ? 'danger' : 'neutral',
          sub: t('fees.dues.overdueShare', { pct: totalDue > 0 ? Math.round((totalOverdue / totalDue) * 100) : 0 }), progress: totalDue > 0 ? (totalOverdue / totalDue) * 100 : 0,
          onClick: () => { setOverdueOnly(!overdueOnly); setSelected([]) }, className: overdueOnly ? 'ring-2 ring-danger-300' : undefined },
      ]} />
      <SectionPills sections={cls?.sections} value={sectionId} onChange={(id) => { setSectionId(id); setSelected([]) }}
        allLabel={t('fees.dues.allSections', { name: cls?.name })} label={(sec) => t('fees.dues.sectionN', { name: sec.name })} />
      <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
        {canSend && <Button size="sm" icon={BellRing} loading={remind.isPending} onClick={() => ask(selected)}>{t('fees.dues.remind')}</Button>}
      </BulkActionBar>
      <DataTable
        rows={rows}
        rowKey="studentId"
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="fee-dues"
        selectable={canSend} selectedIds={selected} onSelectionChange={setSelected}
        rowTone={(r) => (r.overdue ? 'danger' : undefined)}
        toolbar={<div className="flex flex-wrap justify-end gap-2">
          <ControlChip label={t('fees.dues.overdueOnly')} value={overdueOnly ? t('fees.yes') : t('fees.no')} active={overdueOnly}
            options={[t('fees.no'), t('fees.yes')]} onChange={(v) => { setOverdueOnly(v === t('fees.yes')); setSelected([]) }} />
        </div>}
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
