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
    if (!r.ok) return null;
    const j = await r.json();
    const tags = (j.elements && j.elements[0] && j.elements[0].tags) || null;
    if (tags) cache.set(id, { ts: Date.now(), tags });
    return tags;
  } catch (err) {
    console.error('[bhaeha-team] overpass:', err && err.message);
    return null;
  }
}

// Live restaurants from OpenStreetMap. Tries mirrors in parallel, first success wins, bounded by LIVE_BUDGET_MS. Returns null on failure.
async function liveOsmNearby(lat, lng, radiusM, limit) {
  const key = [lat.toFixed(3), lng.toFixed(3), radiusM, limit].join(':');
  const hit = nearCache.get(key);
  if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.list;
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
    return null;
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
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const m = /^(.{3,80}?)[\s.:–-]+(?:[€$£]\s?)?(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|kr|SEK|EUR|:-|\$|£)?$/.exec(line);
    if (!m || !/[a-zA-ZÀ-ÿ]{3}/.test(m[1])) continue;
    const price = Number(m[2].replace(',', '.'));
    const hasCur = /[€$£]|kr|SEK|EUR|:-/.test(line);
    if (!hasCur || !price || seen.has(m[1])) continue;
    seen.add(m[1]);
    items.push({ name: m[1].slice(0, 80), price, currency: /\$/.test(line) ? 'USD' : /£/.test(line) ? 'GBP' : /€|EUR/.test(line) ? 'EUR' : 'SEK', tags: [], daily_special: false });
    if (items.length >= 30) break;
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
          if (live) return send(res, 200, { source: 'osm', restaurants: live }), true;
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
      const tags = place ? { website: place.website, phone: place.phone, name: place.name, address: place.address, _overture: true } : await lookupOsm(id);
      const out = tags ? fromOsm(id, from, to, tags) : { id, from: iso(from), to: iso(to), menu_url: null, days: [], offers: [], source: 'none', confidence: 0 };
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
