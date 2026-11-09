import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { GraduationCap, Grid3x3, ListChecks, Pencil, Plus, Save, Target, X } from 'lucide-react'
import { NBA_PROGRAM_OUTCOMES, OBE_BLOOM_LEVELS } from '@schoolgiant/shared'
import {
  ColorChip, DataTable, EmptyState, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, Select, SideNav, SideNavLayout, StatCardRow, Textarea,
} from '../../components/system'
import Button from '../../components/ui/Button'
import HeatGrid, { HeatLegend } from '../../components/programs/HeatGrid'
import useProgramList from '../../components/programs/useProgramList'
import { fetchOutcomes, saveCourseOutcomes, saveProgramOutcomes } from '../../api/programs'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

function ProgramOutcomesForm({ programId, outcomes, onClose, onSaved }) {
  const { t } = useTranslation('programs')
  const { showError } = useSnackbar()
  const [rows, setRows] = useState(() => outcomes.map((o) => ({ ...o })))
  const setRow = (i, k) => (e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))
  const nextCode = (kind) => `${kind}${rows.filter((r) => (kind === 'PSO' ? r.code?.startsWith('PSO') : r.code?.startsWith('PO'))).length + 1}`
  const save = useMutation({
    mutationFn: () => saveProgramOutcomes(programId, rows.filter((r) => r.code && r.title).map((r) => ({ code: r.code, title: r.title, description: r.description || undefined }))),
    onSuccess: onSaved,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="xl" title={t('programs.outcomes.editPos')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="flex flex-wrap gap-2 mb-3">
        <Button size="sm" variant="secondary" onClick={() => setRows((r) => [...NBA_PROGRAM_OUTCOMES.filter((p) => !r.some((x) => x.code === p.code)), ...r].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })))}>{t('programs.outcomes.loadNba')}</Button>
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows((r) => [...r, { code: nextCode('PO'), title: '' }])}>{t('programs.outcomes.addPo')}</Button>
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows((r) => [...r, { code: nextCode('PSO'), title: '' }])}>{t('programs.outcomes.addPso')}</Button>
      </div>
      <DataTable dense rows={rows.map((r, i) => ({ ...r, i, id: String(i) }))} emptyTitle={t('programs.outcomes.noPos')} columns={[
        { key: 'code', header: t('programs.outcomes.code'), width: 100, render: (_, r) => <Input value={r.code} onChange={setRow(r.i, 'code')} maxLength={5} aria-label={t('programs.outcomes.code')} /> },
        { key: 'title', header: t('programs.outcomes.titleCol'), render: (_, r) => <Input value={r.title} onChange={setRow(r.i, 'title')} maxLength={120} aria-label={t('programs.outcomes.titleCol')} /> },
        { key: 'x', header: '', width: 44, render: (_, r) => <Button size="sm" variant="ghost" icon={X} aria-label={t('programs.remove')} onClick={() => setRows((x) => x.filter((_, j) => j !== r.i))} /> },
      ]} />
    </Modal>
  )
}

