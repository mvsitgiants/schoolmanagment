import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, LogOut, Plus, Users } from 'lucide-react'
import { RIDE_MODES } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, PhoneLink, SearchInput, Select, StatCardRow, Textarea, localIso, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPicker from '../../components/fees/StudentPicker'
import { assignStudent, downloadAssignments, endAssignment, fetchAssignments, fetchRoutes } from '../../api/transport'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useTransportLabels } from '../../components/transport/TransportKit'

function AssignForm({ routes, preset, onClose, onSaved }) {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ studentId: preset?.studentId ?? '', routeId: preset?.routeId ?? routes[0]?.id ?? '', stopId: preset?.stopId ?? '', mode: preset?.mode ?? 'BOTH', from: localIso(new Date()), note: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'routeId' && { stopId: '' }) }))
  const route = routes.find((r) => r.id === form.routeId)
  const save = useMutation({ mutationFn: () => assignStudent(form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={preset ? t('transport.assign.moveTitle', { name: preset.student?.name }) : t('transport.assign.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !form.routeId || !form.stopId} onClick={() => save.mutate()}>{t('transport.assign.save')}</Button>
    </>}>
      <div className="space-y-3">
        {!preset && <StudentPicker value={form.studentId} onChange={(id) => setForm((f) => ({ ...f, studentId: id }))} error={errors.studentId} />}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label={t('transport.assign.route')} required error={errors.routeId}><Select value={form.routeId} onChange={set('routeId')}>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
          <FormField label={t('transport.assign.stop')} required error={errors.stopId}>
            <Select value={form.stopId} onChange={set('stopId')}>
              <option value="">{t('transport.assign.pickStop')}</option>
              {(route?.stops ?? []).map((s) => <option key={s.id} value={s.id}>{[s.name, s.pickupTime].filter(Boolean).join(' · ')}</option>)}
            </Select>
          </FormField>
          <FormField label={t('transport.assign.mode')}><Select value={form.mode} onChange={set('mode')}>{RIDE_MODES.map((m) => <option key={m.value} value={m.value}>{L.mode(m.value)}</option>)}</Select></FormField>
          <FormField label={t('transport.assign.from')} hint={preset ? t('transport.assign.fromMoveHint') : undefined}><Input type="date" value={form.from} onChange={set('from')} /></FormField>
        </div>
        <FormField label={t('transport.assign.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField>
      </div>
    </Modal>
  )
}

/** Transport › Student assignment: who rides which route from which stop; move, take off, export the list. */
export default function Assignments() {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [routeId, setRouteId] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [editing, setEditing] = useState(null)
  const { data: routes = [] } = useQuery({ queryKey: ['transport', 'routes'], queryFn: () => fetchRoutes() })
  const params = { ...(routeId && { routeId }), ...(q && { search: q }) }
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['transport', 'assignments', params], queryFn: () => fetchAssignments(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['transport'] })
  const end = useMutation({ mutationFn: (id) => endAssignment(id), onSuccess: () => { refresh(); showSuccess(t('transport.assign.ended')) }, onError: (e) => showError(e.message) })
  const route = routes.find((r) => r.id === routeId)
  const over = routes.filter((r) => r.vehicle?.capacity && r.students > r.vehicle.capacity)
  const canEdit = hasPermission('transport.assignments.edit')
  return (
    <PageContainer>
      <PageHeader icon={Users} title={t('transport.assign.title')} subtitle={t('transport.assign.subtitle')}
        actions={<>
          {hasPermission('transport.assignments.export') && <HeaderButton icon={Download} onClick={() => downloadAssignments(params).catch((e) => showError(e.message))}>{t('transport.assign.export')}</HeaderButton>}
          {routes.length > 0 && <HeaderButton icon={Plus} variant="primary" requires="transport.assignments.create" onClick={() => setEditing('new')}>{t('transport.assign.new')}</HeaderButton>}
        </>} />
      <div className="space-y-4">
        {!routes.length && <Note>{t('transport.assign.noRoutes')}</Note>}
        <StatCardRow items={[
          { label: t('transport.assign.riding'), value: routes.reduce((n, r) => n + r.students, 0) },
          { label: t('transport.assign.routesN'), value: routes.length },
          { label: t('transport.assign.overfull'), value: over.length, tone: over.length ? 'danger' : 'neutral' },
        ]} />
        {over.length > 0 && <Note tone="warning">{t('transport.assign.overNote', { list: over.map((r) => `${r.name} (${r.students}/${r.vehicle.capacity})`).join(', ') })}</Note>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64"><Select value={routeId} onChange={(e) => setRouteId(e.target.value)} aria-label={t('transport.assign.route')}><option value="">{t('transport.assign.allRoutes')}</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>
          <div className="w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('transport.assign.search')} /></div>
          {route?.vehicle && <span className="text-xs text-ink-muted">{t('transport.assign.routeLine', { reg: route.vehicle.regNo, count: route.students, seats: route.vehicle.capacity })}</span>}
        </div>
        <DataTable rows={rows} loading={isLoading} columns={[
          { key: 'student', header: t('transport.assign.student'), mobilePrimary: true, render: (v) => <span>{v?.name}<span className="block text-xs text-ink-faint">{[v?.className, v?.admissionNo].filter(Boolean).join(' · ')}</span></span> },
          { key: 'route', header: t('transport.assign.route'), render: (v, r) => <span>{v}<span className="block text-xs text-ink-faint">{r.stop}</span></span> },
          { key: 'pickupTime', header: t('transport.assign.times'), mobileHidden: true, render: (v, r) => [v, r.dropTime].filter(Boolean).join(' / ') || '—' },
          { key: 'mode', header: t('transport.assign.mode'), mobileHidden: true, render: (v) => L.mode(v) },
          { key: 'fee', header: t('transport.assign.fee'), align: 'right', mobileHidden: true, render: (v) => (v != null ? <Money value={v} paise /> : '—') },
          { key: 'guardian', header: t('transport.assign.parent'), mobileHidden: true, render: (_, r) => (r.student?.mobile ? <span>{r.student.guardian}<span className="block text-xs"><PhoneLink number={r.student.mobile} /></span></span> : '—') },
          { key: 'from', header: t('transport.assign.since'), mobileHidden: true, render: (v) => date(v) },
          { key: 'id', header: '', align: 'right', width: 60, render: (_, r) => canEdit && <Button size="sm" variant="ghost" icon={LogOut} aria-label={t('transport.assign.end')}
            onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('transport.assign.endConfirm', { name: r.student?.name }), confirmLabel: t('transport.assign.end'), tone: 'danger' })) end.mutate(r.id) }} /> },
        ]} onRowClick={canEdit ? (r) => setEditing(r) : undefined} emptyTitle={t('transport.assign.empty')} />
      </div>
      {editing && <AssignForm routes={routes} preset={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(r) => { setEditing(null); refresh(); if (r?.warning) showError(r.warning); else showSuccess(t('transport.assign.saved')) }} />}
    </PageContainer>
  )
}
