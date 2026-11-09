import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, ArrowDownLeft, ArrowUpRight, Bus, Cpu, Fingerprint, KeyRound, Link2, MapPin, Nfc, Pencil, Plus, Power, ScanFace, ScrollText, Send, Trash2, TriangleAlert, Unplug,
} from 'lucide-react'
import { DEVICE_KINDS, DEVICE_STATUSES, DEVICE_TYPE_LABEL, DEVICE_USED_FOR, PUNCH_OUTCOMES } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, ControlChip, DataTable, DateCell, Drawer, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, PersonCell, PillRow, Select,
  StackCell, StatCardRow, StatusPill, Tabs, Textarea, Toolbar, ViewControls, pillClass, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { DefinitionGrid, Switch } from '../../components/app/Controls'
import { CopyField, RevealOnceModal, errText, fieldErrors } from '../../components/integrations/IntegrationBits'
import {
  createDevice, createGpsUrl, deleteDevice, fetchDeviceOptions, fetchDevicePunches, fetchDevices, fetchIntegrationMeta, rotateDeviceKey, testDevicePunch, updateDevice,
} from '../../api/integrations'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const KIND_LOOK = { BIOMETRIC: { icon: Fingerprint, tone: 'violet' }, RFID: { icon: Nfc, tone: 'sky' }, FACE: { icon: ScanFace, tone: 'pink' }, GPS: { icon: Bus, tone: 'orange' } }
const kindLabel = (t, v) => t(`integrations.devices.kind.${v}`, { defaultValue: DEVICE_TYPE_LABEL[v] ?? v })
const usedForLabel = (t, v) => t(`integrations.devices.usedFor.${v}`, { defaultValue: DEVICE_USED_FOR.find((u) => u.value === v)?.label ?? v })
const statusLabel = (t, v) => (DEVICE_STATUSES[v] ? t(`integrations.devices.status.${v}`, { defaultValue: DEVICE_STATUSES[v].label }) : v)
const outcomeLabel = (t, v) => (PUNCH_OUTCOMES[v] ? t(`integrations.devices.outcome.${v}`, { defaultValue: PUNCH_OUTCOMES[v].label }) : v)
const pushUrl = (baseUrl, key) => `${baseUrl ?? ''}/api/v1/hooks/devices/${key}`

const SAMPLE = {
  STAFF: '{ "punches": [ { "code": "EMP001", "at": "2026-11-09T08:52:00+05:30", "direction": "IN" } ] }',
  STUDENTS: '{ "punches": [ { "code": "GV-2026-0142", "at": "2026-11-09T07:41:00+05:30", "direction": "IN" } ] }',
  GPS: '{ "positions": [ { "lat": 12.9716, "lng": 77.5946, "speed": 32, "at": "2026-11-09T07:41:00+05:30" } ] }',
}

const blank = { name: '', kind: 'BIOMETRIC', usedFor: 'STAFF', serialNo: '', branchId: '', location: '', vehicleId: '', autoMarkAttendance: false, notes: '' }

