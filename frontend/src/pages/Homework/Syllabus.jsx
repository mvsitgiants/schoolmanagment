import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ClipboardPaste, ListChecks, Pencil, Plus, Save, X } from 'lucide-react'
import { parseSyllabusText } from '@schoolgiant/shared'
import { ColorChip, DataTable, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, ProgressBar, Tabs, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchSyllabus, fetchSyllabusOverview, markSyllabusTopics, saveSyllabus } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function PasteModal({ onClose, onAdd }) {
  const { t } = useTranslation('homework')
  const [text, setText] = useState('')
  const units = parseSyllabusText(text)
  const topics = units.reduce((n, u) => n + u.topics.length, 0)
  return (
    <Modal open onClose={onClose} size="lg" title={t('homework.syllabus.paste.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button disabled={!units.length} onClick={() => onAdd(units)}>{t('homework.syllabus.paste.add', { units: units.length, topics })}</Button>
    </>}>
      <div className="space-y-3">
        <Note>{t('homework.syllabus.paste.hint')}</Note>
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('homework.syllabus.paste.placeholder')} />
      </div>
    </Modal>
  )
}

/** Edit the units and topics. Existing ones keep their ids, so sections’ ticks stay. */
function Editor({ syllabus, onDone }) {
  const { t } = useTranslation('homework')
  const { showSuccess, showError } = useSnackbar()
  const qc = useQueryClient()
  const [units, setUnits] = useState(() => syllabus.units.map((u) => ({ ...u, topics: u.topics.map((x) => ({ ...x })) })))
  const [pasting, setPasting] = useState(false)
  const [errors, setErrors] = useState({})
  const setUnit = (i, v) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, name: v } : x)))
  const setTopic = (i, k, v) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, topics: x.topics.map((tp, m) => (m === k ? { ...tp, name: v } : tp)) } : x)))
  const addTopic = (i) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, topics: [...x.topics, { name: '' }] } : x)))
  const dropTopic = (i, k) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, topics: x.topics.filter((_, m) => m !== k) } : x)))
  const removedDone = syllabus.sections.some((s) => Object.keys(s.ticks).some((id) => !units.some((u) => u.topics.some((tp) => tp.id === id))))
  const save = useMutation({
    mutationFn: () => saveSyllabus({ classId: syllabus.classId, subjectId: syllabus.subjectId, units: units.map((u) => ({ id: u.id, name: u.name, topics: u.topics.filter((x) => x.name.trim()).map((x) => ({ id: x.id, name: x.name })) })).filter((u) => u.name.trim()) }),
    onSuccess: (d) => { qc.setQueryData(['syllabus', syllabus.classId, syllabus.subjectId], d); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }); showSuccess(t('homework.syllabus.saved')); onDone() },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setUnits((u) => [...u, { name: '', topics: [{ name: '' }] }])}>{t('homework.syllabus.addUnit')}</Button>
          <Button size="sm" variant="secondary" icon={ClipboardPaste} onClick={() => setPasting(true)}>{t('homework.syllabus.paste.button')}</Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>{t('actions.cancel')}</Button>
          <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()}>{t('homework.syllabus.save')}</Button>
        </div>
      </div>
      {removedDone && <Note tone="warning">{t('homework.syllabus.removedDone')}</Note>}
      {!units.length && <Note>{t('homework.syllabus.emptyEditor')}</Note>}
      {units.map((u, i) => (
        <Panel key={u.id ?? `new-${i}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-ink-faint w-14">{t('homework.syllabus.unitN', { n: i + 1 })}</span>
            <Input value={u.name} onChange={(e) => setUnit(i, e.target.value)} placeholder={t('homework.syllabus.unitName')} error={!!errors[`units.${i}.name`]} />
            <Button size="sm" variant="ghost" icon={X} aria-label={t('homework.syllabus.removeUnit')} onClick={() => setUnits((x) => x.filter((_, j) => j !== i))} />
          </div>
          <div className="space-y-2 ps-16">
            {u.topics.map((tp, k) => (
              <div key={tp.id ?? `n-${k}`} className="flex items-center gap-2">
                <Input value={tp.name} onChange={(e) => setTopic(i, k, e.target.value)} placeholder={t('homework.syllabus.topicName')} />
                <Button size="sm" variant="ghost" icon={X} aria-label={t('homework.syllabus.removeTopic')} onClick={() => dropTopic(i, k)} />
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => addTopic(i)}>{t('homework.syllabus.addTopic')}</Button>
          </div>
        </Panel>
      ))}
      {pasting && <PasteModal onClose={() => setPasting(false)} onAdd={(list) => { setUnits((u) => [...u, ...list]); setPasting(false) }} />}
    </div>
  )
}

function Detail({ classId, subjectId, onBack }) {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showError } = useSnackbar()
  const key = ['syllabus', classId, subjectId]
  const { data: syl, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchSyllabus(classId, subjectId) })
  const [sectionId, setSectionId] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (syl && !syl.sections.some((s) => s.id === sectionId)) setSectionId(syl.sections[0]?.id ?? '') }, [syl, sectionId])
  const tick = useMutation({
    mutationFn: ({ topicId, done }) => markSyllabusTopics({ sectionId, subjectId, topicIds: [topicId], done }),
    onSuccess: (d) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }) },
    onError: (e) => showError(e.message),
  })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('homework.loading')}</p>
  if (error || !syl) return <Note tone="warning">{error?.message}</Note>
  const sec = syl.sections.find((s) => s.id === sectionId)
  const canTick = hasPermission('homework.syllabus.edit') || hasPermission('homework.lesson-plans.edit')
  const canEdit = hasPermission('homework.syllabus.edit') && syl.canEditStructure

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('homework.syllabus.back')} />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{syl.className} · {syl.subject}</p>
            <p className="text-xs text-ink-muted">{t('homework.syllabus.counts', { units: syl.units.length, topics: syl.units.reduce((n, u) => n + u.topics.length, 0) })}{syl.updatedBy ? ` · ${t('homework.syllabus.updatedBy', { name: syl.updatedBy })}` : ''}</p>
          </div>
        </div>
        {!editing && canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>{syl.units.length ? t('homework.syllabus.edit') : t('homework.syllabus.create')}</Button>}
      </div>
      {editing ? <Editor syllabus={syl} onDone={() => setEditing(false)} /> : (
        <>
          {!syl.units.length && <Note>{canEdit ? t('homework.syllabus.noneYetEdit') : t('homework.syllabus.noneYet')}</Note>}
          {syl.sections.length > 1 && <Tabs value={sectionId} onChange={setSectionId} tabs={syl.sections.map((s) => ({ value: s.id, label: `${s.short} · ${s.pct}%` }))} />}
          {sec && syl.units.length > 0 && <>
            <div className="flex items-center gap-3"><span className="text-sm text-ink-muted">{t('homework.syllabus.sectionProgress', { section: sec.label, done: sec.done, topics: sec.topics })}</span><div className="flex-1 max-w-xs"><ProgressBar value={sec.pct} /></div></div>
            {syl.units.map((u, i) => {
              const pu = sec.perUnit.find((x) => x.id === u.id)
              return (
                <Panel key={u.id} title={u.name} subtitle={t('homework.syllabus.unitProgress', { done: pu?.done ?? 0, topics: u.topics.length })}>
                  <div className="divide-y divide-border">
                    {u.topics.map((tp) => {
                      const d = sec.ticks[tp.id]
                      return (
                        <label key={tp.id} className="flex items-center gap-3 py-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={!!d} disabled={!canTick || tick.isPending} onChange={(e) => tick.mutate({ topicId: tp.id, done: e.target.checked })} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                          <span className={`flex-1 ${d ? 'text-ink-muted line-through' : 'text-ink'}`}>{tp.name}</span>
                          {d && <span className="text-xs text-ink-faint">{date(d.date)}{d.by ? ` · ${d.by}` : ''}{d.fromPlan ? ` · ${t('homework.syllabus.fromPlan')}` : ''}</span>}
                        </label>
                      )
                    })}
                    {!u.topics.length && <p className="py-2 text-sm text-ink-faint">{t('homework.syllabus.noTopics', { n: i + 1 })}</p>}
                  </div>
                </Panel>
              )
            })}
          </>}
          {!syl.sections.length && <Note tone="warning">{t('homework.syllabus.noSections')}</Note>}
        </>
      )}
    </div>
  )
}

export default function Syllabus() {
  const { t } = useTranslation('homework')
  const [params, setParams] = useSearchParams()
  const classId = params.get('class')
  const subjectId = params.get('subject')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['syllabus-overview'], queryFn: fetchSyllabusOverview, enabled: !classId })
  return (
    <PageContainer>
      <PageHeader icon={ListChecks} title={t('homework.syllabus.title')} subtitle={t('homework.syllabus.subtitle')} />
      {classId && subjectId ? <Detail classId={classId} subjectId={subjectId} onBack={() => setParams({})} /> : (
        <DataTable
          rows={data?.rows ?? []}
          rowKey="key"
          loading={isLoading}
          error={error}
          onRetry={refetch}
          columns={[
            { key: 'className', header: t('homework.syllabus.class'), mobilePrimary: true, render: (v, r) => <div><div className="flex flex-wrap items-center gap-1"><ColorChip label={v} seed={r.classId} /><ColorChip label={r.subject} seed={r.subjectId} dot /></div><p className="text-xs text-ink-faint mt-1">{r.topics ? t('homework.syllabus.counts', { units: r.units, topics: r.topics }) : t('homework.syllabus.notSet')}</p></div> },
            { key: 'sections', header: t('homework.syllabus.progress'), clamp: false, render: (v, r) => (r.topics ? (
              <div className="flex flex-wrap gap-3">
                {v.map((s) => <div key={s.id} className="w-28"><p className="text-xs text-ink-muted mb-0.5">{s.short} · {s.done}/{s.topics}</p><ProgressBar value={s.pct} showValue={false} /></div>)}
              </div>
            ) : <span className="text-xs text-ink-faint">—</span>) },
          ]}
          onRowClick={(r) => setParams({ class: r.classId, subject: r.subjectId })}
          emptyIcon={ListChecks} emptyTitle={t('homework.syllabus.empty')} emptyHint={t('homework.syllabus.emptyHint')}
        />
      )}
    </PageContainer>
  )
}
