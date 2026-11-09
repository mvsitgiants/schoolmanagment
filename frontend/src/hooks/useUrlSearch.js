import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A list screen's search box that also starts from `?search=` — so the header search (and Scan) can open the
 * screen already filtered to one record. Changing the URL later (searching again from the header) refills it.
 */
export default function useUrlSearch() {
  const [params] = useSearchParams()
  const fromUrl = params.get('search') ?? ''
  const [search, setSearch] = useState(fromUrl)
  useEffect(() => { if (fromUrl) setSearch(fromUrl) }, [fromUrl])
  return [search, setSearch, !!fromUrl]
}
