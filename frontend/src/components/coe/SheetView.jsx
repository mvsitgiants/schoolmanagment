import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Eye, EyeOff, Lock, LockOpen, Save, Scale, ShieldCheck, X } from 'lucide-react'
import { COE_MODERATION_STATUS, internalTotalOf } from '@schoolgiant/shared'
import { CodeBadge, DataTable, FormField, Input, Modal, Note, PersonCell, Select, StatCardRow, StatusPill, Textarea, usePrompt } from '../system'
import Button from '../ui/Button'
import { Switch } from '../app/Controls'
import { decideModeration, fetchSheet, lockSheet, proposeModeration, saveSheet, unlockSheet } from '../../api/coe'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function ModerationModal({ sheet, onClose, onSaved }) {
  const { t } = useTranslation('coe')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ kind: 'ADD', value: '', reason: '' })
  const save = useMutation({ mutationFn: () => proposeModeration(sheet.id, { kind: form.kind, value: Number(form.value), reason: form.reason }), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('coe.moderation.title', { code: sheet.course.code })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!(Number(form.value) > 0) || form.reason.trim().length < 3} onClick={() => save.mutate()}>{t('coe.moderation.propose')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('coe.moderation.kind')}>
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="ADD">{t('coe.moderationKinds.ADD')}</option>
            <option value="SCALE">{t('coe.moderationKinds.SCALE')}</option>
          </Select>
        </FormField>
        <FormField label={form.kind === 'SCALE' ? t('coe.moderation.percent') : t('coe.moderation.marks')} hint={t('coe.moderation.valueHint')}>
          <Input type="number" min="0" max="20" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        </FormField>
        <div className="sm:col-span-2"><FormField label={t('coe.moderation.reason')} required><Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></FormField></div>
      </div>
      <p className="mt-3 text-xs text-ink-faint">{t('coe.moderation.note')}</p>
    </Modal>
  )
}

