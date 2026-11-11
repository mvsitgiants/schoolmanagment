import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FileText, Link2, Play, Plus, StickyNote, Trash2, Video } from 'lucide-react'
import { FILE_MAX_MB, videoEmbed } from '@schoolgiant/shared'
import { Attachments, FormField, Input, Note, Textarea } from '../system'
import Button from '../ui/Button'

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

/**
 * The lesson plan form's "Teaching material": links (videos, websites, Drive / Docs), notes, and — once the plan
 * is saved — files (PDF, Word, Excel, PowerPoint, pictures, short videos).
 * value = { links: [{ title, url }], materialNotes }; onChange(next)
 */
export function MaterialEditor({ planId, value, onChange, errors = {} }) {
  const { t } = useTranslation('homework')
  const links = value.links ?? []
  const setLinks = (next) => onChange({ ...value, links: next })
  const setLink = (i, k) => (e) => setLinks(links.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)))
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-ink">{t('homework.material.title')}</legend>
      <p className="text-xs text-ink-muted">{t('homework.material.hint')}</p>

      <div>
        <p className="mb-1.5 text-xs font-medium text-ink">{t('homework.material.links')}</p>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <Input value={l.title} maxLength={120} onChange={setLink(i, 'title')} placeholder={t('homework.material.linkTitle')} aria-label={t('homework.material.linkTitle')} />
              <Input value={l.url} maxLength={1000} onChange={setLink(i, 'url')} placeholder="https://" aria-label={t('homework.material.linkUrl')}
                error={errors[`links.${i}.url`]} inputMode="url" />
              <Button variant="ghost" icon={Trash2} aria-label={t('homework.material.removeLink')} title={t('homework.material.removeLink')} onClick={() => setLinks(links.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        {links.length < 20 && <Button className="mt-2" size="sm" variant="secondary" icon={Plus} onClick={() => setLinks([...links, { title: '', url: '' }])}>{t('homework.material.addLink')}</Button>}
        <p className="mt-1 text-[11px] text-ink-faint">{t('homework.material.linksHint')}</p>
      </div>

      <FormField label={t('homework.material.notes')} hint={t('homework.material.notesHint')}>
        <Textarea rows={3} value={value.materialNotes ?? ''} maxLength={4000} onChange={(e) => onChange({ ...value, materialNotes: e.target.value })} />
      </FormField>

      <div>
        <p className="mb-1.5 text-xs font-medium text-ink">{t('homework.material.files')}</p>
        {planId
          ? <Attachments entityType="lesson_plan" entityId={planId} canAdd compact label={t('homework.material.files')} />
          : <Note>{t('homework.material.saveFirst', { max: FILE_MAX_MB })}</Note>}
      </div>
    </fieldset>
  )
}

/** A link in the lesson view: videos play right here; other links open in a new tab. */
function LinkRow({ link }) {
  const { t } = useTranslation('homework')
  const [playing, setPlaying] = useState(false)
  const embed = videoEmbed(link.url)
  const label = link.title?.trim() || hostOf(link.url) || link.url
  return (
    <li className="py-2">
      <div className="flex items-center gap-2.5">
        {embed ? <Video className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /> : <Link2 className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{label}</span>
          <span className="block truncate text-xs text-ink-faint">{hostOf(link.url)}</span>
        </span>
        {embed && <Button size="sm" variant={playing ? 'ghost' : 'secondary'} icon={Play} onClick={() => setPlaying(!playing)}>{playing ? t('homework.material.hide') : t('homework.material.play')}</Button>}
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />{t('homework.material.open')}
        </a>
      </div>
      {playing && embed && (
        <div className="mt-2 aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
          <iframe src={embed} title={label} className="h-full w-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      )}
    </li>
  )
}

/** The lesson view's "Teaching material": links (videos play inline), files, notes. Hidden when there is none and nobody can add. */
export function MaterialView({ plan }) {
  const { t } = useTranslation('homework')
  const links = plan.links ?? []
  // nothing written and the reader can't add: just the files, if there are any (no empty heading)
  if (!links.length && !plan.materialNotes && !plan.canChange) {
    return <Attachments entityType="lesson_plan" entityId={plan.id} canAdd={false} compact hideEmpty label={t('homework.material.files')} />
  }
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><FileText className="h-4 w-4 text-brand-600" />{t('homework.material.title')}</h3>
      <div className="space-y-3">
        {links.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border px-3">{links.map((l, i) => <LinkRow key={l.id ?? i} link={l} />)}</ul>}
        <Attachments entityType="lesson_plan" entityId={plan.id} canAdd={!!plan.canChange} compact label={t('homework.material.files')} />
        {plan.materialNotes && (
          <div className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <p className="whitespace-pre-line text-sm text-ink">{plan.materialNotes}</p>
          </div>
        )}
      </div>
    </section>
  )
}

