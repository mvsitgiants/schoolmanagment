import { useId } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ScanSearch } from 'lucide-react'
import { ITEM_TYPES, hasCopies, toPaise } from '@schoolgiant/shared'
import { FormField, FormSection, Input, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { lookupIsbn } from '../../api/library'
import { fetchAcademicLookup } from '../../api/academics'
import { useSnackbar } from '../../context/SnackbarContext'
import { useLibraryLabels, useLibraryMeta } from './LibraryKit'

/** The form's starting values from a title (edit) or blank (add). */
export function titleFormValues(title) {
  return {
    title: title?.title ?? '', subtitle: title?.subtitle ?? '', authors: (title?.authors ?? []).join(', '), isbn: title?.isbn ?? '', publisher: title?.publisher ?? '',
    year: title?.year ?? '', edition: title?.edition ?? '', language: title?.language ?? '', type: title?.type ?? 'BOOK', category: title?.category ?? '', callNo: title?.callNo ?? '',
    description: title?.description ?? '', ebookUrl: title?.ebookUrl ?? '', forFamilies: title?.forFamilies ?? false, classIds: title?.classIds ?? [],
    count: 1, price: '', shelf: '',
  }
}

/** What the API takes from the form. Copies go with a new title only (an existing one adds them from its page). */
export function titleBody(form, { editing = false } = {}) {
  return {
    title: form.title, subtitle: form.subtitle, authors: form.authors.split(/[,;]/).map((x) => x.trim()).filter(Boolean), isbn: form.isbn, publisher: form.publisher,
    year: form.year === '' ? null : Number(form.year), edition: form.edition, language: form.language, type: form.type, category: form.category, callNo: form.callNo,
    description: form.description, ebookUrl: form.ebookUrl, forFamilies: form.forFamilies, classIds: form.classIds,
    ...(!editing && hasCopies(form.type) && Number(form.count) > 0 && { copies: { count: Number(form.count), price: form.price === '' ? null : toPaise(form.price), shelf: form.shelf } }),
  }
}

/**
 * Add / edit form for a catalogue title. Controlled: `value` + `onChange(next)`. `errors` are the API's field errors.
 * `titleId` is the title being edited (so its own ISBN is not reported as a duplicate); `editing` hides the copies section.
 */
export default function TitleForm({ value: form, onChange, errors = {}, onErrors, editing = false, titleId }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const { showError, showSuccess } = useSnackbar()
  const { data: meta } = useLibraryMeta()
  const { data: lookup } = useQuery({ queryKey: ['academics', 'lookup'], queryFn: fetchAcademicLookup })
  const set = (k) => (e) => onChange({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const fill = useMutation({
    mutationFn: () => lookupIsbn(form.isbn),
    onSuccess: (r) => {
      if (r.existing && r.existing.id !== titleId) showError(t('library.titles.isbnExists', { title: r.existing.title }))
      if (!r.found) { showError(t('library.titles.isbnNotFound')); return }
      const d = r.data
      onChange({ ...form, isbn: r.isbn, title: form.title || d.title || '', subtitle: form.subtitle || d.subtitle || '', authors: form.authors || (d.authors ?? []).join(', '), publisher: form.publisher || d.publisher || '', year: form.year || d.year || '', category: form.category || d.category || '' })
      showSuccess(t('library.titles.isbnFilled'))
    },
    onError: (e) => { onErrors?.(e.details?.fields ?? {}); showError(e.message) },
  })
  const ebook = form.type === 'EBOOK'
  const isbnId = `isbn${useId().replace(/:/g, '')}`
  const toggleClass = (id) => onChange({ ...form, classIds: form.classIds.includes(id) ? form.classIds.filter((x) => x !== id) : [...form.classIds, id] })

  return (
    <div className="space-y-5">
      <FormSection title={t('library.titles.form.book')} hint={t('library.titles.form.bookHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('library.titles.isbn')} htmlFor={isbnId} error={errors.isbn} hint={t('library.titles.isbnHint')} className="sm:col-span-2">
            <div className="flex gap-2">
              <Input id={isbnId} value={form.isbn} onChange={set('isbn')} placeholder="978…" inputMode="numeric" aria-invalid={errors.isbn ? true : undefined} />
              <Button variant="secondary" icon={ScanSearch} loading={fill.isPending} disabled={form.isbn.replace(/\D/g, '').length < 10} onClick={() => fill.mutate()} className="shrink-0">{t('library.titles.fill')}</Button>
            </div>
          </FormField>
          <FormField label={t('library.titles.type')}><Select value={form.type} onChange={set('type')}>{ITEM_TYPES.map((x) => <option key={x.value} value={x.value}>{L.type(x.value)}</option>)}</Select></FormField>
          <FormField label={t('library.titles.category')}>
            <Input value={form.category} onChange={set('category')} list="library-categories" />
            <datalist id="library-categories">{(meta?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          </FormField>
          <FormField label={t('library.titles.title')} required error={errors.title} className="sm:col-span-2 xl:col-span-4"><Input value={form.title} onChange={set('title')} /></FormField>
          <FormField label={t('library.titles.subtitle')} className="sm:col-span-2"><Input value={form.subtitle} onChange={set('subtitle')} /></FormField>
          <FormField label={t('library.titles.authors')} hint={t('library.titles.authorsHint')} className="sm:col-span-2"><Input value={form.authors} onChange={set('authors')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('library.titles.form.details')} hint={t('library.titles.form.detailsHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('library.titles.publisher')} className="sm:col-span-2"><Input value={form.publisher} onChange={set('publisher')} /></FormField>
          <FormField label={t('library.titles.year')}><Input type="number" min="1400" max="2100" value={form.year} onChange={set('year')} /></FormField>
          <FormField label={t('library.titles.edition')}><Input value={form.edition} onChange={set('edition')} /></FormField>
          <FormField label={t('library.titles.language')}>
            <Input value={form.language} onChange={set('language')} list="library-languages" />
            <datalist id="library-languages">{(meta?.languages ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          </FormField>
          <FormField label={t('library.titles.callNo')} hint={t('library.titles.callNoHint')}><Input value={form.callNo} onChange={set('callNo')} /></FormField>
          <FormField label={t('library.titles.description')} className="sm:col-span-2 xl:col-span-4"><Textarea rows={2} value={form.description} onChange={set('description')} /></FormField>
        </div>
      </FormSection>

      {ebook && (
        <FormSection title={t('library.titles.ebook')} hint={t('library.titles.form.ebookHint')}>
          <div className="space-y-4">
            <FormField label={t('library.titles.ebookUrl')} error={errors.ebookUrl} hint={t('library.titles.ebookUrlHint')}><Input type="url" value={form.ebookUrl} onChange={set('ebookUrl')} placeholder="https://" /></FormField>
            <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.forFamilies} onChange={set('forFamilies')} className="rounded border-border text-brand-500" />{t('library.titles.forFamilies')}</label>
            {form.forFamilies && (lookup?.classes ?? []).length > 0 && (
              <div>
                <p className="text-xs font-medium text-ink-muted mb-1.5">{t('library.titles.classes')}</p>
                <div className="flex flex-wrap gap-2">
                  {lookup.classes.map((c) => (
                    <label key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                      <input type="checkbox" checked={form.classIds.includes(c.id)} onChange={() => toggleClass(c.id)} className="rounded border-border text-brand-500" />{c.name}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-ink-faint mt-1">{t('library.titles.classesHint')}</p>
              </div>
            )}
          </div>
        </FormSection>
      )}

      {!editing && hasCopies(form.type) && (
        <FormSection title={t('library.titles.form.copies')} hint={t('library.titles.copiesHint')}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label={t('library.titles.copiesCount')}><Input type="number" min="0" max="200" value={form.count} onChange={set('count')} /></FormField>
            <FormField label={t('library.copies.price')}><Input type="number" min="0" value={form.price} onChange={set('price')} /></FormField>
            <FormField label={t('library.copies.shelf')}><Input value={form.shelf} onChange={set('shelf')} /></FormField>
          </div>
        </FormSection>
      )}
    </div>
  )
}