function DeviceModal({ device, options, onClose, onSaved }) {
  const { t } = useTranslation('integrations')
  const { showError } = useSnackbar()
  const [f, setF] = useState(device
    ? { name: device.name, kind: device.kind, usedFor: device.usedFor ?? 'STAFF', serialNo: device.serialNo ?? '', branchId: device.branchId ?? '', location: device.location ?? '', vehicleId: device.vehicleId ?? '', autoMarkAttendance: !!device.autoMarkAttendance, notes: device.notes ?? '' }
    : blank)
  const [errors, setErrors] = useState({})
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const gps = f.kind === 'GPS'
  const body = () => {
    const out = { name: f.name, serialNo: f.serialNo, branchId: f.branchId, location: f.location, notes: f.notes }
    if (!device) out.kind = f.kind
    if (gps) out.vehicleId = f.vehicleId
    else { out.usedFor = f.usedFor; out.autoMarkAttendance = f.usedFor === 'STUDENTS' && f.autoMarkAttendance }
    return out
  }
  const save = useMutation({
    mutationFn: () => (device ? updateDevice(device.id, body()) : createDevice(body())),
    onSuccess: onSaved,
    onError: (e) => { setErrors(fieldErrors(e)); showError(errText(e)) },
  })
  const pickKind = (kind) => setF((x) => ({ ...x, kind, usedFor: kind === 'RFID' ? 'STUDENTS' : kind === 'BIOMETRIC' ? 'STAFF' : x.usedFor }))
  return (
    <Modal open onClose={onClose} title={device ? t('integrations.devices.editTitle', { name: device.name }) : t('integrations.devices.addTitle')}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('integrations.common.cancel')}</Button>
        <Button loading={save.isPending} disabled={f.name.trim().length < 2 || (gps && !f.vehicleId)} onClick={() => save.mutate()}>{device ? t('integrations.common.save') : t('integrations.devices.addAndGetKey')}</Button>
      </>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <FormField label={t('integrations.devices.name')} required error={errors.name}><Input value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder={t('integrations.devices.namePlaceholder')} /></FormField>
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label={t('integrations.devices.kindCol')}>
            <Select value={f.kind} disabled={!!device} onChange={(e) => pickKind(e.target.value)}>{DEVICE_KINDS.map((k) => <option key={k} value={k}>{kindLabel(t, k)}</option>)}</Select>
          </FormField>
          {gps ? (
            <FormField label={t('integrations.devices.vehicle')} required error={errors.vehicleId}>
              <Select value={f.vehicleId} onChange={(e) => set('vehicleId', e.target.value)}>
                <option value="">{t('integrations.devices.pickVehicle')}</option>
                {(options?.vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.regNo}</option>)}
              </Select>
            </FormField>
          ) : (
            <FormField label={t('integrations.devices.usedForCol')}>
              <Select value={f.usedFor} onChange={(e) => set('usedFor', e.target.value)}>{DEVICE_USED_FOR.map((u) => <option key={u.value} value={u.value}>{usedForLabel(t, u.value)}</option>)}</Select>
            </FormField>
          )}
          <FormField label={t('integrations.devices.campus')} error={errors.branchId}>
            <Select value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>
              <option value="">{t('integrations.devices.anyCampus')}</option>
              {(options?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('integrations.devices.location')}><Input value={f.location} maxLength={120} onChange={(e) => set('location', e.target.value)} placeholder={gps ? t('integrations.devices.locationGps') : t('integrations.devices.locationPlaceholder')} /></FormField>
          <FormField label={t('integrations.devices.serialNo')} hint={gps ? t('integrations.devices.serialGpsHint') : undefined}><Input value={f.serialNo} maxLength={60} onChange={(e) => set('serialNo', e.target.value)} /></FormField>
        </div>
        {!gps && f.usedFor === 'STUDENTS' && (
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <Switch checked={f.autoMarkAttendance} onChange={(v) => set('autoMarkAttendance', v)} label={t('integrations.devices.autoMark')} />
            <p className="text-xs text-ink-muted">{t('integrations.devices.autoMarkHint')}</p>
          </div>
        )}
        <FormField label={t('integrations.devices.notes')}><Textarea rows={2} value={f.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} /></FormField>
        {!gps && <Note>{f.usedFor === 'STUDENTS' ? t('integrations.devices.studentsNote') : t('integrations.devices.staffNote')}</Note>}
      </form>
    </Modal>
  )
}

