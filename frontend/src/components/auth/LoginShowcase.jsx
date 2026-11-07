import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BedDouble, FlaskConical, IndianRupee, Pill, Stethoscope, Users } from 'lucide-react'
import { LaptopMock, PhoneMock } from './MockScreens'

// The app's screens, as on the ERP's sign-in: the laptop shows the desktop app, the phone the same
// screen on a phone (captured from the demo institution, City Care). They live in frontend/public/login/ (laptop
// 1600×1003, phone 390×844 at 2×); if one is missing, drawn miniatures (MockScreens) are shown
// instead, so the frame is never empty.
const SLIDES = [
  { key: 'home', src: '/login/home.jpg', phone: '/login/m-home.jpg', label: 'Institution overview' },
  { key: 'radiology', src: '/login/radiology.jpg', phone: '/login/m-radiology.jpg', label: 'Radiology viewer and report' },
  { key: 'opd', src: '/login/opd.jpg', phone: '/login/m-opd.jpg', label: 'OPD visits' },
  { key: 'beds', src: '/login/beds.jpg', phone: '/login/m-beds.jpg', label: 'Bed board' },
  { key: 'billing', src: '/login/billing.jpg', phone: '/login/m-billing.jpg', label: 'Billing' },
]

const MODULES = [
  { key: 'opd', icon: Stethoscope, label: 'OPD' },
  { key: 'ipd', icon: BedDouble, label: 'Inpatients' },
  { key: 'lab', icon: FlaskConical, label: 'Laboratory' },
  { key: 'pharmacy', icon: Pill, label: 'Pharmacy' },
  { key: 'billing', icon: IndianRupee, label: 'Billing' },
  { key: 'hr', icon: Users, label: 'HR & payroll' },
]

const ROTATE_MS = 5000

/** Stacked screens that cross-fade to the current one: the screenshots, or the drawn ones without them. */
function Screens({ index, pick, alt, real, Mock }) {
  return SLIDES.map((s, i) => (
    <div key={s.key} className={`absolute inset-0 [container-type:inline-size] transition-opacity duration-700 ${i === index ? 'opacity-100' : 'opacity-0'}`} aria-hidden={i !== index}>
      {real
        ? <img src={pick(s)} alt={alt(s)} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" className="absolute inset-0 w-full h-full object-cover object-top" />
        : <Mock kind={s.key} title={alt(s)} />}
    </div>
  ))
}

/** A MacBook drawn in CSS: black screen bezel with a camera, aluminium base with the thumb notch. */
function MacBook({ index, alt, real }) {
  return (
    <div className="relative">
      <div className="relative mx-[6%] rounded-t-[14px] rounded-b-[3px] bg-[#0d0d0f] p-[2.2%] pb-[2.6%] ring-1 ring-black/60 shadow-[inset_0_0_0_1.5px_#3a3a3e]">
        <span className="absolute top-[0.9%] left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full bg-[#2b2f36] ring-1 ring-[#1a1c20]" />
        <div className="relative aspect-[1600/1003] overflow-hidden rounded-[3px] bg-white">
          <Screens index={index} pick={(s) => s.src} alt={alt} real={real} Mock={LaptopMock} />
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
        </div>
      </div>
      <div className="relative h-[clamp(10px,2.4vh,16px)] rounded-b-[18px] bg-gradient-to-b from-[#e8e9ed] via-[#c6c8ce] to-[#8f9197] shadow-[0_18px_30px_-10px_rgba(15,23,42,0.55)]">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#9a9ca2]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[15%] h-[45%] rounded-b-[8px] bg-gradient-to-b from-[#a9abb1] to-[#c3c5cb]" />
      </div>
    </div>
  )
}

