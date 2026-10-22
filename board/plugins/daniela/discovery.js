const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_PROVIDERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const cache = new Map();
const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchNearby';

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

function priceLevel(price) {
  const count = (price || '').match(/\$/g)?.length || 0;
  return count ? Math.min(count, 4) : null;
}

function normalize(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !tags.name) {
    return null;
  }

  const address = [
    [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
    [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ') || null;
  return {
    restaurant_id: `osm:${element.type}/${element.id}`,
    name: tags.name,
    lat,
    lng,
    cuisines: (tags.cuisine || '').split(';').map((value) => value.trim()).filter(Boolean),
    price_level: priceLevel(tags.price),
    address,
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    openingHours: tags.opening_hours || null,
    source: 'openstreetmap',
  };
}

function normalizeGooglePlace(place) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!place.id || !place.displayName?.text || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const cuisines = (place.types || [])
    .filter((type) => type.endsWith('_restaurant'))
    .map((type) => type.replace(/_restaurant$/, '').replace(/_/g, ' '));
  const priceLevels = {
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return {
    restaurant_id: `google:${place.id}`,
    name: place.displayName.text,
    lat,
    lng,
    cuisines,
    price_level: priceLevels[place.priceLevel] || null,
    address: place.formattedAddress || null,
    phone: place.nationalPhoneNumber || null,
    website: place.websiteUri || null,
    openingHours: place.regularOpeningHours?.weekdayDescriptions?.join('; ') || null,
    source: 'google-places',
  };
}

function providers() {
  return process.env.OVERPASS_URL ? process.env.OVERPASS_URL.split(',') : DEFAULT_PROVIDERS;
}

function googleApiKey() {
  return process.env.GOOGLE_MAPS_API || process.env.GOOGLE_PLACES_API_KEY || null;
}

function filterRestaurants(restaurants, search) {
  const cuisineSet = new Set(search.cuisines);
  return restaurants
    .filter(Boolean)
    .filter((restaurant) => !cuisineSet.size || restaurant.cuisines.some((cuisine) => cuisineSet.has(cuisine.toLowerCase())))
    .filter((restaurant) => search.priceMin === null || restaurant.price_level === null || restaurant.price_level >= search.priceMin)
    .filter((restaurant) => search.priceMax === null || restaurant.price_level === null || restaurant.price_level <= search.priceMax)
    .slice(0, search.limit);
}

async function fetchGoogleRestaurants(search, apiKey) {
  const response = await fetch(process.env.GOOGLE_PLACES_URL || GOOGLE_PLACES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
      'x-goog-fieldmask': [
        'places.id',
        'places.displayName',
        'places.location',
        'places.types',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.regularOpeningHours',
        'places.priceLevel',
      ].join(','),
    },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: Math.min(search.limit, 20),
      locationRestriction: {
        circle: {
          center: { latitude: search.lat, longitude: search.lng },
          radius: search.radiusMeters,
        },
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Google Places returned ${response.status}`);
  }
  return response.json();
}

async function fetchRestaurants(provider, search) {
  const response = await fetch(provider, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'user-agent': 'tablewise-workshop/1.0',
    },
    body: new URLSearchParams({ data: overpassQuery(search) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`restaurant provider returned ${response.status}`);
  }
  return response.json();
}

async function searchRestaurants(search) {
  const cacheKey = JSON.stringify(search);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { restaurants: cached.restaurants, cacheHit: true };
  }

  let lastError;
  const apiKey = googleApiKey();
  if (apiKey) {
    try {
      const payload = await fetchGoogleRestaurants(search, apiKey);
      const restaurants = filterRestaurants((payload.places || []).map(normalizeGooglePlace), search);
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, restaurants });
      return { restaurants, cacheHit: false };
    } catch (error) {
      lastError = error;
    }
  }

  for (const provider of providers()) {
    try {
      const payload = await fetchRestaurants(provider, search);
      const restaurants = filterRestaurants((payload.elements || []).map(normalize), search);
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, restaurants });
      return { restaurants, cacheHit: false };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`restaurant providers unavailable: ${lastError?.message || 'unknown error'}`);
}

module.exports = { parseSearch, searchRestaurants };
