import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, SquareParking, Trash2 } from 'lucide-react'
import { PARKING_AREA_FOR, PARKING_VEHICLE_KINDS } from '@schoolgiant/shared'
import { EmptyState, FormField, Input, Modal, PageContainer, PageHeader, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { AreaFill, useParkingLabels } from '../../components/parking/ParkingKit'
import { deleteParkingArea, fetchParkingAreas, fetchParkingMeta, saveParkingArea } from '../../api/parking'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

function AreaForm({ area, meta, onClose, onSaved }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const { showError } = useSnackbar()
  const pickCampus = !area && (meta?.branches?.length ?? 0) > 1 && !meta?.branchLocked
  const [f, setF] = useState(() => ({ branchId: '', name: area?.name ?? '', for: area?.for ?? 'ANY', kinds: area?.kinds ?? [], capacity: area?.capacity ?? '', note: area?.note ?? '', active: area?.active ?? true }))
  const [errors, setErrors] = useState({})
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const toggleKind = (k) => set({ kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] })
  const save = useMutation({
    mutationFn: () => saveParkingArea(area?.id, { ...f, capacity: Number(f.capacity) || 0 }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e?.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={area ? t('parking.areas.editTitle', { name: area.name }) : t('parking.areas.newTitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('parking.common.cancel')}</Button><Button loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>{t('parking.common.save')}</Button></>}>
      <div className="space-y-3">
        {pickCampus && (
          <FormField label={t('parking.areas.campus')} error={errors.branchId}>
            <Select value={f.branchId} onChange={(e) => set({ branchId: e.target.value })}>
              <option value="">{meta.branches.find((b) => b.isDefault)?.name ?? meta.branches[0].name}</option>
              {meta.branches.filter((b) => !b.isDefault).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </FormField>
        )}
        <FormField label={t('parking.areas.name')} required error={errors.name}><Input autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('parking.areas.nameHint')} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('parking.areas.for')}>
            <Select value={f.for} onChange={(e) => set({ for: e.target.value })}>{PARKING_AREA_FOR.map((a) => <option key={a.value} value={a.value}>{L.areaFor(a.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('parking.areas.capacity')} hint={t('parking.areas.capacityHint')} error={errors.capacity}>
            <Input type="number" min="0" inputMode="numeric" value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} />
          </FormField>
        </div>
        <FormField label={t('parking.areas.kinds')} hint={t('parking.areas.kindsHint')}>
          <div className="flex flex-wrap gap-2">
            {PARKING_VEHICLE_KINDS.map((k) => (
              <button key={k.value} type="button" aria-pressed={f.kinds.includes(k.value)} onClick={() => toggleKind(k.value)}
                className={`rounded-full border px-3 py-1 text-sm ${f.kinds.includes(k.value) ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:border-brand-300'}`}>{L.kind(k.value)}</button>
            ))}
          </div>
        </FormField>
        <FormField label={t('parking.form.note')}><Textarea rows={2} value={f.note} onChange={(e) => set({ note: e.target.value })} /></FormField>
        {area && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> {t('parking.areas.inUse')}
          </label>
        )}
      </div>
    </Modal>
  )
}

/** Parking › Areas: where vehicles park and how many each place holds. */
export default function ParkingAreas() {
  const { t } = useTranslation('parking')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [form, setForm] = useState(null)
  const { data: areas = [], isLoading, error, refetch } = useQuery({ queryKey: ['parking', 'areas', 'all'], queryFn: () => fetchParkingAreas(true) })
  const { data: meta } = useQuery({ queryKey: ['parking', 'meta'], queryFn: fetchParkingMeta, staleTime: 300_000 })
  const campuses = (meta?.branches?.length ?? 0) > 1 && !meta?.branchLocked
  const campusOf = (a) => (meta?.branches ?? []).find((b) => (a.branchId ? b.id === a.branchId : b.isDefault))?.name
  const refresh = () => qc.invalidateQueries({ queryKey: ['parking'] })
  const remove = useMutation({ mutationFn: (a) => deleteParkingArea(a.id), onSuccess: () => { refresh(); showSuccess(t('parking.areas.deleted')) }, onError: (e) => showError(e.message) })
  const del = async (a) => {
    if (await confirm({ title: t('parking.areas.deleteTitle', { name: a.name }), message: t('parking.areas.deleteHint'), tone: 'danger', confirmLabel: t('parking.common.delete') })) remove.mutate(a)
  }
  return (
    <PageContainer>
      <PageHeader icon={SquareParking} title={t('parking.areas.title')} subtitle={t('parking.areas.subtitle')}
        actions={hasPermission('parking.areas.create') && <Button icon={Plus} onClick={() => setForm({ area: null })}>{t('parking.areas.add')}</Button>} />
      {error && <EmptyState error={error} onRetry={refetch} />}
      {!isLoading && !areas.length && <EmptyState icon={SquareParking} title={t('parking.areas.empty')} hint={t('parking.areas.emptyHint')} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map((a) => (
          <div key={a.id} className={a.active ? '' : 'opacity-60'}>
            <AreaFill area={a} />
            <div className="mt-1.5 flex items-center gap-2 px-1 text-xs text-ink-muted">
              <span>{[campuses && campusOf(a), a.for !== 'VISITOR' && t('parking.areas.passes', { count: a.passes })].filter(Boolean).join(' · ')}</span>
              {!a.active && <StatusPill tone="neutral">{t('parking.areas.off')}</StatusPill>}
              <span className="ms-auto flex gap-1">
                {hasPermission('parking.areas.edit') && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm({ area: a })}>{t('parking.common.edit')}</Button>}
                {hasPermission('parking.areas.delete') && <Button size="sm" variant="ghost" icon={Trash2} className="text-danger-600" onClick={() => del(a)}>{t('parking.common.delete')}</Button>}
              </span>
            </div>
          </div>
        ))}
      </div>
      {form && <AreaForm area={form.area} meta={meta} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); showSuccess(t('parking.areas.saved')) }} />}
    </PageContainer>
  )
}
