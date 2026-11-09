import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CalendarDays, Clock, Facebook, Instagram, Mail, MapPin, Megaphone, Menu as MenuIcon, Phone, Pin, X, Youtube } from 'lucide-react'
import { osmEmbed, parseRichText } from '@schoolgiant/shared'
import { useFormat } from '../../context/SettingsContext'

// The institution's public site, drawn from { site, page, feeds } — the same renderer for the public address
// (/site/:slug[/:page]) and for staff's preview of a draft. Colours come from the brand ramp (the institution's
// primary colour); nothing here is HTML from the server — rich text is parsed to plain parts.

const initials = (name) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

/** A block's link: another page of the site, the admissions form, or an outside address. */
function useHref(site, preview) {
  return (link, apply) => {
    if (apply) return { to: `/apply/${site.slug}`, external: false }
    if (!link) return null
    if (/^(https?:|mailto:|tel:)/i.test(link)) return { href: link, external: true }
    if (link.startsWith('#')) return { href: link, external: false }
    const path = link.replace(/^\/+/, '')
    if (path.startsWith('apply')) return { to: `/apply/${site.slug}`, external: false }
    if (preview) return { href: '#', external: false }
    return { to: path && path !== 'home' ? `/site/${site.slug}/${path}` : `/site/${site.slug}`, external: false }
  }
}

function SmartLink({ target, className, children }) {
  if (!target) return null
  if (target.to) return <Link to={target.to} className={className}>{children}</Link>
  return <a href={target.href} className={className} {...(target.external && { target: '_blank', rel: 'noreferrer noopener' })}>{children}</a>
}

function RichText({ text }) {
  const parts = (ps) => ps.map((p, i) => {
    if (p.href) return <a key={i} href={p.href} className="text-brand-700 underline underline-offset-2" {...(/^https?:/.test(p.href) && { target: '_blank', rel: 'noreferrer noopener' })}>{p.text}</a>
    const lines = p.text.split('\n')
    const body = lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{l}</Fragment>)
    if (p.bold) return <strong key={i}>{body}</strong>
    if (p.italic) return <em key={i}>{body}</em>
    return <Fragment key={i}>{body}</Fragment>
  })
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-ink-muted">
      {parseRichText(text).map((b, i) => {
        if (b.kind === 'h') return <h3 key={i} className="pt-2 font-display text-lg font-semibold text-ink">{parts(b.parts)}</h3>
        if (b.kind === 'ul') return <ul key={i} className="list-disc space-y-1 ps-5">{b.items.map((it, j) => <li key={j}>{parts(it)}</li>)}</ul>
        return <p key={i}>{parts(b.parts)}</p>
      })}
    </div>
  )
}

const STAT_COLS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }
const Heading = ({ children, center }) => (children ? <h2 className={`font-display text-2xl sm:text-3xl font-bold text-ink ${center ? 'text-center' : ''}`}>{children}</h2> : null)
const Section = ({ children, tint }) => <section className={tint ? 'bg-brand-50/60' : ''}><div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">{children}</div></section>

