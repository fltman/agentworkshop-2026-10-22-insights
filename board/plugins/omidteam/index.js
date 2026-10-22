// omidteam: visit timing. Estimates crowd level per hour and suggests the best times to visit.
// No external data source: a heuristic model (meal peaks, weekday/weekend, per-restaurant bias).

const HOURS = [];
for (let h = 8; h <= 23; h++) HOURS.push(h);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function peak(h, center, width) {
  return Math.exp(-((h - center) ** 2) / (2 * width * width));
}

// 0..100 crowd level for one hour on one date
function crowd(id, date, h, kind) {
  const dow = date.getUTCDay();
  const weekend = dow === 0 || dow === 5 || dow === 6;
  const lunch = peak(h, 12.75, 1.0) * (kind === 'dinner' ? 0.5 : 1);
  const dinner = peak(h, 19.75, 1.4) * (kind === 'lunch' ? 0.5 : 1) * (weekend ? 1.06 : 1);
  const breakfast = peak(h, 9, 0.8) * 0.35;
  const base = 0.08 + Math.max(lunch * 0.8, dinner * 0.88, breakfast);
  const month = date.getUTCMonth();
  const season = [0.92, 0.92, 0.97, 1, 1.04, 1.08, 1.1, 1.1, 1.04, 1, 0.94, 0.98][month];
  const bias = season * (0.85 + hash(id + 'b') * 0.3);
  const noise = (hash(id + date.toISOString().slice(0, 10) + h) - 0.5) * 0.08;
  return Math.round(Math.min(1, Math.max(0, base * bias + noise)) * 100);
}

function level(c) { return c < 35 ? 'low' : c < 65 ? 'medium' : 'high'; }
function waitMin(c) { return Math.round((c / 100) ** 2 * 45); }

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d) ? null : d;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const tagCache = new Map();

// Fetch OSM tags for osm:node/N ids. Never throws; null means unknown.
async function osmTags(id) {
  const m = /^osm:node\/(\d+)$/.exec(id);
  if (!m) return null;
  const hit = tagCache.get(id);
  if (hit && Date.now() - hit.t < 3600e3) return hit.tags;
  let tags = null;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'user-agent': 'tablewise-omidteam', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent('[out:json][timeout:8];node(' + m[1] + ');out tags;'),
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) { const j = await r.json(); tags = (j.elements && j.elements[0] && j.elements[0].tags) || {}; }
  } catch (e) { console.error('[omidteam] overpass', e && e.message); }
  tagCache.set(id, { t: tags ? Date.now() : Date.now() - 3600e3 + 120e3, tags });
  return tags;
}

// Minimal opening_hours parser: "Mo-Fr 11:00-22:00; Sa,Su 12:00-23:00", "24/7". Returns fn(dow, hour) or null.
function parseOpening(str) {
  if (!str) return null;
  if (str.trim() === '24/7') return () => true;
  const rules = [];
  for (const part of str.split(';')) {
    const m = /^\s*([A-Za-z,\- ]*?)\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(part);
    if (!m) return null;
    const days = new Set();
    const spec = m[1].trim() || 'Mo-Su';
    for (const tok of spec.split(',')) {
      const r = /^(\w\w)(?:\s*-\s*(\w\w))?$/.exec(tok.trim());
      if (!r) return null;
      const a = DAYS.indexOf(r[1]), b = r[2] ? DAYS.indexOf(r[2]) : a;
      if (a < 0 || b < 0) return null;
      for (let i = a; ; i = (i + 1) % 7) { days.add(i); if (i === b) break; }
    }
    rules.push({ days, from: +m[2] + m[3] / 60, to: +m[4] + m[5] / 60 });
  }
  return (dow, h) => rules.some(r => r.days.has(dow) && (r.to > r.from ? h >= r.from && h < r.to : h >= r.from || h < r.to));
}

const extCache = new Map();
async function getJson(key, url, ttlMs) {
  const hit = extCache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  let v = null;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'tablewise-omidteam' }, signal: AbortSignal.timeout(4000) });
    if (r.ok) v = await r.json();
  } catch (e) { console.error('[omidteam] ext', e && e.message); }
  extCache.set(key, { t: v ? Date.now() : Date.now() - ttlMs + 120e3, v });
  if (extCache.size > 500) extCache.delete(extCache.keys().next().value);
  return v;
}

// Open-Meteo hourly precipitation probability: { 'YYYY-MM-DD': [24 values] } or null
async function weather(lat, lng, from, to) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const f = from.toISOString().slice(0, 10), t = to.toISOString().slice(0, 10);
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(2) + '&longitude=' + lng.toFixed(2) +
    '&hourly=precipitation_probability&timezone=auto&start_date=' + f + '&end_date=' + t;
  const j = await getJson('w' + lat.toFixed(2) + lng.toFixed(2) + f + t, url, 3600e3);
  if (!j || !j.hourly || !j.hourly.time) return null;
  const out = {};
  j.hourly.time.forEach((ts, i) => { (out[ts.slice(0, 10)] = out[ts.slice(0, 10)] || [])[+ts.slice(11, 13)] = j.hourly.precipitation_probability[i]; });
  return out;
}

