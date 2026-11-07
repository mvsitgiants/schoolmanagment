import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../api/client'
import { useRealtime } from '../context/RealtimeContext'

/**
 * Hook to detect network quality and connection states:
 * - 'good': Stable and fast connection (hidden from topbar)
 * - 'slow': High latency, 2G/3G network, or slow RTT (amber chip)
 * - 'reconnecting': Socket/server reconnecting (amber pulse chip)
 * - 'offline': No internet or server unreachable (red alert chip)
 */
export function useNetworkStatus() {
  const realtime = useRealtime?.() || {}
  const socketState = realtime?.state // 'connecting' | 'connected' | 'reconnecting' | 'offline'

  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [latency, setLatency] = useState(null) // in milliseconds
  const [effectiveType, setEffectiveType] = useState(() => {
    const conn = typeof navigator !== 'undefined' ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection) : null
    return conn?.effectiveType || null
  })
  const [downlink, setDownlink] = useState(() => {
    const conn = typeof navigator !== 'undefined' ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection) : null
    return conn?.downlink || null
  })
  const [status, setStatus] = useState('good') // 'good' | 'slow' | 'reconnecting' | 'offline'
  const [checking, setChecking] = useState(false)
  const lastCheck = useRef(Date.now())

  // Actively measure ping / latency against the backend /health endpoint
  const checkLatency = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!navigator.onLine) {
      setOnline(false)
      setStatus('offline')
      return
    }

    setChecking(true)
    const start = performance.now()
    try {
      const pingUrl = `${API_BASE_URL}/health?_t=${Date.now()}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)

      const res = await fetch(pingUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (res.ok) {
        const measured = Math.round(performance.now() - start)
        setLatency(measured)
        setOnline(true)

        // Determine if slow based on latency & network type
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
        const is2G = conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g'
        const isHighLatency = measured >= 1000 // >= 1 second RTT is considered slow

        if (socketState === 'reconnecting') {
          setStatus('reconnecting')
        } else if (is2G || isHighLatency) {
          setStatus('slow')
        } else {
          setStatus('good')
        }
      } else {
        // HTTP error or server down
        setStatus('offline')
      }
    } catch {
      // Fetch aborted or network failure
      if (!navigator.onLine) {
        setStatus('offline')
      } else {
        // Online according to browser, but cannot reach server
        setStatus('slow')
      }
    } finally {
      setChecking(false)
      lastCheck.current = Date.now()
    }
  }, [socketState])

  // Listen to browser network changes
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const updateConnectionInfo = () => {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
      if (conn) {
        setEffectiveType(conn.effectiveType || null)
        setDownlink(conn.downlink || null)
        if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || (conn.rtt && conn.rtt >= 1000)) {
          setStatus('slow')
        }
      }
    }

    const handleOnline = () => {
      setOnline(true)
      checkLatency()
    }

    const handleOffline = () => {
      setOnline(false)
      setStatus('offline')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    if (conn) {
      conn.addEventListener('change', updateConnectionInfo)
      updateConnectionInfo()
    }

    // Initial ping check
    checkLatency()

    // Periodic heartbeat check every 45 seconds while tab is visible
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkLatency()
      }
    }, 45_000)

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 20_000) {
        checkLatency()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (conn) conn.removeEventListener('change', updateConnectionInfo)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [checkLatency])

  // React to socket state changes
  useEffect(() => {
    if (!online || socketState === 'offline') {
      setStatus('offline')
    } else if (socketState === 'reconnecting') {
      setStatus('reconnecting')
    } else if (socketState === 'connected' && status === 'reconnecting') {
      checkLatency()
    }
  }, [socketState, online, status, checkLatency])

  return {
    status, // 'good' | 'slow' | 'reconnecting' | 'offline'
    online,
    latency,
    effectiveType,
    downlink,
    checking,
    checkNow: checkLatency,
  }
}
