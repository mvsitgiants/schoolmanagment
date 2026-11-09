import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Building2, Clock, PhoneCall, Search, Siren, X } from 'lucide-react'
import { PAGE_PRIORITIES, PAGE_TARGET_TYPES } from '@schoolgiant/shared'
import { Avatar, FormField, Input, Modal, SegmentedControl, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { createPageCall, fetchPagingMeta, searchPagingDirectory } from '../../api/comms'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useRealtime } from '../../context/RealtimeContext'
import { CodeTile, errText } from './PagingBits'

// The full call form (Call bell page): ring a person, a role, a department or — for those
// allowed (`comms.calls.broadcast`) — everyone, or send an emergency alert. Answers come back
// live. Everyday calling is the floating dock (CommsDock → dock/CallTab).

const blank = () => ({
  type: 'USER', people: [], roleId: '', deptId: '',
  priority: 'ROUTINE', code: '', branchId: '', room: '', place: '', message: '', recent: null,
})

function Chip({ active, disabled, onClick, title, children }) {
  return (
    <button type="button" disabled={disabled} title={title} onClick={onClick}
      className={clsx(
        'h-8 px-3 rounded-full border text-sm font-medium transition-colors whitespace-nowrap',
        active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink hover:bg-bg',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-surface',
      )}>
      {children}
    </button>
  )
}

