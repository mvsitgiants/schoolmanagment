/** The product's mark in a white tile — the cross the app uses as its logo. */
export default function AuthMark({ size = 'md' }) {
  const box = size === 'lg' ? 'w-14 h-14' : 'w-12 h-12'
  const icon = size === 'lg' ? 'w-9 h-9' : 'w-7 h-7'
  return (
    <span className={`${box} rounded-2xl bg-white shadow-lg shadow-black/10 flex items-center justify-center shrink-0`}>
      <svg viewBox="0 0 64 64" className={icon} aria-hidden="true"><path d="M26 14h12v12h12v12H38v12H26V38H14V26h12z" fill="rgb(var(--brand-600))" /></svg>
    </span>
  )
}
