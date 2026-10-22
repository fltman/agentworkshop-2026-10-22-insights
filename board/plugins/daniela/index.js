const CACHE_TTL_MS = 60_000;
const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const cache = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function numberParameter(value, name, minimum, maximum, fallback) {
  if (value === null) {
    if (fallback === undefined) {
      throw new Error(`${name} is required`);
    }
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseSearch(url) {
  const lat = numberParameter(url.searchParams.get('lat'), 'lat', -90, 90);
  const lng = numberParameter(url.searchParams.get('lng'), 'lng', -180, 180);
  const radiusMeters = numberParameter(
    url.searchParams.get('radiusMeters'),
    'radiusMeters',
    100,
    5_000,
    1_500,
  );
  const limit = numberParameter(url.searchParams.get('limit'), 'limit', 1, 50, 20);
  const cuisines = (url.searchParams.get('cuisine') || '')
    .split(',')
    .map((cuisine) => cuisine.trim().toLowerCase())
    .filter(Boolean);

  return { lat, lng, radiusMeters, limit, cuisines };
}

function overpassQuery({ lat, lng, radiusMeters }) {
  return `[out:json][timeout:15];nwr["amenity"="restaurant"](around:${radiusMeters},${lat},${lng});out center tags;`;
}

function priceLevel(price) {
  if (!price) {
    return null;
  }
  const count = (price.match(/\$/g) || []).length;
  return count ? '$'.repeat(Math.min(count, 4)) : price;
}

function address(tags) {
  const parts = [
    [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
    [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' '),
  ].filter(Boolean);
  return parts.join(', ') || null;
}

function normalize(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !tags.name) {
    return null;
  }

  return {
    id: `osm-${element.type}-${element.id}`,
    name: tags.name,
    lat,
    lng,
    cuisines: (tags.cuisine || '').split(';').map((value) => value.trim()).filter(Boolean),
    priceLevel: priceLevel(tags.price),
    address: address(tags),
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    openingHours: tags.opening_hours || null,
    source: 'openstreetmap',
  };
}

async function restaurants(search) {
  const cacheKey = JSON.stringify(search);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.restaurants;
  }

  const response = await fetch(process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ data: overpassQuery(search) }),
  });
  if (!response.ok) {
    throw new Error(`restaurant provider returned ${response.status}`);
  }

  const payload = await response.json();
  const cuisineSet = new Set(search.cuisines);
  const results = (payload.elements || [])
    .map(normalize)
    .filter(Boolean)
    .filter((restaurant) => !cuisineSet.size || restaurant.cuisines.some((cuisine) => cuisineSet.has(cuisine.toLowerCase())))
    .slice(0, search.limit);

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, restaurants: results });
  return results;
}

module.exports = {
  async handle(req, res, ctx) {
    if (ctx.path !== '/search') {
      return false;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method must be GET' });
      return true;
    }

    try {
      const search = parseSearch(new URL(req.url, 'http://localhost'));
      sendJson(res, 200, { restaurants: await restaurants(search) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unexpected discovery error';
      const status = message.includes('must be a number') || message.endsWith('is required') ? 400 : 502;
      sendJson(res, status, { error: message });
    }
    return true;
  },
};
