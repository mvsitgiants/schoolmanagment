import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarRange } from 'lucide-react'
import { EXAM_STATUS } from '@schoolgiant/shared'
import { ControlChip, PillRow, SideNav, pillClass } from '../system'
import { fetchExam, fetchExams } from '../../api/exams'
import { useFormat } from '../../context/SettingsContext'

/**
 * The exam (and section) a screen works on: this year's exams in the given statuses, the picked one
 * kept in the URL (`?exam=&section=`) so a link opens the same view.
 *
 * Returns, besides the ids:
 *  - `nav`: the exams as a page SideNav (dates, status, mark sheets locked x/y) — false when there is one exam;
 *  - `sectionPills`: the exam's classes as a scrolling pill row (withSection only; false with one class);
 *  - `chips`: the older ControlChip pair (exam + class) for screens that keep a dropdown.
 */
export default function useExamPick({ statuses = ['SCHEDULED', 'PUBLISHED'], withSection = true } = {}) {
  const { t } = useTranslation('exams')
  const { date } = useFormat()
  const [params, setParams] = useSearchParams()
  const [examId, setExamId] = useState(params.get('exam') ?? '')
  const [sectionId, setSectionId] = useState(params.get('section') ?? '')
  const { data: list, isLoading: listLoading } = useQuery({ queryKey: ['exams', ''], queryFn: () => fetchExams() })
  const statusKey = statuses.join()
  const exams = useMemo(() => (list?.exams ?? []).filter((e) => statusKey.split(',').includes(e.status)), [list, statusKey])
  useEffect(() => { if (!examId && exams.length) setExamId(exams.at(-1).id) }, [exams, examId])
  const { data: exam, isLoading: examLoading } = useQuery({ queryKey: ['exam', examId], queryFn: () => fetchExam(examId), enabled: !!examId })
  const sections = useMemo(() => exam?.sections ?? [], [exam])
  useEffect(() => { if (withSection && exam && !sections.some((s) => s.id === sectionId)) setSectionId(sections[0]?.id ?? '') }, [exam, sections, sectionId, withSection])
  useEffect(() => {
    const next = {}
    if (examId) next.exam = examId
    if (withSection && sectionId) next.section = sectionId
    setParams(next, { replace: true })
  }, [examId, sectionId, withSection, setParams])
  const pickExam = (id) => { setExamId(id); setSectionId('') }

  const chips = (
    <>
      <ControlChip label={t('exams.pick.exam')} value={exam?.name ?? (exams.length ? '—' : t('exams.pick.none'))} active={!!examId}
        options={exams.map((e) => e.name)} onChange={(v) => pickExam(exams.find((e) => e.name === v)?.id ?? '')} />
      {withSection && <ControlChip label={t('exams.pick.section')} value={sections.find((s) => s.id === sectionId)?.label ?? '—'} active={!!sectionId}
        options={sections.map((s) => s.label)} onChange={(v) => setSectionId(sections.find((s) => s.label === v)?.id ?? '')} />}
    </>
  )
  const nav = exams.length > 1 && (
    <SideNav title={t('exams.pick.examsNav')} value={examId} onChange={pickExam} items={exams.map((e) => ({
      id: e.id, label: e.name, icon: CalendarRange,
      hint: e.startDate ? `${date(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${date(e.endDate)}` : ''}` : undefined,
      count: e.status === 'PUBLISHED' ? t('exams.pick.publishedShort') : e.sheetsExpected ? `${e.sheetsLocked}/${e.sheetsExpected}` : undefined,
      progress: e.sheetsExpected ? { value: e.sheetsLocked, max: e.sheetsExpected, kind: 'done' } : undefined,
    }))} />
  )
  const sectionPills = withSection && sections.length > 1 && (
    <PillRow>
      {sections.map((s) => (
        <button key={s.id} type="button" aria-pressed={s.id === sectionId} onClick={() => setSectionId(s.id)} className={pillClass(s.id === sectionId)} title={s.label}>
          {s.short || s.label}
        </button>
      ))}
    </PillRow>
  )
  const statusText = exam ? t(`exams.status.${exam.status}`, EXAM_STATUS[exam.status]?.label ?? exam.status) : ''
  return {
    exams, exam, examId, setExamId: pickExam, sectionId, setSectionId, sections, section: sections.find((s) => s.id === sectionId) ?? null,
    chips, nav, sectionPills, statusText,
    loading: listLoading || examLoading, noExams: !listLoading && !exams.length,
  }
}
