import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CheckCircle2, ClipboardList, EyeOff, MessageSquareHeart } from 'lucide-react'
import { FCard, FEmpty, FError, FRow, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { SurveyFill } from '../../components/surveys/SurveyKit'
import { familyAnswerSurvey, familySurvey, familySurveys } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

function OneSurvey({ id, onBack }) {
  const { t } = useTranslation('surveys')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const [done, setDone] = useState(false)
  const { data: s, isLoading, error } = useFamilyQuery(['surveys', id], () => familySurvey(slug, studentId, id))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('surveys.family.back')}</button>
      <FCard title={s.title}>
        {s.intro && <p className="mb-3 whitespace-pre-wrap text-sm text-ink-muted">{s.intro}</p>}
        {s.anonymous && <p className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs text-ink-muted"><EyeOff className="h-3.5 w-3.5" />{t('surveys.fill.anonymousNote')}</p>}
        {s.state !== 'OPEN' && !s.answered ? <p className="text-sm text-ink-muted">{t('surveys.fill.notOpen')}</p> : (
          <SurveyFill definition={s.definition} submitted={done || s.answered}
            onSubmit={async (values) => { await familyAnswerSurvey(slug, studentId, id, values); setDone(true); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'surveys'] }) }} />
        )}
      </FCard>
    </>
  )
}

/** The family app › Surveys: the school's questionnaires for this child's family (or the student) — fill each once. */
export default function FamilySurveys() {
  const { t } = useTranslation('surveys')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [open, setOpen] = useState(null)
  const { data = [], isLoading, error } = useFamilyQuery(['surveys'], () => familySurveys(slug, studentId))
  if (open) return <OneSurvey id={open} onBack={() => setOpen(null)} />
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!data.length) return <FCard><FEmpty icon={MessageSquareHeart} title={t('surveys.family.none')} hint={t('surveys.family.noneHint')} /></FCard>
  const todo = data.filter((s) => !s.answered && s.state === 'OPEN')
  const done = data.filter((s) => s.answered)
  return (
    <>
      {todo.length > 0 && (
        <FCard title={t('surveys.family.toFill')}>
          <div className="divide-y divide-border">
            {todo.map((s) => <FRow key={s.id} icon={ClipboardList} title={s.title} subtitle={s.closesOn ? t('surveys.family.closes', { date: date(s.closesOn) }) : undefined} onClick={() => setOpen(s.id)} />)}
          </div>
        </FCard>
      )}
      {done.length > 0 && (
        <FCard title={t('surveys.family.done')}>
          <div className="divide-y divide-border">
            {done.map((s) => <FRow key={s.id} icon={CheckCircle2} tone="success" title={s.title} subtitle={t('surveys.family.thanks')} />)}
          </div>
        </FCard>
      )}
    </>
  )
}
