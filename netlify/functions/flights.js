// Server-side proxy for live ADS-B data: adsb.lol first, OpenSky as fallback.
// Runs on Netlify's servers so the browser never talks to either API directly —
// sidesteps OpenSky's CORS lockdown and ad-blockers that flag "adsb" as an ads domain.

function nm(a, b) {
  const R = 3440.1, t = x => x * Math.PI / 180
  const dl = t(b.lat - a.lat), dn = t(b.lon - a.lon)
  const s = Math.sin(dl / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dn / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function bearing(a, b) {
  const t = x => x * Math.PI / 180
  const y = Math.sin(t(b.lon - a.lon)) * Math.cos(t(b.lat))
  const x = Math.cos(t(a.lat)) * Math.sin(t(b.lat)) - Math.sin(t(a.lat)) * Math.cos(t(b.lat)) * Math.cos(t(b.lon - a.lon))
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

// Both APIs sit behind bot protection that 403s Node's default User-Agent, so
// pretend to be a browser.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// ICAO ADS-B emitter category (broadcast by the aircraft itself, not
// inferred from type) collapsed to a 3-tier size for the radar glyph.
// Absent category (common on older transponders) is left null rather than
// guessed, and rendered as the medium/default size.
const SMALL_CATS = new Set(['A1', 'A7', 'B1', 'B2', 'B3', 'B4', 'B6'])
const LARGE_CATS = new Set(['A4', 'A5', 'A6'])
function sizeFromCategory(cat) {
  if (!cat) return null
  if (SMALL_CATS.has(cat)) return 'small'
  if (LARGE_CATS.has(cat)) return 'large'
  return 'medium'
}

async function fromAdsbLol(h, r) {
  const res = await fetch(`https://api.adsb.lol/v2/point/${h.lat}/${h.lon}/${r}`, {
    headers: { 'user-agent': BROWSER_UA },
  })
  if (!res.ok) throw new Error('adsb.lol ' + res.status)
  const j = await res.json()
  return (j.ac || []).filter(a => a.lat != null).map(a => ({
    id: a.hex,
    call: (a.flight || '').trim() || a.r || a.hex.toUpperCase(),
    reg: a.r || '', type: a.t || '', desc: a.desc || '',
    alt: a.alt_baro === 'ground' ? 0 : a.alt_baro,
    gs: a.gs, trk: a.track, vr: a.baro_rate,
    size: sizeFromCategory(a.category),
    lat: a.lat, lon: a.lon,
    dst: a.dst ?? nm(h, a), dir: a.dir ?? bearing(h, a),
  }))
}

async function fromOpenSky(h, r) {
  const dLat = r / 60, dLon = r / (60 * Math.cos(h.lat * Math.PI / 180))
  const u = `https://opensky-network.org/api/states/all?lamin=${h.lat - dLat}&lomin=${h.lon - dLon}&lamax=${h.lat + dLat}&lomax=${h.lon + dLon}`
  const res = await fetch(u, { headers: { 'user-agent': BROWSER_UA } })
  if (!res.ok) throw new Error('OpenSky ' + res.status)
  const j = await res.json()
  return (j.states || []).filter(s => s[6] != null).map(s => {
    const p = { lat: s[6], lon: s[5] }
    return {
      id: s[0], call: (s[1] || '').trim() || s[0].toUpperCase(), reg: '', type: '', desc: '',
      alt: s[7] != null ? Math.round(s[7] * 3.281) : null,
      gs: s[9] != null ? Math.round(s[9] * 1.944) : null,
      trk: s[10], vr: s[11] != null ? Math.round(s[11] * 196.85) : null,
      size: null, // OpenSky's state vectors don't carry emitter category
      lat: p.lat, lon: p.lon, dst: nm(h, p), dir: bearing(h, p),
    }
  }).filter(a => a.dst <= r)
}

// Route (origin/destination) lookups, keyed by callsign. Persists across warm
// invocations of this function so repeat polls for the same flights are free.
const routeCache = new Map()
const ROUTE_TTL_MS = 60 * 60 * 1000

async function fetchRoutes(planes) {
  const res = await fetch('https://api.adsb.lol/api/0/routeset', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': BROWSER_UA,
      // The routeset endpoint additionally checks Origin/Referer against its
      // own map frontend, unlike the other adsb.lol endpoints.
      origin: 'https://globe.adsb.lol',
      referer: 'https://globe.adsb.lol/',
    },
    body: JSON.stringify({ planes }),
  })
  if (!res.ok) throw new Error('routeset ' + res.status)
  return res.json()
}

function airport(a) {
  return a ? { icao: a.icao, iata: a.iata, name: a.name, city: a.location } : null
}

async function attachRoutes(ac) {
  const now = Date.now()
  const need = [], seen = new Set()
  for (const a of ac) {
    const cs = (a.call || '').trim()
    if (!cs || seen.has(cs)) continue
    seen.add(cs)
    const cached = routeCache.get(cs)
    if (!cached || now - cached.ts >= ROUTE_TTL_MS) need.push({ callsign: cs, lat: a.lat, lng: a.lon })
  }

  // The routeset endpoint 400s past 100 planes per request.
  const ROUTESET_BATCH = 100
  const batches = []
  for (let i = 0; i < need.length; i += ROUTESET_BATCH) batches.push(need.slice(i, i + ROUTESET_BATCH))

  await Promise.all(batches.map(async batch => {
    try {
      const routes = await fetchRoutes(batch)
      for (const r of routes) {
        const [origin, destination] = r._airports || []
        routeCache.set(r.callsign, {
          origin: airport(origin),
          destination: airport(destination),
          plausible: r.plausible ?? false,
          ts: now,
        })
      }
    } catch {
      // Route info is a nice-to-have; leave this batch's aircraft without it on failure.
    }
  }))

  for (const a of ac) {
    const r = routeCache.get((a.call || '').trim())
    if (r?.plausible && r.origin && r.destination) {
      a.origin = r.origin
      a.destination = r.destination
    }
  }
}

export default async (request) => {
  const url = new URL(request.url)
  const lat = parseFloat(url.searchParams.get('lat'))
  const lon = parseFloat(url.searchParams.get('lon'))
  const radius = parseFloat(url.searchParams.get('radius')) || 30

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return new Response(JSON.stringify({ error: 'lat and lon query params are required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const here = { lat, lon }
  let ac
  try {
    ac = await fromAdsbLol(here, radius)
  } catch (e1) {
    try {
      ac = await fromOpenSky(here, radius)
    } catch (e2) {
      return new Response(JSON.stringify({ error: `adsb.lol: ${e1.message}; opensky: ${e2.message}` }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  ac.sort((a, b) => a.dst - b.dst)
  await attachRoutes(ac)

  return new Response(JSON.stringify({ ac }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=5',
    },
  })
}

export const config = { path: '/api/flights' }
