import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CreditCard, Minus, Plus, ShieldBan, ShoppingBasket, Utensils, Wallet, X } from 'lucide-react'
import { CANTEEN_TAGS, canteenBlockReason, canteenSoldOn, canteenTotal, canteenWalletCheck, formatINR, toPaise, toRupees } from '@schoolgiant/shared'
import { Input, Note, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { loadCheckout } from '../../utils/razorpayCheckout'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyCancelPreorder, familyCanteen, familyCanteenControls, familyPreorder, familyTopupStart, familyTopupVerify } from '../../api/canteen'
import { useFormat } from '../../context/SettingsContext'
import { Balance, FoodMark, ItemTile, OrderPill, SpendBar, TxnPill, useCanteenLabels } from '../../components/canteen/CanteenKit'

const pill = (on, tone = 'brand') => `inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${on ? (tone === 'danger' ? 'border-danger-200 bg-danger-50 text-danger-600' : 'border-brand-300 bg-brand-50 text-brand-700') : 'border-border bg-surface text-ink-muted'}`

/** Top up through the school's Razorpay: open Checkout, then confirm its signed reply with the school. */
function TopUp({ d, onDone }) {
  const { t } = useTranslation('canteen')
  const { slug, studentId } = useFamily()
  const [amount, setAmount] = useState(String(toRupees(d.topUp.presets[1] ?? d.topUp.min)))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const paise = toPaise(amount)
  const valid = paise >= d.topUp.min && paise <= d.topUp.max
  const pay = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await loadCheckout(t('canteen.family.checkoutFailed'))
      const o = await familyTopupStart(slug, studentId, paise)
      await new Promise((resolve) => {
        const rz = new window.Razorpay({
          key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, name: o.name, description: o.description, prefill: o.prefill,
          handler: async (r) => {
            try {
              const res = await familyTopupVerify(slug, studentId, { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature })
              setMsg(res.status === 'APPLIED' ? { tone: 'success', text: t('canteen.family.toppedUp', { balance: formatINR(res.balance) }) } : { tone: 'warning', text: t('canteen.family.topupReview') })
              onDone()
            } catch (e) {
              setMsg({ tone: 'danger', text: e.message })
            } finally {
              resolve()
            }
          },
          modal: { ondismiss: resolve },
        })
        rz.on('payment.failed', (r) => setMsg({ tone: 'danger', text: r?.error?.description || t('canteen.family.payFailed') }))
        rz.open()
      })
    } catch (e) {
      setMsg({ tone: 'danger', text: e.message })
    } finally {
      setBusy(false)
    }
  }
  if (!d.topUp.online) return <Note className="mt-3">{t('canteen.family.topupAtCounter')}</Note>
  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        {d.topUp.presets.map((p) => <button key={p} type="button" className={pill(paise === p)} onClick={() => setAmount(String(toRupees(p)))}>{formatINR(p)}</button>)}
        <Input type="number" inputMode="numeric" min={toRupees(d.topUp.min)} max={toRupees(d.topUp.max)} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" aria-label={t('canteen.family.amount')} />
      </div>
      <Button className="w-full" size="lg" icon={CreditCard} loading={busy} disabled={!valid} onClick={pay}>{t('canteen.family.topupNow', { amount: formatINR(paise) })}</Button>
      <p className="text-center text-xs text-ink-muted">{t('canteen.family.topupHint', { min: formatINR(d.topUp.min), max: formatINR(d.topUp.max) })}</p>
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
    </div>
  )
}

