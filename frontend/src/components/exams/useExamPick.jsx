import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ControlChip } from '../system'
import { fetchExam, fetchExams } from '../../api/exams'

/**
 * The exam (and section) a screen works on: this year's exams in the given statuses, the picked one
 * kept in the URL (`?exam=&section=`) so a link opens the same view. Returns the chips to show.
 */
export default function useExamPick({ statuses = ['SCHEDULED', 'PUBLISHED'], withSection = true } = {}) {
  const { t } = useTranslation('exams')
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

  const chips = (
    <>
      <ControlChip label={t('exams.pick.exam')} value={exam?.name ?? (exams.length ? '—' : t('exams.pick.none'))} active={!!examId}
        options={exams.map((e) => e.name)} onChange={(v) => { setExamId(exams.find((e) => e.name === v)?.id ?? ''); setSectionId('') }} />
      {withSection && <ControlChip label={t('exams.pick.section')} value={sections.find((s) => s.id === sectionId)?.label ?? '—'} active={!!sectionId}
        options={sections.map((s) => s.label)} onChange={(v) => setSectionId(sections.find((s) => s.label === v)?.id ?? '')} />}
    </>
  )
  return { exams, exam, examId, sectionId, sections, chips, loading: listLoading || examLoading, noExams: !listLoading && !exams.length }
}