/** "Send a test punch": the device's whole path (code, time, direction) without saving attendance or a position. */
function TestPunch({ device, onDone }) {
  const { t } = useTranslation('integrations')
  const { showError } = useSnackbar()
  const [code, setCode] = useState('')
  const [direction, setDirection] = useState('IN')
  const [result, setResult] = useState(null)
  useEffect(() => { setResult(null); setCode('') }, [device.id])
  const run = useMutation({
    mutationFn: () => testDevicePunch(device.id, device.kind === 'GPS' ? {} : { code: code.trim() || undefined, direction }),
    onSuccess: (r) => { setResult(r); onDone?.() },
    onError: (e) => showError(errText(e)),
  })
  const gps = device.kind === 'GPS'
  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div>
        <p className="text-sm font-medium text-ink">{t('integrations.devices.testTitle')}</p>
        <p className="text-xs text-ink-muted">{gps ? t('integrations.devices.testGpsHint') : t('integrations.devices.testHint')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {!gps && (
          <>
            <FormField label={device.usedFor === 'STUDENTS' ? t('integrations.devices.cardOrAdmission') : t('integrations.devices.employeeCode')}>
              <Input className="!w-48" value={code} maxLength={60} onChange={(e) => setCode(e.target.value)} placeholder={t('integrations.devices.anyone')} />
            </FormField>
            <FormField label={t('integrations.devices.direction')}>
              <Select className="!w-24" value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="IN">{t('integrations.devices.dir.IN')}</option>
                <option value="OUT">{t('integrations.devices.dir.OUT')}</option>
              </Select>
            </FormField>
          </>
        )}
        <Button variant="secondary" icon={Send} loading={run.isPending} disabled={!device.active} onClick={() => run.mutate()}>{t('integrations.devices.sendTest')}</Button>
      </div>
      {result && (
        <Note tone={result.accepted ? 'success' : 'danger'}>
          {result.accepted ? t('integrations.devices.testOk') : t('integrations.devices.testFailed')}
          {(result.results ?? []).map((r, i) => (
            <span key={i} className="block text-xs mt-1">
              {[r.name ?? r.code, r.time, r.direction && t(`integrations.devices.dir.${r.direction}`), outcomeLabel(t, r.outcome)].filter(Boolean).join(' · ')}
            </span>
          ))}
          {(result.errors ?? []).map((e, i) => <span key={`e${i}`} className="block text-xs mt-1">{e.code ? `${e.code}: ` : ''}{e.message}</span>)}
        </Note>
      )}
    </div>
  )
}