/** One mark sheet: internal (a row per student, a box per component) or external (a row per dummy number). */
export default function SheetView({ sheetId, onBack }) {
  const { t } = useTranslation('coe')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [reveal, setReveal] = useState(false)
  const [moderating, setModerating] = useState(false)
  const key = ['coe-sheet', sheetId, reveal]
  const { data: sheet, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchSheet(sheetId, reveal) })
  const [rows, setRows] = useState({})
  useEffect(() => {
    if (sheet) setRows(Object.fromEntries(sheet.entries.map((e) => [e.id, { components: { ...(e.components ?? {}) }, marks: e.marks ?? '', absent: !!e.absent }])))
  }, [sheet])
  const internal = sheet?.part === 'INTERNAL'
  const setComp = (id, code, v) => setRows((r) => ({ ...r, [id]: { ...r[id], components: { ...r[id].components, [code]: v } } }))
  const setField = (id, k, v) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }))
  const after = (msg) => () => { qc.invalidateQueries({ queryKey: ['coe-sheet', sheetId] }); qc.invalidateQueries({ queryKey: ['coe-board'] }); showSuccess(msg) }
  const payload = () => sheet.entries.map((e) => {
    const r = rows[e.id] ?? {}
    return internal
      ? { studentId: e.studentId, absent: !!r.absent, components: Object.fromEntries(Object.entries(r.components ?? {}).map(([k, v]) => [k, v === '' ? null : Number(v)])) }
      : { dummyNo: e.dummyNo, absent: !!r.absent, marks: r.marks === '' ? null : Number(r.marks) }
  })
  const dirty = sheet && sheet.entries.some((e) => {
    const r = rows[e.id]
    if (!r) return false
    if (!!r.absent !== !!e.absent) return true
    if (internal) return sheet.components.some((c) => String(r.components?.[c.code] ?? '') !== String(e.components?.[c.code] ?? ''))
    return String(r.marks ?? '') !== String(e.marks ?? '')
  })
  const save = useMutation({ mutationFn: () => saveSheet(sheetId, payload()), onSuccess: after(t('coe.sheet.saved')), onError: (e) => showError(e.message) })
  const lock = useMutation({ mutationFn: async () => { if (dirty) await saveSheet(sheetId, payload()); return lockSheet(sheetId) }, onSuccess: after(t('coe.sheet.locked')), onError: (e) => showError(e.message) })
  const unlock = useMutation({ mutationFn: (reason) => unlockSheet(sheetId, reason), onSuccess: after(t('coe.sheet.unlocked')), onError: (e) => showError(e.message) })
  const decide = useMutation({ mutationFn: (approve) => decideModeration(sheetId, approve), onSuccess: after(t('coe.moderation.decided')), onError: (e) => showError(e.message) })

  const totals = useMemo(() => {
    if (!sheet || !internal) return {}
    return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, r.absent ? 0 : internalTotalOf(r.components, sheet.components, sheet.maxMarks)]))
  }, [rows, sheet, internal])

  if (isLoading) return <p className="text-sm text-ink-faint">{t('coe.loading')}</p>
  if (error || !sheet) return <Note tone="warning">{error?.message}</Note>
  const ro = !sheet.canEdit
  const filled = sheet.entries.filter((e) => { const r = rows[e.id]; return r && (r.absent || (internal ? Object.values(r.components ?? {}).some((v) => v !== '' && v !== null && v !== undefined) : r.marks !== '' && r.marks !== null)) }).length
  const mod = sheet.moderation
  const columns = [
    internal || !sheet.masked
      ? { key: 'name', header: t('coe.sheet.student'), sortable: true, render: (v, e) => <PersonCell name={v} sub={e.registerNo || e.admissionNo} /> }
      : { key: 'dummyNo', header: t('coe.sheet.dummyNo'), sortable: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
    ...(!internal && !sheet.masked ? [{ key: 'dummyNo', header: t('coe.sheet.dummyNo'), render: (v) => <CodeBadge>{v}</CodeBadge> }] : []),
    ...(internal
      ? sheet.components.map((c) => ({
        key: c.code, header: `${c.code} (${c.maxMarks})`, width: 96,
        render: (_, e) => <Input type="number" min="0" max={c.maxMarks} step="0.5" value={rows[e.id]?.components?.[c.code] ?? ''} disabled={ro || rows[e.id]?.absent}
          onChange={(ev) => setComp(e.id, c.code, ev.target.value)} aria-label={`${e.name} ${c.code}`} className={Number(rows[e.id]?.components?.[c.code]) > c.maxMarks ? 'border-danger-500' : ''} />,
      }))
      : [{
        key: 'marks', header: t('coe.sheet.marksOutOf', { max: sheet.maxMarks }), width: 130,
        render: (_, e) => <Input type="number" min="0" max={sheet.maxMarks} step="0.5" value={rows[e.id]?.marks ?? ''} disabled={ro || rows[e.id]?.absent}
          onChange={(ev) => setField(e.id, 'marks', ev.target.value)} aria-label={e.dummyNo} className={Number(rows[e.id]?.marks) > sheet.maxMarks ? 'border-danger-500' : ''} />,
      }]),
    {
      key: 'absent', header: t('coe.sheet.absent'), width: 90,
      render: (_, e) => <Switch size="sm" checked={!!rows[e.id]?.absent} disabled={ro} onChange={(v) => setField(e.id, 'absent', v)} label={t('coe.sheet.absent')} />,
    },
    internal
      ? { key: 'total', header: t('coe.sheet.totalOutOf', { max: sheet.maxMarks }), align: 'right', render: (_, e) => <span className="font-semibold">{totals[e.id] ?? '—'}</span> }
      : { key: 'moderated', header: t('coe.sheet.afterModeration'), align: 'right', render: (v) => (mod?.status === 'APPROVED' && v !== null ? <span className="font-semibold text-brand-700">{v}</span> : <span className="text-ink-faint">—</span>) },
  ]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('coe.sheet.back')} />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{sheet.course.code} · {sheet.course.title}</p>
            <p className="text-xs text-ink-faint">{t(`coe.parts.${sheet.part}`)} · {sheet.sessionName}{sheet.enteredBy ? ` · ${t('coe.sheet.lastSaved', { by: sheet.enteredBy, at: dateTime(sheet.enteredAt) })}` : ''}</p>
          </div>
          <StatusPill tone={sheet.status === 'LOCKED' ? 'success' : 'warning'}>{t(`coe.sheetStatus.${sheet.status}`)}</StatusPill>
        </div>
        <div className="flex flex-wrap gap-2">
          {sheet.canReveal && <Button size="sm" variant="ghost" icon={reveal ? EyeOff : Eye} onClick={() => setReveal((v) => !v)}>{reveal ? t('coe.sheet.mask') : t('coe.sheet.reveal')}</Button>}
          {!internal && sheet.canEdit && (!mod || mod.status !== 'PROPOSED') && <Button size="sm" variant="secondary" icon={Scale} onClick={() => setModerating(true)}>{t('coe.moderation.open')}</Button>}
          {sheet.canEdit && <Button size="sm" variant="secondary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>}
          {sheet.canLock && <Button size="sm" icon={Lock} loading={lock.isPending} onClick={() => lock.mutate()}>{t('coe.sheet.lock')}</Button>}
          {sheet.canUnlock && <Button size="sm" variant="secondary" icon={LockOpen} onClick={async () => { const r = await prompt({ title: t('coe.sheet.unlockTitle'), label: t('coe.sheet.unlockReason'), required: true }); if (r) unlock.mutate(r) }}>{t('coe.sheet.unlock')}</Button>}
        </div>
      </div>
      {!internal && sheet.masked && <Note tone="info" icon={ShieldCheck}>{t('coe.sheet.maskedNote')}</Note>}
      {mod && (
        <Note tone={COE_MODERATION_STATUS[mod.status]?.tone === 'success' ? 'success' : mod.status === 'REJECTED' ? 'danger' : 'warning'} icon={Scale}
          actions={mod.status === 'PROPOSED' && sheet.canLock && <div className="flex gap-2">
            <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate(true)}>{t('coe.moderation.approve')}</Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => decide.mutate(false)}>{t('coe.moderation.reject')}</Button>
          </div>}>
          {t('coe.moderation.summary', { what: mod.kind === 'SCALE' ? t('coe.moderation.scaleBy', { v: mod.value }) : t('coe.moderation.addBy', { v: mod.value }), reason: mod.reason, by: mod.proposedBy })}
          {' · '}{t(`coe.moderationStatus.${mod.status}`)}{mod.decidedBy ? ` (${mod.decidedBy})` : ''}
        </Note>
      )}
      <StatCardRow items={[
        { label: t('coe.sheet.scripts'), value: sheet.entries.length, tone: 'brand' },
        { label: t('coe.sheet.entered'), value: `${filled} / ${sheet.entries.length}`, tone: filled === sheet.entries.length ? 'success' : 'warning', progress: sheet.entries.length ? (filled / sheet.entries.length) * 100 : 0 },
        { label: t('coe.sheet.absentCount'), value: Object.values(rows).filter((r) => r.absent).length, tone: 'danger' },
      ]} />
      <DataTable dense rows={sheet.entries} rowKey="id" columns={columns} maxHeight="65vh" exportable exportName={`${sheet.course.code}-${sheet.part.toLowerCase()}`}
        emptyTitle={t('coe.sheet.empty')} />
      {moderating && <ModerationModal sheet={sheet} onClose={() => setModerating(false)} onSaved={() => { setModerating(false); after(t('coe.moderation.proposed'))() }} />}
    </div>
  )
}
