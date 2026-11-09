import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, FilePlus2, Globe, Home, Save, Send, Settings2, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import { SITE_BLOCK_TYPES, SITE_PAGE_KINDS, SITE_PAGE_STATUS, newSiteBlock, siteSlug } from '@schoolgiant/shared'
import { FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, Select, SideNav, SideNavLayout, StatusPill, TONE, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import {
  createSitePage, deleteSitePage, fetchSitePage, fetchSitePages, previewSitePage, publishSitePage, reorderSitePages, saveSitePage, saveSiteSettings, staffImageUrl, unpublishSitePage,
} from '../../api/website'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import BlockEditor, { BLOCK_ICON, BLOCK_TONE } from '../../components/website/BlockEditor'
import SiteView from '../../components/website/SiteView'

const blockLabel = (t, type) => t(`website.blockTypes.${type}`)

function NewPageModal({ existing, onClose, onDone }) {
  const { t } = useTranslation('website')
  const { showError } = useSnackbar()
  const kinds = SITE_PAGE_KINDS.filter((k) => k.value === 'CUSTOM' || !existing.includes(k.value))
  const [form, setForm] = useState({ kind: kinds[0]?.value ?? 'CUSTOM', title: '', slug: '' })
  const title = form.title || (form.kind !== 'CUSTOM' ? t(`website.kinds.${form.kind}`) : '')
  const save = useMutation({ mutationFn: () => createSitePage({ kind: form.kind, title, slug: form.slug || undefined }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('website.pages.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>{t('website.pages.create')}</Button>
    </>}>
      <div className="space-y-3">
        <FormField label={t('website.pages.kind')}><Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>{kinds.map((k) => <option key={k.value} value={k.value}>{t(`website.kinds.${k.value}`)}</option>)}</Select></FormField>
        <FormField label={t('website.pages.title')} required><Input value={form.title} placeholder={title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={80} /></FormField>
        <FormField label={t('website.pages.slug')} hint={t('website.pages.slugHint', { slug: form.slug || siteSlug(title) || '…' })}><Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: siteSlug(e.target.value) }))} maxLength={40} /></FormField>
      </div>
    </Modal>
  )
}

