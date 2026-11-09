import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, CheckCircle2, Library, Plus, Search, Trash2 } from 'lucide-react'
import {
  BLOOM_LEVELS, DIFFICULTY, QP_DIFFICULTIES, QP_SET_LETTERS, QP_SET_MODES, QP_STATUS, QUESTION_TYPES, blueprintTotals, checkBlueprint, checkQuestion, optionLetter,
} from '@schoolgiant/shared'
import { ColorChip, DataTable, FormField, Input, Modal, Note, SegmentedControl, Select, Tag, Textarea } from '../system'
import Button from '../ui/Button'
import { fetchPaperBank } from '../../api/questionPapers'

// The pieces of the question paper screen (pages/Exams/QuestionPapers.jsx): labels, the question card body, the
// target-vs-picked bars, and the forms — blueprint, sets, writing a question, picking from the bank.

const NS = 'questionPapers'

/** Translated labels of the fixed lists. */
export function useQpLabels() {
  const { t } = useTranslation(NS)
  return useMemo(() => ({
    type: (v) => t(`questionPapers.types.${v}`, QUESTION_TYPES[v]?.label ?? v),
    diff: (v) => t(`questionPapers.difficulty.${v}`, DIFFICULTY[v]?.label ?? v),
    status: (v) => t(`questionPapers.status.${v}`, QP_STATUS[v]?.label ?? v),
    bloom: (v) => t(`questionPapers.bloom.${v}`, v),
    mode: (v) => t(`questionPapers.setModes.${v}`, QP_SET_MODES[v]?.label ?? v),
  }), [t])
}
export const diffTone = (d) => DIFFICULTY[d]?.tone ?? 'neutral'
export const statusTone = (s) => QP_STATUS[s]?.tone ?? 'neutral'

/** The chips under a question: type, difficulty, chapter, Bloom's level. */
export function QuestionChips({ q, withType = false }) {
  const L = useQpLabels()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {withType && <Tag tone="info">{L.type(q.type)}</Tag>}
      {q.difficulty && <Tag tone={diffTone(q.difficulty)}>{L.diff(q.difficulty)}</Tag>}
      {q.chapter && <ColorChip label={q.chapter} dot />}
      {q.bloom && <Tag>{L.bloom(q.bloom)}</Tag>}
    </div>
  )
}

/** A question's text and options; `answers` shows the right options and the model answer. */
export function QuestionBody({ q, answers = false }) {
  const { t } = useTranslation(NS)
  const opts = q.type === 'TRUE_FALSE' ? [] : q.options ?? []
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm text-ink whitespace-pre-line break-words">
        {q.text}
        {q.type === 'TRUE_FALSE' && <span className="ms-1 text-ink-faint italic">({t('questionPapers.card.trueFalse')})</span>}
      </p>
      {opts.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {opts.map((o, i) => (
            <span key={i} className={clsx('text-[13px] inline-flex items-start gap-1.5', answers && o.correct ? 'text-emerald-700 font-medium' : 'text-ink-muted')}>
              <span className="font-mono-num">{optionLetter(i)})</span>
              <span className="break-words">{o.text}</span>
              {answers && o.correct && <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-label={t('questionPapers.card.correct')} />}
            </span>
          ))}
        </div>
      )}
      {answers && q.type === 'TRUE_FALSE' && <p className="text-[13px] text-emerald-700 font-medium">{q.options?.find((o) => o.correct)?.text}</p>}
      {answers && ['FILL', 'SHORT', 'LONG'].includes(q.type) && (q.answers ?? []).length > 0 && (
        <p className="text-[13px] text-emerald-700 whitespace-pre-line">{q.answers.join(q.type === 'FILL' ? ' / ' : '\n')}</p>
      )}
    </div>
  )
}

/**
 * Target vs picked, one bar per value: the filled bar is the share of the marks picked, the dark tick the target.
 * `rows` [{ key, label, target (% or null), marks, tone }], `total` all the marks on the paper.
 */
