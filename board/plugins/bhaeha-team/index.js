// bhaeha-team: menus + special offers per restaurant id and date range. See projects/bhaeha-team/CONTRACT.md.
//   GET /t/bhaeha-team/menu?id=&lat=&lng=&from=YYYY-MM-DD&to=YYYY-MM-DD

const MAX_DAYS = 31;
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const LIVE_BUDGET_MS = 4000;
const nearCache = new Map();
const CACHE_TTL = 6 * 3600 * 1000;
const cache = new Map();
const pageCache = new Map();
const dns = require('dns').promises;
const net = require('net');
const MAX_PAGE_BYTES = 500000;

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function iso(d) { return d.toISOString().slice(0, 10); }

// Looks up a restaurant by id "osm:<node|way|relation>:<n>" in OpenStreetMap. Returns null when unknown or on failure.
async function lookupOsm(id) {
  const m = /^osm:(node|way|relation)[:/](\d{1,12})$/.exec(id);
  if (!m) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.tags;
  const body = `[out:json][timeout:10];${m[1]}(${m[2]});out tags;`;
  try {
    const r = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'user-agent': 'tablewise-workshop/1.0', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const tags = (j.elements && j.elements[0] && j.elements[0].tags) || null;
    if (tags) cache.set(id, { ts: Date.now(), tags });
    return tags;
  } catch (err) {
    console.error('[bhaeha-team] overpass:', err && err.message);
    return lookupNominatim(id, m[1], m[2]);
  }
}

// Google Places (New). The key is read only from the server environment and never logged or returned.
const googleKey = () => process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API || '';
const googleCache = new Map();
const GOOGLE_DETAIL_FIELDS = [
  'displayName', 'formattedAddress', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri',
  'rating', 'userRatingCount', 'priceLevel', 'priceRange', 'businessStatus', 'primaryTypeDisplayName', 'types',
  'editorialSummary', 'regularOpeningHours', 'currentOpeningHours', 'dineIn', 'takeout', 'delivery', 'reservable',
  'outdoorSeating', 'liveMusic', 'goodForGroups', 'goodForChildren', 'allowsDogs', 'accessibilityOptions',
  'servesVegetarianFood', 'servesBreakfast', 'servesBrunch', 'servesLunch', 'servesDinner', 'servesBeer', 'servesWine',
  'servesCocktails', 'servesCoffee', 'servesDessert', 'menuForChildren', 'paymentOptions', 'parkingOptions',
].join(',');
const PRICE_LEVELS = { PRICE_LEVEL_FREE: 'Free', PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' };

// Flattens Google's place details into plain label/value facts for display. Only strings, numbers and lists of strings.
function googleFacts(j) {
  const f = {};
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) f[k] = v; };
  put('rating', j.rating);
  put('rating_count', j.userRatingCount);
  put('price_level', PRICE_LEVELS[j.priceLevel]);
  if (j.priceRange && j.priceRange.startPrice) {
    const sp = j.priceRange.startPrice, ep = j.priceRange.endPrice;
    put('price_range', `${sp.units || 0}${ep ? '-' + (ep.units || '') : '+'} ${sp.currencyCode || ''}`.trim());
  }
  put('status', j.businessStatus);
  put('type', j.primaryTypeDisplayName && j.primaryTypeDisplayName.text);
  put('summary', j.editorialSummary && j.editorialSummary.text);
  put('phone', j.internationalPhoneNumber || j.nationalPhoneNumber);
  put('address', j.formattedAddress);
  put('website', httpUrl(j.websiteUri));
  put('google_maps', httpUrl(j.googleMapsUri));
  put('open_now', j.currentOpeningHours && typeof j.currentOpeningHours.openNow === 'boolean' ? (j.currentOpeningHours.openNow ? 'yes' : 'no') : undefined);
  put('opening_hours', (j.regularOpeningHours && j.regularOpeningHours.weekdayDescriptions) || undefined);
  const yes = ['dineIn', 'takeout', 'delivery', 'reservable', 'outdoorSeating', 'liveMusic', 'goodForGroups', 'goodForChildren', 'allowsDogs', 'menuForChildren']
    .filter((x) => j[x] === true).map((x) => x.replace(/([A-Z])/g, ' $1').toLowerCase());
  put('features', yes);
  const serves = ['Vegetarian', 'Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Beer', 'Wine', 'Cocktails', 'Coffee', 'Dessert'].filter((x) => j['serves' + x + (x === 'Vegetarian' ? 'Food' : '')] === true);
  put('serves', serves);
  const acc = j.accessibilityOptions || {};
  put('accessibility', Object.keys(acc).filter((x) => acc[x] === true).map((x) => x.replace(/([A-Z])/g, ' $1').toLowerCase()));
  const pay = j.paymentOptions || {};
  put('payment', Object.keys(pay).filter((x) => pay[x] === true).map((x) => x.replace(/([A-Z])/g, ' $1').toLowerCase()));
  const park = j.parkingOptions || {};
  put('parking', Object.keys(park).filter((x) => park[x] === true).map((x) => x.replace(/([A-Z])/g, ' $1').toLowerCase()));
  return f;
}

