import { useEffect, useState } from 'react'

/**
 * Returns `value` delayed by `delay` ms — for feeding a search box into a
 * server request without firing on every keystroke.
 *
 *   const query = ...            // bound to <SearchInput>
 *   const debouncedQuery = useDebouncedValue(query, 300)
 *   useEffect(() => { load() }, [page, debouncedQuery, statusF])
 */
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
