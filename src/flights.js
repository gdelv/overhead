// Live ADS-B data, fetched through our own /api/flights function (see
// netlify/functions/flights.js) instead of calling adsb.lol/OpenSky directly —
// that server-side hop avoids OpenSky's CORS lockdown and ad-blockers that
// flag any "adsb"-looking URL as an ads request.

export async function fetchFlights(here, radius) {
  const res = await fetch(`/api/flights?lat=${here.lat}&lon=${here.lon}&radius=${radius}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `flights ${res.status}`)
  }
  const j = await res.json()
  return j.ac
}