export function MixBars({ rows, total }) {
  const { t } = useTranslation(NS)
  const FILL = { success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-rose-500', brand: 'bg-brand-500', neutral: 'bg-ink-faint', info: 'bg-sky-500' }
  if (!rows.length) return <p className="text-xs text-ink-faint">{t('questionPapers.mix.nothing')}</p>
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.marks / total) * 100) : 0
        const off = r.target != null && Math.abs(pct - r.target) > 10
        return (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-ink truncate">{r.label}</span>
              <span className={clsx('tabular-nums', off ? 'text-amber-700 font-semibold' : 'text-ink-muted')}>
                {r.target != null ? t('questionPapers.mix.vsTarget', { pct, target: r.target }) : t('questionPapers.mix.pct', { pct })}
              </span>
            </div>
            <div className="relative mt-1 h-2 rounded-full bg-black/5" role="img" aria-label={`${r.label}: ${pct}%`}>
              <div className={clsx('h-2 rounded-full', FILL[r.tone] ?? FILL.brand)} style={{ width: `${Math.min(100, pct)}%` }} />
              {r.target != null && <span className="absolute -top-0.5 h-3 w-0.5 rounded bg-ink" style={{ insetInlineStart: `calc(${Math.min(100, r.target)}% - 1px)` }} aria-hidden />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────────────────── blueprint

const blankSection = (n) => ({ id: undefined, title: `Section ${String.fromCharCode(65 + n)}`, instructions: '', type: 'SHORT', count: 5, marks: 2, attempt: '', choice: false })

/** The blueprint: duration, max marks, instructions, sections, chapter weightage, difficulty mix — with live totals. */
export function BlueprintForm({ paper, saving, onClose, onSave }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const [form, setForm] = useState(() => ({
    durationMin: paper.durationMin ?? '', maxMarks: paper.maxMarks, instructions: paper.instructions ?? '',
    sections: paper.sections.map((s) => ({ ...s, attempt: s.attempt ?? '', instructions: s.instructions ?? '' })),
    chapters: paper.chapters.length ? paper.chapters : [],
    difficulty: paper.difficulty ?? { EASY: 0, MEDIUM: 0, HARD: 0 },
  }))
  const setSec = (i, k, v) => setForm((f) => ({ ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }))
  const move = (i, d) => setForm((f) => { const s = [...f.sections]; [s[i], s[i + d]] = [s[i + d], s[i]]; return { ...f, sections: s } })
  const setCh = (i, k, v) => setForm((f) => ({ ...f, chapters: f.chapters.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }))
  const body = () => ({
    durationMin: Number(form.durationMin) || null, maxMarks: Number(form.maxMarks) || 0, instructions: form.instructions,
    sections: form.sections.map((s) => ({ ...s, count: Number(s.count) || 0, marks: Number(s.marks) || 0, attempt: Number(s.attempt) || null })),
    chapters: form.chapters.filter((c) => String(c.chapter).trim()).map((c) => ({ chapter: c.chapter, weight: Number(c.weight) || 0 })),
    difficulty: Object.fromEntries(QP_DIFFICULTIES.map((d) => [d, Number(form.difficulty[d]) || 0])),
  })
  const b = body()
  const totals = blueprintTotals(b)
  const { errors, warnings } = checkBlueprint(b, b.maxMarks)
  const mixSum = QP_DIFFICULTIES.reduce((n, d) => n + b.difficulty[d], 0)
  const wSum = b.chapters.reduce((n, c) => n + c.weight, 0)
  const sectionErr = (i, k) => (errors[`sections.${i}.${k}`] ? t(`questionPapers.blueprint.errors.${k}`) : undefined)
  return (
    <Modal open onClose={onClose} size="xl" title={t('questionPapers.blueprint.title')} footer={<>
      <span className={clsx('me-auto text-sm tabular-nums', totals.total === b.maxMarks ? 'text-emerald-700' : 'text-amber-700')}>
        {t('questionPapers.blueprint.totalLine', { total: totals.total, max: b.maxMarks, questions: totals.questions })}
      </span>
      <Button variant="secondary" onClick={onClose}>{t('questionPapers.actions.cancel')}</Button>
      <Button loading={saving} disabled={Object.keys(errors).length > 0} onClick={() => onSave(b)}>{t('questionPapers.blueprint.save')}</Button>
    </>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-3 gap-3">
          <FormField label={t('questionPapers.blueprint.duration')} hint={t('questionPapers.blueprint.durationHint')}><Input type="number" min="0" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} /></FormField>
          <FormField label={t('questionPapers.blueprint.maxMarks')} required hint={paper.paperMaxMarks ? t('questionPapers.blueprint.maxMarksHint', { n: paper.paperMaxMarks }) : undefined}><Input type="number" min="1" value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} /></FormField>
        </div>
        <FormField label={t('questionPapers.blueprint.instructions')} hint={t('questionPapers.blueprint.instructionsHint')}>
          <Textarea rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </FormField>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-ink">{t('questionPapers.blueprint.sections')}</p>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, sections: [...f.sections, blankSection(f.sections.length)] }))}>{t('questionPapers.blueprint.addSection')}</Button>
          </div>
          <div className="space-y-2">
            {form.sections.map((s, i) => {
              const m = totals.sections[i]
              return (
                <div key={s.id ?? `new-${i}`} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="grid grid-cols-2 md:grid-cols-[1.2fr_1.4fr_.6fr_.6fr_.7fr_auto] gap-2 items-start">
                    <FormField label={t('questionPapers.blueprint.sectionTitle')} error={sectionErr(i, 'title')}><Input value={s.title} onChange={(e) => setSec(i, 'title', e.target.value)} /></FormField>
                    <FormField label={t('questionPapers.blueprint.type')}>
                      <Select value={s.type} onChange={(e) => setSec(i, 'type', e.target.value)}>
                        {Object.keys(QUESTION_TYPES).map((k) => <option key={k} value={k}>{L.type(k)}</option>)}
                      </Select>
                    </FormField>
                    <FormField label={t('questionPapers.blueprint.count')} error={sectionErr(i, 'count')}><Input type="number" min="1" value={s.count} onChange={(e) => setSec(i, 'count', e.target.value)} /></FormField>
                    <FormField label={t('questionPapers.blueprint.marks')} error={sectionErr(i, 'marks')}><Input type="number" min="0.5" step="0.5" value={s.marks} onChange={(e) => setSec(i, 'marks', e.target.value)} /></FormField>
                    <FormField label={t('questionPapers.blueprint.attempt')} error={sectionErr(i, 'attempt')}><Input type="number" min="1" placeholder={t('questionPapers.blueprint.attemptAll')} value={s.attempt} onChange={(e) => setSec(i, 'attempt', e.target.value)} /></FormField>
                    <div className="flex gap-1 md:mt-6">
                      <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} aria-label={t('questionPapers.actions.moveUp')} onClick={() => move(i, -1)} />
                      <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === form.sections.length - 1} aria-label={t('questionPapers.actions.moveDown')} onClick={() => move(i, 1)} />
                      <Button size="sm" variant="ghost" icon={Trash2} disabled={form.sections.length < 2} aria-label={t('questionPapers.blueprint.removeSection')} onClick={() => setForm((f) => ({ ...f, sections: f.sections.filter((_, j) => j !== i) }))} />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-[1fr_auto] gap-2 items-center">
                    <Input value={s.instructions} placeholder={t('questionPapers.blueprint.sectionInstructions')} aria-label={t('questionPapers.blueprint.sectionInstructions')} onChange={(e) => setSec(i, 'instructions', e.target.value)} />
                    <div className="flex items-center gap-3 text-xs">
                      <label className="inline-flex items-center gap-1.5 text-ink-muted" title={t('questionPapers.blueprint.choiceHint')}>
                        <input type="checkbox" checked={!!s.choice} onChange={(e) => setSec(i, 'choice', e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                        {t('questionPapers.blueprint.choice')}
                      </label>
                      <Tag tone="brand">{t('questionPapers.blueprint.sectionTotal', { n: m?.total ?? 0 })}</Tag>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {warnings.some((w) => w.code === 'MARKS_MISMATCH') && <Note tone="warning">{t('questionPapers.warnings.MARKS_MISMATCH', { total: totals.total, max: b.maxMarks })}</Note>}

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <p className="text-sm font-semibold text-ink">{t('questionPapers.blueprint.mix')}</p>
            <p className="text-xs text-ink-muted mb-2">{t('questionPapers.blueprint.mixHint')}</p>
            <div className="grid grid-cols-3 gap-2">
              {QP_DIFFICULTIES.map((d) => (
                <FormField key={d} label={L.diff(d)}><Input type="number" min="0" max="100" value={form.difficulty[d] ?? 0} onChange={(e) => setForm((f) => ({ ...f, difficulty: { ...f.difficulty, [d]: e.target.value } }))} /></FormField>
              ))}
            </div>
            {mixSum > 0 && mixSum !== 100 && <p className="text-xs text-amber-700 mt-1">{t('questionPapers.warnings.MIX_NOT_100', { sum: mixSum })}</p>}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">{t('questionPapers.blueprint.chapters')}</p>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, chapters: [...f.chapters, { chapter: '', weight: '' }] }))}>{t('questionPapers.blueprint.addChapter')}</Button>
            </div>
            <p className="text-xs text-ink-muted mb-2">{t('questionPapers.blueprint.chaptersHint')}</p>
            <datalist id="qp-chapters">{(paper.bank?.chapters ?? []).map((c) => <option key={c} value={c} />)}</datalist>
            <div className="space-y-2">
              {form.chapters.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_5.5rem_auto] gap-2">
                  <Input list="qp-chapters" value={c.chapter} placeholder={t('questionPapers.blueprint.chapter')} aria-label={t('questionPapers.blueprint.chapter')} onChange={(e) => setCh(i, 'chapter', e.target.value)} />
                  <Input type="number" min="0" max="100" value={c.weight} placeholder="%" aria-label={t('questionPapers.blueprint.weight')} onChange={(e) => setCh(i, 'weight', e.target.value)} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('questionPapers.blueprint.removeChapter')} onClick={() => setForm((f) => ({ ...f, chapters: f.chapters.filter((_, j) => j !== i) }))} />
                </div>
              ))}
            </div>
            {b.chapters.length > 0 && wSum !== 100 && <p className="text-xs text-amber-700 mt-1">{t('questionPapers.warnings.WEIGHT_NOT_100', { sum: wSum })}</p>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ───────────────────────────────────────────────────────── sets

export function SetsForm({ paper, saving, onClose, onSave }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const [count, setCount] = useState(String(Math.max(2, paper.sets.length)))
  const [mode, setMode] = useState(paper.setMode ?? 'SHUFFLE')
  const [shuffleOptions, setShuffleOptions] = useState(paper.shuffleOptions !== false)
  return (
    <Modal open onClose={onClose} title={t('questionPapers.sets.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('questionPapers.actions.cancel')}</Button>
      <Button loading={saving} onClick={() => onSave({ count: Number(count), mode, shuffleOptions })}>{t('questionPapers.sets.make')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('questionPapers.sets.count')}>
          <SegmentedControl options={QP_SET_LETTERS.map((_, i) => ({ value: String(i + 1), label: String(i + 1) }))} value={count} onChange={setCount} />
        </FormField>
        <FormField label={t('questionPapers.sets.mode')}>
          <SegmentedControl options={Object.keys(QP_SET_MODES).map((k) => ({ value: k, label: L.mode(k) }))} value={mode} onChange={setMode} />
        </FormField>
        <Note>{t(`questionPapers.sets.hint.${mode}`)}</Note>
        {mode === 'SHUFFLE' && (
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
            {t('questionPapers.sets.shuffleOptions')}
          </label>
        )}
        {paper.sets.length > 1 && <Note tone="warning">{t('questionPapers.sets.remake')}</Note>}
      </div>
    </Modal>
  )
}

// ───────────────────────────────────────────────────────── writing / editing a question

const blankFor = (type) => ({
  text: '', chapter: '', difficulty: 'MEDIUM', bloom: '', explanation: '', answersText: '',
  options: type === 'TRUE_FALSE' ? [{ text: 'True', correct: true }, { text: 'False', correct: false }] : QUESTION_TYPES[type]?.options ? [0, 1, 2, 3].map(() => ({ text: '', correct: false })) : [],
})

/**
 * Write a question for a section (its type is the section's), or edit one already in the paper. `canSaveToBank`
 * offers "also save to the question bank" for a new one. `onSave(question, { saveToBank })`.
 */
export function QuestionForm({ section, initial, chapters = [], canSaveToBank, saving, onClose, onSave }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const type = section.type
  const [form, setForm] = useState(() => (initial ? {
    ...blankFor(type), ...initial, chapter: initial.chapter ?? '', bloom: initial.bloom ?? '', explanation: initial.explanation ?? '',
    answersText: (initial.answers ?? []).join(type === 'FILL' ? '\n' : '\n\n'),
    options: initial.options?.length ? initial.options.map((o) => ({ ...o })) : blankFor(type).options,
  } : blankFor(type)))
  const [saveToBank, setSaveToBank] = useState(false)
  const [tried, setTried] = useState(false)
  const q = {
    questionId: initial?.questionId ?? undefined, type, text: form.text, chapter: form.chapter, difficulty: form.difficulty, bloom: form.bloom || undefined, explanation: form.explanation,
    options: form.options.filter((o) => String(o.text).trim()),
    answers: type === 'FILL' ? form.answersText.split('\n').map((x) => x.trim()).filter(Boolean) : ['SHORT', 'LONG'].includes(type) && form.answersText.trim() ? [form.answersText.trim()] : undefined,
  }
  if (type === 'TRUE_FALSE') q.options = form.options
  const errors = checkQuestion({ ...q, marks: section.marks })
  const setOpt = (i, k, v) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, [k]: v } : (k === 'correct' && v && type !== 'MULTI' ? { ...o, correct: false } : o))) }))
  const err = (k) => (tried && errors[k] ? t(`questionPapers.form.errors.${k}`) : undefined)
  const submit = () => { setTried(true); if (!Object.keys(errors).length) onSave(q, { saveToBank }) }
  return (
    <Modal open onClose={onClose} size="lg" title={initial ? t('questionPapers.form.editTitle') : t('questionPapers.form.newTitle', { section: section.title })} footer={<>
      {!initial && canSaveToBank && (
        <label className="me-auto inline-flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={saveToBank} onChange={(e) => setSaveToBank(e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {t('questionPapers.form.saveToBank')}
        </label>
      )}
      <Button variant="secondary" onClick={onClose}>{t('questionPapers.actions.cancel')}</Button>
      <Button loading={saving} onClick={submit}>{initial ? t('questionPapers.form.save') : t('questionPapers.form.add')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Tag tone="info">{L.type(type)}</Tag><Tag tone="brand">{t('questionPapers.card.marks', { count: section.marks })}</Tag></div>
        <FormField label={t('questionPapers.form.text')} required error={err('text')}>
          <Textarea rows={3} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder={type === 'FILL' ? t('questionPapers.form.fillPlaceholder') : undefined} />
        </FormField>
        {type === 'TRUE_FALSE' && (
          <FormField label={t('questionPapers.form.answer')}>
            <SegmentedControl options={[{ value: '0', label: t('questionPapers.form.true') }, { value: '1', label: t('questionPapers.form.false') }]}
              value={form.options[1]?.correct ? '1' : '0'} onChange={(v) => setForm((f) => ({ ...f, options: [{ text: 'True', correct: v === '0' }, { text: 'False', correct: v === '1' }] }))} />
          </FormField>
        )}
        {(type === 'MCQ' || type === 'MULTI') && (
          <div>
            <p className="text-xs font-medium text-ink-muted mb-1.5">{type === 'MCQ' ? t('questionPapers.form.optionsOne') : t('questionPapers.form.optionsMany')}</p>
            <div className="space-y-2">
              {form.options.map((o, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                  <input type={type === 'MCQ' ? 'radio' : 'checkbox'} name="qp-correct" checked={!!o.correct} onChange={(e) => setOpt(i, 'correct', e.target.checked)} aria-label={t('questionPapers.form.markCorrect')} className="border-border text-brand-500 focus:ring-brand-500" />
                  <Input value={o.text} placeholder={t('questionPapers.form.option', { letter: optionLetter(i) })} onChange={(e) => setOpt(i, 'text', e.target.value)} />
                  <Button size="sm" variant="ghost" icon={Trash2} disabled={form.options.length < 3} aria-label={t('questionPapers.form.removeOption')} onClick={() => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))} />
                </div>
              ))}
            </div>
            {form.options.length < 6 && <Button size="sm" variant="ghost" icon={Plus} className="mt-1" onClick={() => setForm((f) => ({ ...f, options: [...f.options, { text: '', correct: false }] }))}>{t('questionPapers.form.addOption')}</Button>}
            {err('options') && <p className="text-xs text-danger-600 mt-1">{err('options')}</p>}
          </div>
        )}
        {type === 'FILL' && (
          <FormField label={t('questionPapers.form.fillAnswers')} hint={t('questionPapers.form.fillAnswersHint')} error={err('answers')}>
            <Textarea rows={2} value={form.answersText} onChange={(e) => setForm({ ...form, answersText: e.target.value })} />
          </FormField>
        )}
        {['SHORT', 'LONG'].includes(type) && (
          <FormField label={t('questionPapers.form.modelAnswer')} hint={t('questionPapers.form.modelAnswerHint')}>
            <Textarea rows={type === 'LONG' ? 5 : 3} value={form.answersText} onChange={(e) => setForm({ ...form, answersText: e.target.value })} />
          </FormField>
        )}
        <FormField label={t('questionPapers.form.scheme')} hint={t('questionPapers.form.schemeHint')}>
          <Textarea rows={2} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
        </FormField>
        <div className="grid sm:grid-cols-3 gap-3">
          <FormField label={t('questionPapers.form.chapter')}>
            <Input list="qp-form-chapters" value={form.chapter} onChange={(e) => setForm({ ...form, chapter: e.target.value })} />
          </FormField>
          <datalist id="qp-form-chapters">{chapters.map((c) => <option key={c} value={c} />)}</datalist>
          <FormField label={t('questionPapers.form.difficulty')}>
            <Select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
              {QP_DIFFICULTIES.map((d) => <option key={d} value={d}>{L.diff(d)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('questionPapers.form.bloom')}>
            <Select value={form.bloom} onChange={(e) => setForm({ ...form, bloom: e.target.value })}>
              <option value="">{t('questionPapers.form.noBloom')}</option>
              {BLOOM_LEVELS.map((b) => <option key={b} value={b}>{L.bloom(b)}</option>)}
            </Select>
          </FormField>
        </div>
      </div>
    </Modal>
  )
}

// ───────────────────────────────────────────────────────── picking from the bank

/**
 * The bank of the paper's subject and class, of the section's type, to pick from by hand: by chapter, difficulty,
 * Bloom's level and words. `single`: one question for one place (a click picks it); otherwise tick several.
 */
export function BankPicker({ paper, section, single, saving, onClose, onPick }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const [filters, setFilters] = useState({ chapter: '', difficulty: '', bloom: '', search: '' })
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState([])
  useEffect(() => { const h = setTimeout(() => setFilters((f) => ({ ...f, search })), 300); return () => clearTimeout(h) }, [search])
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['qp-bank', paper.id, section.id, filters],
    queryFn: () => fetchPaperBank(paper.id, { sectionId: section.id, ...filters, pageSize: 50 }),
  })
  const rows = data?.rows ?? []
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal open onClose={onClose} size="xl" title={t('questionPapers.bank.title', { section: section.title, type: L.type(section.type) })} footer={!single && <>
      <Button variant="secondary" onClick={onClose}>{t('questionPapers.actions.cancel')}</Button>
      <Button icon={Library} loading={saving} disabled={!picked.length} onClick={() => onPick(picked)}>{t('questionPapers.bank.add', { count: picked.length })}</Button>
    </>}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-4 gap-2">
          <div className="relative sm:col-span-1">
            <Search className="absolute start-2.5 top-2.5 w-4 h-4 text-ink-faint" aria-hidden />
            <Input className="ps-8" value={search} placeholder={t('questionPapers.bank.search')} aria-label={t('questionPapers.bank.search')} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filters.chapter} onChange={set('chapter')} aria-label={t('questionPapers.bank.chapter')}>
            <option value="">{t('questionPapers.bank.anyChapter')}</option>
            {(paper.bank?.chapters ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.difficulty} onChange={set('difficulty')} aria-label={t('questionPapers.bank.difficulty')}>
            <option value="">{t('questionPapers.bank.anyDifficulty')}</option>
            {QP_DIFFICULTIES.map((d) => <option key={d} value={d}>{L.diff(d)}</option>)}
          </Select>
          <Select value={filters.bloom} onChange={set('bloom')} aria-label={t('questionPapers.bank.bloom')}>
            <option value="">{t('questionPapers.bank.anyBloom')}</option>
            {BLOOM_LEVELS.map((b) => <option key={b} value={b}>{L.bloom(b)}</option>)}
          </Select>
        </div>
        {single && <Note>{t('questionPapers.bank.clickToPick')}</Note>}
        <DataTable
          rows={rows}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          dense
          maxHeight="60vh"
          selectable={!single}
          selectedIds={picked}
          onSelectionChange={setPicked}
          onRowClick={single ? (r) => !r.inSets.length && onPick([r.id]) : undefined}
          columns={[
            { key: 'text', header: t('questionPapers.bank.question'), mobilePrimary: true, render: (_, r) => <QuestionBody q={r} answers /> },
            { key: 'chapter', header: t('questionPapers.bank.chapter'), render: (v) => (v ? <ColorChip label={v} dot /> : <span className="text-ink-faint">—</span>) },
            { key: 'difficulty', header: t('questionPapers.bank.difficulty'), render: (v, r) => <div className="flex flex-col gap-1 items-start"><Tag tone={diffTone(v)}>{L.diff(v)}</Tag>{r.bloom && <Tag>{L.bloom(r.bloom)}</Tag>}</div> },
            { key: 'marks', header: t('questionPapers.bank.marks'), align: 'right', render: (v) => <span className={clsx('tabular-nums', Number(v) !== Number(section.marks) && 'text-amber-700')}>{v}</span> },
            { key: 'used', header: t('questionPapers.bank.used'), align: 'right', render: (v, r) => (
              <div className="flex flex-col items-end gap-1">
                <span className="tabular-nums text-ink-muted">{t('questionPapers.bank.usedTimes', { count: v })}</span>
                {r.inSets.length > 0 && <Tag tone="warning">{t('questionPapers.bank.inSets', { sets: r.inSets.join(', ') })}</Tag>}
              </div>
            ) },
          ]}
          emptyIcon={Library}
          emptyTitle={t('questionPapers.bank.empty')}
          emptyHint={t('questionPapers.bank.emptyHint')}
        />
        {data && data.total > rows.length && <p className="text-xs text-ink-faint">{t('questionPapers.bank.more', { shown: rows.length, total: data.total })}</p>}
      </div>
    </Modal>
  )
}