function SiteSettingsModal({ site, onClose, onDone }) {
  const { t } = useTranslation('website')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(site)
  const set = (path) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => (path.includes('.') ? { ...f, [path.split('.')[0]]: { ...f[path.split('.')[0]], [path.split('.')[1]]: v } } : { ...f, [path]: v }))
  }
  const canPublish = hasPermission('website.pages.publish')
  const save = useMutation({ mutationFn: () => saveSiteSettings(canPublish ? form : { ...form, live: undefined }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={t('website.settings.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-4">
        <label className={`flex items-start gap-3 rounded-xl border p-3 ${form.live ? 'border-success-500/30 bg-success-50' : 'border-border'}`}>
          <input type="checkbox" className="mt-1" checked={form.live} disabled={!canPublish} onChange={set('live')} />
          <span><span className="block text-sm font-semibold text-ink">{t('website.settings.live')}</span><span className="text-xs text-ink-muted">{t('website.settings.liveHint')}</span></span>
        </label>
        <FormField label={t('website.settings.tagline')}><Input value={form.tagline} onChange={set('tagline')} maxLength={160} /></FormField>
        <FormField label={t('website.settings.footer')}><Textarea rows={2} value={form.footer} onChange={set('footer')} maxLength={300} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('website.blocks.phone')}><Input value={form.contact.phone} onChange={set('contact.phone')} /></FormField>
          <FormField label={t('website.blocks.email')}><Input value={form.contact.email} onChange={set('contact.email')} /></FormField>
          <FormField label={t('website.blocks.address')} className="sm:col-span-2"><Textarea rows={2} value={form.contact.address} onChange={set('contact.address')} /></FormField>
        </div>
        <p className="text-xs text-ink-faint">{t('website.settings.contactHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {['facebook', 'instagram', 'youtube', 'x'].map((k) => <FormField key={k} label={t(`website.settings.social.${k}`)}><Input value={form.social[k]} onChange={set(`social.${k}`)} placeholder="https://" /></FormField>)}
        </div>
      </div>
    </Modal>
  )
}

/** One page's editor: details, the blocks (add, move, fold, remove), save / preview / publish. */
function PageEditor({ pageId, pages, slug, onDeleted }) {
  const { t } = useTranslation('website')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const { data: page, isLoading } = useQuery({ queryKey: ['website', 'page', pageId], queryFn: () => fetchSitePage(pageId), enabled: !!pageId })
  const [form, setForm] = useState(null)
  const [open, setOpen] = useState({})
  const [preview, setPreview] = useState(null)
  useEffect(() => { if (page) setForm({ title: page.title, slug: page.slug, inMenu: page.inMenu, seo: page.seo, blocks: page.blocks }) }, [page])
  const dirty = useMemo(() => !!page && !!form && JSON.stringify({ title: page.title, slug: page.slug, inMenu: page.inMenu, seo: page.seo, blocks: page.blocks }) !== JSON.stringify(form), [page, form])
  const refresh = () => qc.invalidateQueries({ queryKey: ['website'] })
  const save = useMutation({ mutationFn: () => saveSitePage(pageId, form), onSuccess: (p) => { qc.setQueryData(['website', 'page', pageId], p); refresh(); showSuccess(t('website.pages.saved')) }, onError: (e) => showError(e.message) })
  const publish = useMutation({
    mutationFn: async () => { if (dirty) await saveSitePage(pageId, form); return publishSitePage(pageId) },
    onSuccess: (p) => { qc.setQueryData(['website', 'page', pageId], p); refresh(); showSuccess(t('website.pages.published')) },
    onError: (e) => showError(e.message),
  })
  const unpublish = useMutation({ mutationFn: () => unpublishSitePage(pageId), onSuccess: (p) => { qc.setQueryData(['website', 'page', pageId], p); refresh(); showSuccess(t('website.pages.unpublished')) }, onError: (e) => showError(e.message) })
  const remove = useMutation({ mutationFn: () => deleteSitePage(pageId), onSuccess: () => { refresh(); onDeleted(); showSuccess(t('website.pages.deleted')) }, onError: (e) => showError(e.message) })
  const move = useMutation({
    mutationFn: (dir) => {
      const ids = pages.map((p) => p.id)
      const i = ids.indexOf(pageId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ids.length) return Promise.resolve(null)
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      return reorderSitePages(ids)
    },
    onSuccess: refresh, onError: (e) => showError(e.message),
  })
  const showPreview = useMutation({ mutationFn: () => previewSitePage(pageId), onSuccess: (d) => setPreview({ ...d, page: { ...d.page, title: form.title, blocks: form.blocks } }), onError: (e) => showError(e.message) })
  if (isLoading || !form || !page) return <div className="h-64 rounded-xl bg-black/[0.05] animate-pulse" />
  const canEdit = hasPermission('website.pages.edit')
  const canPublish = hasPermission('website.pages.publish')
  const setBlocks = (fn) => setForm((f) => ({ ...f, blocks: fn(f.blocks) }))
  const addBlock = (type) => { const b = newSiteBlock(type); setBlocks((bs) => [...bs, b]); setOpen((o) => ({ ...o, [b.id]: true })) }
  const moveBlock = (i, dir) => setBlocks((bs) => { const n = [...bs]; const j = i + dir; if (j < 0 || j >= n.length) return bs; [n[i], n[j]] = [n[j], n[i]]; return n })
  const idx = pages.findIndex((p) => p.id === pageId)
  const status = page.status
  return (
    <div className="space-y-4">
      <Panel title={form.title || t('website.pages.untitled')} subtitle={`/site/${slug ?? ''}${page.kind === 'HOME' ? '' : `/${form.slug}`}`} icon={page.kind === 'HOME' ? Home : Globe}
        actions={<div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={SITE_PAGE_STATUS[status]?.tone}>{t(`website.status.${status}`)}</StatusPill>
          {dirty && <StatusPill tone="warning" dot={false}>{t('website.pages.unsaved')}</StatusPill>}
        </div>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('website.pages.title')} required><Input value={form.title} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={80} /></FormField>
            <FormField label={t('website.pages.slug')}><Input value={form.slug} disabled={!canEdit || page.kind === 'HOME'} onChange={(e) => setForm((f) => ({ ...f, slug: siteSlug(e.target.value) }))} maxLength={40} /></FormField>
            <FormField label={t('website.pages.seoTitle')} hint={t('website.pages.seoTitleHint')}><Input value={form.seo.title} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, seo: { ...f.seo, title: e.target.value } }))} maxLength={70} /></FormField>
            <FormField label={t('website.pages.seoDescription')} hint={t('website.pages.seoDescriptionHint', { count: form.seo.description.length })}><Input value={form.seo.description} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, seo: { ...f.seo, description: e.target.value } }))} maxLength={160} /></FormField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="me-auto flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.inMenu} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, inMenu: e.target.checked }))} />{t('website.pages.inMenu')}</label>
            {canEdit && <>
              <Button size="sm" variant="ghost" icon={ArrowUp} disabled={idx <= 0} onClick={() => move.mutate(-1)} aria-label={t('website.pages.moveUp')} />
              <Button size="sm" variant="ghost" icon={ArrowDown} disabled={idx < 0 || idx >= pages.length - 1} onClick={() => move.mutate(1)} aria-label={t('website.pages.moveDown')} />
            </>}
            <Button size="sm" variant="secondary" icon={Eye} loading={showPreview.isPending} onClick={() => showPreview.mutate()}>{t('website.pages.preview')}</Button>
            {canEdit && <Button size="sm" variant="secondary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('website.pages.saveDraft')}</Button>}
            {canPublish && <Button size="sm" icon={Send} disabled={status === 'PUBLISHED' && !dirty} loading={publish.isPending} onClick={() => publish.mutate()}>{t('website.pages.publish')}</Button>}
            {canPublish && page.publishedAt && <Button size="sm" variant="ghost" icon={EyeOff} loading={unpublish.isPending} onClick={async () => { if (await confirm({ title: t('website.pages.unpublishTitle', { title: page.title }), message: t('website.pages.unpublishHint') })) unpublish.mutate() }}>{t('website.pages.unpublish')}</Button>}
            {hasPermission('website.pages.delete') && page.kind !== 'HOME' && <Button size="sm" variant="ghost" icon={Trash2} className="text-danger-600" aria-label={t('actions.delete')} onClick={async () => { if (await confirm({ title: t('website.pages.deleteTitle', { title: page.title }), message: t('website.pages.deleteHint'), tone: 'danger' })) remove.mutate() }} />}
          </div>
          {page.publishedAt && <p className="text-xs text-ink-faint">{t('website.pages.publishedAt', { when: dateTime(page.publishedAt), by: page.publishedBy ?? '' })}</p>}
        </div>
      </Panel>

      <ol className="space-y-3">
        {form.blocks.map((b, i) => {
          const Icon = BLOCK_ICON[b.type]
          const tone = TONE[BLOCK_TONE[b.type] ?? 'neutral']
          const isOpen = !!open[b.id]
          return (
            <li key={b.id} className="rounded-xl border border-border bg-surface">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-start" onClick={() => setOpen((o) => ({ ...o, [b.id]: !isOpen }))}>
                  {isOpen ? <ChevronDown className="w-4 h-4 text-ink-faint" /> : <ChevronRight className="w-4 h-4 text-ink-faint" />}
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.bg} ${tone.text}`}>{Icon && <Icon className="w-4 h-4" />}</span>
                  <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{blockLabel(t, b.type)}</span><span className="block truncate text-xs text-ink-faint">{b.data.heading || b.data.subheading || t('website.blocks.noHeading')}</span></span>
                  {b.type === 'HERO' && b.data.imageId && <img src={staffImageUrl(b.data.imageId)} alt="" className="ms-auto hidden h-8 w-14 rounded object-cover sm:block" />}
                </button>
                {canEdit && <>
                  <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => moveBlock(i, -1)} aria-label={t('website.pages.moveUp')} />
                  <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === form.blocks.length - 1} onClick={() => moveBlock(i, 1)} aria-label={t('website.pages.moveDown')} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('website.blocks.remove')} onClick={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))} />
                </>}
              </div>
              {isOpen && <div className={`border-t border-border p-4 ${canEdit ? '' : 'pointer-events-none opacity-70'}`}><BlockEditor block={b} onChange={(data) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, data } : x)))} /></div>}
            </li>
          )
        })}
      </ol>
      {!form.blocks.length && <Note>{t('website.pages.noBlocks')}</Note>}

      {canEdit && (
        <Panel title={t('website.blocks.addTitle')} subtitle={t('website.blocks.addSubtitle')}>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
            {SITE_BLOCK_TYPES.map((bt) => {
              const Icon = BLOCK_ICON[bt.value]
              const tone = TONE[BLOCK_TONE[bt.value] ?? 'neutral']
              return (
                <button key={bt.value} type="button" onClick={() => addBlock(bt.value)} disabled={form.blocks.length >= 30}
                  className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-3 text-start transition-all hover:-translate-y-px hover:shadow-card disabled:opacity-50">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone.bg} ${tone.text}`}>{Icon && <Icon className="w-5 h-5" />}</span>
                  <span className="text-sm font-semibold text-ink">{blockLabel(t, bt.value)}</span>
                  <span className="text-[11px] leading-snug text-ink-faint">{t(`website.blockHints.${bt.value}`)}</span>
                </button>
              )
            })}
          </div>
        </Panel>
      )}

      {preview && (
        <Modal open size="xl" onClose={() => setPreview(null)} title={t('website.pages.previewTitle', { title: form.title })}>
          <Note tone="info" className="mb-3">{t('website.pages.previewHint')}</Note>
          <div className="-mx-1 overflow-hidden rounded-xl border border-border"><SiteView data={preview} preview imageUrl={staffImageUrl} /></div>
        </Modal>
      )}
    </div>
  )
}