function PersonSearch({ value, onChange }) {
  const { t } = useTranslation(['comms', 'common'])
  const [q, setQ] = useState('')
  const debounced = useDebouncedValue(q.trim(), 250)
  const { isOnline } = useRealtime()
  const { data: rows = [], isFetching } = useQuery({ queryKey: ['paging', 'directory', debounced], queryFn: () => searchPagingDirectory(debounced), staleTime: 15_000 })
  const picked = new Set(value.map((p) => p.id))
  const toggle = (u) => onChange(picked.has(u.id) ? value.filter((p) => p.id !== u.id) : [...value, { id: u.id, name: u.name }].slice(0, 10))
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 h-7 ps-0.5 pe-1 rounded-full bg-brand-50 text-brand-700 text-xs font-medium">
              <Avatar name={p.name} size={24} />
              {p.name}
              <button type="button" aria-label={t('callComposerRemovePerson', { name: p.name })} onClick={() => toggle(p)} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-brand-100"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('personSearchPlaceholder')} className="ps-9" aria-label={t('findPersonAria')} autoFocus />
      </div>
      <ul className="max-h-48 overflow-y-auto scroll-thin rounded-lg border border-border divide-y divide-border">
        {!debounced && rows.length === 0 && <li className="px-3 py-3 text-xs text-ink-muted">{isFetching ? t('looking') : t('personSearchEmptyHint')}</li>}
        {debounced && rows.length === 0 && !isFetching && <li className="px-3 py-3 text-xs text-ink-muted">{t('nobodyFound')}</li>}
        {rows.map((u) => {
          const online = u.online || isOnline(u.id)
          return (
            <li key={u.id}>
              <button type="button" onClick={() => toggle(u)} className={clsx('w-full text-start flex items-center gap-2.5 px-3 py-1.5 hover:bg-bg', picked.has(u.id) && 'bg-brand-50/60')}>
                <span className="relative shrink-0">
                  <Avatar name={u.name} size={30} />
                  <span className={clsx('absolute bottom-0 end-0 w-2.5 h-2.5 rounded-full ring-2 ring-surface', online ? 'bg-success-500' : 'bg-border')} title={online ? t('online') : t('offline')} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink font-medium truncate">{u.name}</span>
                  <span className="block text-[11px] text-ink-faint truncate">{[u.designation, ...(u.departments ?? [])].filter(Boolean).join(' · ') || '—'}</span>
                </span>
                {picked.has(u.id) && <span className="text-[11px] font-semibold text-brand-700">{t('added')}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The compose form. `open` mounts it fresh each time. */
export function CallModal({ open, onClose, onSent }) {
  const { t } = useTranslation(['comms', 'common'])
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState(blank)
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const { data: meta } = useQuery({ queryKey: ['paging', 'meta'], queryFn: fetchPagingMeta, enabled: open, staleTime: 30_000 })
  useEffect(() => { if (open) setF(blank()) }, [open])
  const branches = meta?.branches ?? []
  // the caller's campus by default (the server does the same when none is sent)
  useEffect(() => { if (open && !f.branchId && branches.length > 1) set({ branchId: meta?.myBranchId ?? branches.find((b) => b.isDefault)?.id ?? '' }) }, [open, meta]) // eslint-disable-line react-hooks/exhaustive-deps
  const codes = (meta?.codes ?? []).filter((c) => c.enabled)
  const isCode = f.priority === 'CODE'

  const types = PAGE_TARGET_TYPES.filter((ty) => !ty.broadcast || meta?.canBroadcast)

  const target = useMemo(() => {
    if (f.recent) return f.recent
    switch (f.type) {
      case 'USER': return f.people.length ? { type: 'USER', ids: f.people.map((p) => p.id) } : null
      case 'ROLE': return f.roleId ? { type: 'ROLE', ids: [f.roleId] } : null
      case 'DEPARTMENT': return f.deptId ? { type: 'DEPARTMENT', ids: [f.deptId] } : null
      case 'EVERYONE': return { type: 'EVERYONE', ids: [] }
      default: return null
    }
  }, [f])

  const hasPlace = !!(f.room.trim() || f.place.trim())
  const ok = !!target && (!isCode || (f.code && hasPlace))

  const send = useMutation({
    mutationFn: () => createPageCall({
      target,
      priority: f.priority,
      code: isCode ? f.code : undefined,
      location: { branchId: f.branchId || undefined, room: f.room.trim() || undefined, text: f.place.trim() || undefined },
      message: f.message,
    }),
    onSuccess: (call) => {
      const what = call.priority === 'CODE' ? call.codeLabel : t('call')
      showSuccess(t('callSentSuccess', { label: what, count: call.recipients?.length ?? 0, callNo: call.callNo }))
      qc.invalidateQueries({ queryKey: ['paging'] })
      onSent?.(call)
      onClose()
    },
    onError: (e) => showError(errText(e)),
  })

  const pickPriority = (priority) => {
    if (priority === 'CODE') set({ priority, code: f.code || codes[0]?.code || '', ...(f.recent || f.type === 'USER' ? { type: 'EVERYONE', recent: null } : {}) })
    else set({ priority, ...(f.type === 'EVERYONE' && !meta?.canBroadcast ? { type: 'USER' } : {}) })
  }

  const picked = codes.find((c) => c.code === f.code)

  return (
    <Modal open={open} onClose={onClose} title={isCode ? t('sendEmergencyCode') : t('callSomeone')} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button icon={isCode ? Siren : PhoneCall} variant={isCode ? 'danger' : 'primary'} loading={send.isPending} disabled={!ok} onClick={() => send.mutate()}>
          {isCode ? (picked?.label ? t('callComposerSendCode', { label: picked.label }) : t('sendCall')) : t('call')}
        </Button>
      </>}>
      <div className="space-y-3.5">
        <FormField label={t('howUrgent')}>
          <SegmentedControl value={f.priority} onChange={pickPriority} options={PAGE_PRIORITIES.filter((p) => p.value !== 'CODE' || meta?.canBroadcast).map((p) => ({ value: p.value, label: t(`priorities.${p.value}`) }))} />
        </FormField>

        {isCode && (
          <FormField label={t('code')} required>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {codes.map((c) => (
                <button key={c.code} type="button" onClick={() => set({ code: c.code })}
                  className={clsx('flex items-start gap-2 rounded-lg border p-2 text-start transition-colors', f.code === c.code ? 'border-ink bg-bg ring-1 ring-ink' : 'border-border hover:bg-bg')}>
                  <CodeTile color={c.color} size={28} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink truncate">{c.label}</span>
                    <span className="block text-[11px] text-ink-muted line-clamp-2">{c.meaning}</span>
                  </span>
                </button>
              ))}
            </div>
          </FormField>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{t('who')}</p>
          {!f.recent && meta?.recentTargets?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-ink-faint" />
              {meta.recentTargets.map((rt, i) => (
                <button key={i} type="button" onClick={() => set({ recent: rt, type: rt.type })}
                  className="h-7 ps-0.5 pe-2.5 rounded-full border border-border bg-surface text-xs text-ink hover:bg-bg max-w-[14rem] inline-flex items-center gap-1.5" title={rt.label}>
                  <Avatar name={rt.label} size={22} soft /><span className="truncate">{rt.label}</span>
                </button>
              ))}
            </div>
          )}
          {f.recent ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-500 bg-brand-50 px-3 py-2">
              <span className="text-sm text-brand-700 font-medium min-w-0 truncate">{t(`targetShort.${f.recent.type}`, { defaultValue: f.recent.type })} · {f.recent.label}</span>
              <button type="button" onClick={() => set({ recent: null })} className="text-xs text-brand-700 hover:underline shrink-0">{t('change')}</button>
            </div>
          ) : (
            <>
              <div className="flex gap-1.5 overflow-x-auto scroll-hide pb-0.5">
                {types.map((ty) => (
                  <Chip key={ty.value} active={f.type === ty.value} title={t(`targetTypes.${ty.value}`)} onClick={() => set({ type: ty.value })}>
                    {t(`targetShort.${ty.value}`)}
                  </Chip>
                ))}
              </div>
              {f.type === 'USER' && <PersonSearch value={f.people} onChange={(people) => set({ people })} />}
              {f.type === 'ROLE' && (
                <Select value={f.roleId} onChange={(e) => set({ roleId: e.target.value })} aria-label={t('targetShort.ROLE')}>
                  <option value="">{t('pickRole')}</option>
                  {(meta?.roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              )}
              {f.type === 'DEPARTMENT' && (
                <Select value={f.deptId} onChange={(e) => set({ deptId: e.target.value })} aria-label={t('targetShort.DEPARTMENT')}>
                  <option value="">{t('pickDepartment')}</option>
                  {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
              {f.type === 'EVERYONE' && <p className="text-xs text-ink-muted">{t('ringsEveryMember')}</p>}
            </>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{t('where')}{isCode && <span className="text-danger-500"> *</span>}</p>
          <div className="grid grid-cols-2 gap-2">
            {branches.length > 1 && (
              <div className="col-span-2 flex items-center gap-2">
                <span className="w-9 h-9 shrink-0 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center"><Building2 className="w-4 h-4" /></span>
                <div className="flex-1 min-w-0">
                  <Select value={f.branchId} onChange={(e) => set({ branchId: e.target.value })} aria-label={t('campus')}>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </div>
              </div>
            )}
            <Input value={f.room} onChange={(e) => set({ room: e.target.value })} maxLength={40} placeholder={t('roomBayPlaceholder')} aria-label={t('callComposerRoomAria')} />
            <Input value={f.place} onChange={(e) => set({ place: e.target.value })} maxLength={120} placeholder={t('placePlaceholder')} aria-label={t('callComposerPlaceAria')} />
          </div>
        </div>

        <FormField label={t('message')}>
          <Textarea rows={2} value={f.message} onChange={(e) => set({ message: e.target.value })} maxLength={300} placeholder={isCode ? t('codeMessagePlaceholder') : t('callMessagePlaceholder')} />
        </FormField>
      </div>
    </Modal>
  )
}
