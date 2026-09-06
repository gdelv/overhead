// Live ADS-B data: adsb.lol first, OpenSky as fallback. No API keys needed.

export function nm(a, b) {
  const R = 3440.1, t = x => x * Math.PI / 180
  const dl = t(b.lat - a.lat), dn = t(b.lon - a.lon)
  const s = Math.sin(dl / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dn / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

export function bearing(a, b) {
  const t = x => x * Math.PI / 180
  const y = Math.sin(t(b.lon - a.lon)) * Math.cos(t(b.lat))
  const x = Math.cos(t(a.lat)) * Math.sin(t(b.lat)) - Math.sin(t(a.lat)) * Math.cos(t(b.lat)) * Math.cos(t(b.lon - a.lon))
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

async function fromAdsbLol(h, r) {
  const res = await fetch(`https://api.adsb.lol/v2/point/${h.lat}/${h.lon}/${r}`)
  if (!res.ok) throw new Error('adsb.lol ' + res.status)
  const j = await res.json()
  return (j.ac || []).filter(a => a.lat != null).map(a => ({
    id: a.hex,
    call: (a.flight || '').trim() || a.r || a.hex.toUpperCase(),
    reg: a.r || '', type: a.t || '', desc: a.desc || '',
    alt: a.alt_baro === 'ground' ? 0 : a.alt_baro,
    gs: a.gs, trk: a.track, vr: a.baro_rate,
    lat: a.lat, lon: a.lon,
    dst: a.dst ?? nm(h, a), dir: a.dir ?? bearing(h, a),
  }))
}

async function fromOpenSky(h, r) {
  const dLat = r / 60, dLon = r / (60 * Math.cos(h.lat * Math.PI / 180))
  const u = `https://opensky-network.org/api/states/all?lamin=${h.lat - dLat}&lomin=${h.lon - dLon}&lamax=${h.lat + dLat}&lomax=${h.lon + dLon}`
  const res = await fetch(u)
  if (!res.ok) throw new Error('OpenSky ' + res.status)
  const j = await res.json()
  return (j.states || []).filter(s => s[6] != null).map(s => {
    const p = { lat: s[6], lon: s[5] }
    return {
      id: s[0], call: (s[1] || '').trim() || s[0].toUpperCase(), reg: '', type: '', desc: '',
      alt: s[7] != null ? Math.round(s[7] * 3.281) : null,
      gs: s[9] != null ? Math.round(s[9] * 1.944) : null,
      trk: s[10], vr: s[11] != null ? Math.round(s[11] * 196.85) : null,
      lat: p.lat, lon: p.lon, dst: nm(h, p), dir: bearing(h, p),
    }
  }).filter(a => a.dst <= r)
}

export async function fetchFlights(here, radius) {
  let ac
  try { ac = await fromAdsbLol(here, radius) }
  catch { ac = await fromOpenSky(here, radius) }
  return ac.sort((a, b) => a.dst - b.dst)
}
