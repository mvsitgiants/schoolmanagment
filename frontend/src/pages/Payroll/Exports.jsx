import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Note, PageContainer, PageHeader, Panel, Select } from '../../components/system'
import Button from '../../components/ui/Button'
import { downloadExport, fetchExportOptions, fetchRuns } from '../../api/payroll'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { RunStatusPill, useMonthLabel } from '../../components/payroll/PayrollKit'

/** Payroll › Bank & statutory exports: the salary transfer file, PF ECR, ESI, professional tax and the salary register. */
export default function Exports() {
  const { t } = useTranslation('payroll')
  const monthLabel = useMonthLabel()
  const { showSuccess, showError } = useSnackbar()
  const { data: runs } = useQuery({ queryKey: ['payroll-runs', 'exports'], queryFn: () => fetchRuns({ page: 1, pageSize: 24 }) })
  const list = (runs?.data ?? []).filter((r) => r.status !== 'DRAFT')
  const [runId, setRunId] = useState('')
  const id = runId || list[0]?.id
  const run = list.find((r) => r.id === id)
  const { data: options = [] } = useQuery({ queryKey: ['payroll-exports', id], queryFn: () => fetchExportOptions(id), enabled: !!id })
  const dl = useMutation({
    mutationFn: (kind) => downloadExport(id, kind),
    onSuccess: (r) => showSuccess(r.skipped ? t('payroll.exports.doneSkipped', { rows: r.rows, skipped: r.skipped }) : t('payroll.exports.done', { rows: r.rows })),
    onError: (e) => showError(e.message),
  })
  return (
    <PageContainer>
      <PageHeader icon={FileSpreadsheet} title={t('payroll.exports.title')} subtitle={t('payroll.exports.subtitle')} />
      {!list.length ? <Note>{t('payroll.exports.none')}</Note> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-72">
              <Select value={id ?? ''} onChange={(e) => setRunId(e.target.value)} aria-label={t('payroll.exports.run')}>
                {list.map((r) => <option key={r.id} value={r.id}>{`${monthLabel(r.month)} · ${r.runNo}${r.branchName ? ` · ${r.branchName}` : ''}`}</option>)}
              </Select>
            </div>
            {run && <RunStatusPill status={run.status} />}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {options.map((o) => (
              <Panel key={o.kind} title={t(`payroll.exports.kinds.${o.kind}`)} subtitle={o.ready ? t('payroll.exports.rows', { count: o.rows }) : t(o.released ? 'payroll.exports.needsApproval' : 'payroll.exports.needsCalculation')}>
                <p className="text-xs text-ink-muted mb-3">{t(`payroll.exports.hints.${o.kind}`)}</p>
                <Button size="sm" variant="secondary" icon={Download} disabled={!o.ready || !hasPermission('payroll.exports.export')} loading={dl.isPending && dl.variables === o.kind} onClick={() => dl.mutate(o.kind)}>{t('payroll.exports.download')}</Button>
              </Panel>
            ))}
          </div>
          <Note>{t('payroll.exports.checkLayout')}</Note>
        </div>
      )}
    </PageContainer>
  )
}
