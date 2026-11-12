import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlignCenter, AlignLeft, AlignRight, Bold, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, PlayCircle, Underline } from 'lucide-react'
import { safeHref, sanitizeHtml, videoEmbed } from '@schoolgiant/shared'
import { usePrompt } from '../system'
import { useSnackbar } from '../../context/SnackbarContext'

// Rich text: bold, italic, underline, headings, lists, links, alignment, pictures and video placeholders. What it saves
// is cleaned by the shared allow-list (packages/shared/src/richText.js); the server cleans it again, and the views clean
// it before showing it. A video placeholder (a[data-embed=video] on a YouTube / Vimeo link) shows as the player.

const RICH = 'text-sm leading-relaxed text-ink break-words [&_p]:my-1 [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_a]:text-brand-700 [&_a]:underline [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const decodeAttr = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const VIDEO_A = /<a href="([^"]+)"[^>]*data-embed="video"[^>]*>[\s\S]*?<\/a>/g

/** Clean HTML with each video placeholder turned into its player (the address comes from videoEmbed only). */
export function withVideoPlayers(clean, title = '') {
  return clean.replace(VIDEO_A, (whole, href) => {
    const src = videoEmbed(decodeAttr(href))
    return src ? `<span class="my-2 block aspect-video w-full overflow-hidden rounded-lg border border-border bg-black"><iframe src="${esc(src)}" class="h-full w-full" title="${esc(title)}" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></span>` : whole
  })
}

/** Rich text, shown as students see it (videos as players unless `players` is off). */
export function RichTextView({ html, className, players = true }) {
  const { t } = useTranslation('lms')
  const clean = sanitizeHtml(html ?? '')
  if (!clean) return null
  return <div className={clsx(RICH, className)} dangerouslySetInnerHTML={{ __html: players ? withVideoPlayers(clean, t('lms.rich.videoPlayer')) : clean }} />
}

/**
 * The editor. Uncontrolled after the first paint (so the caret never jumps); `onChange` gets cleaned HTML.
 *   headings     show the heading buttons
 *   onPickImage  show the picture button; called to pick and upload one — then call ref.insertImage(src, alt)
 *   videos       show the video button (a YouTube / Vimeo link students see as the player)
 *   tall         a taller writing area (phones: at least 40% of the screen)
 * The ref offers focus(), insertHtml(html) and insertImage(src, alt), at the caret (or the end).
 */
export const RichTextEditor = forwardRef(function RichTextEditor({ value, onChange, placeholder, id, headings = false, onPickImage, videos = false, tall = false }, outer) {
  const { t } = useTranslation('lms')
  const { showError } = useSnackbar()
  const prompt = usePrompt()
  const ref = useRef(null)
  const saved = useRef(null) // the caret, kept so a picture added after a dialog lands where the teacher was
  useEffect(() => { if (ref.current) ref.current.innerHTML = sanitizeHtml(value ?? '') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const emit = () => onChange?.(sanitizeHtml(ref.current?.innerHTML ?? ''))
  const keep = () => {
    const sel = window.getSelection()
    if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange()
  }
  const restore = () => {
    ref.current?.focus()
    const sel = window.getSelection()
    if (saved.current && ref.current?.contains(saved.current.startContainer)) { sel.removeAllRanges(); sel.addRange(saved.current) } else {
      const r = document.createRange(); r.selectNodeContents(ref.current); r.collapse(false); sel.removeAllRanges(); sel.addRange(r)
    }
  }
  const insertHtml = (html) => { restore(); document.execCommand('insertHTML', false, html); keep(); emit() }
  useImperativeHandle(outer, () => ({
    focus: () => restore(),
    insertHtml,
    insertImage: (src, alt = '') => insertHtml(`<p><img src="${esc(src)}" alt="${esc(alt)}"></p><p><br></p>`),
  }))
  const exec = (cmd, arg) => { ref.current?.focus(); document.execCommand(cmd, false, arg); emit() }
  const heading = (tag) => {
    const block = document.queryCommandValue('formatBlock')?.toLowerCase()
    exec('formatBlock', block === tag ? '<p>' : `<${tag}>`)
  }
  const addLink = async () => {
    keep()
    const sel = window.getSelection()
    const range = saved.current
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
  const addVideo = async () => {
    keep()
    const raw = String(await prompt({ title: t('lms.rich.videoTitle'), label: t('lms.rich.videoLabel'), placeholder: t('lms.rich.videoPlaceholder'), required: true }) ?? '').trim()
    if (!raw) return
    const href = safeHref(/^[a-z]+:/i.test(raw) ? raw : `https://${raw}`)
    if (!href || !videoEmbed(href)) { showError(t('lms.rich.badVideo')); return }
    insertHtml(`<p><a href="${esc(href)}" data-embed="video">${esc(t('lms.rich.videoText', { url: href }))}</a></p><p><br></p>`)
  }
  const tools = [
    { icon: Bold, label: t('lms.rich.bold'), run: () => exec('bold') },
    { icon: Italic, label: t('lms.rich.italic'), run: () => exec('italic') },
    { icon: Underline, label: t('lms.rich.underline'), run: () => exec('underline') },
    ...(headings ? [{ sep: true }, { icon: Heading2, label: t('lms.rich.heading'), run: () => heading('h2') }, { icon: Heading3, label: t('lms.rich.subheading'), run: () => heading('h3') }] : []),
    { sep: true },
    { icon: List, label: t('lms.rich.bullets'), run: () => exec('insertUnorderedList') },
    { icon: ListOrdered, label: t('lms.rich.numbers'), run: () => exec('insertOrderedList') },
    { icon: Link2, label: t('lms.rich.link'), run: addLink },
    ...(onPickImage ? [{ icon: ImagePlus, label: t('lms.rich.picture'), run: () => { keep(); onPickImage() } }] : []),
    ...(videos ? [{ icon: PlayCircle, label: t('lms.rich.video'), run: addVideo }] : []),
    { sep: true },
    { icon: AlignLeft, label: t('lms.rich.left'), run: () => exec('justifyLeft') },
    { icon: AlignCenter, label: t('lms.rich.center'), run: () => exec('justifyCenter') },
    { icon: AlignRight, label: t('lms.rich.right'), run: () => exec('justifyRight') },
  ]
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      <div className="scroll-thin flex flex-nowrap items-center gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1" role="toolbar" aria-label={t('lms.rich.toolbar')}>
        {tools.map((x, i) => (x.sep ? <span key={i} className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden /> : (
          <button key={i} type="button" title={x.label} aria-label={x.label} onMouseDown={(e) => e.preventDefault()} onClick={x.run}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-black/[0.04] hover:text-ink [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10">
            <x.icon className="h-4 w-4" aria-hidden />
          </button>
        )))}
      </div>
      <div id={id} ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder={placeholder}
        onInput={() => { keep(); emit() }} onBlur={() => { keep(); emit() }} onKeyUp={keep} onMouseUp={keep}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); emit() }}
        className={clsx(RICH, 'overflow-y-auto px-3 py-2 outline-none empty:before:text-ink-faint empty:before:content-[attr(data-placeholder)]', tall ? 'min-h-[40vh] max-h-[70vh] lg:min-h-[260px]' : 'min-h-[120px] max-h-[360px]')} />
    </div>
  )
})
