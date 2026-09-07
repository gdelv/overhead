import { useEffect, useRef, useState } from 'react'
import { fetchFlights } from './flights.js'
import { fetchPlace } from './geocode.js'

const REFRESH_MS = 10000

const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8]
const climb = vr => (vr == null || Math.abs(vr) < 200) ? '' : vr > 0 ? ' ↑ climbing' : ' ↓ descending'
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Fading comet-tail behind the sweep line, trailing opposite the spin direction.
function Sweep({ dur = '7s' }) {
  if (reducedMotion()) return null
  const trail = [0, 7, 14, 21, 28, 35, 42, 49].map(off => {
    const rad = -off * Math.PI / 180
    return { x: (100 * Math.sin(rad)).toFixed(1), y: (-100 * Math.cos(rad)).toFixed(1), o: Math.max(0, 0.85 - off * 0.017) }
  })
  return (
    <g className="sweep">
      {trail.map((p, i) => <line key={i} x1="0" y1="0" x2={p.x} y2={p.y} style={{ opacity: p.o }} />)}
      <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur={dur} repeatCount="indefinite" />
    </g>
  )
}

function ScopeRings({ radius, labelled }) {
  const rings = [1 / 3, 2 / 3, 1]
  return (
    <>
      {rings.map(f => (
        <g key={f}>
          <circle className="ring" r={100 * f} />
          {labelled && <text className="ringlabel" x="3" y={-100 * f + 11}>{Math.round(radius * f)} nm</text>}
        </g>
      ))}
      <line className="ring" x1="0" y1="-100" x2="0" y2="100" />
      <line className="ring" x1="-100" y1="0" x2="100" y2="0" />
    </>
  )
}

function Radar({ flights, radius, selected, onSelect, heading }) {
  return (
    <svg className="radar" viewBox="-110 -110 220 220" role="img" aria-label="Radar view of nearby aircraft">
      <defs>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ScopeRings radius={radius} labelled />
      <Sweep />
      {heading != null && (
        <path className="facing mobile-only" d="M0,-26 L11,4 L0,-6 L-11,4 Z" transform={`rotate(${heading})`} />
      )}
      <g className="ownship">
        <circle className="me-pulse" r="4" />
        <circle className="me-dot" r="4" />
      </g>
      {flights.map(a => {
        const d = Math.min(a.dst / radius, 1) * 100
        const ang = (a.dir - 90) * Math.PI / 180
        const x = (d * Math.cos(ang)).toFixed(1), y = (d * Math.sin(ang)).toFixed(1)
        return (
          <path key={a.id}
            className={'plane' + (a.id === selected ? ' sel' : '')}
            d="M0,-7 L4,5 L0,3 L-4,5 Z"
            transform={`translate(${x},${y}) rotate(${a.trk || 0})`}
            onClick={() => onSelect(a.id)}>
            <title>{a.origin && a.destination ? `${a.call} · ${a.origin.iata || a.origin.icao} → ${a.destination.iata || a.destination.icao}` : a.call}</title>
          </path>
        )
      })}
    </svg>
  )
}

function Scope() {
  return (
    <svg className="scope" viewBox="-110 -110 220 220" aria-hidden="true">
      <defs>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ScopeRings />
      <Sweep dur="9s" />
      <g className="ownship">
        <circle className="me-pulse" r="5" />
        <circle className="me-dot" r="5" />
      </g>
    </svg>
  )
}

function Route({ origin, destination }) {
  const code = ap => ap.iata || ap.icao
  if (!origin || !destination) return <div className="route route-unknown">No filed route</div>
  return (
    <div className="route" title={`${origin.name} → ${destination.name}`}>
      {code(origin)} <span className="arrow">→</span> {code(destination)}
    </div>
  )
}

function FlightRow({ a, selected, onSelect }) {
  const ref = useRef(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [selected])
  const ident = [a.desc || a.type, a.reg].filter(Boolean).join(' · ')
  return (
    <div ref={ref} className={'row' + (selected ? ' sel' : '')} onClick={() => onSelect(a.id)}>
      <div className="call">{a.call}</div>
      <div className="dist">{a.dst.toFixed(1)} nm {compass(a.dir)}</div>
      <Route origin={a.origin} destination={a.destination} />
      <div className="meta">
        {ident && <>{ident}<br /></>}
        {a.alt != null ? (a.alt === 0 ? 'On the ground' : a.alt.toLocaleString() + ' ft' + climb(a.vr)) : 'Altitude unknown'}
        {a.gs != null && ` · ${Math.round(a.gs)} kt`}
        {a.trk != null && ` · heading ${Math.round(a.trk)}°`}
      </div>
    </div>
  )
}