/** One course: its COs (statement, Bloom level), the CO–PO heat map (click to change) and which IA component assesses which CO. */
function CourseEditor({ course, pos, components, canEdit, onSaved }) {
  const { t } = useTranslation('programs')
  const { showError, showSuccess } = useSnackbar()
  const [cos, setCos] = useState(course.outcomes)
  const [map, setMap] = useState(course.coPo)
  const [comp, setComp] = useState(course.componentCos)
  useEffect(() => { setCos(course.outcomes); setMap(course.coPo); setComp(course.componentCos) }, [course])
  const level = (co, po) => map.find((m) => m.co === co && m.po === po)?.level ?? 0
  const cycle = (r, c) => {
    const next = (level(r.key, c.key) + 1) % 4
    setMap((m) => [...m.filter((x) => !(x.co === r.key && x.po === c.key)), ...(next ? [{ co: r.key, po: c.key, level: next }] : [])])
  }
  const covers = (component, co) => {
    const row = comp.find((x) => x.component === component)
    return !row || !row.cos?.length || row.cos.includes(co)
  }
  const toggleCover = (component, co) => setComp((list) => {
    const row = list.find((x) => x.component === component)
    const current = !row || !row.cos?.length ? cos.map((c) => c.code) : row.cos
    const next = current.includes(co) ? current.filter((x) => x !== co) : [...current, co]
    return [...list.filter((x) => x.component !== component), { component, cos: next.length === cos.length ? [] : next }]
  })
  const setCo = (i, k) => (e) => setCos((list) => list.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)))
  const dirty = JSON.stringify([cos, map, comp]) !== JSON.stringify([course.outcomes, course.coPo, course.componentCos])
  const save = useMutation({
    mutationFn: () => saveCourseOutcomes(course.id, { outcomes: cos.filter((c) => c.statement?.trim()), coPo: map, componentCos: comp }),
    onSuccess: () => { showSuccess(t('programs.outcomes.saved')); onSaved() },
    onError: (e) => showError(e.message),
  })
  const rows = cos.map((c) => ({ key: c.code, label: c.code, sub: OBE_BLOOM_LEVELS.find((b) => b.value === c.bloom) ? t(`programs.bloom.${c.bloom}`) : '', hint: c.statement }))
  const avg = (r) => {
    const v = map.filter((m) => m.co === r.key && m.level > 0)
    return v.length ? Math.round((v.reduce((n, m) => n + m.level, 0) / v.length) * 10) / 10 : null
  }
  return (
    <Panel title={`${course.code} · ${course.title}`} subtitle={t('programs.semesterN', { n: course.semester })} icon={Target}
      actions={canEdit && <Button size="sm" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>}>
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-ink">{t('programs.outcomes.courseOutcomes')}</p>
            {canEdit && <Button size="sm" variant="ghost" icon={Plus} disabled={cos.length >= 12} onClick={() => setCos((l) => [...l, { code: `CO${l.length + 1}`, statement: '', bloom: 'L2' }])}>{t('programs.outcomes.addCo')}</Button>}
          </div>
          {cos.length === 0 ? <p className="text-sm text-ink-faint">{t('programs.outcomes.noCos')}</p> : (
            <div className="space-y-2">
              {cos.map((c, i) => (
                <div key={i} className="grid grid-cols-[64px_1fr_140px_36px] gap-2 items-start">
                  <span className="pt-2"><ColorChip label={c.code} seed={c.code} /></span>
                  {canEdit ? <Textarea rows={1} value={c.statement} onChange={setCo(i, 'statement')} placeholder={t('programs.outcomes.statementPlaceholder')} aria-label={t('programs.outcomes.statement')} />
                    : <p className="pt-2 text-sm text-ink">{c.statement}</p>}
                  <Select value={c.bloom} onChange={setCo(i, 'bloom')} disabled={!canEdit} aria-label={t('programs.outcomes.bloom')}>
                    {OBE_BLOOM_LEVELS.map((b) => <option key={b.value} value={b.value}>{b.value} · {t(`programs.bloom.${b.value}`)}</option>)}
                  </Select>
                  {canEdit && <Button size="sm" variant="ghost" icon={X} aria-label={t('programs.remove')} onClick={() => {
                    setCos((l) => l.filter((_, j) => j !== i))
                    setMap((m) => m.filter((x) => x.co !== c.code))
                  }} />}
                </div>
              ))}
            </div>
          )}
        </div>
        {cos.length > 0 && pos.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-ink">{t('programs.outcomes.matrix')}</p>
            <p className="text-xs text-ink-faint mb-2">{canEdit ? t('programs.outcomes.matrixHint') : t('programs.outcomes.matrixHintRo')}</p>
            <HeatGrid rows={rows} columns={pos.map((p) => ({ key: p.code, label: p.code, hint: p.title }))} rowHeader={t('programs.outcomes.co')}
              value={(r, c) => level(r.key, c.key)} format={(v) => (v ? v : '')} onCell={canEdit ? cycle : undefined}
              footer={{ label: t('programs.outcomes.avg'), value: avg }} />
            <div className="mt-2"><HeatLegend items={[t('programs.outcomes.l0'), t('programs.outcomes.l1'), t('programs.outcomes.l2'), t('programs.outcomes.l3')]} /></div>
          </div>
        )}
        {cos.length > 0 && components.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-ink">{t('programs.outcomes.assessedBy')}</p>
            <p className="text-xs text-ink-faint mb-2">{t('programs.outcomes.assessedByHint')}</p>
            <div className="space-y-1.5">
              {components.map((k) => (
                <div key={k.code} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-28 text-sm text-ink-muted truncate" title={k.name}>{k.code} · {k.maxMarks}</span>
                  {cos.map((c) => {
                    const on = covers(k.code, c.code)
                    return (
                      <button key={c.code} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => toggleCover(k.code, c.code)}
                        className={on ? 'rounded-md bg-brand-500/15 px-2 py-0.5 text-xs font-semibold text-brand-700' : 'rounded-md border border-border px-2 py-0.5 text-xs text-ink-faint'}>
                        {c.code}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

export default function Outcomes() {
  const { t } = useTranslation('programs')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { programs, programId, setProgramId, isLoading } = useProgramList()
  const [courseId, setCourseId] = useState('')
  const [editPos, setEditPos] = useState(false)
  const key = ['outcomes', programId]
  const { data: board, isLoading: loadingBoard, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchOutcomes(programId), enabled: !!programId })
  const canEdit = hasPermission('programs.outcomes.edit')
  useEffect(() => { if (board && !board.courses.some((c) => c.id === courseId)) setCourseId(board.courses[0]?.id ?? '') }, [board, courseId])
  const course = board?.courses.find((c) => c.id === courseId)
  const pos = board?.outcomes ?? []
  const stats = useMemo(() => {
    if (!board) return null
    const withCos = board.courses.filter((c) => c.outcomes.length).length
    const mapped = board.courses.filter((c) => c.coPo.length).length
    const covered = pos.filter((p) => board.coverage[p.code]?.courses).length
    return { withCos, mapped, covered, cos: board.courses.reduce((n, c) => n + c.outcomes.length, 0) }
  }, [board, pos])
  // program view: per course, the strongest CO link to each PO
  const courseLevel = (c, po) => {
    const v = c.coPo.filter((m) => m.po === po).map((m) => m.level)
    return v.length ? Math.max(...v) : 0
  }

  if (!isLoading && !programs.length) {
    return (
      <PageContainer>
        <PageHeader icon={ListChecks} title={t('programs.outcomes.title')} subtitle={t('programs.outcomes.subtitle')} />
        <EmptyState icon={GraduationCap} title={t('programs.programs.emptyTitle')} hint={t('programs.outcomes.noProgramsHint')} />
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      <PageHeader icon={ListChecks} title={t('programs.outcomes.title')} subtitle={t('programs.outcomes.subtitle')} />
      <SideNavLayout nav={<SideNav title={t('programs.programs.list')} value={programId} onChange={setProgramId}
        items={programs.map((p) => ({ id: p.id, label: p.name, hint: p.code, count: p.coCount || undefined, icon: GraduationCap }))} />}>
        {loadingBoard && <p className="text-sm text-ink-faint">{t('programs.loading')}</p>}
        {error && <EmptyState error={error} onRetry={refetch} />}
        {board && (
          <>
            <StatCardRow items={[
              { icon: Target, tone: 'brand', label: t('programs.outcomes.statPos'), value: pos.length, sub: t('programs.outcomes.statPosSub', { psos: pos.filter((p) => p.kind === 'PSO').length }) },
              { icon: ListChecks, tone: 'violet', label: t('programs.outcomes.statCos'), value: stats.cos, sub: t('programs.outcomes.statCosSub', { done: stats.withCos, total: board.courses.length }), progress: board.courses.length ? (stats.withCos / board.courses.length) * 100 : 0 },
              { icon: Grid3x3, tone: 'teal', label: t('programs.outcomes.statMapped'), value: `${stats.mapped} / ${board.courses.length}`, sub: t('programs.outcomes.statMappedSub'), progress: board.courses.length ? (stats.mapped / board.courses.length) * 100 : 0 },
              { icon: Target, tone: stats.covered === pos.length ? 'success' : 'warning', label: t('programs.outcomes.statCovered'), value: `${stats.covered} / ${pos.length}`, sub: t('programs.outcomes.statCoveredSub') },
            ]} />
            <Panel title={t('programs.outcomes.programOutcomes')} subtitle={t('programs.outcomes.programOutcomesHint')}
              actions={canEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditPos(true)}>{t('actions.edit')}</Button>}>
              {pos.length === 0 ? (
                <EmptyState icon={Target} title={t('programs.outcomes.noPos')} hint={t('programs.outcomes.noPosHint')}
                  action={canEdit && <Button icon={Plus} onClick={() => setEditPos(true)}>{t('programs.outcomes.addPos')}</Button>} />
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {pos.map((p) => (
                    <div key={p.code} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                      <ColorChip label={p.code} seed={p.kind} />
                      <div className="min-w-0">
                        <p className="text-sm text-ink">{p.title}</p>
                        <p className="text-[11px] text-ink-faint">{t('programs.outcomes.coverage', { courses: board.coverage[p.code]?.courses ?? 0, strength: board.coverage[p.code]?.strength ?? 0 })}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            {board.courses.length === 0 ? (
              <Note tone="info">{t('programs.outcomes.noCourses')}</Note>
            ) : pos.length > 0 && (
              <Panel title={t('programs.outcomes.programMatrix')} subtitle={t('programs.outcomes.programMatrixHint')} icon={Grid3x3}>
                <HeatGrid rows={board.courses.map((c) => ({ key: c.id, label: c.code, sub: c.title, hint: c.title }))} columns={pos.map((p) => ({ key: p.code, label: p.code, hint: p.title }))}
                  rowHeader={t('programs.outcomes.course')} value={(r, c) => courseLevel(board.courses.find((x) => x.id === r.key), c.key)} format={(v) => (v ? v : '')}
                  onCell={(r) => setCourseId(r.key)} />
              </Panel>
            )}
            {board.courses.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <FormField label={t('programs.outcomes.course')}>
                  <Select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="min-w-[280px]">
                    {board.courses.map((c) => <option key={c.id} value={c.id}>{`${t('programs.semShort', { n: c.semester })} · ${c.code} · ${c.title}`}{c.outcomes.length ? ` (${t('programs.outcomes.coCount', { n: c.outcomes.length })})` : ''}</option>)}
                  </Select>
                </FormField>
              </div>
            )}
            {course && <CourseEditor key={course.id} course={course} pos={pos} components={board.iaComponents} canEdit={canEdit} onSaved={() => qc.invalidateQueries({ queryKey: key })} />}
          </>
        )}
      </SideNavLayout>
      {editPos && board && <ProgramOutcomesForm programId={programId} outcomes={pos} onClose={() => setEditPos(false)}
        onSaved={() => { setEditPos(false); showSuccess(t('programs.outcomes.posSaved')); qc.invalidateQueries({ queryKey: key }) }} />}
    </PageContainer>
  )
}
