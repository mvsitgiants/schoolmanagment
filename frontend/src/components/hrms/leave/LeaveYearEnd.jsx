import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarCheck2, RefreshCw } from 'lucide-react'
import { DataTable, Note, Panel, StatCardRow, useConfirm } from '../../system'
import Button from '../../ui/Button'
import { fetchLeaveYearEnd, runLeaveYearEnd } from '../../../api/hrms'
import { hasPermission } from '../../../api/auth'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useFormat } from '../../../context/SettingsContext'
import { halves, invalidateLeave, useDaysText } from './LeaveBits'

// Leave › Setup › Year end: at the start of each leave year, the days above each policy's carry-forward limit lapse
// and the rest are carried into the new year. This shows what the coming year end will do (from today's balances,
// waiting requests counted as taken), what happened at the start of this year, and brings everyone up to date now.

export default function LeaveYearEnd() {
  const { t } = useTranslation('hrmsLeave')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const days = useDaysText()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: y, isLoading } = useQuery({ queryKey: ['leave-year-end'], queryFn: fetchLeaveYearEnd })
  const run = useMutation({
    mutationFn: runLeaveYearEnd,
    onSuccess: (r) => { showSuccess(t('hrmsLeave.yearEnd.ran', { count: r.staff })); invalidateLeave(qc) },
    onError: (e) => showError(e.message),
  })
  const go = async () => {
    if (await confirm({ title: t('hrmsLeave.yearEnd.runTitle', { year: y.year.label }), message: t('hrmsLeave.yearEnd.runMsg'), confirmLabel: t('hrmsLeave.yearEnd.run') })) run.mutate()
  }
  if (isLoading || !y) return <p className="text-sm text-ink-faint">{t('hrmsLeave.loading')}</p>
  const p = y.projected
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted max-w-3xl">{t('hrmsLeave.yearEnd.intro')}</p>
      <Panel title={t('hrmsLeave.yearEnd.thisYear', { year: y.year.label })} subtitle={t('hrmsLeave.yearEnd.thisYearSub', { from: date(y.year.from), to: date(y.year.to) })} icon={CalendarCheck2} iconTone="neutral"
        actions={hasPermission('hrms.leave.edit') && <Button size="sm" variant="secondary" icon={RefreshCw} loading={run.isPending} onClick={go}>{t('hrmsLeave.yearEnd.run')}</Button>}>
        <p className="text-sm text-ink">
          {y.done.notYet ? t('hrmsLeave.yearEnd.notYet', { count: y.done.notYet, total: y.done.staff }) : t('hrmsLeave.yearEnd.allDone', { count: y.done.staff })}
          {' '}{y.done.lapsedDays > 0 ? t('hrmsLeave.yearEnd.lapsedThen', { days: days(y.done.lapsedDays), count: y.done.people }) : t('hrmsLeave.yearEnd.nothingLapsed')}
        </p>
        <p className="mt-1 text-xs text-ink-faint">{t('hrmsLeave.yearEnd.runHint')}</p>
      </Panel>
      <div>
        <h3 className="text-sm font-semibold text-ink mb-1">{t('hrmsLeave.yearEnd.comingTitle', { year: y.year.label, date: date(y.year.to) })}</h3>
        <p className="text-xs text-ink-muted mb-3">{t('hrmsLeave.yearEnd.comingSub', { next: y.next.label })}</p>
        <StatCardRow items={[
          { label: t('hrmsLeave.yearEnd.carried'), tone: 'brand', value: halves(p.keepDays), sub: t('hrmsLeave.yearEnd.carriedSub', { next: y.next.label }) },
          { label: t('hrmsLeave.yearEnd.lapse'), value: halves(p.lapseDays), tone: 'neutral', sub: t('hrmsLeave.yearEnd.lapseSub', { count: p.people }) },
        ]} />
      </div>
      <DataTable rows={p.rows} rowKey="employeeId" emptyTitle={t('hrmsLeave.yearEnd.empty')} columns={[
        { key: 'name', header: t('hrmsLeave.yearEnd.person'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p>{r.designation && <p className="text-[11px] text-ink-faint">{r.designation}</p>}</div> },
        { key: 'items', header: t('hrmsLeave.yearEnd.byType'), render: (items) => (
          <ul className="text-xs space-y-0.5">
            {items.map((x) => <li key={x.leaveTypeId} className="text-ink">{x.lapse > 0 ? (x.keep > 0 ? t('hrmsLeave.yearEnd.lineLapse', { type: x.name, keep: days(x.keep), lapse: days(x.lapse) }) : t('hrmsLeave.yearEnd.lineAllLapse', { type: x.name, lapse: days(x.lapse) })) : t('hrmsLeave.yearEnd.lineKeep', { type: x.name, keep: days(x.keep) })}</li>)}
          </ul>
        ) },
        { key: 'keep', header: t('hrmsLeave.yearEnd.keepCol'), align: 'right', render: (v) => halves(v) },
        { key: 'lapse', header: t('hrmsLeave.yearEnd.lapseCol'), align: 'right', render: (v) => (v > 0 ? <span className="font-semibold text-ink">{halves(v)}</span> : <span className="text-ink-faint">0</span>) },
      ]} />
      <Note>{t('hrmsLeave.yearEnd.note')}</Note>
    </div>
  )
}