/** Pick a day, tap what the child should get, pay from the wallet. */
function Preorder({ d, onDone }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const { slug, studentId } = useFamily()
  const { date: fmt } = useFormat()
  const openDays = d.days.filter((x) => x.open)
  const [day, setDay] = useState(openDays[0]?.date ?? null)
  const [cart, setCart] = useState({})
  const [msg, setMsg] = useState(null)
  const wd = d.days.find((x) => x.date === day)?.weekday
  const menu = useMemo(() => {
    if (!day) return []
    const sp = new Map(d.specials.filter((s) => s.date === day).map((s) => [s.itemId, s]))
    return d.items.filter((it) => canteenSoldOn(it, wd) || sp.has(it.id)).map((it) => {
      const s = sp.get(it.id)
      return { ...it, soldOut: day === d.date && it.soldOut, price: s?.price ?? it.price, menuPrice: it.price, special: !!s }
    })
  }, [d, day, wd])
  const byId = new Map(menu.map((m) => [m.id, m]))
  const lines = Object.entries(cart).map(([id, qty]) => ({ ...byId.get(id), qty })).filter((l) => l.id)
  const total = canteenTotal(lines)
  const spentThatDay = day === d.date ? d.wallet.spentToday : d.preorders.filter((o) => o.date === day && o.status !== 'CANCELLED').reduce((n, o) => n + o.total, 0)
  const why = total ? canteenWalletCheck({ balance: d.wallet.balance, dailyLimit: d.wallet.dailyLimit, spentToday: spentThatDay }, total) : null
  const place = useMutation({
    mutationFn: () => familyPreorder(slug, studentId, { date: day, lines: lines.map((l) => ({ itemId: l.id, qty: l.qty })) }),
    onSuccess: (o) => { setCart({}); setMsg({ tone: 'success', text: t('canteen.family.placed', { no: o.orderNo, date: fmt(o.date) }) }); onDone() },
    onError: (e) => setMsg({ tone: 'danger', text: e.message }),
  })
  const add = (id) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const dec = (id) => setCart((c) => { const n = (c[id] ?? 0) - 1; const next = { ...c }; if (n > 0) next[id] = n; else delete next[id]; return next })
  return (
    <FCard title={t('canteen.family.preorderTitle')}>
      <p className="-mt-2 mb-3 text-xs text-ink-muted">{t('canteen.family.preorderHint', { time: d.cutoff })}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {d.days.map((x) => (
          <button key={x.date} type="button" disabled={!x.open} onClick={() => { setDay(x.date); setCart({}); setMsg(null) }}
            className={`flex min-w-[64px] shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-xs ${day === x.date ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink'} disabled:opacity-40`}>
            <span className="font-semibold">{x.date === d.date ? t('canteen.family.today') : L.day(x.weekday)}</span>
            <span className="text-[11px] text-ink-faint">{x.date.slice(8)}</span>
          </button>
        ))}
      </div>
      {!openDays.length ? <FEmpty icon={Utensils} title={t('canteen.family.noDays')} /> : !menu.length ? <FEmpty icon={Utensils} title={t('canteen.family.noMenu')} /> : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {menu.map((it) => <ItemTile key={it.id} item={it} compact qty={cart[it.id] ?? 0} blocked={canteenBlockReason(it, d.wallet)} onClick={() => add(it.id)} />)}
        </div>
      )}
      {lines.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-bg p-3 space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><ShoppingBasket className="w-4 h-4" />{t('canteen.family.yourOrder', { date: fmt(day) })}</p>
          {lines.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-sm">
              <FoodMark mark={l.mark} size={11} /><span className="min-w-0 flex-1 truncate">{l.name}</span>
              <button type="button" aria-label={t('canteen.counter.less')} onClick={() => dec(l.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface"><Minus className="w-4 h-4" /></button>
              <span className="w-5 text-center font-mono-num font-semibold">{l.qty}</span>
              <button type="button" aria-label={t('canteen.counter.more')} onClick={() => add(l.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface"><Plus className="w-4 h-4" /></button>
              <span className="w-16 text-end font-mono-num">{formatINR(l.price * l.qty)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-border pt-2"><span className="text-sm text-ink-muted">{t('canteen.counter.total')}</span><span className="font-mono-num text-lg font-bold">{formatINR(total)}</span></div>
          {why && <Note tone="warning">{why.code === 'NO_BALANCE' ? t('canteen.counter.short', { amount: formatINR(why.short) }) : t('canteen.counter.overLimit', { left: formatINR(why.left) })}</Note>}
          <Button className="w-full" size="lg" icon={Wallet} loading={place.isPending} disabled={!!why} onClick={() => place.mutate()}>{t('canteen.family.place', { amount: formatINR(total) })}</Button>
        </div>
      )}
      {msg && <Note tone={msg.tone} className="mt-3">{msg.text}</Note>}
    </FCard>
  )
}

/** The parent's controls: a daily spend limit and food ruled out. */
function Controls({ d, onDone }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const { slug, studentId } = useFamily()
  const [limit, setLimit] = useState(d.wallet.dailyLimit ? String(toRupees(d.wallet.dailyLimit)) : '')
  const [tags, setTags] = useState(d.wallet.blockedTags)
  const [items, setItems] = useState(d.wallet.blockedItemIds)
  const [msg, setMsg] = useState(null)
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const save = useMutation({
    mutationFn: () => familyCanteenControls(slug, studentId, { dailyLimit: limit === '' ? null : toPaise(limit), blockedTags: tags, blockedItemIds: items }),
    onSuccess: () => { setMsg({ tone: 'success', text: t('canteen.family.controlsSaved') }); onDone() },
    onError: (e) => setMsg({ tone: 'danger', text: e.message }),
  })
  return (
    <FCard title={t('canteen.family.controlsTitle')}>
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-sm font-medium text-ink">{t('canteen.controls.limitRs')}</p>
          <Input type="number" inputMode="numeric" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={t('canteen.family.noLimit')} />
          <p className="mt-1 text-xs text-ink-muted">{t('canteen.controls.limitHint')}</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">{t('canteen.controls.tags')}</p>
          <div className="flex flex-wrap gap-2">{CANTEEN_TAGS.map((x) => <button key={x.value} type="button" className={pill(tags.includes(x.value), 'danger')} onClick={() => toggle(tags, setTags, x.value)}><ShieldBan className="w-3.5 h-3.5" />{t('canteen.counter.noTag', { tag: L.tag(x.value) })}</button>)}</div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">{t('canteen.controls.items')}</p>
          <div className="flex flex-wrap gap-2">{d.items.map((i) => <button key={i.id} type="button" className={pill(items.includes(i.id), 'danger')} onClick={() => toggle(items, setItems, i.id)}><FoodMark mark={i.mark} size={10} />{i.name}</button>)}</div>
        </div>
        <Button className="w-full" loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      </div>
    </FCard>
  )
}

/** The family app › Canteen: the wallet, topping it up, pre-orders, the parent's controls and the ledger. */
export default function FamilyCanteen() {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date, dateTime } = useFormat()
  const { data: d, isLoading, error } = useFamilyQuery(['canteen'], () => familyCanteen(slug, studentId))
  const refresh = () => qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'canteen'] })
  const cancel = useMutation({ mutationFn: (orderId) => familyCancelPreorder(slug, studentId, orderId), onSuccess: refresh })
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!d) return null
  const upcoming = d.preorders.filter((o) => o.date >= d.date)
  return (
    <>
      <FCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-faint">{t('canteen.wallet.balance')}</p>
            <Balance value={d.wallet.balance} low={d.wallet.low} />
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><Wallet className="w-6 h-6" /></span>
        </div>
        {d.wallet.low && <Note tone="warning" className="mt-2">{t('canteen.family.low', { amount: formatINR(d.wallet.lowBalance) })}</Note>}
        <SpendBar className="mt-3" spent={d.wallet.spentToday} limit={d.wallet.dailyLimit} />
        <TopUp d={d} onDone={refresh} />
      </FCard>

      <Preorder d={d} onDone={refresh} />

      {upcoming.length > 0 && (
        <FCard title={t('canteen.family.myPreorders')}>
          <div className="divide-y divide-border">
            {upcoming.map((o) => (
              <div key={o.id} className="flex items-center gap-2 py-2">
                {o.token && o.date === d.date && (
                  <span className="flex shrink-0 flex-col items-center rounded-xl border border-border bg-surface px-2.5 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{t('canteen.tokens.token')}</span>
                    <span className="font-mono-num text-2xl font-extrabold leading-none text-ink tabular-nums">{o.token}</span>
                  </span>
                )}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-ink">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</span><span className="text-xs text-ink-muted">{date(o.date)} · {formatINR(o.total)}</span></span>
                {o.token && o.date === d.date && ['PLACED', 'READY'].includes(o.status)
                  ? <StatusPill tone={o.status === 'READY' ? 'success' : 'info'}>{t(`canteen.family.tokenStatus.${o.status}`)}</StatusPill>
                  : <OrderPill status={o.status} />}
                {o.canCancel && <Button size="sm" variant="ghost" icon={X} loading={cancel.isPending && cancel.variables === o.id} aria-label={t('canteen.family.cancel')} onClick={() => cancel.mutate(o.id)} />}
              </div>
            ))}
          </div>
          {cancel.error && <Note tone="danger" className="mt-2">{cancel.error.message}</Note>}
        </FCard>
      )}

      {d.canControl && <Controls key={`${d.wallet.dailyLimit}-${d.wallet.blockedTags.join()}-${d.wallet.blockedItemIds.join()}`} d={d} onDone={refresh} />}

      <FCard title={t('canteen.family.ledger')}>
        {!d.ledger.length ? <FEmpty icon={Wallet} title={t('canteen.wallets.noLedger')} /> : (
          <div className="divide-y divide-border">
            {d.ledger.map((x) => (
              <div key={x.id} className="flex items-center gap-2 py-2">
                <TxnPill type={x.type} />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{[x.mode && L.mode(x.mode), x.note].filter(Boolean).join(' · ') || dateTime(x.at)}</span>
                <span className={`font-mono-num text-sm font-semibold ${x.amount > 0 ? 'text-success-700' : 'text-ink'}`}>{x.amount > 0 ? '+' : '−'}{formatINR(Math.abs(x.amount))}</span>
              </div>
            ))}
          </div>
        )}
      </FCard>
    </>
  )
}
