import LanguageSelector from '../../components/ui/LanguageSelector'
import NoticeBanner from '../../components/ui/NoticeBanner'
import AuthMark from './AuthMark'

/**
 * The frame the sign-in side pages share (sign-up, forgot password, invite, verify email): the login
 * page's blue band and white card, as in the ERP. `wide` for the sign-up plan picker.
 */
export default function AuthShell({ children, wide = false }) {
  return (
    <div className="auth-blue relative min-h-[100dvh] bg-bg overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[300px] lg:h-[46vh] bg-gradient-to-br from-brand-500 via-brand-500 to-brand-600">
        <div className="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
      </div>
      <div className="absolute top-4 end-4 sm:top-6 sm:end-6 z-10 rounded-lg bg-white shadow-sm"><LanguageSelector /></div>
      <div className="relative min-h-[100dvh] flex flex-col items-center justify-center p-5 sm:p-8">
        <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-[460px]'} auth-rise`}>
          <div className="mb-6 flex items-center justify-center gap-3">
            <AuthMark />
            <span className="font-display text-2xl font-bold text-white">SchoolGiant</span>
          </div>
          <div className="rounded-[28px] bg-white ring-1 ring-slate-900/5 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.22)] p-7 sm:p-10">
            {/* planned maintenance etc. — people see it before they sign in */}
            <NoticeBanner className="border rounded-lg mb-6 px-3 sm:px-3" />
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