// Nager.Date public holidays: Set of 'YYYY-MM-DD' or null
async function holidays(country, year) {
  if (!/^[A-Za-z]{2}$/.test(country || '')) return null;
  const j = await getJson('h' + country + year, 'https://date.nager.at/api/v3/PublicHolidays/' + year + '/' + country.toUpperCase(), 86400e3);
  return Array.isArray(j) ? new Set(j.map(x => x.date)) : null;
}

const AMENITY_KIND = { cafe: 'cafe', bar: 'bar', pub: 'bar', fast_food: 'fast' };

function compute(q, tags, wx, hol) {
  const id = String(q.id || '').slice(0, 100);
  if (!id) return { error: 'id is required' };
  const from = parseDate(q.from) || new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const to = parseDate(q.to) || from;
  const days = Math.round((to - from) / 86400000) + 1;
  if (days < 1 || days > 14) return { error: 'date range must be 1-14 days, from <= to' };
  const maxWait = Number.isFinite(+q.maxWaitMinutes) && q.maxWaitMinutes !== '' && q.maxWaitMinutes != null ? +q.maxWaitMinutes : 15;
  const isOpen = parseOpening(tags && tags.opening_hours);
  const amen = AMENITY_KIND[tags && tags.amenity];
  const meal = ['lunch', 'dinner'].includes(q.meal) ? q.meal : 'any';

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const hours = HOURS.map(h => {
      let c = crowd(id, d, h, meal);
      if (amen === 'cafe' && h >= 8 && h <= 10) c = Math.min(100, c + 25);
      if (amen === 'bar' && h >= 21) c = Math.min(100, c + 25);
      if (amen === 'fast') c = Math.round(c * 0.6);
      const rain = wx && wx[d.toISOString().slice(0, 10)] && wx[d.toISOString().slice(0, 10)][h];
      if (rain >= 60) c = Math.round(c * 0.85);
      if (hol && hol.has(d.toISOString().slice(0, 10))) c = Math.min(100, Math.round(c * 1.12));
      const closed = isOpen ? !isOpen(d.getUTCDay(), h) : false;
      if (closed) c = 0;
      return { hour: h, crowd: c, level: level(c), est_wait_minutes: waitMin(c), open: !closed };
    });
    const inMeal = h => meal === 'lunch' ? h >= 11 && h <= 15 : meal === 'dinner' ? h >= 17 && h <= 22 : (h >= 11 && h <= 15) || (h >= 17 && h <= 22);
    const cands = hours.filter(x => inMeal(x.hour) && x.open);
    const ok = cands.filter(x => x.est_wait_minutes <= maxWait);
    const pool = ok.length ? ok : cands;
    // prefer the calmest run of up to 3 consecutive hours, so the guest gets a usable window
    let pick = pool.slice().sort((a, b) => a.crowd - b.crowd).slice(0, 1);
    let bestScore = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const run = [pool[i]];
      while (run.length < 3 && pool[i + run.length] && pool[i + run.length].hour === run[run.length - 1].hour + 1) run.push(pool[i + run.length]);
      const score = run.reduce((a, x) => a + x.crowd, 0) / run.length + (3 - run.length) * 8;
      if (score < bestScore) { bestScore = score; pick = run; }
    }
    const best = pick.map(x => ({ time: String(x.hour).padStart(2, '0') + ':00', crowd: x.crowd, est_wait_minutes: x.est_wait_minutes }));
    const busiest = hours.slice().sort((a, b) => b.crowd - a.crowd)[0];
    out.push({
      date: d.toISOString().slice(0, 10),
      hours,
      best_times: best,
      busiest: { time: String(busiest.hour).padStart(2, '0') + ':00', crowd: busiest.crowd },
      within_max_wait: ok.length > 0,
    });
  }
  const lat = Number.isFinite(parseFloat(q.lat)) ? parseFloat(q.lat) : null;
  const lng = Number.isFinite(parseFloat(q.lng)) ? parseFloat(q.lng) : null;
  return { restaurant_id: id, lat, lng, source: ['osm', wx && 'weather', hol && 'holidays'].filter(x => x !== null && x !== false && x !== undefined && (x === 'osm' ? tags : x)).concat('heuristic-model').join('+'), days: out };
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}

module.exports = {
  async handle(req, res, ctx) {
    const u = new URL(req.url, 'http://x');
    const p = ctx.path.replace(/^\/+|\/+$/g, '');
    if (p === 'health') return send(res, 200, { ok: true, module: 'visit-timing' }), true;
    if (p === 'timing') {
      const q = Object.fromEntries(u.searchParams);
      const from = parseDate(q.from) || new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      const to = parseDate(q.to) || from;
      const span = Math.round((to - from) / 86400000);
      const ok = span >= 0 && span < 14;
      const [tags, wx, hol] = await Promise.all([
        osmTags(String(q.id || '')),
        ok ? weather(parseFloat(q.lat), parseFloat(q.lng), from, to) : null,
        ok ? holidays(q.country, from.getUTCFullYear()) : null,
      ]);
      const r = compute(q, tags, wx, hol);
      return send(res, r.error ? 400 : 200, r), true;
    }
    return false;
  },
};