function TodayPunches({ device, today }) {
  const { t } = useTranslation('integrations')
  const { data, isLoading } = useQuery({ queryKey: ['integrations', 'punches', 'device', device.id, today], queryFn: () => fetchDevicePunches({ deviceId: device.id, date: today, pageSize: 50 }), enabled: device.kind !== 'GPS' })
  if (device.kind === 'GPS') return null
  const rows = data?.data ?? []
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">{t('integrations.devices.punchesToday')} · {data?.meta?.total ?? 0}</p>
      {isLoading ? <div className="h-24 rounded-lg bg-black/5 animate-pulse" /> : !rows.length ? <p className="text-sm text-ink-faint">{t('integrations.devices.noPunchesToday')}</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-mono-num text-ink w-12">{p.time}</span>
              {p.direction === 'OUT' ? <ArrowUpRight className="w-4 h-4 text-ink-faint" aria-label={t('integrations.devices.dir.OUT')} /> : <ArrowDownLeft className="w-4 h-4 text-success-600" aria-label={t('integrations.devices.dir.IN')} />}
              <span className="flex-1 min-w-0 truncate text-ink">{p.personName ?? p.code}</span>
              <StatusPill tone={PUNCH_OUTCOMES[p.outcome]?.tone}>{outcomeLabel(t, p.outcome)}</StatusPill>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DevicesTab({ data, isLoading, meta, onOpen, onAdd }) {
  const { t } = useTranslation('integrations')
  return (
    <DataTable
      rows={data?.devices ?? []}
      loading={isLoading}
      onRowClick={onOpen}
      exportable
      exportName="devices"
      columns={[
        { key: 'name', header: t('integrations.devices.device'), mobilePrimary: true, sortable: true, render: (v, d) => <StackCell title={v} sub={[d.location, d.branchName].filter(Boolean).join(' · ') || d.serialNo || '—'} /> },
        { key: 'kind', header: t('integrations.devices.kindCol'), sortable: true, render: (v) => <ColorChip label={kindLabel(t, v)} {...KIND_LOOK[v]} /> },
        { key: 'usedFor', header: t('integrations.devices.usedForCol'), render: (v, d) => (d.kind === 'GPS' ? <span className="text-sm text-ink-muted">{d.vehicleRegNo ?? '—'}</span> : <span className="text-sm text-ink">{usedForLabel(t, v)}{d.autoMarkAttendance && <span className="block text-[11px] text-ink-faint">{t('integrations.devices.autoMarkShort')}</span>}</span>) },
        { key: 'status', header: t('integrations.common.status'), sortable: true, render: (v, d) => <div><StatusPill tone={DEVICE_STATUSES[v]?.tone}>{statusLabel(t, v)}</StatusPill>{v === 'ERROR' && d.lastError?.message && <p className="text-[11px] text-ink-faint line-clamp-1 mt-0.5">{d.lastError.message}</p>}</div> },
        { key: 'lastSeenAt', header: t('integrations.devices.lastSeen'), sortable: true, render: (v) => (v ? <DateCell value={v} time /> : <span className="text-ink-faint">—</span>) },
        { key: 'punchesToday', header: t('integrations.devices.today'), align: 'right', sortable: true, render: (v, d) => (d.kind === 'GPS' ? '—' : <span className="font-mono-num">{v}</span>) },
      ]}
      emptyIcon={Cpu}
      emptyTitle={t('integrations.devices.empty')}
      emptyHint={t('integrations.devices.emptyHint', { url: pushUrl(meta?.baseUrl, '…') })}
      emptyAction={<Button icon={Plus} requires="integrations.devices.create" onClick={onAdd}>{t('integrations.devices.add')}</Button>}
    />
  )
}

const OUTCOME_KEYS = Object.keys(PUNCH_OUTCOMES)

function PunchLog({ devices, today }) {
  const { t } = useTranslation('integrations')
  const [search, setSearch] = useState('')
  const [date, setDate] = useState(today)
  const [outcome, setOutcome] = useState('')
  const [who, setWho] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, date, outcome, who, deviceId])
  useEffect(() => { if (today && !date) setDate(today) }, [today]) // eslint-disable-line react-hooks/exhaustive-deps
  const params = { search: q, date: date || undefined, outcome: outcome || undefined, personType: who || undefined, deviceId: deviceId || undefined, page, pageSize: 50 }
  const { data, isLoading } = useQuery({ queryKey: ['integrations', 'punches', params], queryFn: () => fetchDevicePunches(params), placeholderData: (p) => p, refetchInterval: 30_000 })
  const meta = data?.meta
  const all = t('integrations.common.all')
  const whoOptions = [['STAFF', t('integrations.devices.staff')], ['STUDENT', t('integrations.devices.students')]]
  const named = (devices ?? []).filter((d) => d.kind !== 'GPS')
  return (
    <div className="space-y-3">
      <PillRow>
        {['ATTENDANCE', 'GATE', 'MARKED_PRESENT', 'UNKNOWN', 'SKIPPED'].map((k) => (
          <button key={k} type="button" aria-pressed={outcome === k} onClick={() => setOutcome(outcome === k ? '' : k)} className={pillClass(outcome === k)}>
            {outcomeLabel(t, k)} <span className="font-semibold text-ink">{meta?.byOutcome?.[k] ?? 0}</span>
          </button>
        ))}
      </PillRow>
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        exportable
        exportName="device-punches"
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('integrations.devices.searchPunches')} right={(
          <ViewControls>
            <Input type="date" aria-label={t('integrations.devices.date')} className="!h-8 !w-40" value={date} onChange={(e) => setDate(e.target.value)} />
            <ControlChip label={t('integrations.devices.who')} value={whoOptions.find(([k]) => k === who)?.[1] ?? all} active={!!who} options={[all, ...whoOptions.map(([, l]) => l)]} onChange={(v) => setWho(whoOptions.find(([, l]) => l === v)?.[0] ?? '')} />
            <ControlChip label={t('integrations.devices.device')} value={named.find((d) => d.id === deviceId)?.name ?? all} active={!!deviceId} options={[all, ...named.map((d) => d.name)]} onChange={(v) => setDeviceId(named.find((d) => d.name === v)?.id ?? '')} />
            <ControlChip label={t('integrations.devices.outcomeCol')} value={outcome ? outcomeLabel(t, outcome) : all} active={!!outcome} options={[all, ...OUTCOME_KEYS.map((k) => outcomeLabel(t, k))]} onChange={(v) => setOutcome(OUTCOME_KEYS.find((k) => outcomeLabel(t, k) === v) ?? '')} />
          </ViewControls>
        )} />}
        columns={[
          { key: 'at', header: t('integrations.common.when'), nowrap: true, width: 150, render: (v) => <DateCell value={v} time /> },
          { key: 'personName', header: t('integrations.devices.person'), mobilePrimary: true, render: (v, r) => <PersonCell name={v ?? t('integrations.devices.unknownPerson')} sub={`${r.personType === 'STUDENT' ? t('integrations.devices.student') : r.personType === 'STAFF' ? t('integrations.devices.staffOne') : ''} · ${r.code}`} size={26} /> },
          { key: 'direction', header: t('integrations.devices.direction'), render: (v) => (v ? <span className="inline-flex items-center gap-1 text-sm">{v === 'OUT' ? <ArrowUpRight className="w-4 h-4 text-ink-faint" /> : <ArrowDownLeft className="w-4 h-4 text-success-600" />}{t(`integrations.devices.dir.${v}`)}</span> : <span className="text-ink-faint">—</span>) },
          { key: 'deviceName', header: t('integrations.devices.device'), render: (v, r) => <ColorChip label={v} {...KIND_LOOK[r.kind]} /> },
          { key: 'outcome', header: t('integrations.devices.outcomeCol'), render: (v, r) => <div><StatusPill tone={PUNCH_OUTCOMES[v]?.tone}>{outcomeLabel(t, v)}</StatusPill>{r.note && <p className="text-[11px] text-ink-faint mt-0.5 line-clamp-2">{r.note}</p>}</div> },
        ]}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={ScrollText}
        emptyTitle={t('integrations.devices.noPunches')}
        emptyHint={t('integrations.devices.noPunchesHint')}
      />
    </div>
  )
}