export default function App() {
  const [here, setHere] = useState(null)
  const [radius, setRadius] = useState(10)
  const [flights, setFlights] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState(null)
  const [status, setStatus] = useState({ text: '' })
  const [place, setPlace] = useState(null)
  const [compassOn, setCompassOn] = useState(false)
  const [heading, setHeading] = useState(null)

  useEffect(() => {
    if (!here) return
    let alive = true
    setPlace(null)
    fetchPlace(here).then(p => { if (alive) setPlace(p) }).catch(() => { if (alive) setPlace(null) })
    return () => { alive = false }
  }, [here])

  useEffect(() => {
    if (!compassOn) return
    // Track an unwrapped angle so the CSS rotation always turns the short way
    // and keeps going past 360/0 instead of snapping back when the raw
    // 0-360 reading wraps around.
    let continuous = null
    function onOrient(e) {
      // iOS gives a ready-made compass heading; other browsers only give
      // device-frame alpha, which points the opposite way round.
      const raw = e.webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) % 360 : null)
      if (raw == null) return
      if (continuous == null) {
        continuous = raw
      } else {
        const prevMod = ((continuous % 360) + 360) % 360
        const delta = (((raw - prevMod + 180) % 360 + 360) % 360) - 180
        continuous += delta
      }
      setHeading(continuous)
    }
    const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(evt, onOrient)
    return () => window.removeEventListener(evt, onOrient)
  }, [compassOn])

  async function enableCompass() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const perm = await DeviceOrientationEvent.requestPermission()
        if (perm !== 'granted') return setStatus({ text: 'Compass permission denied.' })
      }
      setCompassOn(true)
    } catch (e) {
      setStatus({ text: `Compass unavailable (${e.message}).` })
    }
  }

  useEffect(() => {
    if (!here) return
    let alive = true
    setFlights([])
    setLoaded(false)
    setStatus({ text: 'Scanning the airspace…' })
    async function tick() {
      try {
        const ac = await fetchFlights(here, radius)
        if (!alive) return
        setFlights(ac)
        setLoaded(true)
        setStatus({ text: `${ac.length} aircraft nearby · updated ${new Date().toLocaleTimeString()}` })
      } catch (e) {
        if (!alive) return
        setLoaded(true)
        setStatus({ text: `Could not reach the flight data feeds (${e.message}). Retrying shortly.`, err: true })
      }
    }
    tick()
    const t = setInterval(tick, REFRESH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [here, radius])

  function useMyLocation() {
    if (!navigator.geolocation) return setStatus({ text: 'Location not available in this browser.', err: true })
    setStatus({ text: 'Finding you…' })
    navigator.geolocation.getCurrentPosition(
      p => setHere({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
      e => setStatus({ text: `Location blocked (${e.message}).`, err: true }),
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  if (!here) {
    return (
      <section className="hero">
        <Scope />
        <h1 className="brand">Overhead</h1>
        <p className="tagline">See what's flying near you, right now.</p>
        <button className="cta" onClick={useMyLocation}>Use my location</button>
        <div className="status">{status.err ? <div className="err">{status.text}</div> : status.text}</div>
      </section>
    )
  }

  return (
    <>
      <header className="topbar">
        <h1 className="brand">Overhead</h1>
        <span className={'pulse' + (status.err ? ' down' : '')}>
          <i className="pulse-dot" />{status.err ? 'signal lost' : 'live'}
        </span>
      </header>

      <p className="readout">
        <span className="place">{place?.town ? `${place.town}${place.state ? ', ' + place.state : ''}` : 'Locating place…'}</span>
        <span className="coords">{here.lat.toFixed(4)}, {here.lon.toFixed(4)}</span>
      </p>

      <div className="loc">
        <select value={radius} onChange={e => setRadius(+e.target.value)}>
          {[10, 30, 60, 100].map(r => <option key={r} value={r}>{r} nm</option>)}
        </select>
        <button className="quiet mobile-only" onClick={enableCompass}>{compassOn ? 'Compass on' : 'Enable compass'}</button>
      </div>

      <Radar flights={flights} radius={radius} selected={selected} onSelect={setSelected} heading={compassOn ? heading : null} />

      <div className="status">{status.err ? <div className="err">{status.text}</div> : status.text}</div>

      <div className="list">
        {!loaded
          ? <div className="empty">Scanning the airspace…</div>
          : flights.length === 0
            ? <div className="empty">Clear skies. Nothing is broadcasting its position within range right now. Try a wider radius.</div>
            : flights.map(a => <FlightRow key={a.id} a={a} selected={a.id === selected} onSelect={setSelected} />)}
      </div>
    </>
  )
}
