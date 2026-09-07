import { useEffect, useRef, useState } from 'react'
import { fetchFlights } from './flights.js'
import { fetchPlace } from './geocode.js'

const HOME = { lat: 40.7685, lon: -73.4660 } // Plainview, NY
const REFRESH_MS = 10000

const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8]
const climb = vr => (vr == null || Math.abs(vr) < 200) ? '' : vr > 0 ? ' ↑ climbing' : ' ↓ descending'

function Radar({ flights, radius, selected, onSelect }) {
  const rings = [1 / 3, 2 / 3, 1]
  return (
    <svg className="radar" viewBox="-110 -110 220 220" role="img" aria-label="Radar view of nearby aircraft">
      {rings.map(f => (
        <g key={f}>
          <circle className="ring" r={100 * f} />
          <text className="ringlabel" x="3" y={-100 * f + 11}>{Math.round(radius * f)} nm</text>
        </g>
      ))}
      <line className="ring" x1="0" y1="-100" x2="0" y2="100" />
      <line className="ring" x1="-100" y1="0" x2="100" y2="0" />
      <circle className="me" r="4" />
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
  const [latIn, setLatIn] = useState(HOME.lat.toString())
  const [lonIn, setLonIn] = useState(HOME.lon.toString())
  const [here, setHere] = useState(HOME)
  const [radius, setRadius] = useState(10)
  const [flights, setFlights] = useState([])
  const [selected, setSelected] = useState(null)
  const [status, setStatus] = useState({ text: 'Starting…' })
  const [place, setPlace] = useState(null)

  useEffect(() => {
    let alive = true
    setPlace(null)
    fetchPlace(here).then(p => { if (alive) setPlace(p) }).catch(() => { if (alive) setPlace(null) })
    return () => { alive = false }
  }, [here])

  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const ac = await fetchFlights(here, radius)
        if (!alive) return
        setFlights(ac)
        setStatus({ text: `${ac.length} aircraft nearby · updated ${new Date().toLocaleTimeString()}` })
      } catch (e) {
        if (alive) setStatus({ text: `Could not reach the flight data feeds (${e.message}). Retrying shortly.`, err: true })
      }
    }
    tick()
    const t = setInterval(tick, REFRESH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [here, radius])

  function trackHere() {
    const lat = parseFloat(latIn), lon = parseFloat(lonIn)
    if (isNaN(lat) || isNaN(lon)) return setStatus({ text: 'Enter a latitude and longitude first.' })
    setHere({ lat, lon })
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setStatus({ text: 'Location not available in this browser. Enter coordinates instead.' })
    setStatus({ text: 'Finding you…' })
    navigator.geolocation.getCurrentPosition(
      p => {
        const lat = +p.coords.latitude.toFixed(4), lon = +p.coords.longitude.toFixed(4)
        setLatIn(String(lat)); setLonIn(String(lon)); setHere({ lat, lon })
      },
      e => setStatus({ text: `Location blocked (${e.message}). Enter coordinates and tap Track here.` }),
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  return (
    <>
      <h1>Overhead</h1>
      <p className="sub">
        Aircraft within {radius} nautical miles of {here.lat.toFixed(4)}, {here.lon.toFixed(4)}
        {place?.town && (place?.state ? ` (${place.town}, ${place.state})` : ` (${place.town})`)}, refreshed every 10 seconds.
      </p>

      <div className="loc">
        <button onClick={useMyLocation}>Use my location</button>
        <input type="number" step="any" inputMode="decimal" placeholder="Latitude" value={latIn} onChange={e => setLatIn(e.target.value)} />
        <input type="number" step="any" inputMode="decimal" placeholder="Longitude" value={lonIn} onChange={e => setLonIn(e.target.value)} />
        <button className="quiet" onClick={trackHere}>Track here</button>
        <select value={radius} onChange={e => setRadius(+e.target.value)}>
          {[10, 30, 60, 100].map(r => <option key={r} value={r}>{r} nm</option>)}
        </select>
      </div>

      <Radar flights={flights} radius={radius} selected={selected} onSelect={setSelected} />

      <div className="status">{status.err ? <div className="err">{status.text}</div> : status.text}</div>

      <div className="list">
        {flights.length === 0
          ? <div className="empty">Clear skies. Nothing is broadcasting its position within range right now. Try a wider radius.</div>
          : flights.map(a => <FlightRow key={a.id} a={a} selected={a.id === selected} onSelect={setSelected} />)}
      </div>
    </>
  )
}