function GpsTrackers({ data, isLoading }) {
  const { t } = useTranslation('integrations')
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const [url, setUrl] = useState(null)
  const make = useMutation({ mutationFn: createGpsUrl, onSuccess: (r) => { setUrl(r.url); qc.invalidateQueries({ queryKey: ['integrations', 'devices'] }) }, onError: (e) => showError(errText(e)) })
  const canMake = hasPermission('integrations.devices.create') || hasPermission('integrations.devices.edit')
  return (
    <div className="space-y-3">
      <Note icon={MapPin}><Trans t={t} i18nKey="integrations.devices.gpsNote" components={{ b: <b /> }} /></Note>
      {url ? <CopyField label={t('integrations.devices.gpsUrl')} value={url} hint={t('integrations.devices.gpsUrlHint')} /> : canMake && (
        <Button variant="secondary" icon={Link2} loading={make.isPending} onClick={() => make.mutate()}>{data?.gps?.hasUrl ? t('integrations.devices.showGpsUrl') : t('integrations.devices.makeGpsUrl')}</Button>
      )}
      <DataTable
        rows={data?.trackers ?? []}
        loading={isLoading}
        exportable
        exportName="gps-trackers"
        columns={[
          { key: 'regNo', header: t('integrations.devices.vehicle'), mobilePrimary: true, sortable: true, render: (v, r) => <StackCell title={v} sub={r.branchName ?? undefined} /> },
          { key: 'gpsDeviceId', header: t('integrations.devices.trackerId'), render: (v) => <CodeBadge>{v}</CodeBadge> },
          { key: 'status', header: t('integrations.common.status'), sortable: true, render: (v) => <StatusPill tone={DEVICE_STATUSES[v]?.tone}>{statusLabel(t, v)}</StatusPill> },
          { key: 'lastSeenAt', header: t('integrations.devices.lastPosition'), sortable: true, render: (v, r) => (v ? <div><DateCell value={v} time />{r.source && <p className="text-[11px] text-ink-faint">{t(`integrations.devices.source.${r.source}`, { defaultValue: r.source })}</p>}</div> : <span className="text-ink-faint">—</span>) },
        ]}
        emptyIcon={Bus}
        emptyTitle={t('integrations.devices.noTrackers')}
        emptyHint={t('integrations.devices.noTrackersHint')}
      />
    </div>
  )
}