/** An iPhone drawn in CSS: rounded black body, side buttons, Dynamic Island and a status bar over the app. */
function Phone({ index, alt, real }) {
  return (
    <div className="relative">
      <span className="absolute -left-[2px] top-[18%] w-[3px] h-[7%] rounded-l bg-[#2a2a2d]" />
      <span className="absolute -left-[2px] top-[28%] w-[3px] h-[11%] rounded-l bg-[#2a2a2d]" />
      <span className="absolute -right-[2px] top-[24%] w-[3px] h-[14%] rounded-r bg-[#2a2a2d]" />
      <div className="relative rounded-[22%/10.5%] bg-[#0d0d0f] p-[4.5%] ring-1 ring-black/70 shadow-[inset_0_0_0_1.5px_#3a3a3e,0_25px_50px_-12px_rgba(15,23,42,0.6)]">
        <div className="relative aspect-[390/890] overflow-hidden rounded-[17%/8%] bg-white flex flex-col">
          <div className="relative h-[5.2%] shrink-0 bg-[#F4F5F7] flex items-center justify-between px-[8%] text-[7px] font-semibold text-slate-900">
            <span>9:41</span>
            <span className="flex items-center gap-[2px]">
              <svg viewBox="0 0 12 9" className="w-[9px] h-[7px]" aria-hidden="true"><path d="M6 8.2 7.6 6.4a2.3 2.3 0 0 0-3.2 0L6 8.2ZM2.8 4.8a4.6 4.6 0 0 1 6.4 0l1-1.1a6 6 0 0 0-8.4 0l1 1.1ZM.6 2.4a7.7 7.7 0 0 1 10.8 0l1-1.1a9.2 9.2 0 0 0-12.8 0l1 1.1Z" fill="currentColor" /></svg>
              <span className="w-[11px] h-[5.5px] rounded-[2px] ring-1 ring-slate-900/60 p-[1px]"><span className="block h-full w-[75%] rounded-[1px] bg-slate-900" /></span>
            </span>
            <span className="absolute top-[18%] left-1/2 -translate-x-1/2 w-[28%] h-[74%] rounded-full bg-black" />
          </div>
          <div className="relative flex-1">
            <Screens index={index} pick={(s) => s.phone} alt={alt} real={real} Mock={PhoneMock} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The product on a MacBook with a phone in front, a screen at a time. */
export function ProductPeek({ className = '' }) {
  const { t } = useTranslation('common')
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  // the screenshots once the first one is known to be there; the drawn screens until then (or for good)
  const [real, setReal] = useState(false)
  useEffect(() => { const img = new Image(); img.onload = () => setReal(true); img.src = SLIDES[0].src }, [])
  // someone who asked for less motion gets a still picture and the dots
  const [still] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const alt = (s) => t(`auth.showcase.slides.${s.key}`, s.label)

  useEffect(() => {
    if (still || paused) return undefined
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [still, paused, index])

  return (
    <div className={`relative ${className}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative pr-[9%] pb-[3%]">
        <MacBook index={index} alt={alt} real={real} />
        <div className="absolute right-0 bottom-0 w-[23%]"><Phone index={index} alt={alt} real={real} /></div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-2" role="tablist" aria-label={t('auth.showcase.screens', 'Product screens')}>
        {SLIDES.map((s, i) => (
          <button key={s.key} type="button" role="tab" aria-selected={i === index} aria-label={alt(s)} title={alt(s)} onClick={() => setIndex(i)}
            className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-brand-600' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`} />
        ))}
      </div>
    </div>
  )
}

/** Light tiles naming the main modules. */
export function KeyModules() {
  const { t } = useTranslation('common')
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800 mb-3">{t('auth.showcase.keyModules', 'Key modules')}</p>
      <div className="grid grid-cols-3 xl:grid-cols-6 gap-3">
        {MODULES.map(({ key, icon: Icon, label }) => (
          <div key={key} className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-brand-50/70 ring-1 ring-brand-100 py-4 px-2 hover:bg-brand-50 hover:-translate-y-0.5 transition-all">
            <span className="w-10 h-10 rounded-xl bg-white ring-1 ring-brand-200 flex items-center justify-center">
              <Icon className="w-5 h-5 text-brand-600" strokeWidth={1.75} />
            </span>
            <span className="text-xs text-slate-600 text-center">{t(`auth.showcase.modules.${key}`, label)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-slate-400">{t('auth.showcase.more', '…and 29 more, from radiology and OT to CSSD, insurance and accounts.')}</p>
    </div>
  )
}
