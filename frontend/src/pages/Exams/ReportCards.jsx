import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileBadge, Printer, Save, Send } from 'lucide-react'
import { RESULT_STATUS } from '@schoolgiant/shared'
import { BulkActionBar, ColorChip, DataTable, DateCell, Input, LevelBar, Note, PageContainer, PageHeader, PersonCell, SideNavLayout, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useExamPick from '../../components/exams/useExamPick'
import { fetchCandidates, saveRemarks, sendReportCards } from '../../api/exams'
import { HoldActions, HoldPill } from '../../components/exams/HoldKit'
import { hasPermission } from '../../api/auth'
import { printDocument, printDocuments } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useIsMobile } from '../../hooks/useMediaQuery'

const NO_ROWS = [] // stable: a fresh [] each render would re-run the remarks effect forever

/** A section's report cards: the class teacher's remarks, printing, and sending them to families. */
export default function ReportCards() {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const isMobile = useIsMobile()
  const { showSuccess, showError } = useSnackbar()
  const { exam, examId, sectionId, section, nav, sectionPills, noExams } = useExamPick()
  const [selected, setSelected] = useState([])
  const [remarks, setRemarks] = useState({})
  useEffect(() => { setSelected([]) }, [examId, sectionId])
  const key = ['exam-candidates', examId, sectionId]
  const { data: rows = NO_ROWS, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchCandidates(examId, sectionId), enabled: !!examId && !!sectionId })
  useEffect(() => { setRemarks(Object.fromEntries(rows.map((r) => [r.id, r.remark ?? '']))) }, [rows])
  const changed = rows.filter((r) => (remarks[r.id] ?? '') !== (r.remark ?? ''))
  const canRemark = hasPermission('exams.marks.create') || hasPermission('exams.report-cards.publish')
  const canPrint = hasPermission('exams.report-cards.print')
  const canSend = hasPermission('exams.report-cards.publish')
  const published = exam?.status === 'PUBLISHED'
  const save = useMutation({
    mutationFn: () => saveRemarks(examId, sectionId, changed.map((r) => ({ candidateId: r.id, remark: remarks[r.id] ?? '' }))),
    onSuccess: (data) => { qc.setQueryData(key, data); showSuccess(t('exams.reportCards.remarksSaved')) },
    onError: (e) => showError(e.message),
  })
  const send = useMutation({
    mutationFn: (resend) => sendReportCards(examId, { sectionId, resend }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['exam-candidates'] }); showSuccess(r.held ? t('exams.holds.sentSkipped', { count: r.sent, held: r.held }) : t('exams.reportCards.sent', { count: r.sent })) },
    onError: (e) => showError(e.message),
  })
  const print = async (ids) => {
    const r = await printDocuments('REPORT_CARD', ids, { preparing: t('exams.reportCards.preparing') })
    if (r?.error) showError(r.error)
  }
  // a result on hold: no report card prints or goes to the family (the server leaves it out too)
  const isHeld = (r) => !!r.hold?.result?.held
  const printable = rows.filter((r) => !isHeld(r))
  const held = rows.length - printable.length
  const unsent = printable.filter((r) => !r.notifiedAt).length

  return (
    <PageContainer>
      <PageHeader icon={FileBadge} title={t('exams.reportCards.title')} subtitle={t('exams.reportCards.subtitle')} />
      {noExams && <Note className="mb-4">{t('exams.pick.noneScheduled')}</Note>}
      <SideNavLayout nav={nav}>
        {sectionPills}
        {exam && !published && <Note tone="warning">{t('exams.reportCards.notPublished')}</Note>}
        {held > 0 && <Note tone="warning">{t('exams.holds.resultsHeld', { count: held })}</Note>}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canRemark && changed.length > 0 && <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()}>{t('exams.reportCards.saveRemarks', { count: changed.length })}</Button>}
            {canPrint && printable.length > 0 && <Button variant="secondary" icon={Printer} onClick={() => print(printable.map((r) => r.id))}>{t('exams.reportCards.printAll')}</Button>}
            {canSend && published && rows.length > 0 && <Button variant="secondary" icon={Send} loading={send.isPending}
              onClick={async () => {
                const resend = unsent === 0
                if (await confirm({ title: resend ? t('exams.reportCards.resendConfirm.title') : t('exams.reportCards.sendConfirm.title', { count: unsent }), message: t('exams.reportCards.sendConfirm.message'), confirmLabel: t('exams.reportCards.send') })) send.mutate(resend)
              }}>{unsent ? t('exams.reportCards.sendCount', { count: unsent }) : t('exams.reportCards.resend')}</Button>}
          </div>
        )}
        <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
          {canPrint && <Button size="sm" icon={Printer} onClick={() => print(selected.filter((id) => !isHeld(rows.find((r) => r.id === id) ?? {})))}>{t('exams.reportCards.printSelected')}</Button>}
          {(canSend || canPrint) && <HoldActions examId={examId} ids={selected} part="result" onDone={() => setSelected([])} />}
        </BulkActionBar>
        <DataTable
          rows={rows}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          title={exam && section ? `${exam.name} · ${section.label}` : undefined}
          selectable={canPrint || canSend} selectedIds={selected} onSelectionChange={setSelected}
          columns={[
            { key: 'rollNo', header: t('exams.roll'), width: 60, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
            { key: 'name', header: t('exams.student'), mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
            { key: 'pct', header: '%', align: 'right', mobilePrimary: true, mobileLabel: t('exams.results.pctLabel'), render: (v, r) => (v === null || v === undefined ? '—' : (
              <div className="inline-flex items-center justify-end gap-2">
                {!isMobile && <LevelBar bare value={v} max={100} width="w-14" dangerAt={r.result === 'FAIL' ? 100 : undefined} />}
                <span className={r.result === 'FAIL' ? 'font-semibold tabular-nums text-danger-600' : 'font-semibold tabular-nums text-ink'}>{v}%</span>
                {r.grade && <ColorChip label={r.grade} seed={`grade-${r.grade}`} mono />}
              </div>
            )) },
            { key: 'result', header: t('exams.results.result'), mobileTrail: true, render: (v, r) => (isHeld(r) ? <HoldPill hold={r.hold} part="result" /> : v ? <StatusPill tone={RESULT_STATUS[v]?.tone}>{t(`exams.result.${v}`, RESULT_STATUS[v]?.label)}</StatusPill> : '—') },
            { key: 'remark', header: t('exams.reportCards.remark'), clamp: false, render: (_, r) => (canRemark
              ? <div onClick={(e) => e.stopPropagation()}><Input value={remarks[r.id] ?? ''} maxLength={300} onChange={(e) => setRemarks((x) => ({ ...x, [r.id]: e.target.value }))} placeholder={t('exams.reportCards.remarkPlaceholder')} aria-label={t('exams.reportCards.remark')} /></div>
              : <span className="text-sm text-ink-muted">{r.remark || '—'}</span>) },
            { key: 'notifiedAt', header: t('exams.reportCards.sentCol'), render: (v) => (v ? <DateCell value={v} time /> : <span className="text-xs text-ink-faint">{t('exams.reportCards.notSent')}</span>) },
            { key: 'id', header: '', align: 'right', width: 60, render: (id, r) => canPrint && !isHeld(r) && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('exams.reportCards.print')} title={t('exams.reportCards.print')} onClick={() => printDocument('REPORT_CARD', id)}><span className="md:hidden">{t('exams.reportCards.print')}</span></Button> },
          ]}
          emptyIcon={FileBadge} emptyTitle={exam ? t('exams.reportCards.empty') : t('exams.pick.pickFirst')}
        />
      </SideNavLayout>
    </PageContainer>
  )
}
