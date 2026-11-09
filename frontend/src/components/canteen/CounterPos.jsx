import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Banknote, CreditCard, Minus, Plus, ScanLine, ShoppingBasket, Trash2, UserX, Wallet } from 'lucide-react'
import { CANTEEN_CATEGORIES, canteenBlockReason, canteenTotal, canteenWalletCheck, formatINR, toPaise } from '@schoolgiant/shared'
import { FormField, Input, Modal, Note, PersonCell, SegmentedControl } from '../system'
import Button from '../ui/Button'
import { createOrder, fetchTodayMenu, fetchWallet, findStudents, topUpWallet } from '../../api/canteen'
import { ScanDialog, cardCodeOf } from '../scan/Scanner'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { Balance, FoodMark, ItemTile, SpendBar, useCanteenLabels } from './CanteenKit'

/** Cash or UPI into a wallet at the counter. */
export function TopUpModal({ student, onClose, onDone }) {
  const { t } = useTranslation('canteen')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ amount: '', mode: 'CASH', reference: '' })
  const save = useMutation({ mutationFn: () => topUpWallet(student.id, { amount: toPaise(form.amount), mode: form.mode, reference: form.reference }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="sm" title={t('canteen.topup.title', { name: student.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!(Number(form.amount) > 0)} onClick={() => save.mutate()}>{t('canteen.topup.save')}</Button>
    </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">{[100, 200, 500, 1000].map((r) => <Button key={r} size="sm" variant={Number(form.amount) === r ? 'primary' : 'secondary'} onClick={() => setForm((f) => ({ ...f, amount: String(r) }))}>{formatINR(r * 100)}</Button>)}</div>
        <FormField label={t('canteen.topup.amountRs')} required><Input type="number" min="1" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} autoFocus /></FormField>
        <FormField label={t('canteen.topup.mode')}><SegmentedControl value={form.mode} onChange={(mode) => setForm((f) => ({ ...f, mode }))} options={[{ value: 'CASH', label: t('canteen.modes.CASH') }, { value: 'UPI', label: t('canteen.modes.UPI') }]} /></FormField>
        {form.mode === 'UPI' && <FormField label={t('canteen.topup.reference')}><Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></FormField>}
      </div>
    </Modal>
  )
}

/** The student at the counter: who, the balance, today's spend against the limit, what the family ruled out. */
function StudentCard({ s, onClear, onTopUp }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-3">
      <div className="flex items-start gap-3">
        <PersonCell name={s.name} sub={[s.admissionNo, s.place].filter(Boolean).join(' · ')} photo={s.photo} size={52} />
        <Button size="sm" variant="ghost" icon={UserX} aria-label={t('canteen.counter.clear')} className="ms-auto" onClick={onClear} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div><p className="text-[11px] uppercase tracking-wide text-ink-faint">{t('canteen.wallet.balance')}</p><Balance value={s.balance} low={s.balance <= 0} /></div>
        {hasPermission('canteen.orders.create') && <Button size="sm" variant="secondary" icon={Plus} onClick={onTopUp}>{t('canteen.topup.button')}</Button>}
      </div>
      <SpendBar spent={s.spentToday} limit={s.dailyLimit} />
      {(s.blockedTags.length > 0 || s.blockedItemIds.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {s.blockedTags.map((x) => <span key={x} className="rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-600">{t('canteen.counter.noTag', { tag: L.tag(x) })}</span>)}
          {s.blockedItemIds.length > 0 && <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-600">{t('canteen.counter.itemsBlocked', { count: s.blockedItemIds.length })}</span>}
        </div>
      )}
    </div>
  )
}

/** Canteen › Orders › Counter: find the child (card tap, admission no or name), tap items, pay from the wallet or cash. */
export default function CounterPos() {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const findRef = useRef(null)
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState(null)
  const [student, setStudent] = useState(null)
  const [cart, setCart] = useState({}) // itemId → qty
  const [cat, setCat] = useState('ALL')
  const [topUp, setTopUp] = useState(false)
  const { data: menu, isLoading } = useQuery({ queryKey: ['canteen', 'today'], queryFn: () => fetchTodayMenu(), refetchInterval: 60_000 })
  const items = menu?.items ?? []
  const byId = new Map(items.map((i) => [i.id, i]))
  const lines = Object.entries(cart).map(([id, qty]) => ({ ...byId.get(id), qty })).filter((l) => l.id)
  const total = canteenTotal(lines)
  const walletWhy = student ? canteenWalletCheck({ balance: student.balance, dailyLimit: student.dailyLimit, spentToday: student.spentToday }, total) : null
  const canSell = hasPermission('canteen.orders.create')

  useEffect(() => { findRef.current?.focus() }, [])
  const reset = () => { setStudent(null); setCart({}); setQ(''); setMatches(null); setTimeout(() => findRef.current?.focus(), 0) }
  const pick = (s) => {
    setStudent(s); setMatches(null); setQ('')
    // drop what the family has ruled out
    setCart((c) => Object.fromEntries(Object.entries(c).filter(([id]) => byId.get(id) && !canteenBlockReason(byId.get(id), s))))
  }
  const [camera, setCamera] = useState(false)
  // a scanner gun types the card code; the camera reads the card's QR (a check link) — both come down to the code
  const find = useMutation({
    mutationFn: (code) => findStudents(cardCodeOf(code ?? q).trim()),
    onSuccess: (rows) => { if (rows.length === 1) pick(rows[0]); else setMatches(rows) },
    onError: (e) => showError(e.message),
  })
  const refreshStudent = async (id) => { try { const d = await fetchWallet(id); setStudent(d.student) } catch { /* keep the card as it was */ } }
  const pay = useMutation({
    mutationFn: (payMode) => createOrder({ studentId: student?.id ?? null, payMode, lines: lines.map((l) => ({ itemId: l.id, qty: l.qty })) }),
    onSuccess: (o) => { showSuccess(t('canteen.counter.sold', { no: o.orderNo, amount: formatINR(o.total) })); qc.invalidateQueries({ queryKey: ['canteen'] }); reset() },
    onError: (e) => showError(e.message),
  })
  const add = (it) => setCart((c) => ({ ...c, [it.id]: (c[it.id] ?? 0) + 1 }))
  const dec = (id) => setCart((c) => { const n = (c[id] ?? 0) - 1; const next = { ...c }; if (n > 0) next[id] = n; else delete next[id]; return next })
  const shown = items.filter((i) => cat === 'ALL' || i.category === cat)

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_320px] items-start">
      {/* who */}
      <section className="space-y-3 lg:sticky lg:top-4">
        <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) find.mutate() }} className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <ScanLine className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
            <Input ref={findRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('canteen.counter.findPlaceholder')} className="ps-9" autoComplete="off" />
          </div>
          <Button type="button" variant="secondary" icon={ScanLine} aria-label={t('canteen.counter.scanCamera')} title={t('canteen.counter.scanCamera')} onClick={() => setCamera(true)} />
        </form>
        <ScanDialog open={camera} onClose={() => setCamera(false)} onCode={(c) => find.mutate(c)} title={t('canteen.counter.scanCamera')} />
        <p className="text-[11px] text-ink-faint">{t('canteen.counter.findHint')}</p>
        {matches && (
          <div className="rounded-xl border border-border bg-surface divide-y divide-border">
            {!matches.length && <p className="p-3 text-sm text-ink-muted">{t('canteen.counter.noMatch')}</p>}
            {matches.map((s) => (
              <button key={s.id} type="button" onClick={() => pick(s)} className="flex w-full items-center gap-2 p-2.5 text-start hover:bg-black/[0.03]">
                <PersonCell name={s.name} sub={[s.admissionNo, s.place].filter(Boolean).join(' · ')} />
                <span className="ms-auto font-mono-num text-sm font-semibold text-ink">{formatINR(s.balance)}</span>
              </button>
            ))}
          </div>
        )}
        {student ? <StudentCard s={student} onClear={reset} onTopUp={() => setTopUp(true)} />
          : <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-ink-muted"><Banknote className="mx-auto mb-1 w-6 h-6 text-ink-faint" />{t('canteen.counter.walkIn')}</div>}
      </section>

      {/* the day's menu */}
      <section className="min-w-0 space-y-3">
        <SegmentedControl value={cat} onChange={setCat} options={[{ value: 'ALL', label: t('canteen.menu.all') }, ...CANTEEN_CATEGORIES.map((c) => ({ value: c.value, label: L.category(c.value) }))]} />
        {!isLoading && !items.length && <Note>{t('canteen.counter.nothingToday')}</Note>}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {isLoading && Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 rounded-xl bg-black/[0.05] animate-pulse" />)}
          {shown.map((it) => <ItemTile key={it.id} item={it} compact qty={cart[it.id] ?? 0} blocked={student ? canteenBlockReason(it, student) : null} onClick={canSell ? () => add(it) : undefined} />)}
        </div>
      </section>

      {/* the cart */}
      <section className="rounded-xl border border-border bg-surface p-3 lg:sticky lg:top-4 space-y-3">
        <div className="flex items-center gap-2"><ShoppingBasket className="w-4 h-4 text-ink-faint" /><h3 className="font-display text-sm font-semibold text-ink">{t('canteen.counter.cart')}</h3>
          {lines.length > 0 && <Button size="sm" variant="ghost" icon={Trash2} className="ms-auto" aria-label={t('canteen.counter.emptyCart')} onClick={() => setCart({})} />}
        </div>
        {!lines.length ? <p className="py-6 text-center text-sm text-ink-faint">{t('canteen.counter.cartEmpty')}</p> : (
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-2">
                <FoodMark mark={l.mark} size={11} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-ink">{l.name}</span><span className="text-[11px] text-ink-faint font-mono-num">{formatINR(l.price)}</span></span>
                <span className="flex items-center gap-1">
                  <button type="button" aria-label={t('canteen.counter.less')} onClick={() => dec(l.id)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-black/[0.03]"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-6 text-center font-mono-num text-sm font-semibold">{l.qty}</span>
                  <button type="button" aria-label={t('canteen.counter.more')} onClick={() => add(l)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-black/[0.03]"><Plus className="w-3.5 h-3.5" /></button>
                </span>
                <span className="w-16 text-end font-mono-num text-sm font-semibold text-ink">{formatINR(l.price * l.qty)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-ink-muted">{t('canteen.counter.total')}</span>
          <span className="font-mono-num text-2xl font-bold text-ink">{formatINR(total)}</span>
        </div>
        {student && total > 0 && walletWhy && (
          <Note tone="warning">{walletWhy.code === 'NO_BALANCE' ? t('canteen.counter.short', { amount: formatINR(walletWhy.short) }) : t('canteen.counter.overLimit', { left: formatINR(walletWhy.left) })}</Note>
        )}
        {canSell && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" icon={Wallet} disabled={!student || !total || !!walletWhy} loading={pay.isPending && pay.variables === 'WALLET'} onClick={() => pay.mutate('WALLET')}>{t('canteen.counter.payWallet')}</Button>
            <Button size="lg" variant="secondary" icon={CreditCard} disabled={!total} loading={pay.isPending && pay.variables === 'CASH'} onClick={() => pay.mutate('CASH')}>{t('canteen.counter.payCash')}</Button>
          </div>
        )}
      </section>
      {topUp && student && <TopUpModal student={student} onClose={() => setTopUp(false)} onDone={async (r) => { setTopUp(false); showSuccess(t('canteen.topup.done', { balance: formatINR(r.balance) })); await refreshStudent(student.id); qc.invalidateQueries({ queryKey: ['canteen'] }) }} />}
    </div>
  )
}
