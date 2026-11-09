import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowUpRight, ClipboardCheck, MessageSquareQuote, PenLine, RefreshCw, Save, Sparkles, Trophy, Users } from 'lucide-react'
import { REMARK_LENGTHS, REMARK_TONES } from '@schoolgiant/shared'
import {
  ColorChip, ControlChip, DataTable, Input, LevelBar, Note, PageContainer, PageHeader, PctCell, PersonCell, SegmentedControl, StatCardRow, Tag, Textarea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import AiGate from '../../components/ai/AiGate'
import { draftRemarks, fetchRemarkStudents, fetchRemarksSetup, saveAiRemarks } from '../../api/ai'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const NS = 'ai'
const NO_ROWS = []

/** Change since the previous exam: ▲ 4.5 / ▼ 2. */
function Change({ value }) {
  const { t } = useTranslation(NS)
  if (value === null || value === undefined) return null
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span title={t('ai.remarks.changeHint')} className={up ? 'inline-flex items-center text-xs font-semibold text-emerald-700 tabular-nums' : 'inline-flex items-center text-xs font-semibold text-rose-600 tabular-nums'}>
      <Icon className="w-3.5 h-3.5" aria-hidden />{Math.abs(value)}
    </span>
  )
}

function RemarksBoard() {
  const { t } = useTranslation(NS)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const canDraft = hasPermission('ai.remarks.create')
  const canSave = canDraft && (hasPermission('exams.marks.create') || hasPermission('exams.report-cards.publish'))
  const [examId, setExamId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [tone, setTone] = useState('WARM')
  const [length, setLength] = useState('SHORT')
  const [includeRank, setIncludeRank] = useState(false)
  const [note, setNote] = useState('')
  const [texts, setTexts] = useState({})
  const [drafted, setDrafted] = useState({}) // candidateId → the AI's text (to label it "AI draft" until edited)
  const [busyRows, setBusyRows] = useState([])

  const setup = useQuery({ queryKey: ['ai-remarks-setup', examId], queryFn: () => fetchRemarksSetup(examId) })
  useEffect(() => { if (!examId && setup.data?.examId) setExamId(setup.data.examId) }, [setup.data, examId])
  const sections = useMemo(() => setup.data?.sections ?? [], [setup.data])
  useEffect(() => { if (setup.data && !sections.some((s) => s.id === sectionId)) setSectionId(sections[0]?.id ?? '') }, [setup.data, sections, sectionId])
  const exams = setup.data?.exams ?? []
  const exam = exams.find((e) => e.id === examId)

  const key = ['ai-remark-students', examId, sectionId]
  const students = useQuery({ queryKey: key, queryFn: () => fetchRemarkStudents(examId, sectionId), enabled: !!examId && !!sectionId })
  const rows = students.data?.rows ?? NO_ROWS
  useEffect(() => { setTexts(Object.fromEntries(rows.map((r) => [r.candidateId, r.remark ?? '']))); setDrafted({}) }, [rows])

  const changed = rows.filter((r) => (texts[r.candidateId] ?? '') !== (r.remark ?? ''))
  const waiting = rows.filter((r) => drafted[r.candidateId] && texts[r.candidateId] === drafted[r.candidateId] && texts[r.candidateId] !== r.remark).length

  const applyDrafts = (drafts) => {
    setTexts((x) => ({ ...x, ...Object.fromEntries(drafts.map((d) => [d.candidateId, d.remark])) }))
    setDrafted((x) => ({ ...x, ...Object.fromEntries(drafts.map((d) => [d.candidateId, d.remark])) }))
  }
  const body = { examId, sectionId, tone, length, includeRank, note: note.trim() || undefined }
  const draftAll = useMutation({
    mutationFn: () => draftRemarks(body),
    onSuccess: (r) => { applyDrafts(r.drafts); showSuccess(t('ai.remarks.drafted', { count: r.drafts.length })) },
    onError: (e) => showError(e.message),
  })
  const redraft = async (row) => {
    setBusyRows((x) => [...x, row.candidateId])
    try {
      const r = await draftRemarks({ ...body, candidateIds: [row.candidateId] })
      applyDrafts(r.drafts)
    } catch (e) {
      showError(e.message)
    } finally {
      setBusyRows((x) => x.filter((id) => id !== row.candidateId))
    }
  }
  const save = useMutation({
    mutationFn: () => saveAiRemarks({ examId, sectionId, remarks: changed.map((r) => ({ candidateId: r.candidateId, remark: (texts[r.candidateId] ?? '').trim() })) }),
    onSuccess: () => { showSuccess(t('ai.remarks.saved', { count: changed.length })); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['exam-candidates'] }) },
    onError: (e) => showError(e.message),
  })

  const startDraftAll = async () => {
    const written = rows.filter((r) => (texts[r.candidateId] ?? '').trim()).length
    if (written && !(await confirm({ title: t('ai.remarks.replaceTitle'), message: t('ai.remarks.replaceMessage', { count: written }), confirmLabel: t('ai.remarks.replace') }))) return
    draftAll.mutate()
  }

  const s = students.data?.summary
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ControlChip icon={ClipboardCheck} label={t('ai.remarks.exam')} value={exam?.name ?? '—'} active={!!exam} options={exams.map((e) => e.name)}
            onChange={(v) => { setExamId(exams.find((e) => e.name === v)?.id ?? ''); setSectionId('') }} />
          <ControlChip icon={Users} label={t('ai.remarks.section')} value={sections.find((x) => x.id === sectionId)?.label ?? '—'} active={!!sectionId} options={sections.map((x) => x.label)}
            onChange={(v) => setSectionId(sections.find((x) => x.label === v)?.id ?? '')} />
          <ControlChip icon={Trophy} label={t('ai.remarks.rank')} value={includeRank ? t('ai.remarks.rankOn') : t('ai.remarks.rankOff')} active={includeRank} caret={false} onClick={() => setIncludeRank((x) => !x)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl options={REMARK_TONES.map((v) => ({ value: v, label: t(`ai.remarks.tones.${v}`) }))} value={tone} onChange={setTone} />
          <SegmentedControl options={REMARK_LENGTHS.map((v) => ({ value: v, label: t(`ai.remarks.lengths.${v}`) }))} value={length} onChange={setLength} />
        </div>
      </div>

      {setup.data?.examsOff && <Note tone="warning">{t('ai.remarks.examsOff')}</Note>}
      {setup.data && !setup.data.examsOff && !exams.length && <Note>{t('ai.remarks.noExams')}</Note>}

      {s && (
        <StatCardRow items={[
          { icon: Users, label: t('ai.remarks.stats.students'), value: s.students, tone: 'brand' },
          { icon: Trophy, label: t('ai.remarks.stats.average'), value: s.average === null || s.average === undefined ? '—' : `${s.average}%`, sub: t('ai.remarks.stats.passFail', { passed: s.passed, failed: s.failed }), tone: 'violet' },
          { icon: MessageSquareQuote, label: t('ai.remarks.stats.saved'), value: `${s.withRemark}/${s.students}`, progress: s.students ? (s.withRemark / s.students) * 100 : 0, tone: 'success' },
          { icon: Sparkles, label: t('ai.remarks.stats.drafts'), value: waiting, sub: changed.length ? t('ai.remarks.stats.unsaved', { count: changed.length }) : t('ai.remarks.stats.allSaved'), tone: waiting ? 'warning' : 'sky' },
        ]} />
      )}

      <Note icon={Sparkles}>{t('ai.remarks.how')}</Note>

      <DataTable
        rows={rows}
        rowKey="candidateId"
        loading={students.isLoading && !!sectionId}
        error={students.error}
        onRetry={students.refetch}
        title={t('ai.remarks.tableTitle')}
        toolbar={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Input className="w-64 max-w-full" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t('ai.remarks.notePlaceholder')} aria-label={t('ai.remarks.notePlaceholder')} />
            {canDraft && <Button icon={Sparkles} loading={draftAll.isPending} disabled={!rows.length} onClick={startDraftAll}>{t('ai.remarks.draftAll', { count: rows.length })}</Button>}
            {canSave && <Button variant={changed.length ? 'primary' : 'secondary'} icon={Save} loading={save.isPending} disabled={!changed.length} onClick={() => save.mutate()}>{t('ai.remarks.saveAll', { count: changed.length })}</Button>}
          </div>
        )}
        columns={[
          { key: 'rollNo', header: t('ai.remarks.cols.roll'), width: 56, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
          { key: 'name', header: t('ai.remarks.cols.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
          { key: 'pct', header: t('ai.remarks.cols.result'), render: (v, r) => (v === null || v === undefined ? <span className="text-ink-faint">—</span> : (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <LevelBar bare value={v} max={100} width="w-12" dangerAt={r.result === 'FAIL' ? 100 : undefined} />
              <span className={r.result === 'FAIL' ? 'font-semibold tabular-nums text-danger-600' : 'font-semibold tabular-nums text-ink'}>{v}%</span>
              {r.grade && <ColorChip label={r.grade} seed={`grade-${r.grade}`} mono />}
              <Change value={r.change} />
            </div>
          )) },
          { key: 'attendancePct', header: t('ai.remarks.cols.attendance'), mobileHidden: true, render: (v) => <PctCell value={v} /> },
          { key: 'subjects', header: t('ai.remarks.cols.subjects'), mobileHidden: true, render: (subs) => {
            const marked = (subs ?? []).filter((x) => x.pct !== null && x.pct !== undefined).sort((a, b) => b.pct - a.pct)
            if (!marked.length) return <span className="text-ink-faint">—</span>
            const best = marked[0]
            const worst = marked.length > 1 ? marked.at(-1) : null
            return (
              <div className="flex flex-col gap-1">
                <Tag tone="success" title={t('ai.remarks.strongest')}>{best.subject} · {best.pct}%</Tag>
                {worst && <Tag tone="warning" title={t('ai.remarks.weakest')}>{worst.subject} · {worst.pct}%</Tag>}
              </div>
            )
          } },
          { key: 'remark', header: t('ai.remarks.cols.remark'), clamp: false, render: (_, r) => {
            const text = texts[r.candidateId] ?? ''
            const isDraft = drafted[r.candidateId] && text === drafted[r.candidateId] && text !== r.remark
            const isEdited = text !== (r.remark ?? '') && !isDraft
            return (
              <div className="min-w-[16rem] space-y-1" onClick={(e) => e.stopPropagation()}>
                {canDraft || canSave
                  ? <Textarea rows={3} value={text} maxLength={300} onChange={(e) => setTexts((x) => ({ ...x, [r.candidateId]: e.target.value }))} placeholder={t('ai.remarks.placeholder')} aria-label={t('ai.remarks.cols.remark')} />
                  : <p className="text-sm text-ink-muted">{text || '—'}</p>}
                <div className="flex items-center gap-1.5 min-h-5">
                  {isDraft && <Tag tone="violet" icon={Sparkles}>{t('ai.remarks.aiDraft')}</Tag>}
                  {isEdited && <Tag tone="warning" icon={PenLine}>{t('ai.remarks.unsaved')}</Tag>}
                  {!isDraft && !isEdited && r.remark && <Tag tone="success">{t('ai.remarks.savedBy', { name: r.remarkBy ?? '—' })}</Tag>}
                  <span className="ms-auto text-[11px] text-ink-faint tabular-nums">{text.length}/300</span>
                </div>
              </div>
            )
          } },
          { key: 'candidateId', header: '', align: 'right', width: 56, render: (_, r) => canDraft && (
            <Button size="sm" variant="ghost" icon={RefreshCw} loading={busyRows.includes(r.candidateId)} disabled={draftAll.isPending}
              aria-label={t('ai.remarks.redraft')} title={t('ai.remarks.redraft')} onClick={(e) => { e.stopPropagation(); redraft(r) }} />
          ) },
        ]}
        emptyIcon={MessageSquareQuote}
        emptyTitle={sectionId ? t('ai.remarks.empty') : t('ai.remarks.pickFirst')}
        emptyHint={t('ai.remarks.emptyHint')}
      />
    </>
  )
}

/** AI › Report card remarks: Claude drafts each student's remark from their results; the class teacher edits and saves. */
export default function Remarks() {
  const { t } = useTranslation(NS)
  return (
    <PageContainer>
      <PageHeader icon={MessageSquareQuote} title={t('ai.remarks.title')} subtitle={t('ai.remarks.subtitle')} />
      <AiGate feature="remarks">
        <RemarksBoard />
      </AiGate>
    </PageContainer>
  )
}
