import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, Plus, Save, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { MODULES, SUPPORTED_LANGUAGES } from '@schoolgiant/shared'
import { EmptyState, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import ArticleBody from '../../components/support/ArticleBody'
import { addStarterHelp, deleteHelpArticle, fetchHelpArticles, saveHelpArticle } from '../../api/support'
import { canPlatform } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

// Superadmin › Help articles: short how-tos every school's Help & support page searches, linked to the screens they
// explain. English is the article; Hindi (and other languages) are translations. Starter articles come unpublished.

const LANGS = SUPPORTED_LANGUAGES.map((l) => l.code)

function Editor({ article, onClose }) {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const canEdit = canPlatform('support')
  const [lang, setLang] = useState('en')
  const [preview, setPreview] = useState(false)
  const [v, setV] = useState(() => ({ slug: '', title: '', summary: '', body: '', module: '', pages: [], translations: {}, published: false, order: 100, ...article }))
  const text = lang === 'en' ? v : v.translations[lang] ?? { title: '', summary: '', body: '' }
  const setText = (k, val) => setV((x) => (lang === 'en' ? { ...x, [k]: val } : { ...x, translations: { ...x.translations, [lang]: { ...(x.translations[lang] ?? {}), [k]: val } } }))
  const mod = MODULES.find((m) => m.id === v.module)
  const save = useMutation({
    mutationFn: () => saveHelpArticle(article?.id, { ...v, module: v.module || '' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-help-articles'] }); showSuccess(t('superadmin.help.saved')); onClose() },
    onError: (e) => showError(e.message),
  })
  const remove = useMutation({ mutationFn: () => deleteHelpArticle(article.id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-help-articles'] }); onClose() }, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="xl" title={article ? article.title : t('superadmin.help.newTitle')} footer={<>
      {article && canEdit && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" onClick={async () => { if (await confirm({ title: t('superadmin.help.deleteTitle'), message: t('superadmin.help.deleteMessage'), tone: 'danger', confirmLabel: t('superadmin.help.delete') })) remove.mutate() }}>{t('superadmin.help.delete')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('superadmin.help.close')}</Button>
      {canEdit && <Button icon={Save} loading={save.isPending} disabled={!v.title.trim()} onClick={() => save.mutate()}>{t('superadmin.help.save')}</Button>}
    </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <FormField label={t('superadmin.help.module')}>
            <Select value={v.module} onChange={(e) => setV((x) => ({ ...x, module: e.target.value, pages: [] }))}>
              <option value="">{t('superadmin.help.anyModule')}</option>
              {MODULES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('superadmin.help.order')} hint={t('superadmin.help.orderHint')}><Input inputMode="numeric" value={v.order} onChange={(e) => setV((x) => ({ ...x, order: Number(e.target.value.replace(/\D/g, '')) || 0 }))} /></FormField>
          <FormField label={t('superadmin.help.slug')} hint={t('superadmin.help.slugHint')}><Input value={v.slug} onChange={(e) => setV((x) => ({ ...x, slug: e.target.value }))} placeholder="admit-a-student" /></FormField>
          <FormField label={t('superadmin.help.published')} hint={v.published ? t('superadmin.help.publishedHint') : t('superadmin.help.draftHint')}>
            <div className="h-9 flex items-center"><Switch checked={v.published} onChange={(on) => setV((x) => ({ ...x, published: on }))} label={t('superadmin.help.published')} disabled={!canEdit} /></div>
          </FormField>
        </div>
        {mod && (
          <FormField label={t('superadmin.help.screens')} hint={t('superadmin.help.screensHint')}>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {mod.pages.map((p) => {
                const key = `${mod.id}.${p.id}`
                return (
                  <label key={key} className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
                    <input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={v.pages.includes(key)} onChange={(e) => setV((x) => ({ ...x, pages: e.target.checked ? [...x.pages, key] : x.pages.filter((y) => y !== key) }))} />
                    {p.name}
                  </label>
                )
              })}
            </div>
          </FormField>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l, label: SUPPORTED_LANGUAGES.find((x) => x.code === l)?.nativeName ?? l }))} />
          <SegmentedControl value={preview ? 'P' : 'W'} onChange={(x) => setPreview(x === 'P')} options={[{ value: 'W', label: t('superadmin.help.write') }, { value: 'P', label: t('superadmin.help.preview') }]} />
        </div>
        {lang !== 'en' && !text.title && <Note>{t('superadmin.help.noTranslation')}</Note>}
        {preview ? (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <p className="font-display text-lg font-semibold text-ink">{text.title || v.title}</p>
            {(text.summary || v.summary) && <p className="text-sm text-ink-muted">{text.summary || v.summary}</p>}
            <ArticleBody text={text.body || v.body} />
          </div>
        ) : (
          <div className="space-y-3">
            <FormField label={t('superadmin.help.title')}><Input value={text.title ?? ''} onChange={(e) => setText('title', e.target.value)} maxLength={160} /></FormField>
            <FormField label={t('superadmin.help.summary')}><Input value={text.summary ?? ''} onChange={(e) => setText('summary', e.target.value)} maxLength={300} /></FormField>
            <FormField label={t('superadmin.help.body')} hint={t('superadmin.help.bodyHint')}><Textarea rows={12} value={text.body ?? ''} onChange={(e) => setText('body', e.target.value)} className="font-mono text-[13px]" /></FormField>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function HelpArticles() {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data, isLoading } = useQuery({ queryKey: ['sa-help-articles'], queryFn: fetchHelpArticles })
  const [open, setOpen] = useState(null) // article, or 'new'
  const canEdit = canPlatform('support')
  const starter = useMutation({
    mutationFn: addStarterHelp,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['sa-help-articles'] }); showSuccess(t('superadmin.help.starterAdded', { count: r.added })) },
    onError: (e) => showError(e.message),
  })
  const rows = data?.rows ?? []
  const modName = (id) => MODULES.find((m) => m.id === id)?.name
  return (
    <PageContainer>
      <PageHeader icon={BookOpen} title={t('superadmin.help.pageTitle')} subtitle={t('superadmin.help.pageSubtitle')}
        actions={canEdit && <>
          {data?.starterLeft > 0 && <Button variant="secondary" icon={Sparkles} loading={starter.isPending} onClick={() => starter.mutate()}>{t('superadmin.help.addStarter', { count: data.starterLeft })}</Button>}
          <Button icon={Plus} onClick={() => setOpen('new')}>{t('superadmin.help.new')}</Button>
        </>} />
      <Panel flush>
        {isLoading ? <p className="px-4 py-4 text-sm text-ink-faint">…</p> : !rows.length ? <EmptyState icon={BookOpen} title={t('superadmin.help.empty')} hint={t('superadmin.help.emptyHint')} /> : (
          <ul className="divide-y divide-border">
            {rows.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setOpen(a)} className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-black/[0.02]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{a.title}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {[modName(a.module), Object.keys(a.translations).length ? t('superadmin.help.alsoIn', { list: Object.keys(a.translations).join(', ') }) : null, t('superadmin.help.views', { count: a.views })].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="hidden sm:flex items-center gap-2 text-xs text-ink-muted"><ThumbsUp className="w-3.5 h-3.5" />{a.helpful.yes}<ThumbsDown className="w-3.5 h-3.5 ms-1" />{a.helpful.no}</span>
                  <StatusPill tone={a.published ? 'success' : 'neutral'}>{a.published ? t('superadmin.help.isPublished') : t('superadmin.help.isDraft')}</StatusPill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {open && <Editor key={open === 'new' ? 'new' : open.id} article={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </PageContainer>
  )
}
