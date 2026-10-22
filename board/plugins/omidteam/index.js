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
  const dinner = peak(h, 19.75, 1.4) * (kind === 'lunch' ? 0.5 : 1) * (weekend ? 1.15 : 1);
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

const AMENITY_KIND = { cafe: 'cafe', bar: 'bar', pub: 'bar', fast_food: 'fast' };

function compute(q, tags) {
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
      const closed = isOpen ? !isOpen(d.getUTCDay(), h) : false;
      if (closed) c = 0;
      return { hour: h, crowd: c, level: level(c), est_wait_minutes: waitMin(c), open: !closed };
    });
    const inMeal = h => meal === 'lunch' ? h >= 11 && h <= 15 : meal === 'dinner' ? h >= 17 && h <= 22 : (h >= 11 && h <= 15) || (h >= 17 && h <= 22);
    const cands = hours.filter(x => inMeal(x.hour) && x.open);
    const ok = cands.filter(x => x.est_wait_minutes <= maxWait);
    const best = (ok.length ? ok : cands).slice().sort((a, b) => a.crowd - b.crowd).slice(0, 3)
      .sort((a, b) => a.hour - b.hour)
      .map(x => ({ time: String(x.hour).padStart(2, '0') + ':00', crowd: x.crowd, est_wait_minutes: x.est_wait_minutes }));
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
  return { restaurant_id: id, lat, lng, source: tags ? 'osm+heuristic-model' : 'heuristic-model', days: out };
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
      const r = compute(q, await osmTags(String(q.id || '')));
      return send(res, r.error ? 400 : 200, r), true;
    }
    return false;
  },
};