/** Website › Pages: the site's pages down the left (in menu order), the chosen page's blocks on the right. */
export default function WebsitePages() {
  const { t } = useTranslation('website')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { data, isLoading } = useQuery({ queryKey: ['website', 'pages'], queryFn: fetchSitePages })
  const [sel, setSel] = useState(null)
  const [adding, setAdding] = useState(false)
  const [settings, setSettings] = useState(false)
  const pages = data?.pages ?? []
  const current = sel && pages.some((p) => p.id === sel) ? sel : pages[0]?.id
  const live = data?.site?.live
  const counts = Object.fromEntries(Object.keys(SITE_PAGE_STATUS).map((s) => [s, pages.filter((p) => p.status === s).length]))
  return (
    <PageContainer>
      <PageHeader icon={Globe} title={t('website.pages.heading')} subtitle={t('website.pages.subtitle')}
        actions={<>
          {data?.slug && live && <HeaderButton icon={SquareArrowOutUpRight} onClick={() => window.open(`/site/${data.slug}`, '_blank', 'noopener')}>{t('website.pages.openSite')}</HeaderButton>}
          <HeaderButton icon={Settings2} requires="website.pages.edit" onClick={() => setSettings(true)}>{t('website.settings.button')}</HeaderButton>
          <HeaderButton icon={FilePlus2} variant="primary" requires="website.pages.create" onClick={() => setAdding(true)}>{t('website.pages.new')}</HeaderButton>
        </>} />
      <div className="space-y-4">
        {data && !live && <Note tone="warning" actions={hasPermission('website.pages.edit') ? <Button size="sm" variant="secondary" onClick={() => setSettings(true)}>{t('website.settings.button')}</Button> : undefined}>{t('website.pages.siteOff', { url: `/site/${data.slug}` })}</Note>}
        {data && live && <Note tone="success">{t('website.pages.siteOn', { url: `${window.location.origin}/site/${data.slug}`, published: counts.PUBLISHED + counts.CHANGED, total: pages.length })}</Note>}
        <SideNavLayout nav={<SideNav title={t('website.pages.menu')} value={current} onChange={setSel} items={pages.map((p) => ({
          id: p.id, label: p.title, icon: p.kind === 'HOME' ? Home : Globe, hint: `/${p.slug} · ${t(`website.status.${p.status}`)}${p.inMenu ? '' : ` · ${t('website.pages.hidden')}`}`,
          count: p.blocks, countTone: p.status === 'CHANGED' ? 'warning' : p.status === 'DRAFT' ? 'danger' : undefined,
        }))} />}>
          {isLoading ? <div className="h-64 rounded-xl bg-black/[0.05] animate-pulse" /> : current ? <PageEditor key={current} pageId={current} pages={pages} slug={data?.slug} onDeleted={() => setSel(null)} /> : null}
        </SideNavLayout>
      </div>
      {adding && <NewPageModal existing={pages.map((p) => p.kind)} onClose={() => setAdding(false)} onDone={(p) => { setAdding(false); qc.invalidateQueries({ queryKey: ['website'] }); setSel(p.id); showSuccess(t('website.pages.created')) }} />}
      {settings && data && <SiteSettingsModal site={data.site} onClose={() => setSettings(false)} onDone={() => { setSettings(false); qc.invalidateQueries({ queryKey: ['website'] }); showSuccess(t('website.settings.saved')) }} />}
    </PageContainer>
  )
}
