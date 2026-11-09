import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Briefcase, Building2, CalendarClock, Globe, Mail, MapPin, Pencil, Phone, Plus, Trash2, Trophy, UserRound, X } from 'lucide-react'
import { COMPANY_SECTORS, formatLpa } from '@schoolgiant/shared'
import {
  Drawer, EmptyState, FormField, HeaderButton, Input, PageContainer, PageHeader, PANEL, SearchInput, SegmentedControl, Select, SideNav, SideNavLayout,
  SkeletonRows, StatCardRow, Textarea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteCompany, fetchCompanies, fetchCompany, saveCompany } from '../../api/placements'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { CompanyLogo, DriveStatusPill, ctcRange, usePlacementLabels } from '../../components/placements/PlacementsKit'

const EMPTY = { name: '', sector: 'IT', website: '', city: '', about: '', notes: '', contacts: [], active: true }

function CompanyForm({ company, onClose, onSaved }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => (company ? { ...EMPTY, ...company, contacts: company.contacts.map(({ id, ...c }) => c) } : EMPTY))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setContact = (i, k) => (e) => setForm((f) => ({ ...f, contacts: f.contacts.map((c, j) => (j === i ? { ...c, [k]: k === 'primary' ? e.target.checked : e.target.value } : k === 'primary' && e.target.checked ? { ...c, primary: false } : c)) }))
  const save = useMutation({
    mutationFn: () => saveCompany(company?.id, { ...form, contacts: form.contacts.filter((c) => c.name?.trim()) }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Drawer open onClose={onClose} size="lg" title={company ? t('placements.companies.editTitle') : t('placements.companies.newTitle')} subtitle={company?.name}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>{t('actions.save')}</Button></>}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <CompanyLogo name={form.name || '?'} size={48} />
          <FormField className="flex-1" label={t('placements.companies.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} /></FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('placements.companies.sector')}><Select value={form.sector} onChange={set('sector')}>{COMPANY_SECTORS.map((s) => <option key={s.value} value={s.value}>{L.sector(s.value)}</option>)}</Select></FormField>
          <FormField label={t('placements.companies.city')}><Input value={form.city ?? ''} onChange={set('city')} /></FormField>
        </div>
        <FormField label={t('placements.companies.website')} error={errors.website}><Input value={form.website ?? ''} onChange={set('website')} placeholder="https://" /></FormField>
        <FormField label={t('placements.companies.about')}><Textarea rows={2} value={form.about ?? ''} onChange={set('about')} /></FormField>
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">{t('placements.companies.contacts')}</p>
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setForm((f) => ({ ...f, contacts: [...f.contacts, { name: '', designation: '', email: '', mobile: '', primary: !f.contacts.length }] }))}>{t('placements.companies.addContact')}</Button>
          </div>
          {!form.contacts.length && <p className="text-xs text-ink-faint">{t('placements.companies.noContacts')}</p>}
          <div className="space-y-3">
            {form.contacts.map((c, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-lg bg-black/[0.02] p-2 sm:grid-cols-2">
                <Input value={c.name} onChange={setContact(i, 'name')} placeholder={t('placements.companies.contactName')} />
                <Input value={c.designation ?? ''} onChange={setContact(i, 'designation')} placeholder={t('placements.companies.designation')} />
                <Input value={c.email ?? ''} onChange={setContact(i, 'email')} placeholder={t('placements.companies.email')} error={errors[`contacts.${i}.email`]} />
                <Input value={c.mobile ?? ''} onChange={setContact(i, 'mobile')} placeholder={t('placements.companies.mobile')} error={errors[`contacts.${i}.mobile`]} />
                <div className="flex items-center justify-between sm:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={!!c.primary} onChange={setContact(i, 'primary')} />{t('placements.companies.primary')}</label>
                  <Button size="sm" variant="ghost" icon={X} aria-label={t('placements.companies.removeContact')} onClick={() => setForm((f) => ({ ...f, contacts: f.contacts.filter((_, j) => j !== i) }))} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <FormField label={t('placements.companies.notes')}><Textarea rows={3} value={form.notes ?? ''} onChange={set('notes')} /></FormField>
        {company && <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />{t('placements.companies.active')}</label>}
      </div>
    </Drawer>
  )
}

function CompanyDrawer({ id, onClose, onEdit, onDeleted }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { date } = useFormat()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const { data: c } = useQuery({ queryKey: ['placements', 'company', id], queryFn: () => fetchCompany(id) })
  const remove = useMutation({ mutationFn: () => deleteCompany(id), onSuccess: () => { showSuccess(t('placements.companies.deleted')); onDeleted() }, onError: (e) => showError(e.message) })
  return (
    <Drawer open onClose={onClose} size="lg" title={c?.name ?? ''} subtitle={c ? L.sector(c.sector) : ''}
      footer={c && <>
        {hasPermission('placements.companies.delete') && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: t('placements.companies.deleteTitle', { name: c.name }), tone: 'danger' })) remove.mutate() }}>{t('actions.delete')}</Button>}
        {hasPermission('placements.companies.edit') && <Button icon={Pencil} onClick={() => onEdit(c)}>{t('actions.edit')}</Button>}
      </>}>
      {!c ? <SkeletonRows rows={5} /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <CompanyLogo name={c.name} size={56} />
            <div className="min-w-0 space-y-1 text-sm">
              {c.city && <p className="flex items-center gap-1.5 text-ink-muted"><MapPin className="h-4 w-4" />{c.city}</p>}
              {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-brand-700"><Globe className="h-4 w-4" />{c.website.replace(/^https?:\/\//, '')}</a>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[[Briefcase, t('placements.companies.drives'), c.visits.drives], [Trophy, t('placements.companies.offers'), c.visits.offers], [Building2, t('placements.companies.best'), formatLpa(c.visits.bestCtc)]].map(([Icon, label, v]) => (
              <div key={label} className="rounded-xl border border-border p-3"><Icon className="h-4 w-4 text-ink-faint" /><p className="mt-1 text-lg font-semibold tabular-nums text-ink">{v}</p><p className="text-xs text-ink-muted">{label}</p></div>
            ))}
          </div>
          {c.about && <p className="text-sm text-ink-muted">{c.about}</p>}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('placements.companies.contacts')}</h4>
            {!c.contacts.length ? <p className="text-sm text-ink-faint">{t('placements.companies.noContacts')}</p> : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {c.contacts.map((x) => (
                  <div key={x.id} className="rounded-xl border border-border p-3 text-sm">
                    <p className="flex items-center gap-1.5 font-medium text-ink"><UserRound className="h-4 w-4 text-ink-faint" />{x.name}{x.primary && <span className="rounded bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700">{t('placements.companies.primaryShort')}</span>}</p>
                    {x.designation && <p className="text-xs text-ink-muted">{x.designation}</p>}
                    {x.email && <a href={`mailto:${x.email}`} className="mt-1 flex items-center gap-1.5 text-xs text-brand-700"><Mail className="h-3.5 w-3.5" />{x.email}</a>}
                    {x.mobile && <a href={`tel:${x.mobile}`} className="flex items-center gap-1.5 text-xs text-brand-700"><Phone className="h-3.5 w-3.5" />{x.mobile}</a>}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('placements.companies.visits')}</h4>
            {!c.drives.length ? <p className="text-sm text-ink-faint">{t('placements.companies.noVisits')}</p> : (
              <ol className="relative space-y-3 border-s border-border ps-4">
                {c.drives.map((d) => (
                  <li key={d.id} className="relative">
                    <span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{d.title}</p>
                      <DriveStatusPill status={d.status} />
                    </div>
                    <p className="text-xs text-ink-muted">{[d.startDate && date(d.startDate), ctcRange(d.ctcMin, d.ctcMax), t('placements.companies.offerCount', { count: d.offers })].filter(Boolean).join(' · ')}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {c.notes && <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('placements.companies.notes')}</h4><p className="whitespace-pre-line text-sm text-ink">{c.notes}</p></section>}
        </div>
      )}
    </Drawer>
  )
}

/** Placements › Companies: the recruiters — sector, HR contacts, past visits and offers — as a wall of company cards. */
export default function PlacementsCompanies() {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [sector, setSector] = useState('')
  const [active, setActive] = useState('active')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null) // null · 'new' · company
  const params = { sector: sector || undefined, search: q || undefined, active }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['placements', 'companies', params], queryFn: () => fetchCompanies(params) })
  const rows = data?.data ?? []
  const counts = data?.sectors ?? {}
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const refresh = () => qc.invalidateQueries({ queryKey: ['placements'] })
  const visited = rows.filter((c) => c.visits.drives > 0).length
  const offers = rows.reduce((n, c) => n + c.visits.offers, 0)
  const best = rows.reduce((m, c) => Math.max(m, c.visits.bestCtc), 0)
  return (
    <PageContainer>
      <PageHeader icon={Building2} title={t('placements.companies.title')} subtitle={t('placements.companies.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="placements.companies.create" onClick={() => setEditing('new')}>{t('placements.companies.new')}</HeaderButton>} />
      <SideNavLayout nav={<SideNav title={t('placements.companies.sectors')} value={sector} onChange={setSector} items={[
        { id: '', label: t('placements.companies.allSectors'), count: total },
        ...COMPANY_SECTORS.filter((s) => counts[s.value]).map((s) => ({ id: s.value, label: L.sector(s.value), count: counts[s.value] })),
      ]} />}>
        <StatCardRow items={[
          { icon: Building2, label: t('placements.companies.statCompanies'), value: rows.length, tone: 'brand' },
          { icon: CalendarClock, label: t('placements.companies.statVisited'), value: visited, tone: 'violet', progress: rows.length ? (visited / rows.length) * 100 : 0 },
          { icon: Trophy, label: t('placements.companies.statOffers'), value: offers, tone: 'success' },
          { icon: Briefcase, label: t('placements.companies.statBest'), value: formatLpa(best), tone: 'orange' },
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-72"><SearchInput value={search} onChange={setSearch} placeholder={t('placements.companies.search')} /></div>
          <SegmentedControl value={active} onChange={setActive} options={['active', 'inactive', 'all'].map((v) => ({ value: v, label: t(`placements.companies.show.${v}`) }))} />
        </div>
        {isLoading ? <SkeletonRows rows={6} /> : error ? <EmptyState error={error} onRetry={refetch} /> : !rows.length ? (
          <EmptyState icon={Building2} title={t('placements.companies.empty')} hint={t('placements.companies.emptyHint')} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {rows.map((c) => {
              const contact = c.contacts.find((x) => x.primary) ?? c.contacts[0]
              return (
                <button key={c.id} type="button" onClick={() => setOpen(c.id)} className={`${PANEL} flex flex-col gap-3 p-4 text-start transition hover:-translate-y-0.5 hover:shadow-lg ${c.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start gap-3">
                    <CompanyLogo name={c.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{c.name}</p>
                      <p className="truncate text-xs text-ink-muted">{[L.sector(c.sector), c.city].filter(Boolean).join(' · ')}</p>
                    </div>
                    {c.visits.bestCtc > 0 && <span className="shrink-0 rounded-lg bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">{formatLpa(c.visits.bestCtc)}</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-black/[0.03] py-1.5"><p className="text-base font-semibold tabular-nums text-ink">{c.visits.drives}</p><p className="text-[11px] text-ink-muted">{t('placements.companies.drives')}</p></div>
                    <div className="rounded-lg bg-black/[0.03] py-1.5"><p className="text-base font-semibold tabular-nums text-ink">{c.visits.offers}</p><p className="text-[11px] text-ink-muted">{t('placements.companies.offers')}</p></div>
                    <div className="rounded-lg bg-black/[0.03] py-1.5"><p className="truncate px-1 text-[13px] font-semibold text-ink">{c.visits.lastVisit ? date(c.visits.lastVisit) : '—'}</p><p className="text-[11px] text-ink-muted">{t('placements.companies.lastVisit')}</p></div>
                  </div>
                  {contact && <p className="flex items-center gap-1.5 truncate text-xs text-ink-muted"><UserRound className="h-3.5 w-3.5 shrink-0" />{[contact.name, contact.designation].filter(Boolean).join(' · ')}</p>}
                </button>
              )
            })}
          </div>
        )}
      </SideNavLayout>
      {open && <CompanyDrawer id={open} onClose={() => setOpen(null)} onEdit={(c) => { setOpen(null); setEditing(c) }} onDeleted={() => { setOpen(null); refresh() }} />}
      {editing && <CompanyForm company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(c) => { setEditing(null); refresh(); showSuccess(t('placements.companies.saved')); setOpen(c.id) }} />}
    </PageContainer>
  )
}
