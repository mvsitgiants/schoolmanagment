import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Camera, CreditCard, Printer, Settings2, UsersRound } from 'lucide-react'
import { BulkActionBar, CodeBadge, ControlChip, DataTable, Note, PageContainer, PageHeader, StackCell, StatCardRow, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPhoto from '../../components/students/StudentPhoto'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchIdCardList } from '../../api/students'
import { hasPermission } from '../../api/auth'
import { printDocument, printDocuments } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'

/** Student ID cards: pick a class, add the missing photos, print the cards (front and back) for all or some. */
export default function IdCards() {
  const { t } = useTranslation('students')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const sections = useMemo(() => lookup?.sections ?? [], [lookup])
  const [sectionId, setSectionId] = useState('')
  const picked = sectionId || sections[0]?.id || ''
  const [selected, setSelected] = useState([])
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['id-card-list', picked], queryFn: () => fetchIdCardList(picked), enabled: !!picked })
  const canPrint = hasPermission('students.id-cards.print')
  const canPhoto = hasPermission('students.profile.edit') || canPrint
  const missing = rows.filter((r) => !r.hasPhoto).length
  const printedCount = rows.filter((r) => r.printed).length
  const print = async (ids) => {
    if (ids.length === 1) { await printDocument('STUDENT_ID_CARD', ids[0]); return }
    const r = await printDocuments('STUDENT_ID_CARD', ids, { preparing: t('students.idCards.preparing') })
    if (r?.error) showError(r.error)
  }

  return (
    <PageContainer>
      <PageHeader icon={CreditCard} title={t('students.idCards.title')} subtitle={t('students.idCards.subtitle')}
        actions={<>
          {hasPermission('core.settings.view') && <Link to="/core/settings" className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline px-2"><Settings2 size={15} />{t('students.idCards.design')}</Link>}
          {canPrint && rows.length > 0 && <Button icon={Printer} onClick={() => print(rows.map((r) => r.id))}>{t('students.idCards.printAll', { count: rows.length })}</Button>}
        </>} />
      {rows.length > 0 && missing > 0 && <Note tone="warning" className="mb-4">{t('students.idCards.missingPhotos', { count: missing })}</Note>}
      {rows.length > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: UsersRound, tone: 'brand', label: t('students.idCards.summary.students'), value: rows.length, sub: sections.find((s) => s.id === picked)?.label },
          { icon: Camera, tone: missing ? 'warning' : 'success', label: t('students.idCards.summary.withPhoto'), value: rows.length - missing, sub: t('students.idCards.summary.ofTotal', { count: rows.length }), progress: ((rows.length - missing) / rows.length) * 100 },
          { icon: CreditCard, tone: 'info', label: t('students.idCards.summary.printed'), value: printedCount, sub: t('students.idCards.summary.ofTotal', { count: rows.length }), progress: (printedCount / rows.length) * 100 },
        ]} />
      )}
      <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
        {canPrint && <Button size="sm" icon={Printer} onClick={() => print(selected)}>{t('students.idCards.printSelected')}</Button>}
      </BulkActionBar>
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        selectable={canPrint} selectedIds={selected} onSelectionChange={setSelected}
        toolbar={<div className="flex justify-end">
          <ControlChip label={t('students.directory.section')} value={sections.find((s) => s.id === picked)?.label ?? '—'} active={!!sectionId}
            options={sections.map((s) => s.label)} onChange={(v) => { setSectionId(sections.find((s) => s.label === v)?.id ?? ''); setSelected([]) }} />
        </div>}
        columns={[
          { key: 'hasPhoto', header: t('students.idCards.photo'), width: 140, render: (_, r) => <div onClick={(e) => e.stopPropagation()}><StudentPhoto studentId={r.id} name={r.name} size="sm" canEdit={canPhoto} /></div> },
          { key: 'rollNo', header: t('students.idCards.roll'), width: 70, render: (v) => <CodeBadge>{v}</CodeBadge> },
          { key: 'name', header: t('students.directory.student'), mobilePrimary: true, render: (v, r) => <StackCell title={v} sub={r.admissionNo} subMono /> },
          { key: 'printed', header: t('students.idCards.card'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('students.idCards.printed') : t('students.idCards.notYet')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 60, render: (id) => canPrint && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('students.idCards.print')} title={t('students.idCards.print')} onClick={() => print([id])} /> },
        ]}
        emptyIcon={CreditCard} emptyTitle={t('students.idCards.empty')}
      />
      <Note className="mt-4">{t('students.idCards.hint')}</Note>
    </PageContainer>
  )
}
