import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Siren } from 'lucide-react'
import { DataTable, FormField, Input, Modal, PageContainer, PageHeader, SegmentedControl, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { CodeTile, errText } from '../../components/comms/PagingBits'
import { fetchPageCodes, resetPageCode, savePageCode } from '../../api/comms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const HEX = /^#[0-9a-fA-F]{6}$/

function EditCode({ code, onClose }) {
  const { t } = useTranslation(['comms', 'common'])
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState({ label: '', meaning: '', color: '#000000', enabled: true })
  useEffect(() => { if (code) setF({ label: code.label, meaning: code.meaning, color: code.color, enabled: code.enabled }) }, [code])
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['comms', 'codes'] }); qc.invalidateQueries({ queryKey: ['paging', 'meta'] }); showSuccess(msg); onClose() }
  const save = useMutation({ mutationFn: () => savePageCode(code.code, f), onSuccess: (c) => done(t('codeSavedSuccess', { label: c.label })), onError: (e) => showError(errText(e)) })
  const reset = async () => {
    if (!(await confirm({ title: t('resetConfirmTitle', { label: code.defaults.label }), message: t('resetConfirmMessage'), confirmLabel: t('reset') }))) return
    try { await resetPageCode(code.code); done(t('codeResetSuccess', { label: code.defaults.label })) } catch (e) { showError(errText(e)) }
  }
  const ok = f.label.trim().length >= 2 && f.meaning.trim().length >= 2 && HEX.test(f.color)
  return (
    <Modal open={!!code} onClose={onClose} title={code ? t('editCodeTitle', { label: code.label }) : ''}
      footer={<>
        {code?.customised && <Button variant="ghost" icon={RotateCcw} onClick={reset}>{t('resetToDefault')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>{t('common:actions.save')}</Button>
      </>}>
      <div className="space-y-3.5">
        <div className="rounded-lg px-4 py-3 text-white" style={{ backgroundColor: HEX.test(f.color) ? f.color : '#000000' }}>
          <p className="text-[11px] uppercase tracking-widest font-semibold text-white/85">{t('preview')}</p>
          <p className="font-display text-2xl font-bold">{f.label || '—'}</p>
          <p className="text-sm text-white/90">{f.meaning}</p>
        </div>
        <FormField label={t('name')} required><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={40} /></FormField>
        <FormField label={t('whatItMeans')} required><Input value={f.meaning} onChange={(e) => setF({ ...f, meaning: e.target.value })} maxLength={80} /></FormField>
        <FormField label={t('colour')} hint={t('colourHint')}>
          <div className="flex items-center gap-2">
            <div className="w-14 shrink-0"><Input type="color" value={HEX.test(f.color) ? f.color : '#000000'} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label={t('pickAColour')} className="px-1 py-1 cursor-pointer" /></div>
            <div className="w-32"><Input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value.trim() })} maxLength={7} className="font-mono-num" aria-label={t('colourCode')} /></div>
          </div>
        </FormField>
        <FormField label={t('inUse')}>
          <SegmentedControl value={f.enabled ? 'on' : 'off'} onChange={(v) => setF({ ...f, enabled: v === 'on' })} options={[{ value: 'on', label: t('on') }, { value: 'off', label: t('off') }]} />
        </FormField>
      </div>
    </Modal>
  )
}

/** Emergency alerts: each institution's own names, meanings and colours for the product alerts. */
export default function Codes() {
  const { t } = useTranslation(['comms', 'common'])
  const [editing, setEditing] = useState(null)
  const { data: codes = [], isLoading } = useQuery({ queryKey: ['comms', 'codes'], queryFn: fetchPageCodes })
  const canEdit = hasPermission('comms.codes.edit')
  return (
    <PageContainer>
      <PageHeader icon={Siren} title={t('emergencyCodesTitle')} subtitle={t('emergencyCodesSubtitle')} />
      <DataTable title={t('codes')} rows={codes} loading={isLoading} rowKey="code" onRowClick={canEdit ? setEditing : undefined}
        columns={[
          { key: 'label', header: t('code'), mobilePrimary: true, sortable: true, render: (v, r) => (
            <span className="flex items-center gap-2.5 min-w-0">
              <CodeTile color={r.color} size={30} />
              <span className="min-w-0">
                <span className="block font-medium text-ink truncate">{v}</span>
                <span className="block text-[11px] text-ink-faint font-mono-num">{r.code}</span>
              </span>
            </span>
          ) },
          { key: 'meaning', header: t('means'), sortable: true },
          { key: 'enabled', header: t('inUse'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('on') : t('off')}</StatusPill> },
          { key: 'customised', header: t('wording'), mobileHidden: true, render: (v, r) => (v ? <span className="text-sm text-ink-muted">{t('edited', { defaultLabel: r.defaults.label })}</span> : <span className="text-sm text-ink-faint">{t('default')}</span>) },
          { key: 'actions', header: '', render: (_, r) => (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" requires="comms.codes.edit" onClick={() => setEditing(r)}>{t('common:actions.edit')}</Button>
            </div>
          ) },
        ]}
        emptyIcon={Siren} emptyTitle={t('noCodes')} />
      <EditCode code={editing} onClose={() => setEditing(null)} />
    </PageContainer>
  )
}