/** Integrations › Devices: biometric and RFID devices with their push keys, the punch log, and the bus GPS trackers. */
export default function Devices() {
  const { t } = useTranslation('integrations')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [tab, setTab] = useState('devices')
  const [editing, setEditing] = useState(null) // null | 'new' | device
  const [openId, setOpenId] = useState(null)
  const [reveal, setReveal] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['integrations', 'devices'], queryFn: fetchDevices, refetchInterval: 30_000 })
  const { data: meta } = useQuery({ queryKey: ['integrations', 'meta'], queryFn: fetchIntegrationMeta, staleTime: 300_000 })
  const { data: options } = useQuery({ queryKey: ['integrations', 'device-options'], queryFn: fetchDeviceOptions, staleTime: 300_000, enabled: !!editing })
  const devices = data?.devices ?? []
  const open = devices.find((d) => d.id === openId) ?? null
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] })
  const rotate = useMutation({ mutationFn: (id) => rotateDeviceKey(id), onSuccess: (r) => { setReveal({ title: t('integrations.devices.newKeyFor', { name: r.device.name }), key: r.key, kind: r.device.kind }); refresh() }, onError: (e) => showError(errText(e)) })
  const toggle = useMutation({ mutationFn: (d) => updateDevice(d.id, { active: !d.active }), onSuccess: (d) => { refresh(); showSuccess(d.active ? t('integrations.devices.enabled') : t('integrations.devices.disabled')) }, onError: (e) => showError(errText(e)) })
  const remove = async (d) => {
    if (!(await confirm({ title: t('integrations.devices.removeTitle', { name: d.name }), message: t('integrations.devices.removeMsg'), tone: 'danger', confirmLabel: t('integrations.common.remove') }))) return
    try { await deleteDevice(d.id); setOpenId(null); refresh(); showSuccess(t('integrations.devices.removed')) } catch (e) { showError(errText(e)) }
  }
  const askRotate = async (d) => {
    if (await confirm({ title: t('integrations.devices.newKeyTitle', { name: d.name }), message: t('integrations.devices.newKeyMsg'), confirmLabel: t('integrations.devices.issueKey') })) rotate.mutate(d.id)
  }
  const count = (s) => devices.filter((d) => d.status === s).length
  const punches = devices.reduce((n, d) => n + (d.punchesToday ?? 0), 0)
  const trackersLive = (data?.trackers ?? []).filter((x) => x.status === 'OK').length
  const add = () => setEditing('new')

  return (
    <PageContainer>
      <PageHeader icon={Cpu} title={t('integrations.devices.title')} subtitle={t('integrations.devices.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="integrations.devices.create" onClick={add}>{t('integrations.devices.add')}</HeaderButton>} />
      <StatCardRow items={[
        { icon: Cpu, label: t('integrations.devices.devices'), value: devices.length, sub: t('integrations.devices.onlineCount', { count: count('OK') }), tone: 'brand' },
        { icon: Activity, label: t('integrations.devices.punchesToday'), value: punches, tone: 'success' },
        { icon: TriangleAlert, label: t('integrations.devices.needAttention'), value: count('ERROR') + count('IDLE'), sub: t('integrations.devices.neverCount', { count: count('NEVER') }), tone: count('ERROR') ? 'danger' : count('IDLE') ? 'warning' : 'teal' },
        { icon: Bus, label: t('integrations.devices.busTrackers'), value: (data?.trackers ?? []).length, sub: t('integrations.devices.liveCount', { count: trackersLive }), tone: 'orange', onClick: () => setTab('gps') },
      ]} />
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[
          { value: 'devices', label: t('integrations.devices.tabDevices') },
          { value: 'punches', label: t('integrations.devices.tabPunches') },
          { value: 'gps', label: t('integrations.devices.tabGps') },
        ]} />
        <div className="p-4 bg-bg/40 rounded-b-xl space-y-4">
          {tab === 'devices' && <DevicesTab data={data} isLoading={isLoading} meta={meta} onOpen={(d) => setOpenId(d.id)} onAdd={add} />}
          {tab === 'punches' && <PunchLog devices={devices} today={data?.today ?? ''} />}
          {tab === 'gps' && <GpsTrackers data={data} isLoading={isLoading} />}
        </div>
      </div>

      <Drawer open={!!open} onClose={() => setOpenId(null)} size="lg" subtitle={open ? kindLabel(t, open.kind) : undefined} title={open?.name}
        footer={open && (
          <div className="flex flex-wrap gap-2 w-full">
            <Button variant="secondary" icon={Pencil} requires="integrations.devices.edit" onClick={() => setEditing(open)}>{t('integrations.common.edit')}</Button>
            <Button variant="secondary" icon={KeyRound} requires="integrations.devices.edit" loading={rotate.isPending} onClick={() => askRotate(open)}>{t('integrations.devices.newKey')}</Button>
            <Button variant="ghost" icon={Power} requires="integrations.devices.edit" loading={toggle.isPending} onClick={() => toggle.mutate(open)}>{open.active ? t('integrations.devices.disable') : t('integrations.devices.enable')}</Button>
            <Button variant="ghost" icon={Trash2} requires="integrations.devices.delete" className="ms-auto text-danger-600" onClick={() => remove(open)}>{t('integrations.common.remove')}</Button>
          </div>
        )}>
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={DEVICE_STATUSES[open.status]?.tone}>{statusLabel(t, open.status)}</StatusPill>
              <ColorChip label={kindLabel(t, open.kind)} {...KIND_LOOK[open.kind]} />
            </div>
            {open.lastError?.message && open.status === 'ERROR' && <Note tone="danger">{dateTime(open.lastError.at)} — {open.lastError.message}</Note>}
            {open.status === 'NEVER' && <Note icon={Unplug}>{t('integrations.devices.neverNote')}</Note>}
            <DefinitionGrid items={[
              { label: t('integrations.devices.key'), value: open.keyHint, mono: true },
              { label: t('integrations.devices.keyIssued'), value: open.keyIssuedAt ? dateTime(open.keyIssuedAt) : null },
              { label: t('integrations.devices.lastSeen'), value: open.lastSeenAt ? `${dateTime(open.lastSeenAt)}${open.lastIp ? ` · ${open.lastIp}` : ''}` : null },
              { label: t('integrations.devices.receivedAcceptedRejected'), value: `${open.counts?.received ?? 0} / ${open.counts?.accepted ?? 0} / ${open.counts?.rejected ?? 0}`, mono: true },
              open.kind === 'GPS' ? { label: t('integrations.devices.vehicle'), value: open.vehicleRegNo } : { label: t('integrations.devices.usedForCol'), value: usedForLabel(t, open.usedFor) },
              open.usedFor === 'STUDENTS' && open.kind !== 'GPS' && { label: t('integrations.devices.autoMark'), value: open.autoMarkAttendance ? t('integrations.common.on') : t('integrations.common.off') },
              { label: t('integrations.devices.campus'), value: open.branchName },
              { label: t('integrations.devices.location'), value: open.location },
              { label: t('integrations.devices.serialNo'), value: open.serialNo, mono: true },
              open.notes && { label: t('integrations.devices.notes'), value: open.notes, full: true },
            ]} />
            <div className="space-y-2">
              <CopyField label={t('integrations.devices.endpoint')} value={pushUrl(meta?.baseUrl, `${open.keyHint.split('_••••')[0]}_…`)} hint={t('integrations.devices.endpointHint')} />
              <pre className="text-[11px] rounded-lg bg-bg border border-border p-2 overflow-x-auto text-ink-muted">{SAMPLE[open.kind === 'GPS' ? 'GPS' : open.usedFor] ?? SAMPLE.STAFF}</pre>
              <p className="text-[11px] text-ink-faint">{open.kind === 'GPS' ? t('integrations.devices.formatGps') : open.usedFor === 'STUDENTS' ? t('integrations.devices.formatStudents') : t('integrations.devices.formatStaff')}</p>
            </div>
            {hasPermission('integrations.devices.edit') && <TestPunch device={open} onDone={refresh} />}
            <TodayPunches device={open} today={data?.today} />
          </div>
        )}
      </Drawer>

      {editing && <DeviceModal device={editing === 'new' ? null : editing} options={options} onClose={() => setEditing(null)} onSaved={(r) => {
        setEditing(null); refresh()
        if (r.key) { setReveal({ title: t('integrations.devices.keyFor', { name: r.device.name }), key: r.key, kind: r.device.kind }); setOpenId(r.device.id) } else showSuccess(t('integrations.devices.saved'))
      }} />}
      <RevealOnceModal open={!!reveal} onClose={() => setReveal(null)} title={reveal?.title} secret={reveal?.key}>
        {reveal && <CopyField label={t('integrations.devices.pushTo')} value={pushUrl(meta?.baseUrl, reveal.key)} />}
        <p className="text-xs text-ink-muted">{t('integrations.devices.putKey')}</p>
      </RevealOnceModal>
    </PageContainer>
  )
}
