// bhaeha-team: menus + special offers per restaurant id and date range. See projects/bhaeha-team/CONTRACT.md.
//   GET /t/bhaeha-team/menu?id=&lat=&lng=&from=YYYY-MM-DD&to=YYYY-MM-DD

const MAX_DAYS = 31;
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL = 6 * 3600 * 1000;
const cache = new Map();
const pageCache = new Map();
const dns = require('dns').promises;
const net = require('net');
const MAX_PAGE_BYTES = 500000;

const DISHES = [
  { name: 'Soup of the day', price: 8.5, tags: ['vegetarian'] },
  { name: 'Grilled salmon with potatoes', price: 17.0, tags: ['fish', 'gluten-free'] },
  { name: 'Pasta al forno', price: 13.5, tags: ['vegetarian'] },
  { name: 'Chicken schnitzel', price: 15.0, tags: ['meat'] },
  { name: 'Mushroom risotto', price: 14.0, tags: ['vegetarian', 'gluten-free'] },
  { name: 'Beef burger', price: 16.0, tags: ['meat'] },
  { name: 'Falafel plate', price: 12.0, tags: ['vegan', 'vegetarian'] },
  { name: 'Fish and chips', price: 15.5, tags: ['fish'] },
];

const OFFERS = [
  { title: 'Lunch 2-for-1', description: 'Weekdays 11-14' },
  { title: 'Free dessert with main course', description: 'After 18:00' },
  { title: 'Happy hour drinks -30%', description: '16-18' },
];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function iso(d) { return d.toISOString().slice(0, 10); }

function build(id, from, to) {
  const days = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
    const date = iso(d);
    const h = hash(id + date);
    const items = [0, 1, 2].map((k) => {
      const dish = DISHES[(h + k * 3) % DISHES.length];
      return { name: dish.name, price: dish.price, currency: 'EUR', tags: dish.tags, daily_special: k === 0 };
    });
    days.push({ date, items });
  }
  const o = OFFERS[hash(id) % OFFERS.length];
  return {
    id,
    from: iso(from),
    to: iso(to),
    menu_url: null,
    days,
    offers: [{ ...o, valid_from: iso(from), valid_to: iso(to) }],
    source: 'mock',
    confidence: 0.3,
  };
}

// Looks up a restaurant by id "osm:<node|way|relation>:<n>" in OpenStreetMap. Returns null when unknown or on failure.
async function lookupOsm(id) {
  const m = /^osm:(node|way|relation):(\d{1,12})$/.exec(id);
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

// Fetches a public menu page and extracts "dish ... price" lines. Heuristic: pages are not dated, so items apply to the whole range.
async function scrapeMenu(url) {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.items;
  let items = [];
  try {
    const u = new URL(url);
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return [];
    const r = await fetch(url, {
      headers: { 'user-agent': 'tablewise-workshop/1.0', accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
    });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/text\/html|text\/plain/.test(type)) return [];
    const html = (await r.text()).slice(0, MAX_PAGE_BYTES);
    const text = html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h\d|br)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
    const seen = new Set();
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      const m = /^(.{3,80}?)[\s.:–-]+(?:[€$£]\s?)?(\d{1,3}(?:[.,]\d{1,2})?)\s?(?:€|kr|SEK|EUR|:-|\$|£)?$/.exec(line);
      if (!m || !/[a-zA-ZÀ-ÿ]{3}/.test(m[1])) continue;
      const price = Number(m[2].replace(',', '.'));
      const hasCur = /[€$£]|kr|SEK|EUR|:-/.test(line);
      if (!hasCur || !price || seen.has(m[1])) continue;
      seen.add(m[1]);
      items.push({ name: m[1].slice(0, 80), price, currency: /\$/.test(line) ? 'USD' : /£/.test(line) ? 'GBP' : /kr|SEK|:-/.test(line) ? 'SEK' : 'EUR', tags: [], daily_special: false });
      if (items.length >= 30) break;
    }
  } catch (err) {
    console.error('[bhaeha-team] scrape:', err && err.message);
    items = [];
  }
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
        const limit = Math.min(Math.max(parseInt(q.get('limit'), 10) || 25, 1), 100);
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
      const demo = q.get('demo') === '1';
      if (tags && !demo) {
        const out = fromOsm(id, from, to, tags);
        if (tags._overture) Object.assign(out, { source: 'overture', name: tags.name, phone: tags.phone || null, address: tags.address || null });
        const items = out.menu_url || out.website ? await scrapeMenu(out.menu_url || out.website) : [];
        if (items.length) {
          for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) out.days.push({ date: iso(d), items });
          out.source = 'website';
          out.confidence = 0.4;
        }
        return send(res, 200, out), true;
      }
      const out = build(id, from, to);
      if (tags) Object.assign(out, { ...fromOsm(id, from, to, tags), days: out.days, offers: out.offers, source: 'osm+mock' });
      send(res, 200, out);
    } catch (err) {
      console.error('[bhaeha-team]', err && err.message);
      send(res, 500, { error: 'internal error' });
    }
    return true;
  },
};
