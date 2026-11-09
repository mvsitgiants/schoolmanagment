// Ring tones made with the Web Audio API (no audio files): a fast two-tone alarm for emergency
// alerts and a loud double ring for urgent calls — both repeat until the call is answered —
// a single soft chime for a normal call, and a short "pop" for chat messages.
// Browsers keep audio locked until the person has clicked or tapped the page once;
// unlockAudio() runs on that first gesture (IncomingCalls wires it). Until then the
// incoming screen, the tab notification and the vibration still alert them.

let ctx = null

function audio() {
  if (ctx) return ctx
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  try { ctx = new AC() } catch { ctx = null }
  return ctx
}

/** Call from a user gesture so later rings can play. */
export function unlockAudio() {
  const c = audio()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}

function tone(c, { freq, at, dur, type = 'sine', gain = 0.22 }) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(g)
  g.connect(c.destination)
  osc.start(at)
  osc.stop(at + dur + 0.05)
}

const PATTERNS = {
  CODE: {
    every: 1100,
    vibrate: [400, 120, 400, 120, 400],
    play: (c, t) => { for (let i = 0; i < 4; i++) tone(c, { freq: i % 2 ? 660 : 960, at: t + i * 0.24, dur: 0.22, type: 'square', gain: 0.16 }) },
  },
  URGENT: {
    every: 2000,
    vibrate: [300, 150, 300],
    play: (c, t) => { tone(c, { freq: 880, at: t, dur: 0.32, type: 'triangle' }); tone(c, { freq: 880, at: t + 0.42, dur: 0.32, type: 'triangle' }) },
  },
  // a normal call chimes once (no loop) — the card stays on screen until it is answered
  ROUTINE: {
    every: 0,
    vibrate: [200],
    play: (c, t) => { tone(c, { freq: 660, at: t, dur: 0.22, gain: 0.18 }); tone(c, { freq: 880, at: t + 0.26, dur: 0.38, gain: 0.18 }) },
  },
}

const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

/** Ring for `kind` (CODE · URGENT loop until stopped; ROUTINE chimes once). Returns stop(). */
export function startRinging(kind = 'ROUTINE') {
  const p = PATTERNS[kind] ?? PATTERNS.ROUTINE
  const c = audio()
  const tick = () => {
    if (c && c.state === 'running') {
      try { p.play(c, c.currentTime + 0.02) } catch { /* a closed context: stay silent */ }
    }
    if (canVibrate()) { try { navigator.vibrate(p.vibrate) } catch { /* not allowed yet */ } }
  }
  tick()
  const timer = p.every ? setInterval(tick, p.every) : null
  return () => {
    if (timer) clearInterval(timer)
    if (canVibrate()) { try { navigator.vibrate(0) } catch { /* ignore */ } }
  }
}

/** A short soft "pop" for a new chat message (not a ring): one rising blip, no vibration. */
export function playPop() {
  const c = audio()
  if (!c || c.state !== 'running') return
  try {
    const t = c.currentTime + 0.01
    tone(c, { freq: 740, at: t, dur: 0.09, gain: 0.12 })
    tone(c, { freq: 1100, at: t + 0.07, dur: 0.12, gain: 0.1 })
  } catch { /* a closed context: stay silent */ }
}
