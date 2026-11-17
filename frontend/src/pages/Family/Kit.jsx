import { useTranslation } from 'react-i18next'
import { Download, FileText, MapPin, Phone, Printer, Shirt, Store } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyKit, familyKitFileUrl } from '../../api/family'

const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/**
 * The family app › Books & uniform: what the child's class needs — books, notebooks, stationery, uniform, shoes — with
 * codes, prices and the school's notes, the files to download (the publisher's book list, a uniform picture), and a
 * print button that also saves it as a PDF.
 */
export default function FamilyKit() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { data: k, isLoading, error } = useFamilyQuery(['kit'], () => familyKit(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!k) return <FEmpty icon={Shirt} title={t('family.kit.none')} hint={t('family.kit.noneHint')} />
  const money = (p) => formatINR(p, { decimals: 0 })
  return (
    <div className="space-y-4 print:space-y-2">
      <FCard title={t('family.kit.title', { cls: k.className })} action={<Button size="sm" variant="ghost" icon={Printer} className="print:hidden" onClick={() => window.print()}>{t('family.kit.print')}</Button>}>
        <p className="text-sm text-ink-muted">{t('family.kit.year', { year: k.yearName })}</p>
        {k.instructions && <p className="mt-3 whitespace-pre-line text-[15px] text-ink">{k.instructions}</p>}
      </FCard>

      {k.files.length > 0 && (
        <FCard title={t('family.kit.files')} className="print:hidden">
          <div className="space-y-1">
            {k.files.map((f) => (
              <a key={f.id} href={familyKitFileUrl(slug, studentId, f.id)} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 text-sm text-ink hover:bg-black/[0.02]">
                <FileText className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span className="flex-1 truncate">{f.title || f.fileName}</span>
                <span className="text-xs text-ink-faint">{size(f.size)}</span><Download className="w-4 h-4 text-ink-faint" aria-hidden />
              </a>
            ))}
          </div>
        </FCard>
      )}

      {k.shops?.length > 0 && (
        <FCard title={t('family.kit.whereToBuy')}>
          <ul className="divide-y divide-border">
            {k.shops.map((s) => (
              <li key={s.name} className="py-3 first:pt-0 last:pb-0">
                <p className="flex items-center gap-2 text-[15px] font-medium text-ink"><Store className="w-4 h-4 text-ink-faint shrink-0" aria-hidden />{s.name}</p>
                <p className="text-xs text-ink-muted mt-0.5">{s.sells.length ? s.sells.map((x) => t(`family.kit.kinds.${x}`)).join(', ') : t('family.kit.everything')}</p>
                {s.address && <p className="text-sm text-ink mt-1">{s.address}</p>}
                {s.note && <p className="text-sm text-ink-muted mt-0.5">{s.note}</p>}
                {(s.phone || s.mapUrl) && (
                  <div className="mt-2 flex flex-wrap gap-2 print:hidden">
                    {s.phone && <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-brand-700"><Phone className="w-4 h-4" />{t('family.kit.call')}</a>}
                    {s.mapUrl && <a href={s.mapUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-brand-700"><MapPin className="w-4 h-4" />{t('family.kit.map')}</a>}
                  </div>
                )}
                {s.phone && <p className="hidden print:block text-sm text-ink">{s.phone}</p>}
              </li>
            ))}
          </ul>
        </FCard>
      )}

      {k.groups.map((g) => (
        <FCard key={g.kind} title={t(`family.kit.kinds.${g.kind}`)}>
          {g.shops?.length > 0 && <p className="-mt-1 mb-2 text-xs text-ink-muted">{t('family.kit.buyAt', { shops: g.shops.join(', ') })}</p>}
          <ul className="divide-y divide-border">
            {g.items.map((i, n) => (
              <li key={n} className="py-2.5 flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-ink">{i.name}{i.qty > 1 ? <span className="text-ink-muted font-normal"> × {i.qty}</span> : null}</span>
                  <span className="block text-xs text-ink-muted">
                    {[i.subject, i.publisher, i.code && t('family.kit.code', { code: i.code })].filter(Boolean).join(' · ')}
                  </span>
                  {i.note && <span className="block text-xs text-ink mt-0.5">{i.note}</span>}
                </span>
                {i.price != null && <span className="text-sm text-ink font-mono-num shrink-0">{money(i.price * (i.qty || 1))}</span>}
              </li>
            ))}
          </ul>
        </FCard>
      ))}
      {k.total != null && (
        <FCard>
          <div className="flex items-center justify-between text-[15px]"><span className="text-ink-muted">{t('family.kit.total')}</span><span className="font-semibold text-ink font-mono-num">{money(k.total)}</span></div>
          <p className="mt-1 text-xs text-ink-faint">{t('family.kit.totalHint')}</p>
        </FCard>
      )}
    </div>
  )
}
