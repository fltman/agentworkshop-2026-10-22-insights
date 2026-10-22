// Google Places (New) search proxy. The API key lives only in the server environment (GOOGLE_PLACES_API_KEY),
// is never sent to the browser, never logged and never part of an error message.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const FIELDS = [
  'places.id', 'places.displayName', 'places.location', 'places.formattedAddress', 'places.priceLevel',
  'places.rating', 'places.userRatingCount', 'places.nationalPhoneNumber', 'places.websiteUri',
  'places.regularOpeningHours', 'places.primaryType', 'places.types',
].join(',');
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_MIN = 40;
const PRICE = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
const OSM_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // Google: 0 = Sunday
const OSM_ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const cache = new Map();
let windowStart = 0;
let windowCount = 0;

function hhmm(t) {
  return String(t.hour || 0).padStart(2, '0') + ':' + String(t.minute || 0).padStart(2, '0');
}

// Google periods -> OSM opening_hours string, so the UI can compare it with the chosen time.
function openingHours(roh) {
  const periods = roh && roh.periods;
  if (!periods || !periods.length) return null;
  if (periods.length === 1 && periods[0].open && !periods[0].close) return '24/7';
  const perDay = {};
  periods.forEach((p) => {
    if (!p.open || !p.close) return;
    const day = OSM_DAYS[p.open.day];
    (perDay[day] = perDay[day] || []).push(hhmm(p.open) + '-' + hhmm(p.close));
  });
  return OSM_ORDER.map((d) => d + ' ' + (perDay[d] ? perDay[d].join(',') : 'off')).join('; ');
}

function normalize(p) {
  if (!p.id || !p.location) return null;
  const types = p.types || [];
  const cuisines = types.filter((t) => t.endsWith('_restaurant')).map((t) => t.replace(/_restaurant$/, '').replace(/_/g, ' '));
  return {
    restaurant_id: 'google:' + p.id,
    name: (p.displayName && p.displayName.text) || 'Unnamed',
    lat: p.location.latitude,
    lng: p.location.longitude,
    cuisines,
    price_level: PRICE[p.priceLevel] || null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    rating_count: p.userRatingCount || null,
    contact: {
      phone: p.nationalPhoneNumber || null,
      website: p.websiteUri || null,
      address: p.formattedAddress || null,
      opening_hours: openingHours(p.regularOpeningHours),
    },
    source: 'google-places',
  };
}

function number(value, name, min, max, fallback) {
  if (value === null || value === undefined || value === '') {
    if (fallback === undefined) throw new Error(name + ' is required');
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(name + ' must be a number from ' + min + ' to ' + max);
  return n;
}

// Nearby Search returns at most 20 places per call, so one search covers the area with five overlapping circles.
function circles(lat, lng, radius) {
  const dLat = (radius * 0.5) / 111320;
  const dLng = (radius * 0.5) / (111320 * Math.cos((lat * Math.PI) / 180));
  const r = Math.max(radius * 0.6, 100);
  return [[lat, lng], [lat + dLat, lng], [lat - dLat, lng], [lat, lng + dLng], [lat, lng - dLng]].map(([la, ln]) => ({ lat: la, lng: ln, radius: r }));
}

async function nearby(key, c) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': FIELDS },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: c.radius } },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('google places returned ' + res.status);
  const data = await res.json();
  return data.places || [];
}

async function search(key, lat, lng, radius, limit) {
  const cacheKey = [lat.toFixed(3), lng.toFixed(3), Math.round(radius / 100)].join('|');
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.list;
  const results = await Promise.allSettled(circles(lat, lng, radius).map((c) => nearby(key, c)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw new Error(results[0].reason.message);
  const seen = new Set();
  const list = [];
  ok.flatMap((r) => r.value).forEach((p) => {
    const n = normalize(p);
    if (n && !seen.has(n.restaurant_id)) { seen.add(n.restaurant_id); list.push(n); }
  });
  const R = 6371000, rad = Math.PI / 180;
  const dist = (r) => 2 * R * Math.asin(Math.sqrt(Math.sin(((r.lat - lat) * rad) / 2) ** 2 + Math.cos(lat * rad) * Math.cos(r.lat * rad) * Math.sin(((r.lng - lng) * rad) / 2) ** 2));
  list.forEach((r) => { r.distance_m = Math.round(dist(r)); });
  const inside = list.filter((r) => r.distance_m <= radius).sort((a, b) => a.distance_m - b.distance_m).slice(0, limit);
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, list: inside });
  return inside;
}

function allowed() {
  const now = Date.now();
  if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
  windowCount += 1;
  return windowCount <= MAX_REQUESTS_PER_MIN;
}

async function handlePlaces(req, res, json) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return json(res, 503, { configured: false, error: 'GOOGLE_PLACES_API_KEY is not set on the server' });
  if (!allowed()) return json(res, 429, { error: 'too many place searches, try again in a minute' });
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams;
    const lat = number(q.get('lat'), 'lat', -90, 90);
    const lng = number(q.get('lng'), 'lng', -180, 180);
    const radius = number(q.get('radius_m'), 'radius_m', 100, 5000, 1500);
    const limit = number(q.get('limit'), 'limit', 1, 100, 60);
    const wanted = (q.get('cuisines') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    let restaurants = await search(key, lat, lng, radius, limit);
    if (wanted.length) restaurants = restaurants.filter((r) => r.cuisines.some((c) => wanted.includes(c)));
    return json(res, 200, { restaurants, source: 'google-places' });
  } catch (e) {
    const msg = e && e.message ? e.message : 'unexpected error';
    return json(res, /must be|required/.test(msg) ? 400 : 502, { error: msg.replace(key, '***') });
  }
}

module.exports = { handlePlaces, openingHours, normalize, circles };
