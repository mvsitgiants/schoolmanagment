import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BellRing, IndianRupee, Users } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { BulkActionBar, ControlChip, DataTable, PageContainer, PageHeader, StatCardRow, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchDues, sendFeeReminders } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** Families with fees outstanding — pick some (or all) and send them a reminder. */
export default function Dues() {
  const { t } = useTranslation('fees')
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [sectionId, setSectionId] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [selected, setSelected] = useState([])
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const sections = useMemo(() => lookup?.sections ?? [], [lookup])
  const params = { sectionId: sectionId || undefined, overdueOnly: overdueOnly || undefined }
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['fee-dues', params], queryFn: () => fetchDues(params) })
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
      <StatCardRow className="mb-4" items={[
        { icon: Users, label: t('fees.dues.students'), value: rows.length },
        { icon: IndianRupee, label: t('fees.dues.totalDue'), value: formatINR(totalDue), tone: totalDue ? 'warning' : 'success' },
        { icon: AlertTriangle, label: t('fees.dues.totalOverdue'), value: formatINR(totalOverdue), tone: totalOverdue ? 'danger' : 'neutral' },
      ]} />
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
          <ControlChip label={t('fees.dues.section')} value={sections.find((s) => s.id === sectionId)?.label ?? t('fees.all')} active={!!sectionId}
            options={[t('fees.all'), ...sections.map((s) => s.label)]} onChange={(v) => { setSectionId(sections.find((s) => s.label === v)?.id ?? ''); setSelected([]) }} />
          <ControlChip label={t('fees.dues.overdueOnly')} value={overdueOnly ? t('fees.yes') : t('fees.no')} active={overdueOnly}
            options={[t('fees.no'), t('fees.yes')]} onChange={(v) => { setOverdueOnly(v === t('fees.yes')); setSelected([]) }} />
        </div>}
        columns={[
          { key: 'name', header: t('fees.dues.student'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.classShort, r.admissionNo].filter(Boolean).join(' · ')}</p></div> },
          { key: 'guardianName', header: t('fees.dues.guardian'), mobileHidden: true, render: (v, r) => (v ? <div><p className="text-sm">{v}</p>{r.guardianMobile && <p className="text-xs text-ink-faint font-mono-num">{r.guardianMobile}</p>}</div> : '—') },
          { key: 'oldestDue', header: t('fees.dues.since'), nowrap: true, render: (v) => date(v) },
          { key: 'invoices', header: t('fees.dues.installments'), align: 'right', mobileHidden: true },
          { key: 'overdue', header: t('fees.dues.overdue'), align: 'right', render: (v) => (v ? <span className="text-danger-600">{formatINR(v)}</span> : '—') },
          { key: 'due', header: t('fees.dues.due'), align: 'right', render: (v) => formatINR(v) },
        ]}
        onRowClick={hasPermission('fees.collect.view') ? (r) => navigate(`/fees/collect?student=${r.studentId}`) : undefined}
        totals={{ overdue: formatINR(totalOverdue), due: formatINR(totalDue) }}
        totalsLabel={t('fees.dues.total')}
        emptyIcon={IndianRupee} emptyTitle={t('fees.dues.empty')} emptyHint={t('fees.dues.emptyHint')}
      />
    </PageContainer>
  )
}
