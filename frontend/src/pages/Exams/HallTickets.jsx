import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Printer, Ticket } from 'lucide-react'
import { BulkActionBar, DataTable, Note, PageContainer, PageHeader, PersonCell } from '../../components/system'
import Button from '../../components/ui/Button'
import useExamPick from '../../components/exams/useExamPick'
import { fetchCandidates } from '../../api/exams'
import { hasPermission } from '../../api/auth'
import { printDocument, printDocuments } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'

export default function HallTickets() {
  const { t } = useTranslation('exams')
  const { showError } = useSnackbar()
  const { exam, examId, sectionId, chips, noExams } = useExamPick()
  const [selected, setSelected] = useState([])
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['exam-candidates', examId, sectionId], queryFn: () => fetchCandidates(examId, sectionId), enabled: !!examId && !!sectionId })
  const canPrint = hasPermission('exams.hall-tickets.print')
  const print = async (ids) => {
    const r = await printDocuments('HALL_TICKET', ids, { preparing: t('exams.hallTickets.preparing') })
    if (r?.error) showError(r.error)
  }

  return (
    <PageContainer>
      <PageHeader icon={Ticket} title={t('exams.hallTickets.title')} subtitle={t('exams.hallTickets.subtitle')}
        actions={canPrint && rows.length > 0 && <Button icon={Printer} onClick={() => print(rows.map((r) => r.id))}>{t('exams.hallTickets.printAll', { count: rows.length })}</Button>} />
      {noExams && <Note className="mb-4">{t('exams.pick.noneScheduled')}</Note>}
      <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
        {canPrint && <Button size="sm" icon={Printer} onClick={() => print(selected)}>{t('exams.hallTickets.printSelected')}</Button>}
      </BulkActionBar>
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        selectable={canPrint} selectedIds={selected} onSelectionChange={setSelected}
        toolbar={<div className="flex flex-wrap justify-end gap-2">{chips}</div>}
        columns={[
          { key: 'rollNo', header: t('exams.roll'), width: 70, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
          { key: 'name', header: t('exams.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
          { key: 'id', header: '', align: 'right', width: 60, render: (id) => canPrint && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('exams.hallTickets.print')} title={t('exams.hallTickets.print')} onClick={() => printDocument('HALL_TICKET', id)} /> },
        ]}
        emptyIcon={Ticket} emptyTitle={exam ? t('exams.hallTickets.empty') : t('exams.pick.pickFirst')}
      />
    </PageContainer>
  )
}
