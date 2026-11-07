import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpenCheck } from 'lucide-react'
import { MARK_BY } from '@schoolgiant/shared'
import { ControlChip, DataTable, FormField, Input, Note, PageContainer, PageHeader } from '../../components/system'
import { fetchAttendanceBoard, fetchRegister } from '../../api/attendance'

const CELL = { P: 'text-success-600', A: 'text-danger-600 font-semibold', L: 'text-amber-600', HD: 'text-info-600', LV: 'text-ink-muted' }

/** A section's month at a glance: a column per day, a row per student, totals and % on the right. */
export default function Register() {
  const { t } = useTranslation('attendance')
  const { data: board } = useQuery({ queryKey: ['attendance-board', ''], queryFn: () => fetchAttendanceBoard() })
  const sections = board?.sections ?? []
  const [sectionId, setSectionId] = useState('')
  const [month, setMonth] = useState('')
  useEffect(() => { if (!sectionId && sections.length) setSectionId(sections[0].id) }, [sections, sectionId])
  useEffect(() => { if (!month && board?.today) setMonth(board.today.slice(0, 7)) }, [board, month])
  const { data: reg, isLoading } = useQuery({ queryKey: ['attendance-register', sectionId, month], queryFn: () => fetchRegister(sectionId, month), enabled: !!sectionId && !!month })
  const days = reg?.days.filter((d) => d.taken || d.working) ?? []
  const short = (v) => (v ? t(`attendance.short.${v}`, MARK_BY[v]?.short ?? v) : '')

  const columns = [
    { key: 'rollNo', header: t('attendance.register.roll'), width: 50, render: (v) => v ?? '–' },
    { key: 'name', header: t('attendance.register.student'), mobilePrimary: true, render: (v, r) => <span className={clsx('font-medium', r.current ? 'text-ink' : 'text-ink-faint')}>{v}</span> },
    ...days.map((d) => ({
      key: d.date, header: <span className={clsx('font-mono-num', !d.taken && 'text-ink-faint')} title={d.date}>{Number(d.date.slice(8))}</span>, align: 'center', width: 30, mobileHidden: true,
      render: (_, r) => <span className={clsx('text-xs font-mono-num', CELL[r.marks[d.date]])}>{short(r.marks[d.date])}</span>,
    })),
    { key: 'present', header: t('attendance.register.present'), align: 'right', render: (_, r) => (r.counts.P + r.counts.L) + 0.5 * r.counts.HD },
    { key: 'absent', header: t('attendance.register.absent'), align: 'right', render: (_, r) => r.counts.A },
    { key: 'pct', header: '%', align: 'right', render: (v) => (v == null ? '—' : <span className={clsx('font-semibold', v < (reg?.minimumPct ?? 0) ? 'text-danger-600' : 'text-ink')}>{v}</span>) },
  ]

  return (
    <PageContainer wide>
      <PageHeader icon={BookOpenCheck} title={t('attendance.register.title')} subtitle={t('attendance.register.subtitle')} />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        {sections.length > 0 && <ControlChip label={t('attendance.register.section')} value={sections.find((s) => s.id === sectionId)?.short ?? ''} active options={sections.map((s) => s.short)} onChange={(v) => setSectionId(sections.find((s) => s.short === v)?.id ?? '')} />}
        <FormField label={t('attendance.register.month')}><Input type="month" value={month} max={board?.today?.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></FormField>
      </div>
      {board && !sections.length && <Note>{t('attendance.board.none')}</Note>}
      {reg && (
        <DataTable rows={reg.students} columns={columns} loading={isLoading} dense exportable exportName={`attendance-${reg.section.label}-${month}`}
          title={t('attendance.register.tableTitle', { section: reg.section.label, taken: reg.days.filter((d) => d.taken).length })}
          emptyIcon={BookOpenCheck} emptyTitle={t('attendance.register.empty')} />
      )}
      <p className="mt-3 text-xs text-ink-muted">{t('attendance.register.legend')}</p>
    </PageContainer>
  )
}
