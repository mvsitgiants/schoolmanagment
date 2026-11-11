import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpen, ClipboardList, ExternalLink, Eye, Link2, ListChecks, Paperclip, Pencil, PlayCircle, Share2, Trash2, Users } from 'lucide-react'
import { CONTENT_STATUS, CONTENT_TYPES } from '@schoolgiant/shared'
import { ColorChip, Modal, StatusPill, TONE, openDocumentViewer } from '../system'
import Button from '../ui/Button'
import { RichTextView } from './RichText'
import { downloadFile } from '../../api/files'
import { fetchTopicContentCount } from '../../api/lms'
import { hasPermission } from '../../api/auth'
import { useModules } from '../../context/ModuleContext'
import { useFormat } from '../../context/SettingsContext'

// Teaching content shared with students: its type tile, status, the card on "My content" / "Content library", the
// preview (as students see it) and the "shared with students" line on a syllabus topic.

export const TYPE_ICON = { MATERIAL: BookOpen, ASSIGNMENT: ClipboardList, QUIZ: ListChecks, VIDEO: PlayCircle, LINK: Link2 }
const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** The type's icon on its own calm colour. */
export function TypeIcon({ type, className, iconClassName = 'h-4 w-4' }) {
  const Icon = TYPE_ICON[type] ?? BookOpen
  const tone = TONE[CONTENT_TYPES[type]?.tone ?? 'neutral']
  return <span className={clsx('grid shrink-0 place-items-center rounded-lg', tone.bg, tone.text, className ?? 'h-9 w-9')} aria-hidden><Icon className={iconClassName} /></span>
}

/** Published, or "Scheduled for 12 Nov, 9:00". */
export function ContentStatus({ item }) {
  const { t } = useTranslation('lms')
  const { dateTime } = useFormat()
  const label = item.status === 'SCHEDULED' ? t('lms.content.scheduledFor', { when: dateTime(item.publishAt) }) : t(`lms.content.status.${item.status}`)
  return <StatusPill tone={CONTENT_STATUS[item.status]?.tone}>{label}</StatusPill>
}

/** One shared item: type, title, class / subject / topic, status, views and files, with its actions. */
export function ContentCard({ item, onOpen, onEdit, onDelete, showTeacher = false }) {
  const { t } = useTranslation('lms')
  return (
    <li className="flex items-start gap-3 py-3">
      <TypeIcon type={item.type} className="h-10 w-10" iconClassName="h-5 w-5" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block max-w-full text-start">
          <span className="block text-sm font-semibold leading-snug text-ink break-words hover:text-brand-700">{item.title}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <ColorChip label={item.className} seed={item.classId} />
          <ColorChip label={item.subject} seed={item.subjectId} dot />
          <span className="text-xs text-ink-muted">{t(`lms.content.types.${item.type}.name`)}</span>
        </div>
        <p className="mt-1 text-xs text-ink-muted break-words">{[item.topic || t('lms.content.noTopic'), showTeacher && item.createdBy && t('lms.content.by', { name: item.createdBy })].filter(Boolean).join(' · ')}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <ContentStatus item={item} />
          <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden />{t('lms.content.views', { count: item.views })}</span>
          {item.files.length > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" aria-hidden />{t('lms.content.filesCount', { count: item.files.length })}</span>}
          {item.visibility === 'STUDENTS' && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{t('lms.content.chosenCount', { count: item.studentIds.length })}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onOpen && <Button size="sm" variant="ghost" icon={Eye} onClick={onOpen} aria-label={t('lms.content.open')} title={t('lms.content.open')} />}
        {onEdit && item.canEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label={t('lms.content.edit')} title={t('lms.content.edit')} />}
        {onDelete && item.canDelete && <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete} aria-label={t('lms.content.delete')} title={t('lms.content.delete')} />}
      </div>
    </li>
  )
}

/**
 * The item as students will see it. `item` is a saved item (files open from the server) or the form being filled in
 * (`pendingFiles`: the files about to be added, shown by name).
 */
export function ContentPreview({ item, pendingFiles = [], onClose, footer }) {
  const { t } = useTranslation('lms')
  const files = item.files ?? []
  const open = (f) => openDocumentViewer({ name: f.name, contentType: f.mime, load: () => downloadFile(f.id) })
  const nothing = !item.descriptionHtml && !item.body && !item.url && !files.length && !pendingFiles.length
  return (
    <Modal open onClose={onClose} size="lg" title={t('lms.content.preview.title')} footer={footer ?? <Button variant="secondary" onClick={onClose}>{t('lms.content.preview.close')}</Button>}>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <TypeIcon type={item.type} className="h-10 w-10" iconClassName="h-5 w-5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{[item.subject, item.topic].filter(Boolean).join(' · ')}</p>
            <p className="mt-0.5 text-base font-semibold leading-snug text-ink break-words">{item.title || t('lms.content.preview.untitled')}</p>
          </div>
        </div>
        {item.descriptionHtml ? <RichTextView html={item.descriptionHtml} /> : item.body ? <p className="text-sm text-ink whitespace-pre-line break-words">{item.body}</p> : null}
        {item.embed && <div className="aspect-video w-full overflow-hidden rounded-xl bg-black"><iframe src={item.embed} title={item.title} className="h-full w-full" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>}
        {item.url && !item.embed && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-brand-700 hover:bg-black/[0.02]">
            <ExternalLink className="h-4 w-4" aria-hidden /><span className="break-all">{item.url}</span>
          </a>
        )}
        {(files.length > 0 || pendingFiles.length > 0) && (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => open(f)} className="flex min-h-[40px] w-full items-center gap-2 rounded-lg border border-border px-3 text-start text-sm text-ink hover:bg-black/[0.02]">
                  <Paperclip className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="shrink-0 text-xs text-ink-faint">{fmtSize(f.size)}</span>
                </button>
              </li>
            ))}
            {pendingFiles.map((f, i) => (
              <li key={`p${i}`} className="flex min-h-[40px] items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-ink">
                <Paperclip className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="shrink-0 text-xs text-ink-faint">{fmtSize(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
        {nothing && <p className="text-sm text-ink-faint">{t('lms.content.preview.nothing')}</p>}
        {item.visibility === 'STUDENTS' && <p className="text-xs text-ink-muted">{t('lms.content.preview.onlyChosen', { count: item.studentIds?.length ?? 0 })}</p>}
      </div>
    </Modal>
  )
}

/** "Shared with students: 3 items" for a syllabus topic, linking to the library filtered by it. */
export function TopicContentLink({ topicId, className }) {
  const { t } = useTranslation('lms')
  const { isEnabled } = useModules()
  const allowed = isEnabled('lms') && hasPermission('lms.content-library.view')
  const { data } = useQuery({ queryKey: ['lms-topic-count', topicId], queryFn: () => fetchTopicContentCount(topicId), enabled: allowed && !!topicId, retry: false, staleTime: 60_000 })
  if (!allowed || !data) return null
  return (
    <Link to={`/lms/content-library?topicId=${topicId}`} className={clsx('inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline', className)}>
      <Share2 className="h-3.5 w-3.5" aria-hidden />{t('lms.content.sharedWithStudents', { count: data.count })}
    </Link>
  )
}
