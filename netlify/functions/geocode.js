// Server-side proxy for reverse geocoding (lat/lon -> town, state) via OSM
// Nominatim. Runs on Netlify's servers because Nominatim doesn't send
// Access-Control-Allow-Origin, so a direct browser fetch would be blocked.

// Nominatim's usage policy requires a User-Agent that identifies the app.
const APP_UA = 'overhead-tracker.netlify.app'

export default async (request) => {
  const url = new URL(request.url)
  const lat = parseFloat(url.searchParams.get('lat'))
  const lon = parseFloat(url.searchParams.get('lon'))

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return new Response(JSON.stringify({ error: 'lat and lon query params are required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14`,
    { headers: { 'user-agent': APP_UA } },
  )
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `nominatim ${res.status}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const j = await res.json()
  const addr = j.address || {}
  const town = addr.city || addr.town || addr.village || addr.hamlet || addr.county || null
  const state = addr['ISO3166-2-lvl4']?.split('-')[1] || addr.state || null

  return new Response(JSON.stringify({ town, state }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  })
}

export const config = { path: '/api/geocode' }
