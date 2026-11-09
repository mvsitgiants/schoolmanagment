import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleHelp, Lock, School } from 'lucide-react'
import { SurveyFill } from '../../components/surveys/SurveyKit'
import { answerPublicSurvey, fetchPublicSurvey } from '../../api/surveys'
import { applyBrandRamp } from '../../utils/brandRamp'

const KEY = (token) => `sg_survey:${token}`
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/** The browser's own random id for this survey, so the same browser answers once. */
function useClientKey(token) {
  return useMemo(() => {
    const k = `${KEY(token)}:id`
    let v = read(k)
    if (!v) {
      v = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^\w-]/g, '').slice(0, 40)
      write(k, v)
    }
    return v
  }, [token])
}

/**
 * A survey's public link (/s/<school>/<token>): no sign-in — alumni, visitors, the community. The institution's name and
 * colour at the top, the questions, and a thank-you. Only surveys sent to "anyone with the link" open here.
 */
export default function PublicSurvey() {
  const { t } = useTranslation('surveys')
  const { slug, token } = useParams()
  const clientKey = useClientKey(token)
  const [done, setDone] = useState(() => read(`${KEY(token)}:done`) === '1')
  const { data: s, isLoading, error } = useQuery({ queryKey: ['public-survey', slug, token], queryFn: () => fetchPublicSurvey(slug, token), retry: false })
  useEffect(() => {
    if (!s) return undefined
    applyBrandRamp(s.institution.primaryColor || null)
    document.title = `${s.title} · ${s.institution.name}`
    return () => applyBrandRamp(null)
  }, [s])
  return (
    <div className="min-h-[100dvh] bg-bg">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        {isLoading ? <div className="h-64 animate-pulse rounded-2xl bg-black/[0.06]" /> : error || !s ? (
          <section className="mt-16 rounded-2xl border border-border bg-surface p-6 text-center">
            <CircleHelp className="mx-auto h-10 w-10 text-ink-faint" />
            <p className="mt-3 text-base font-semibold text-ink">{t('surveys.public.notFound')}</p>
            <p className="mt-1 text-sm text-ink-muted">{error?.message}</p>
          </section>
        ) : (
          <>
            <header className="flex items-center gap-3">
              {s.institution.logoUrl ? <img src={s.institution.logoUrl} alt="" className="h-11 w-11 rounded-xl border border-border bg-surface object-contain" /> : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500"><School className="h-6 w-6 text-white" /></span>}
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-semibold text-ink">{s.institution.name}</p>
                <p className="text-[13px] text-ink-muted">{t('surveys.public.kicker')}</p>
              </div>
            </header>
            <section className="rounded-2xl border border-border bg-surface p-5">
              <h1 className="font-display text-xl font-semibold text-ink">{s.title}</h1>
              {s.intro && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{s.intro}</p>}
              <div className="mt-5">
                {s.state !== 'OPEN' ? (
                  <p className="inline-flex items-center gap-2 text-sm text-ink-muted"><Lock className="h-4 w-4" />{s.state === 'SCHEDULED' ? t('surveys.public.notYet') : t('surveys.public.closed')}</p>
                ) : (
                  <SurveyFill definition={s.definition} submitted={done}
                    onSubmit={async (values) => {
                      try {
                        await answerPublicSurvey(slug, token, { values, clientKey })
                      } catch (e) {
                        if (e.status !== 409) throw e
                      }
                      write(`${KEY(token)}:done`, '1')
                      setDone(true)
                    }} />
                )}
              </div>
            </section>
            {s.anonymous && <p className="text-center text-xs text-ink-faint">{t('surveys.fill.anonymousNote')}</p>}
          </>
        )}
      </div>
    </div>
  )
}
