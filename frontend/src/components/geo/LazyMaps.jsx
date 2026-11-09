import { Component, Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'

// The Leaflet map is loaded on demand (React.lazy) so the map library and its CSS stay out of the main bundle.
// Nothing else may import SiteMap.jsx directly. (Ported from the hospital platform.)
const SiteMap = lazy(() => import('./SiteMap'))

const Placeholder = ({ height, text }) => (
  <div style={{ height }} className="rounded-lg border border-border bg-bg flex items-center justify-center px-4 text-center text-xs text-ink-faint">{text}</div>
)

/** If the map code cannot be fetched (offline, new deploy), say so instead of breaking the form. */
class MapBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <Placeholder height={this.props.height} text={this.props.failedText} /> : this.props.children
  }
}

/** Draw an attendance site (see SiteMap.jsx for the props). */
export function LazySiteMap(props) {
  const { t } = useTranslation('geo')
  return (
    <MapBoundary height={280} failedText={t('geo.maps.siteFailed')}>
      <Suspense fallback={<Placeholder height={280} text={t('geo.maps.loading')} />}><SiteMap {...props} /></Suspense>
    </MapBoundary>
  )
}