// Details for ids "google:<place_id>": returns tags like OSM so the same menu pipeline can use the website.
async function lookupGoogle(id) {
  const m = /^google:([A-Za-z0-9_-]{10,200})$/.exec(id);
  const key = googleKey();
  if (!m || !key) return null;
  const hit = googleCache.get(id);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.tags;
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${m[1]}`, {
      headers: { 'x-goog-api-key': key, 'x-goog-fieldmask': GOOGLE_DETAIL_FIELDS },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const facts = googleFacts(j);
    const tags = { name: j.displayName && j.displayName.text, website: j.websiteUri, phone: facts.phone, address: j.formattedAddress, _google: true, 'diet:vegetarian': j.servesVegetarianFood ? 'yes' : undefined, google: facts };
    googleCache.set(id, { ts: Date.now(), tags });
    return tags;
  } catch (err) {
    console.error('[bhaeha-team] google details:', err && err.message);
    return null;
  }
}

async function googleNearby(lat, lng, radiusM, limit) {
  const key = googleKey();
  if (!key) return null;
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'content-type': 'application/json',
        'x-goog-fieldmask': 'places.id,places.displayName,places.location,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.primaryType',
      },
      body: JSON.stringify({
        includedTypes: ['restaurant'],
        maxResultCount: Math.min(limit, 20),
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusM, 50000) } },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const k = Math.cos(lat * Math.PI / 180);
    return (j.places || []).filter((p) => p.id && p.location).map((p) => ({
      id: 'google:' + p.id,
      name: (p.displayName && p.displayName.text) || 'Unnamed',
      lat: p.location.latitude,
      lng: p.location.longitude,
      category: (p.primaryType || 'restaurant'),
      website: httpUrl(p.websiteUri),
      phone: p.nationalPhoneNumber || null,
      address: p.formattedAddress || null,
      distance_m: Math.round(Math.hypot((p.location.latitude - lat) * 111320, (p.location.longitude - lng) * 111320 * k)),
    }));
  } catch (err) {
    console.error('[bhaeha-team] google nearby:', err && err.message);
    return null;
  }
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const nominatimHeaders = { 'user-agent': 'tablewise-workshop/1.0', accept: 'application/json' };

// Fallback when Overpass is down: same OSM tags via Nominatim's lookup API.
async function lookupNominatim(id, type, num) {
  try {
    const r = await fetch(`${NOMINATIM}/lookup?format=jsonv2&extratags=1&osm_ids=${type[0].toUpperCase()}${num}`, { headers: nominatimHeaders, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const tags = j[0] && j[0].extratags ? { ...j[0].extratags } : null;
    if (tags) cache.set(id, { ts: Date.now(), tags });
    return tags;
  } catch (err) {
    console.error('[bhaeha-team] nominatim lookup:', err && err.message);
    return null;
  }
}

// Fallback when Overpass is down: OSM restaurants in a bounding box via Nominatim (works worldwide, max 40 results).
async function nominatimNearby(lat, lng, radiusM, limit) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
  const viewbox = [lng - dLng, lat + dLat, lng + dLng, lat - dLat].map((x) => x.toFixed(5)).join(',');
  const url = `${NOMINATIM}/search?format=jsonv2&extratags=1&addressdetails=1&bounded=1&limit=${Math.min(limit, 40)}&q=restaurant&viewbox=${viewbox}`;
  try {
    const r = await fetch(url, { headers: nominatimHeaders, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const k = Math.cos(lat * Math.PI / 180);
    return j.filter((e) => e.type === 'restaurant' && e.name && ['node', 'way', 'relation'].includes(e.osm_type)).map((e) => {
      const t = e.extratags || {};
      const la = Number(e.lat);
      const ln = Number(e.lon);
      return {
        id: 'osm:' + e.osm_type + ':' + e.osm_id,
        name: e.name,
        lat: la,
        lng: ln,
        category: t.cuisine ? t.cuisine.split(';')[0] + '_restaurant' : 'restaurant',
        website: httpUrl(t.website || t['contact:website']),
        phone: t.phone || t['contact:phone'] || null,
        address: e.address ? [e.address.road, e.address.house_number].filter(Boolean).join(' ') || null : null,
        opening_hours: t.opening_hours || null,
        distance_m: Math.round(Math.hypot((la - lat) * 111320, (ln - lng) * 111320 * k)),
      };
    }).sort((a, b) => a.distance_m - b.distance_m);
  } catch (err) {
    console.error('[bhaeha-team] nominatim:', err && err.message);
    return null;
  }
}

// Live restaurants from OpenStreetMap. Tries mirrors in parallel, first success wins, bounded by LIVE_BUDGET_MS. Returns null on failure.
async function liveOsmNearby(lat, lng, radiusM, limit) {
  const key = [lat.toFixed(3), lng.toFixed(3), radiusM, limit].join(':');
  const hit = nearCache.get(key);
  if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.list;
  const g = await googleNearby(lat, lng, radiusM, limit);
  if (g && g.length) {
    nearCache.set(key, { ts: Date.now(), list: g, source: 'google' });
    return g;
  }
  const body = 'data=' + encodeURIComponent(`[out:json][timeout:8];nwr(around:${radiusM},${lat},${lng})["amenity"="restaurant"]["name"];out center tags ${limit};`);
  const ask = (url) => fetch(url, {
    method: 'POST',
    headers: { 'user-agent': 'tablewise-workshop/1.0', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(LIVE_BUDGET_MS),
  }).then(async (r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!Array.isArray(j.elements)) throw new Error('bad body');
    return j.elements;
  });
  try {
    const els = await Promise.any(OVERPASS_MIRRORS.map(ask));
    const k = Math.cos(lat * Math.PI / 180);
    const list = els.map((e) => {
      const t = e.tags || {};
      const la = e.lat != null ? e.lat : e.center && e.center.lat;
      const ln = e.lon != null ? e.lon : e.center && e.center.lon;
      if (la == null || ln == null) return null;
      return {
        id: 'osm:' + e.type + ':' + e.id,
        name: t.name,
        lat: la,
        lng: ln,
        category: t.cuisine ? t.cuisine.split(';')[0] + '_restaurant' : 'restaurant',
        website: httpUrl(t.website || t['contact:website']),
        phone: t.phone || t['contact:phone'] || null,
        address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null,
        opening_hours: t.opening_hours || null,
        distance_m: Math.round(Math.hypot((la - lat) * 111320, (ln - lng) * 111320 * k)),
      };
    }).filter(Boolean).sort((a, b) => a.distance_m - b.distance_m).slice(0, limit);
    if (list.length) nearCache.set(key, { ts: Date.now(), list });
    return list.length ? list : null;
  } catch (err) {
    console.error('[bhaeha-team] live osm:', err && err.errors ? err.errors.map((x) => x.message).join('; ') : err && err.message);
    const list = await nominatimNearby(lat, lng, radiusM, limit);
    if (list && list.length) nearCache.set(key, { ts: Date.now(), list });
    return list && list.length ? list : null;
  }
}

let places = null;
function loadPlaces() {
  if (places) return places;
  try { places = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'stockholm.json'), 'utf8')); }
  catch (err) { console.error('[bhaeha-team] places:', err && err.message); places = []; }
  return places;
}

function placeById(id) {
  return loadPlaces().find((p) => p.id === id) || null;
}

function nearby(lat, lng, radiusM, limit) {
  const k = Math.cos(lat * Math.PI / 180);
  return loadPlaces()
    .map((p) => ({ ...p, distance_m: Math.round(Math.hypot((p.lat - lat) * 111320, (p.lng - lng) * 111320 * k)) }))
    .filter((p) => p.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
}

function httpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
}

function fromOsm(id, from, to, tags) {
  const diet = ['vegetarian', 'vegan', 'gluten_free'].filter((k) => tags['diet:' + k] && tags['diet:' + k] !== 'no');
  return {
    id,
    from: iso(from),
    to: iso(to),
    menu_url: httpUrl(tags['website:menu'] || tags['contact:menu'] || tags['menu:url']),
    website: httpUrl(tags.website || tags['contact:website']),
    opening_hours: tags.opening_hours || null,
    diet,
    days: [],
    offers: [],
    source: 'osm',
    confidence: 0.5,
  };
}

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1?$|fc|fd|fe80|::ffff:)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
}

// Fetches a public page. Follows up to 3 redirects by hand so every hop is re-validated (http(s) only, no private IPs).
async function fetchHtml(url) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(cur);
    if (!/^https?:$/.test(u.protocol)) return null;
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;
    const r = await fetch(cur, {
      headers: { 'user-agent': 'tablewise-workshop/1.0', accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      cur = new URL(r.headers.get('location'), cur).href;
      continue;
    }
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/text\/html|text\/plain/.test(type)) return null;
    return { url: cur, html: (await r.text()).slice(0, MAX_PAGE_BYTES) };
  }
  return null;
}

function extractItems(html) {
  const items = [];
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h\d|br|td|dd|dt|span)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&(nbsp|amp|quot|apos|lt|gt|aring|auml|ouml|Aring|Auml|Ouml|eacute|egrave);/g, (_, n) => ({ nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', aring: 'å', auml: 'ä', ouml: 'ö', Aring: 'Å', Auml: 'Ä', Ouml: 'Ö', eacute: 'é', egrave: 'è' })[n]);
  const seen = new Set();
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cur = (str) => (/\$/.test(str) ? 'USD' : /£/.test(str) ? 'GBP' : /€|EUR/.test(str) ? 'EUR' : 'SEK');
  const add = (name, price, line) => {
    if (!name || !/[a-zA-ZÀ-ÿ]{3}/.test(name) || !price || seen.has(name)) return;
    seen.add(name);
    items.push({ name: name.slice(0, 80), price, currency: cur(line), tags: [], daily_special: false });
  };
  const priceOnly = /^(?:[€$£]\s?)?(\d{2,4}(?:[.,]\d{1,2})?)\s?(?:€|kr|SEK|EUR|:-|\$|£)$/i;
  for (let i = 0; i < lines.length && items.length < 30; i++) {
    const line = lines[i];
    const po = priceOnly.exec(line);
    if (po) {
      // Name and price in separate elements: take the previous text line as the dish name.
      const prev = lines[i - 1];
      if (prev && prev.length >= 3 && prev.length <= 80 && !priceOnly.test(prev) && !/^\+/.test(line)) add(prev, Number(po[1].replace(',', '.')), line);
      continue;
    }
    const m = /^(.{3,80}?)[\s.:–-]+(?:[€$£]\s?)?(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|kr|SEK|EUR|:-|\$|£)?$/.exec(line);
    if (!m || !/[€$£]|kr|SEK|EUR|:-/.test(line)) continue;
    add(m[1], Number(m[2].replace(',', '.')), line);
  }
  return items.length >= 3 ? items : [];
}

// Same-host links that look like a menu page (Swedish and English words), best matches first, max 3.
function menuLinks(html, base) {
  const out = [];
  const baseUrl = new URL(base);
  const re = /<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 20) {
    const label = (m[2].replace(/<[^>]+>/g, ' ') + ' ' + m[1]).toLowerCase();
    if (!/meny|menu|lunch|dagens|a-la-carte|alacarte|food|mat\b|dryck/.test(label)) continue;
    try {
      const u = new URL(m[1], base);
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== baseUrl.hostname.replace(/^www\./, '')) continue;
      if (/\.(pdf|jpe?g|png|gif|webp)$/i.test(u.pathname)) continue;
      if (!out.includes(u.href) && u.href !== base) out.push(u.href);
    } catch (err) { /* ignore bad href */ }
  }
  return out.slice(0, 3);
}

// Fetches a restaurant page and, if it has no dish prices, up to 3 of its menu subpages.
// Heuristic: pages are not dated, so items apply to the whole range.
async function scrapeMenu(url) {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.items;
  let items = [];
  let reason = 'site_unreachable';
  try {
    const page = await fetchHtml(url);
    if (page) {
      reason = 'no_readable_menu';
      if (/<a\s[^>]*href\s*=\s*["'][^"']*\.pdf(\?[^"']*)?["'][^>]*>/i.test(page.html) && /meny|menu|lunch|dagens/i.test(page.html)) reason = 'menu_is_pdf_or_image';
      items = extractItems(page.html);
      if (!items.length) {
        for (const link of menuLinks(page.html, page.url)) {
          const sub = await fetchHtml(link).catch(() => null);
          if (sub) items = extractItems(sub.html);
          if (items.length) break;
        }
      }
    }
  } catch (err) {
    console.error('[bhaeha-team] scrape:', err && err.message);
    items = [];
  }
  if (!items.length) items.reason = reason;
  pageCache.set(url, { ts: Date.now(), items });
  return items;
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

module.exports = {
  _scrapeMenu: scrapeMenu,
  async handle(req, res, { path }) {
    if (req.method === 'GET' && path === '/restaurants') {
      try {
        const q = new URL(req.url, 'http://x').searchParams;
        const lat = Number(q.get('lat'));
        const lng = Number(q.get('lng'));
        if (!q.get('lat') || !q.get('lng') || !isFinite(lat) || !isFinite(lng)) return send(res, 400, { error: 'lat and lng are required numbers' }), true;
        const radius = Math.min(Math.max(Number(q.get('radius_m')) || 600, 50), 5000);
        const limit = Math.min(Math.max(parseInt(q.get('limit'), 10) || 100, 1), 300);
        if (q.get('live') === '1') {
          const live = await liveOsmNearby(lat, lng, radius, limit);
          if (live) return send(res, 200, { source: live[0].id.startsWith('google:') ? 'google' : 'osm', restaurants: live }), true;
        }
        send(res, 200, { source: 'overture', restaurants: nearby(lat, lng, radius, limit) });
      } catch (err) {
        console.error('[bhaeha-team]', err && err.message);
        send(res, 500, { error: 'internal error' });
      }
      return true;
    }
    if (req.method !== 'GET' || path !== '/menu') return false;
    try {
      const q = new URL(req.url, 'http://x').searchParams;
      const id = (q.get('id') || '').trim();
      if (!id || id.length > 200) return send(res, 400, { error: 'id is required (max 200 chars)' }), true;
      const lat = Number(q.get('lat'));
      const lng = Number(q.get('lng'));
      if (!q.get('lat') || !q.get('lng') || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return send(res, 400, { error: 'lat and lng are required numbers' }), true;
      }
      const from = parseDate(q.get('from'));
      const to = parseDate(q.get('to'));
      if (!from || !to) return send(res, 400, { error: 'from and to are required, format YYYY-MM-DD' }), true;
      if (to < from) return send(res, 400, { error: 'to must not be before from' }), true;
      if ((to - from) / 86400000 + 1 > MAX_DAYS) return send(res, 400, { error: `range is limited to ${MAX_DAYS} days` }), true;
      const place = id.startsWith('overture:') ? placeById(id) : null;
      const tags = place ? { website: place.website, phone: place.phone, name: place.name, address: place.address, _overture: true } : id.startsWith('google:') ? await lookupGoogle(id) : await lookupOsm(id);
      const out = tags ? fromOsm(id, from, to, tags) : { id, from: iso(from), to: iso(to), menu_url: null, days: [], offers: [], source: 'none', confidence: 0 };
      if (tags && tags._google) Object.assign(out, { source: 'google', google: tags.google, name: tags.name, phone: tags.phone || null, address: tags.address || null });
      if (tags && tags._overture) Object.assign(out, { source: 'overture', name: tags.name, phone: tags.phone || null, address: tags.address || null });
      const items = out.menu_url || out.website ? await scrapeMenu(out.menu_url || out.website) : [];
      if (!items.length) {
        const reasons = {
          no_website: 'This restaurant has no website listed in the open data, so there is no menu to read.',
          site_unreachable: 'The restaurant website could not be reached.',
          menu_is_pdf_or_image: 'The menu is published as a PDF or image, which we cannot read yet.',
          no_readable_menu: 'The website has no menu with prices in readable text (often a JavaScript widget or delivery app).',
        };
        out.empty_reason = out.menu_url || out.website ? items.reason || 'no_readable_menu' : 'no_website';
        out.empty_message = reasons[out.empty_reason];
      }
      if (items.length) {
        for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) out.days.push({ date: iso(d), items });
        out.source = 'website';
        out.confidence = 0.4;
      }
      send(res, 200, out);
    } catch (err) {
      console.error('[bhaeha-team]', err && err.message);
      send(res, 500, { error: 'internal error' });
    }
    return true;
  },
};