function Gallery({ d, img }) {
  const { t } = useTranslation('website')
  const [open, setOpen] = useState(null)
  return (
    <Section>
      <Heading>{d.heading}</Heading>
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {d.images.map((g, i) => (
          <button key={`${g.imageId}-${i}`} type="button" onClick={() => setOpen(g)} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-black/5">
            <img src={img(g.imageId)} alt={g.caption || ''} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
            {g.caption && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-start text-xs text-white">{g.caption}</span>}
          </button>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setOpen(null)}>
          <button type="button" className="absolute end-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label={t('website.public.close')}><X className="w-5 h-5" /></button>
          <figure className="max-h-full max-w-5xl"><img src={img(open.imageId)} alt={open.caption || ''} className="max-h-[80vh] rounded-lg object-contain" />{open.caption && <figcaption className="mt-2 text-center text-sm text-white/90">{open.caption}</figcaption>}</figure>
        </div>
      )}
    </Section>
  )
}

function Block({ b, ctx }) {
  const { t } = useTranslation('website')
  const { date } = useFormat()
  const { site, feeds, img, href } = ctx
  const d = b.data ?? {}
  switch (b.type) {
    case 'HERO': {
      const target = href(d.buttonLink, d.apply)
      return (
        <section className="relative overflow-hidden bg-brand-700">
          {d.imageId && <img src={img(d.imageId)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className={`absolute inset-0 ${d.imageId ? 'bg-gradient-to-r from-black/70 via-black/40 to-black/10' : 'bg-gradient-to-br from-brand-700 to-brand-500'}`} />
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
            <div className="max-w-2xl">
              {d.heading && <h1 className="font-display text-3xl sm:text-5xl font-bold leading-tight text-white">{d.heading}</h1>}
              {d.subheading && <p className="mt-4 text-base sm:text-lg text-white/85">{d.subheading}</p>}
              {target && (d.buttonLabel || d.apply) && <SmartLink target={target} className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand-700 shadow-lg hover:bg-brand-50">{d.buttonLabel || t('website.public.applyOnline')}<ArrowRight className="w-4 h-4" /></SmartLink>}
            </div>
          </div>
        </section>
      )
    }
    case 'TEXT':
      return <Section><div className="mx-auto max-w-3xl"><Heading>{d.heading}</Heading>{d.body && <div className="mt-4"><RichText text={d.body} /></div>}</div></Section>
    case 'GALLERY':
      return d.images?.length ? <Gallery d={d} img={img} /> : null
    case 'STATS':
      return (
        <Section tint>
          <Heading center>{d.heading}</Heading>
          <div className={`grid gap-6 grid-cols-2 ${STAT_COLS[Math.min(4, Math.max(2, d.items.length))]} ${d.heading ? 'mt-8' : ''}`}>
            {d.items.map((s, i) => <div key={i} className="text-center"><p className="font-display text-4xl font-bold text-brand-600">{s.value}</p><p className="mt-1 text-sm font-medium text-ink-muted">{s.label}</p></div>)}
          </div>
        </Section>
      )
    case 'CARDS':
      return (
        <Section>
          <Heading>{d.heading}</Heading>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.items.map((c, i) => {
              const target = href(c.link)
              const body = (
                <>
                  {c.imageId ? <img src={img(c.imageId)} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" /> : <div className="h-1.5 bg-brand-500" />}
                  <div className="p-5"><h3 className="font-display text-lg font-semibold text-ink">{c.title}</h3>{c.text && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{c.text}</p>}
                    {target && <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">{t('website.public.more')}<ArrowRight className="w-4 h-4" /></span>}</div>
                </>
              )
              return target ? <SmartLink key={i} target={target} className="block overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-card">{body}</SmartLink>
                : <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">{body}</div>
            })}
          </div>
        </Section>
      )
    case 'CTA': {
      const target = href(d.buttonLink, d.apply)
      return (
        <section className="bg-gradient-to-r from-brand-600 to-brand-500">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-12 sm:flex-row sm:items-center sm:justify-between">
            <div>{d.heading && <h2 className="font-display text-2xl font-bold text-white">{d.heading}</h2>}{d.text && <p className="mt-2 text-white/85">{d.text}</p>}</div>
            {target && <SmartLink target={target} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand-700 shadow-lg hover:bg-brand-50">{d.buttonLabel || t('website.public.applyOnline')}<ArrowRight className="w-4 h-4" /></SmartLink>}
          </div>
        </section>
      )
    }
    case 'CONTACT': {
      const map = d.showMap && d.lat != null && d.lng != null ? osmEmbed([{ lat: Number(d.lat), lng: Number(d.lng) }]) : null
      return (
        <Section>
          <Heading>{d.heading}</Heading>
          <div className={`mt-6 grid gap-6 ${map ? 'lg:grid-cols-2' : ''}`}>
            <div className="space-y-4">
              {d.address && <p className="flex gap-3 text-ink"><MapPin className="mt-0.5 w-5 h-5 shrink-0 text-brand-600" /><span className="whitespace-pre-line">{d.address}</span></p>}
              {d.phone && <a href={`tel:${d.phone.replace(/\s/g, '')}`} className="flex gap-3 text-ink hover:text-brand-700"><Phone className="w-5 h-5 shrink-0 text-brand-600" />{d.phone}</a>}
              {d.email && <a href={`mailto:${d.email}`} className="flex gap-3 text-ink hover:text-brand-700"><Mail className="w-5 h-5 shrink-0 text-brand-600" />{d.email}</a>}
            </div>
            {map && <iframe title={t('website.public.map')} src={map} className="h-72 w-full rounded-2xl border border-border" loading="lazy" referrerPolicy="no-referrer" />}
          </div>
        </Section>
      )
    }
    case 'NOTICES':
      return (
        <Section>
          <Heading>{d.heading || t('website.public.notices')}</Heading>
          {!feeds.notices.length ? <p className="mt-4 text-sm text-ink-muted">{t('website.public.noNotices')}</p> : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {feeds.notices.map((n) => (
                <article key={n.id} className="rounded-2xl border border-border bg-surface p-5">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700">{n.pinned ? <Pin className="w-3.5 h-3.5" /> : <Megaphone className="w-3.5 h-3.5" />}{[n.category, n.date && date(n.date)].filter(Boolean).join(' · ')}</p>
                  <h3 className="mt-2 font-display text-base font-semibold text-ink">{n.title}</h3>
                  {n.excerpt && <p className="mt-1 text-sm text-ink-muted line-clamp-3">{n.excerpt}</p>}
                </article>
              ))}
            </div>
          )}
        </Section>
      )
    case 'EVENTS':
      return (
        <Section tint>
          <Heading>{d.heading || t('website.public.events')}</Heading>
          {!feeds.events.length ? <p className="mt-4 text-sm text-ink-muted">{t('website.public.noEvents')}</p> : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {feeds.events.map((e) => {
                const dt = new Date(`${e.startDate}T12:00:00Z`)
                return (
                  <article key={e.id} className="flex gap-4 rounded-2xl border border-border bg-surface p-4">
                    <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-500 text-white">
                      <span className="text-2xl font-bold leading-none">{dt.getUTCDate()}</span>
                      <span className="text-[11px] font-semibold uppercase">{t(`website.public.months.${dt.getUTCMonth()}`)}</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-ink">{e.title}</h3>
                      <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><CalendarDays className="w-3.5 h-3.5" />{e.endDate !== e.startDate ? `${date(e.startDate)} – ${date(e.endDate)}` : date(e.startDate)}</p>
                      {e.startTime && <p className="flex items-center gap-1 text-xs text-ink-muted"><Clock className="w-3.5 h-3.5" />{e.startTime}{e.endTime ? `–${e.endTime}` : ''}</p>}
                      {e.venue && <p className="flex items-center gap-1 text-xs text-ink-muted"><MapPin className="w-3.5 h-3.5" />{e.venue}</p>}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </Section>
      )
    default:
      return null
  }
}

const SOCIAL = { facebook: Facebook, instagram: Instagram, youtube: Youtube }

/** The whole page: header with the menu, the blocks, the footer. */
export default function SiteView({ data, imageUrl, preview = false }) {
  const { t } = useTranslation('website')
  const [menuOpen, setMenuOpen] = useState(false)
  const { site, page, feeds } = data
  const href = useHref(site, preview)
  const ctx = { site, feeds: feeds ?? { notices: [], events: [] }, img: imageUrl, href }
  const navTo = (m) => (preview ? { href: '#' } : { to: m.home ? `/site/${site.slug}` : `/site/${site.slug}/${m.slug}` })
  return (
    <div className="min-h-full bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <SmartLink target={navTo({ home: true })} className="flex min-w-0 items-center gap-3">
            {site.logoUrl ? <img src={site.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
              : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500 font-display text-sm font-bold text-white">{initials(site.name)}</span>}
            <span className="min-w-0"><span className="block truncate font-display text-base font-bold text-ink">{site.name}</span>{site.tagline && <span className="hidden sm:block truncate text-xs text-ink-muted">{site.tagline}</span>}</span>
          </SmartLink>
          <nav className="ms-auto hidden lg:flex items-center gap-1">
            {site.menu.map((m) => <SmartLink key={m.slug} target={navTo(m)} className={`rounded-lg px-3 py-2 text-sm font-medium ${m.slug === page.slug ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:text-ink'}`}>{m.title}</SmartLink>)}
          </nav>
          {site.applyOnline && <SmartLink target={href(null, true)} className="ms-auto lg:ms-2 hidden sm:inline-flex items-center rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">{t('website.public.applyOnline')}</SmartLink>}
          <button type="button" className="ms-auto sm:ms-0 lg:hidden rounded-lg p-2 text-ink" aria-label={t('website.public.menu')} onClick={() => setMenuOpen((o) => !o)}>{menuOpen ? <X className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}</button>
        </div>
        {menuOpen && (
          <nav className="lg:hidden border-t border-border px-4 py-2">
            {site.menu.map((m) => <SmartLink key={m.slug} target={navTo(m)} className="block rounded-lg px-3 py-3 text-sm font-medium text-ink">{m.title}</SmartLink>)}
            {site.applyOnline && <SmartLink target={href(null, true)} className="mt-1 block rounded-lg bg-brand-500 px-3 py-3 text-center text-sm font-semibold text-white">{t('website.public.applyOnline')}</SmartLink>}
          </nav>
        )}
      </header>

      <main>{page.blocks.map((b) => <Block key={b.id} b={b} ctx={ctx} />)}</main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3">
          <div>
            <p className="font-display text-base font-bold text-ink">{site.name}</p>
            {site.footer && <p className="mt-2 text-sm text-ink-muted whitespace-pre-line">{site.footer}</p>}
          </div>
          <div className="space-y-2 text-sm text-ink-muted">
            {site.contact?.address && <p className="flex gap-2"><MapPin className="mt-0.5 w-4 h-4 shrink-0" />{site.contact.address}</p>}
            {site.contact?.phone && <a href={`tel:${site.contact.phone.replace(/\s/g, '')}`} className="flex gap-2 hover:text-ink"><Phone className="w-4 h-4 shrink-0" />{site.contact.phone}</a>}
            {site.contact?.email && <a href={`mailto:${site.contact.email}`} className="flex gap-2 hover:text-ink"><Mail className="w-4 h-4 shrink-0" />{site.contact.email}</a>}
          </div>
          <div className="flex flex-wrap items-start gap-2 sm:justify-end">
            {Object.entries(site.social ?? {}).filter(([, v]) => v).map(([k, v]) => {
              const Icon = SOCIAL[k]
              return <a key={k} href={v} target="_blank" rel="noreferrer noopener" className="flex h-10 min-w-[40px] items-center justify-center rounded-full border border-border px-3 text-sm text-ink-muted hover:text-ink" aria-label={k}>{Icon ? <Icon className="w-4 h-4" /> : t(`website.settings.social.${k}`)}</a>
            })}
          </div>
        </div>
        <p className="border-t border-border py-4 text-center text-xs text-ink-faint">{t('website.public.copyright', { year: new Date().getFullYear(), name: site.name })}</p>
      </footer>
    </div>
  )
}
