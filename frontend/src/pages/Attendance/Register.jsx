import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpenCheck, CalendarCheck, Percent, TriangleAlert, UsersRound } from 'lucide-react'
import { MARK_BY, attendancePct } from '@schoolgiant/shared'
import { ControlChip, DataTable, FormField, Input, Note, PageContainer, PageHeader, PersonCell, StatCardRow, TONE, PctCell } from '../../components/system'
import { fetchAttendanceBoard, fetchRegister } from '../../api/attendance'

// each mark as a small coloured square in the day columns
const MARK_TONE = { P: 'success', A: 'danger', L: 'warning', HD: 'info', LV: 'neutral' }

/** A section's month at a glance: a column per day, a row per student, totals and % on the right. */
export default function Register() {
  const { t } = useTranslation('attendance')
  const { data: board } = useQuery({ queryKey: ['attendance-board', ''], queryFn: () => fetchAttendanceBoard() })
  const sections = board?.sections ?? []
  const [sectionId, setSectionId] = useState('')
  const [month, setMonth] = useState('')
  const [subjectId, setSubjectId] = useState('') // period-wise attendance: one subject's periods
  useEffect(() => { if (!sectionId && sections.length) setSectionId(sections[0].id) }, [sections, sectionId])
  useEffect(() => { if (!month && board?.today) setMonth(board.today.slice(0, 7)) }, [board, month])
  const { data: reg, isLoading } = useQuery({ queryKey: ['attendance-register', sectionId, month, subjectId], queryFn: () => fetchRegister(sectionId, month, subjectId), enabled: !!sectionId && !!month })
  const days = reg?.days.filter((d) => d.taken || d.working) ?? []
  const short = (v) => (v ? t(`attendance.short.${v}`, MARK_BY[v]?.short ?? v) : '')
  const students = reg?.students ?? []
  const min = reg?.minimumPct || 75
  const overall = reg ? attendancePct(students.reduce((m, r) => { for (const k of ['P', 'A', 'L', 'HD', 'LV', 'total']) m[k] += r.counts?.[k] ?? 0; return m }, { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 })) : null
  const below = students.filter((r) => r.pct != null && r.pct < min).length
  const takenDays = reg ? reg.days.filter((d) => d.taken).length : 0

  const columns = [
    { key: 'rollNo', header: t('attendance.register.roll'), width: 50, render: (v) => <span className="font-mono-num text-ink-muted">{v ?? '–'}</span> },
    { key: 'name', header: t('attendance.register.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} size={24} className={r.current ? undefined : 'opacity-50'} /> },
    ...days.map((d) => ({
      key: d.date, header: <span className={clsx('font-mono-num', !d.taken && 'text-ink-faint')} title={d.date}>{Number(d.date.slice(8))}</span>, align: 'center', width: 30, mobileHidden: true,
      render: (_, r) => {
        const m = r.marks[d.date]
        if (!m) return null
        const tone = TONE[MARK_TONE[m] ?? 'neutral']
        return <span className={clsx('inline-flex h-5 min-w-[20px] items-center justify-center rounded px-0.5 text-[10.5px] font-semibold font-mono-num', tone.bg, tone.text)}>{short(m)}</span>
      },
    })),
    { key: 'present', header: t('attendance.register.present'), align: 'right', render: (_, r) => <span className={clsx('font-semibold tabular-nums', TONE.success.text)}>{(r.counts.P + r.counts.L) + 0.5 * r.counts.HD}</span> },
    { key: 'absent', header: t('attendance.register.absent'), align: 'right', render: (_, r) => (r.counts.A ? <span className={clsx('font-semibold tabular-nums', TONE.danger.text)}>{r.counts.A}</span> : <span className="text-ink-faint tabular-nums">0</span>) },
    { key: 'pct', header: '%', align: 'right', render: (v) => <PctCell value={v} min={reg?.minimumPct} /> },
  ]

  return (
    <PageContainer wide>
      <PageHeader icon={BookOpenCheck} title={t('attendance.register.title')} subtitle={t('attendance.register.subtitle')} />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        {sections.length > 0 && <ControlChip label={t('attendance.register.section')} value={sections.find((s) => s.id === sectionId)?.short ?? ''} active options={sections.map((s) => s.short)} onChange={(v) => { setSectionId(sections.find((s) => s.short === v)?.id ?? ''); setSubjectId('') }} />}
        {reg?.subjects?.length > 0 && (
          <ControlChip label={t('attendance.register.subject')} value={reg.subjects.find((x) => x.id === subjectId)?.name ?? t('attendance.register.wholeDay')} active={!!subjectId}
            options={[t('attendance.register.wholeDay'), ...reg.subjects.map((x) => x.name)]} onChange={(v) => setSubjectId(reg.subjects.find((x) => x.name === v)?.id ?? '')} />
        )}
        <FormField label={t('attendance.register.month')}><Input type="month" value={month} max={board?.today?.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></FormField>
      </div>
      {board && !sections.length && <Note>{t('attendance.board.none')}</Note>}
      {reg && students.length > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: UsersRound, tone: 'brand', label: t('attendance.register.summary.students'), value: students.length },
          { icon: CalendarCheck, tone: 'info', label: t('attendance.register.summary.days'), value: takenDays },
          { icon: Percent, tone: overall == null ? 'neutral' : overall < min ? 'danger' : overall < 90 ? 'warning' : 'success', label: t('attendance.register.summary.average'), value: overall == null ? '—' : `${overall}%`, progress: overall ?? undefined },
          { icon: TriangleAlert, tone: below ? 'danger' : 'success', label: t('attendance.register.summary.below', { min }), value: below },
        ]} />
      )}
      {reg && (
        <DataTable rows={reg.students} columns={columns} loading={isLoading} dense exportable exportName={`attendance-${reg.section.label}-${month}`}
          title={t('attendance.register.tableTitle', { section: reg.section.label, taken: reg.days.filter((d) => d.taken).length })}
          emptyIcon={BookOpenCheck} emptyTitle={t('attendance.register.empty')} />
      )}
      <p className="mt-3 text-xs text-ink-muted">{t('attendance.register.legend')}</p>
    </PageContainer>
  )
}
