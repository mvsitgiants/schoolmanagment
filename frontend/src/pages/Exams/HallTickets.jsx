import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Printer, Ticket } from 'lucide-react'
import { BulkActionBar, DataTable, Note, PageContainer, PageHeader, PersonCell, SideNavLayout } from '../../components/system'
import Button from '../../components/ui/Button'
import useExamPick from '../../components/exams/useExamPick'
import { fetchCandidates } from '../../api/exams'
import { HoldActions, HoldPill } from '../../components/exams/HoldKit'
import { hasPermission } from '../../api/auth'
import { printDocument, printDocuments } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'

export default function HallTickets() {
  const { t } = useTranslation('exams')
  const { showError } = useSnackbar()
  const { exam, examId, sectionId, section, nav, sectionPills, noExams } = useExamPick()
  const [selected, setSelected] = useState([])
  useEffect(() => { setSelected([]) }, [examId, sectionId])
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['exam-candidates', examId, sectionId], queryFn: () => fetchCandidates(examId, sectionId), enabled: !!examId && !!sectionId })
  const canPrint = hasPermission('exams.hall-tickets.print')
  // an admit card on hold doesn't print (the server leaves it out too)
  const isHeld = (r) => !!r.hold?.admitCard?.held
  const printable = rows.filter((r) => !isHeld(r))
  const held = rows.length - printable.length
  const print = async (ids) => {
    const r = await printDocuments('HALL_TICKET', ids, { preparing: t('exams.hallTickets.preparing') })
    if (r?.error) showError(r.error)
  }

  return (
    <PageContainer>
      <PageHeader icon={Ticket} title={t('exams.hallTickets.title')} subtitle={t('exams.hallTickets.subtitle')}
        actions={canPrint && printable.length > 0 && <Button icon={Printer} onClick={() => print(printable.map((r) => r.id))}>{t('exams.hallTickets.printAll', { count: printable.length })}</Button>} />
      {noExams && <Note className="mb-4">{t('exams.pick.noneScheduled')}</Note>}
      <SideNavLayout nav={nav}>
        {sectionPills}
        {held > 0 && <Note tone="warning">{t('exams.holds.admitCardsHeld', { count: held })}</Note>}
        <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
          {canPrint && <Button size="sm" icon={Printer} onClick={() => print(selected.filter((id) => !isHeld(rows.find((r) => r.id === id) ?? {})))}>{t('exams.hallTickets.printSelected')}</Button>}
          {canPrint && <HoldActions examId={examId} ids={selected} part="admitCard" onDone={() => setSelected([])} />}
        </BulkActionBar>
        <DataTable
          rows={rows}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          title={exam && section ? `${exam.name} · ${section.label}` : undefined}
          selectable={canPrint} selectedIds={selected} onSelectionChange={setSelected}
          columns={[
            { key: 'rollNo', header: t('exams.roll'), width: 70, mobilePrimary: true, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
            { key: 'name', header: t('exams.student'), mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
            { key: 'hold', header: t('exams.holds.col'), mobileTrail: true, render: (_, r) => <HoldPill hold={r.hold} part="admitCard" /> },
            { key: 'id', header: '', align: 'right', width: 60, mobileHidden: true, render: (id, r) => canPrint && !isHeld(r) && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('exams.hallTickets.print')} title={t('exams.hallTickets.print')} onClick={() => printDocument('HALL_TICKET', id)} /> },
          ]}
          emptyIcon={Ticket} emptyTitle={exam ? t('exams.hallTickets.empty') : t('exams.pick.pickFirst')}
        />
      </SideNavLayout>
    </PageContainer>
  )
}
