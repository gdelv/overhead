// Reverse geocoding, fetched through our own /api/geocode function (see
// netlify/functions/geocode.js) instead of calling Nominatim directly — that
// server-side hop avoids Nominatim's missing CORS headers.

export async function fetchPlace(here) {
  const res = await fetch(`/api/geocode?lat=${here.lat}&lon=${here.lon}`)
  if (!res.ok) throw new Error(`geocode ${res.status}`)
  return res.json()
}
