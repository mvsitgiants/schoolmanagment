import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import SiteView from '../../components/website/SiteView'
import { publicImageUrl, publicSitePage } from '../../api/website'
import { applyBrandRamp } from '../../utils/brandRamp'

/** Set (or add) a <meta name="…"> for the page's SEO description. */
function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`)
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el) }
  el.setAttribute('content', content ?? '')
}

/** The institution's public website: /site/:slug and /site/:slug/:page — no sign-in, published pages only. */
export default function PublicSite() {
  const { t } = useTranslation('website')
  const { slug, page } = useParams()
  const { data, isLoading, error } = useQuery({ queryKey: ['public-site', slug, page ?? ''], queryFn: () => publicSitePage(slug, page), retry: false, staleTime: 60_000 })
  const site = data?.site
  useEffect(() => {
    if (!site) return undefined
    applyBrandRamp(site.primaryColor || null)
    return () => applyBrandRamp(null)
  }, [site])
  useEffect(() => {
    if (!data) return
    const seo = data.page.seo ?? {}
    document.title = seo.title || (data.page.kind === 'HOME' ? data.site.name : `${data.page.title} · ${data.site.name}`)
    setMeta('description', seo.description || data.site.tagline || '')
    window.scrollTo({ top: 0 })
  }, [data])
  if (isLoading) return <div className="min-h-[100dvh] bg-bg p-6"><div className="mx-auto h-64 max-w-6xl animate-pulse rounded-2xl bg-black/5" /></div>
  if (error || !data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg p-6 text-center">
        <div><Globe className="mx-auto h-10 w-10 text-ink-faint" /><p className="mt-3 font-semibold text-ink">{error?.status === 404 && page ? t('website.public.pageMissing') : t('website.public.notAvailable')}</p></div>
      </div>
    )
  }
  return <SiteView data={data} imageUrl={(id) => publicImageUrl(slug, id)} />
}
