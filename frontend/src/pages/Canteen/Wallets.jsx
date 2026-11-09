import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, BadgeIndianRupee, PiggyBank, Plus, RefreshCw, Scale, ShieldBan, Undo2, Wallet } from 'lucide-react'
import { CANTEEN_TAGS, CANTEEN_TOPUP_STATUS, formatINR, toPaise, toRupees } from '@schoolgiant/shared'
import { DataTable, Drawer, FormField, Input, Modal, Note, PageContainer, PageHeader, PersonCell, SearchInput, SegmentedControl, StatCardRow, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { adjustWallet, fetchMenu, fetchWallet, fetchWallets, recheckTopup, refundWallet, saveWalletControls } from '../../api/canteen'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { TopUpModal } from '../../components/canteen/CounterPos'
import { Balance, FoodMark, OrderPill, SpendBar, TxnPill, useCanteenLabels } from '../../components/canteen/CanteenKit'

const chip = (on) => `inline-flex min-h-[32px] items-center gap-1 rounded-full border px-3 text-xs font-medium ${on ? 'border-danger-200 bg-danger-50 text-danger-600' : 'border-border bg-surface text-ink-muted hover:bg-black/[0.03]'}`

function RefundModal({ s, onClose, onDone }) {
  const { t } = useTranslation('canteen')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ amount: String(toRupees(s.balance)), mode: 'CASH', reference: '', reason: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => refundWallet(s.id, { amount: toPaise(form.amount), mode: form.mode, reference: form.reference, reason: form.reason }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="sm" title={t('canteen.refund.title', { name: s.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button variant="danger" loading={save.isPending} disabled={!(Number(form.amount) > 0) || form.reason.trim().length < 3} onClick={() => save.mutate()}>{t('canteen.refund.save')}</Button>
    </>}>
      <div className="space-y-3">
        <Note tone="warning">{t('canteen.refund.hint', { balance: formatINR(s.balance) })}</Note>
        <FormField label={t('canteen.refund.amountRs')} required><Input type="number" min="1" value={form.amount} onChange={set('amount')} /></FormField>
        <FormField label={t('canteen.refund.mode')}><SegmentedControl value={form.mode} onChange={(mode) => setForm((f) => ({ ...f, mode }))} options={['CASH', 'BANK'].map((m) => ({ value: m, label: t(`canteen.modes.${m}`) }))} /></FormField>
        {form.mode === 'BANK' && <FormField label={t('canteen.refund.reference')}><Input value={form.reference} onChange={set('reference')} /></FormField>}
        <FormField label={t('canteen.refund.reason')} required><Textarea rows={2} value={form.reason} onChange={set('reason')} placeholder={t('canteen.refund.reasonPlaceholder')} /></FormField>
      </div>
    </Modal>
  )
}

function AdjustModal({ s, onClose, onDone }) {
  const { t } = useTranslation('canteen')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ way: 'IN', amount: '', reason: '' })
  const save = useMutation({ mutationFn: () => adjustWallet(s.id, { amount: (form.way === 'IN' ? 1 : -1) * toPaise(form.amount), reason: form.reason }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="sm" title={t('canteen.adjust.title', { name: s.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!(Number(form.amount) > 0) || form.reason.trim().length < 3} onClick={() => save.mutate()}>{t('canteen.adjust.save')}</Button>
    </>}>
      <div className="space-y-3">
        <Note>{t('canteen.adjust.hint')}</Note>
        <SegmentedControl value={form.way} onChange={(way) => setForm((f) => ({ ...f, way }))} options={[{ value: 'IN', label: t('canteen.adjust.add') }, { value: 'OUT', label: t('canteen.adjust.take') }]} />
        <FormField label={t('canteen.adjust.amountRs')} required><Input type="number" min="1" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></FormField>
        <FormField label={t('canteen.adjust.reason')} required><Textarea rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}

/** The family's controls, set by staff on a parent's request (parents set them themselves in the app). */
export function ControlsModal({ s, onClose, onDone }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const { showError } = useSnackbar()
  const { data: menu } = useQuery({ queryKey: ['canteen', 'menu'], queryFn: fetchMenu })
  const [form, setForm] = useState({ limit: s.dailyLimit ? String(toRupees(s.dailyLimit)) : '', tags: s.blockedTags, items: s.blockedItemIds })
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }))
  const save = useMutation({ mutationFn: () => saveWalletControls(s.id, { dailyLimit: form.limit === '' ? null : toPaise(form.limit), blockedTags: form.tags, blockedItemIds: form.items }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={t('canteen.controls.title', { name: s.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('canteen.controls.limitRs')} hint={t('canteen.controls.limitHint')}><Input type="number" min="0" value={form.limit} onChange={(e) => setForm((f) => ({ ...f, limit: e.target.value }))} /></FormField>
        <FormField label={t('canteen.controls.tags')}>
          <div className="flex flex-wrap gap-2">{CANTEEN_TAGS.map((x) => <button key={x.value} type="button" className={chip(form.tags.includes(x.value))} onClick={() => toggle('tags', x.value)}>{t('canteen.counter.noTag', { tag: L.tag(x.value) })}</button>)}</div>
        </FormField>
        <FormField label={t('canteen.controls.items')}>
          <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">{(menu?.items ?? []).filter((i) => i.active).map((i) => <button key={i.id} type="button" className={chip(form.items.includes(i.id))} onClick={() => toggle('items', i.id)}><FoodMark mark={i.mark} size={10} />{i.name}</button>)}</div>
        </FormField>
      </div>
    </Modal>
  )
}

function WalletDrawer({ studentId, onClose }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const qc = useQueryClient()
  const { dateTime, date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [modal, setModal] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['canteen', 'wallet', studentId], queryFn: () => fetchWallet(studentId), enabled: !!studentId })
  const recheck = useMutation({ mutationFn: recheckTopup, onSuccess: () => qc.invalidateQueries({ queryKey: ['canteen'] }), onError: (e) => showError(e.message) })
  const done = (msg) => (r) => { setModal(null); qc.invalidateQueries({ queryKey: ['canteen'] }); showSuccess(msg(r)) }
  const s = data?.student
  return (
    <Drawer open={!!studentId} onClose={onClose} size="xl" title={s?.name ?? t('canteen.wallets.wallet')} subtitle={s ? [s.admissionNo, s.place].filter(Boolean).join(' · ') : undefined}>
      {isLoading || !s ? <div className="h-48 rounded-xl bg-black/[0.05] animate-pulse" /> : (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-gradient-to-br from-brand-50 to-surface p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-center gap-3">
                <PersonCell name={s.name} photo={s.photo} size={48} />
              </div>
              <div className="text-end"><p className="text-[11px] uppercase tracking-wide text-ink-faint">{t('canteen.wallet.balance')}</p><Balance value={s.balance} low={s.balance < data.settings.lowBalance} /></div>
            </div>
            <SpendBar className="mt-3" spent={s.spentToday} limit={s.dailyLimit} />
            {(s.blockedTags.length > 0 || s.blockedItemIds.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.blockedTags.map((x) => <span key={x} className="rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-600">{t('canteen.counter.noTag', { tag: L.tag(x) })}</span>)}
                {s.blockedItemIds.length > 0 && <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-600">{t('canteen.counter.itemsBlocked', { count: s.blockedItemIds.length })}</span>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {hasPermission('canteen.orders.create') && <Button size="sm" icon={Plus} onClick={() => setModal('topup')}>{t('canteen.topup.button')}</Button>}
              {hasPermission('canteen.wallet.refund') && <>
                <Button size="sm" variant="secondary" icon={Undo2} disabled={s.balance <= 0} onClick={() => setModal('refund')}>{t('canteen.refund.button')}</Button>
                <Button size="sm" variant="secondary" icon={Scale} onClick={() => setModal('adjust')}>{t('canteen.adjust.button')}</Button>
                <Button size="sm" variant="secondary" icon={ShieldBan} onClick={() => setModal('controls')}>{t('canteen.controls.button')}</Button>
              </>}
            </div>
          </div>

          {data.online.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('canteen.wallets.online')}</h3>
              <div className="divide-y divide-border rounded-xl border border-border">
                {data.online.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-mono-num font-semibold">{formatINR(o.amount)}</span>
                    <StatusPill tone={CANTEEN_TOPUP_STATUS[o.status]?.tone}>{L.topup(o.status)}</StatusPill>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">{o.error ?? o.paymentId ?? ''}</span>
                    <span className="text-xs text-ink-faint">{dateTime(o.at)}</span>
                    {o.status !== 'APPLIED' && hasPermission('canteen.wallet.refund') && <Button size="sm" variant="ghost" icon={RefreshCw} loading={recheck.isPending && recheck.variables === o.id} onClick={() => recheck.mutate(o.id)} aria-label={t('canteen.wallets.recheck')} />}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('canteen.wallets.ledger')}</h3>
            {!data.ledger.length ? <p className="text-sm text-ink-faint">{t('canteen.wallets.noLedger')}</p> : (
              <ol className="relative space-y-2 border-s-2 border-border ps-4">
                {data.ledger.map((x) => (
                  <li key={x.id} className="relative">
                    <span className={`absolute -start-[23px] top-2 flex h-4 w-4 items-center justify-center rounded-full ${x.amount > 0 ? 'bg-success-500' : 'bg-brand-500'}`}>{x.amount > 0 ? <ArrowDownLeft className="w-2.5 h-2.5 text-white" /> : <ArrowUpRight className="w-2.5 h-2.5 text-white" />}</span>
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-bg px-3 py-2">
                      <TxnPill type={x.type} />
                      <span className="min-w-0 flex-1 text-xs text-ink-muted truncate">{[x.orderNo, x.mode && L.mode(x.mode), x.note, x.by].filter(Boolean).join(' · ')}</span>
                      <span className={`font-mono-num text-sm font-semibold ${x.amount > 0 ? 'text-success-700' : 'text-ink'}`}>{x.amount > 0 ? '+' : '−'}{formatINR(Math.abs(x.amount))}</span>
                      <span className="w-full text-[11px] text-ink-faint">{dateTime(x.at)} · {t('canteen.wallets.after', { balance: formatINR(x.balanceAfter) })}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {data.orders.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('canteen.wallets.orders')}</h3>
              <div className="divide-y divide-border rounded-xl border border-border">
                {data.orders.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm text-ink">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</span><span className="text-[11px] text-ink-faint">{o.orderNo} · {date(o.date)} · {L.pay(o.payMode)}</span></span>
                    <OrderPill status={o.status} />
                    <span className="font-mono-num text-sm font-semibold">{formatINR(o.total)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {modal === 'topup' && s && <TopUpModal student={s} onClose={() => setModal(null)} onDone={done((r) => t('canteen.topup.done', { balance: formatINR(r.balance) }))} />}
      {modal === 'refund' && s && <RefundModal s={s} onClose={() => setModal(null)} onDone={done((r) => t('canteen.refund.done', { balance: formatINR(r.balance) }))} />}
      {modal === 'adjust' && s && <AdjustModal s={s} onClose={() => setModal(null)} onDone={done((r) => t('canteen.adjust.done', { balance: formatINR(r.balance) }))} />}
      {modal === 'controls' && s && <ControlsModal s={s} onClose={() => setModal(null)} onDone={done(() => t('canteen.controls.saved'))} />}
    </Drawer>
  )
}

/** Canteen › Wallets: every student's balance, the low ones, the family's controls; a wallet's ledger in a drawer. */
export default function CanteenWallets() {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const params = { filter, search: q || undefined, page }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['canteen', 'wallets', params], queryFn: () => fetchWallets(params) })
  const st = data?.stats ?? {}
  const rows = data?.rows ?? []
  const peak = Math.max(1, ...rows.map((r) => r.balance))
  return (
    <PageContainer>
      <PageHeader icon={Wallet} title={t('canteen.wallets.title')} subtitle={t('canteen.wallets.subtitle')} />
      <div className="space-y-4">
        <StatCardRow items={[
          { icon: PiggyBank, label: t('canteen.wallets.held'), value: formatINR(st.held ?? 0), sub: t('canteen.wallets.heldSub', { count: st.wallets ?? 0 }) },
          { icon: AlertTriangle, tone: st.low ? 'danger' : 'neutral', label: t('canteen.wallets.low'), value: st.low ?? 0, sub: t('canteen.wallets.lowSub', { amount: formatINR(data?.lowBalance ?? 0) }), onClick: () => { setFilter('LOW'); setPage(1) } },
          { icon: BadgeIndianRupee, tone: 'success', label: t('canteen.wallets.today'), value: formatINR(st.topUpsToday ?? 0), segments: [{ label: t('canteen.txn.TOP_UP'), value: (st.topUpsToday ?? 0) / 100, tone: 'success' }, { label: t('canteen.txn.PURCHASE'), value: (st.spentToday ?? 0) / 100, tone: 'brand' }] },
          { icon: RefreshCw, tone: st.needsReview ? 'warning' : 'neutral', label: t('canteen.wallets.review'), value: st.needsReview ?? 0, sub: t('canteen.wallets.reviewSub') },
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={filter} onChange={(v) => { setFilter(v); setPage(1) }} options={['ALL', 'LOW', 'LIMITED'].map((v) => ({ value: v, label: t(`canteen.wallets.filters.${v}`) }))} />
          <div className="w-64 max-w-full"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('canteen.wallets.search')} /></div>
        </div>
        <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} onRowClick={(r) => setOpen(r.id)} emptyIcon={Wallet} emptyTitle={t('canteen.wallets.empty')} emptyHint={t('canteen.wallets.emptyHint')}
          rowTone={(r) => (r.low ? 'danger' : undefined)}
          columns={[
            { key: 'name', header: t('canteen.wallets.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.admissionNo, r.place].filter(Boolean).join(' · ')} /> },
            { key: 'balance', header: t('canteen.wallet.balance'), render: (v, r) => (
              <span className="flex min-w-[140px] flex-col gap-1">
                <span className={`font-mono-num text-sm font-semibold ${r.low ? 'text-danger-600' : 'text-ink'}`}>{formatINR(v)}</span>
                <span className="h-1.5 w-full rounded-full bg-black/[0.06] overflow-hidden"><span className={`block h-full rounded-full ${r.low ? 'bg-danger-500' : 'bg-success-500'}`} style={{ width: `${Math.max(2, (v / peak) * 100)}%` }} /></span>
              </span>
            ) },
            { key: 'spentToday', header: t('canteen.wallets.todaySpend'), mobileHidden: true, render: (v, r) => <SpendBar spent={v} limit={r.dailyLimit} className="min-w-[160px]" /> },
            { key: 'blockedTags', header: t('canteen.wallets.controls'), mobileHidden: true, render: (v, r) => (
              <span className="flex flex-wrap gap-1">
                {v.map((x) => <span key={x} className="rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-600">{t('canteen.counter.noTag', { tag: L.tag(x) })}</span>)}
                {r.blockedItemIds.length > 0 && <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-600">{t('canteen.counter.itemsBlocked', { count: r.blockedItemIds.length })}</span>}
                {!v.length && !r.blockedItemIds.length && <span className="text-xs text-ink-faint">—</span>}
              </span>
            ) },
          ]}
          pagination={data && !q && data.total > data.pageSize ? { page: page - 1, size: data.pageSize, totalElements: data.total, totalPages: Math.ceil(data.total / data.pageSize), onPageChange: (p) => setPage(p + 1) } : undefined} />
      </div>
      <WalletDrawer studentId={open} onClose={() => setOpen(null)} />
    </PageContainer>
  )
}
