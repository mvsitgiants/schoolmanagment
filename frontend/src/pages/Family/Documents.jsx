import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Download, FileText, FolderOpen } from 'lucide-react'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyDocumentBlob, familyDocuments } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const isImage = (d) => /^image\//i.test(d.contentType ?? '')

/** A picture of the paper, fetched once it scrolls into view. */
function Thumb({ doc }) {
  const { slug, studentId } = useFamily()
  const ref = useRef(null)
  const [url, setUrl] = useState(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (!isImage(doc) || !ref.current) return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '150px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [doc])
  useEffect(() => {
    if (!seen) return undefined
    let made = null
    let gone = false
    familyDocumentBlob(slug, studentId, doc.id).then((b) => { if (gone) return; made = URL.createObjectURL(b); setUrl(made) }).catch(() => {})
    return () => { gone = true; if (made) URL.revokeObjectURL(made) }
  }, [seen, slug, studentId, doc.id])
  return (
    <div ref={ref} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-t-2xl bg-bg">
      {url ? <img src={url} alt={doc.fileName} className="h-full w-full object-cover" /> : <FileText className="h-8 w-8 text-ink-faint" aria-hidden />}
    </div>
  )
}

/**
 * The family app › Documents: the child's papers the school already holds — given at admission, on the student record,
 * sent for scholarships — so the family sees what is there and does not send it again. Open or save each.
 */
export default function FamilyDocuments() {
  const { t } = useTranslation('family')
  const { slug, studentId, student } = useFamily()
  const { date } = useFormat()
  const [busy, setBusy] = useState(null)
  const { data, isLoading, error } = useFamilyQuery(['documents'], () => familyDocuments(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const docs = data ?? []
  const open = async (d, save = false) => {
    setBusy(d.id)
    try {
      const blob = await familyDocumentBlob(slug, studentId, d.id)
      const url = URL.createObjectURL(blob)
      if (save) {
        const a = document.createElement('a')
        a.href = url; a.download = d.fileName
        a.click()
      } else window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally { setBusy(null) }
  }
  return (
    <>
      <FCard>
        <p className="text-[15px] text-ink">{t('family.docs.intro', { name: student?.firstName ?? '' })}</p>
      </FCard>
      {!docs.length ? <FCard><FEmpty icon={FolderOpen} title={t('family.docs.none')} hint={t('family.docs.noneHint')} /></FCard> : (
        <div className="grid grid-cols-2 gap-3">
          {docs.map((d) => (
            <div key={d.id} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <button type="button" className="block w-full" onClick={() => open(d)} aria-label={t('family.docs.open', { name: d.title || d.fileName })}><Thumb doc={d} /></button>
              <div className="space-y-1 p-3">
                <p className="text-sm font-medium text-ink line-clamp-2">{d.title || t(`family.docs.kind.${d.category}`, d.categoryLabel)}</p>
                <p className="text-xs text-ink-faint">{date(String(d.at).slice(0, 10))}</p>
                {d.checked && <p className="flex items-center gap-1 text-xs font-medium text-success-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{t('family.docs.checked')}</p>}
                <button type="button" disabled={busy === d.id} onClick={() => open(d, true)} className="mt-1 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium text-ink disabled:opacity-50">
                  <Download className="h-4 w-4" aria-hidden />{t('family.docs.save')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
