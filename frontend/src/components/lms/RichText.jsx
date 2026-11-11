import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Link2, List, ListOrdered, Underline } from 'lucide-react'
import { safeHref, sanitizeHtml } from '@schoolgiant/shared'
import { usePrompt } from '../system'
import { useSnackbar } from '../../context/SnackbarContext'

// Small rich text: bold, italic, underline, lists, links, alignment. What it saves is cleaned by the shared allow-list
// (packages/shared/src/richText.js); the server cleans it again, and the views clean it before showing it.

const RICH = 'text-sm leading-relaxed text-ink break-words [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_a]:text-brand-700 [&_a]:underline'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Rich text, shown as students see it. */
export function RichTextView({ html, className }) {
  const clean = sanitizeHtml(html ?? '')
  if (!clean) return null
  return <div className={clsx(RICH, className)} dangerouslySetInnerHTML={{ __html: clean }} />
}

/** The editor. Uncontrolled after the first paint (so the caret never jumps); `onChange` gets cleaned HTML. */
export function RichTextEditor({ value, onChange, placeholder, id }) {
  const { t } = useTranslation('lms')
  const { showError } = useSnackbar()
  const prompt = usePrompt()
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.innerHTML = sanitizeHtml(value ?? '') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const emit = () => onChange?.(sanitizeHtml(ref.current?.innerHTML ?? ''))
  const exec = (cmd, arg) => { ref.current?.focus(); document.execCommand(cmd, false, arg); emit() }
  const addLink = async () => {
    const sel = window.getSelection()
    const range = sel?.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null
    const raw = String(await prompt({ title: t('lms.rich.linkTitle'), label: t('lms.rich.linkLabel'), placeholder: t('lms.rich.linkPlaceholder'), required: true }) ?? '').trim()
    if (!raw) return
    const href = safeHref(/^[a-z]+:/i.test(raw) ? raw : `https://${raw}`)
    if (!href) { showError(t('lms.rich.badLink')); return }
    ref.current?.focus()
    if (range) { sel.removeAllRanges(); sel.addRange(range) }
    if (!range || range.collapsed) document.execCommand('insertHTML', false, `<a href="${esc(href)}">${esc(href)}</a>&nbsp;`)
    else document.execCommand('createLink', false, href)
    emit()
  }
  const tools = [
    { icon: Bold, label: t('lms.rich.bold'), run: () => exec('bold') },
    { icon: Italic, label: t('lms.rich.italic'), run: () => exec('italic') },
    { icon: Underline, label: t('lms.rich.underline'), run: () => exec('underline') },
    { sep: true },
    { icon: List, label: t('lms.rich.bullets'), run: () => exec('insertUnorderedList') },
    { icon: ListOrdered, label: t('lms.rich.numbers'), run: () => exec('insertOrderedList') },
    { icon: Link2, label: t('lms.rich.link'), run: addLink },
    { sep: true },
    { icon: AlignLeft, label: t('lms.rich.left'), run: () => exec('justifyLeft') },
    { icon: AlignCenter, label: t('lms.rich.center'), run: () => exec('justifyCenter') },
    { icon: AlignRight, label: t('lms.rich.right'), run: () => exec('justifyRight') },
  ]
  return (
    <div className="rounded-lg border border-border bg-surface focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label={t('lms.rich.toolbar')}>
        {tools.map((x, i) => (x.sep ? <span key={i} className="mx-1 h-4 w-px bg-border" aria-hidden /> : (
          <button key={i} type="button" title={x.label} aria-label={x.label} onMouseDown={(e) => e.preventDefault()} onClick={x.run}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-black/[0.04] hover:text-ink">
            <x.icon className="h-4 w-4" aria-hidden />
          </button>
        )))}
      </div>
      <div id={id} ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder={placeholder}
        onInput={emit} onBlur={emit}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); emit() }}
        className={clsx(RICH, 'min-h-[120px] max-h-[360px] overflow-y-auto px-3 py-2 outline-none empty:before:text-ink-faint empty:before:content-[attr(data-placeholder)]')} />
    </div>
  )
}
