const CACHE_TTL_MS = 60_000;
const METRIC_WINDOW_MS = 5 * 60_000;
const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const cache = new Map();
const metrics = {
  startedAt: Date.now(),
  searchesTotal: 0,
  events: [],
};

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
    url.searchParams.get('radius_m') || url.searchParams.get('radiusMeters'),
    'radius_m',
    100,
    5_000,
    1_500,
  );
  const limit = numberParameter(url.searchParams.get('limit'), 'limit', 1, 50, 20);
  const cuisines = (url.searchParams.get('cuisines') || url.searchParams.get('cuisine') || '')
    .split(',')
    .map((cuisine) => cuisine.trim().toLowerCase())
    .filter(Boolean);
  const priceMin = numberParameter(url.searchParams.get('price_min'), 'price_min', 1, 4, null);
  const priceMax = numberParameter(url.searchParams.get('price_max'), 'price_max', 1, 4, null);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    throw new Error('price_min must not exceed price_max');
  }

  return { lat, lng, radiusMeters, limit, cuisines, priceMin, priceMax };
}

function overpassQuery({ lat, lng, radiusMeters }) {
  return `[out:json][timeout:15];nwr["amenity"="restaurant"](around:${radiusMeters},${lat},${lng});out center tags;`;
}

function clientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  return (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
}

function trimMetrics(now = Date.now()) {
  metrics.events = metrics.events.filter((event) => event.at > now - METRIC_WINDOW_MS);
}

function recordSearch({ client, cacheHit, durationMs, restaurants: restaurantList, failed }) {
  const now = Date.now();
  metrics.searchesTotal += 1;
  metrics.events.push({
    at: now,
    client,
    cacheHit,
    durationMs,
    failed,
    restaurantIds: restaurantList.map((restaurant) => restaurant.restaurant_id),
  });
  trimMetrics(now);
}

function stats() {
  const now = Date.now();
  trimMetrics(now);
  const recent = metrics.events;
  const successful = recent.filter((event) => !event.failed);
  const durationTotal = successful.reduce((total, event) => total + event.durationMs, 0);

  return {
    generated_at: new Date(now).toISOString(),
    period_seconds: METRIC_WINDOW_MS / 1_000,
    uptime_seconds: Math.floor((now - metrics.startedAt) / 1_000),
    searches: {
      total: metrics.searchesTotal,
      recent: recent.length,
      errors_recent: recent.filter((event) => event.failed).length,
      cache_hit_rate_recent: successful.length
        ? Number((successful.filter((event) => event.cacheHit).length / successful.length).toFixed(2))
        : 0,
      average_latency_ms_recent: successful.length ? Math.round(durationTotal / successful.length) : 0,
    },
    active: {
      users_recent: new Set(recent.map((event) => event.client)).size,
      restaurants_recent: new Set(successful.flatMap((event) => event.restaurantIds)).size,
    },
  };
}

function priceLevel(price) {
  if (!price) {
    return null;
  }
  const count = (price.match(/\$/g) || []).length;
  return count ? Math.min(count, 4) : null;
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
    restaurant_id: `osm:${element.type}/${element.id}`,
    name: tags.name,
    lat,
    lng,
    cuisines: (tags.cuisine || '').split(';').map((value) => value.trim()).filter(Boolean),
    price_level: priceLevel(tags.price),
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
    return { restaurants: cached.restaurants, cacheHit: true };
  }

  const response = await fetch(process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'user-agent': 'tablewise-workshop/1.0',
    },
    body: new URLSearchParams({ data: overpassQuery(search) }),
    signal: AbortSignal.timeout(8_000),
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
    .filter((restaurant) => search.priceMin === null || restaurant.price_level === null || restaurant.price_level >= search.priceMin)
    .filter((restaurant) => search.priceMax === null || restaurant.price_level === null || restaurant.price_level <= search.priceMax)
    .slice(0, search.limit);

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, restaurants: results });
  return { restaurants: results, cacheHit: false };
}

module.exports = {
  async handle(req, res, ctx) {
    if (ctx.path === '/stats') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method must be GET' });
        return true;
      }
      sendJson(res, 200, stats());
      return true;
    }
    if (ctx.path !== '/search') {
      return false;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method must be GET' });
      return true;
    }

    try {
      const startedAt = performance.now();
      const search = parseSearch(new URL(req.url, 'http://localhost'));
      const result = await restaurants(search);
      recordSearch({
        client: clientKey(req),
        cacheHit: result.cacheHit,
        durationMs: performance.now() - startedAt,
        restaurants: result.restaurants,
        failed: false,
      });
      sendJson(res, 200, { restaurants: result.restaurants });
    } catch (error) {
      recordSearch({
        client: clientKey(req),
        cacheHit: false,
        durationMs: 0,
        restaurants: [],
        failed: true,
      });
      const message = error instanceof Error ? error.message : 'unexpected discovery error';
      const status = message.includes('must be a number')
        || message.endsWith('is required')
        || message === 'price_min must not exceed price_max'
        ? 400
        : 502;
      sendJson(res, status, { error: message });
    }
    return true;
  },
};
