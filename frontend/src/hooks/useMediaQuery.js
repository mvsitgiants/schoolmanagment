import { useSyncExternalStore } from 'react'

/**
 * Subscribe to a CSS media query. SSR-safe-ish (returns `false` with no window).
 *
 *   const isMobile = useMediaQuery('(max-width: 767.98px)')
 */
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** Phones — below Tailwind's `md` breakpoint (768px). */
export function useIsMobile() {
  return useMediaQuery('(max-width: 767.98px)')
}

/** Below Tailwind's `lg` breakpoint (1024px) — phones + most tablets. */
export function useIsCompact() {
  return useMediaQuery('(max-width: 1023.98px)')
}
