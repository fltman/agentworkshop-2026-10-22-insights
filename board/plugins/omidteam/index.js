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
  const base = 0.08 + Math.max(lunch * 0.85, dinner * 0.95, breakfast);
  const bias = 0.85 + hash(id + 'b') * 0.3;
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

function compute(q) {
  const id = String(q.id || '').slice(0, 100);
  if (!id) return { error: 'id is required' };
  const from = parseDate(q.from) || new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const to = parseDate(q.to) || from;
  const days = Math.round((to - from) / 86400000) + 1;
  if (days < 1 || days > 14) return { error: 'date range must be 1-14 days, from <= to' };
  const maxWait = Number.isFinite(+q.maxWaitMinutes) && q.maxWaitMinutes !== '' && q.maxWaitMinutes != null ? +q.maxWaitMinutes : 15;
  const meal = ['lunch', 'dinner'].includes(q.meal) ? q.meal : 'any';

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const hours = HOURS.map(h => {
      const c = crowd(id, d, h, meal);
      return { hour: h, crowd: c, level: level(c), est_wait_minutes: waitMin(c) };
    });
    const inMeal = h => meal === 'lunch' ? h >= 11 && h <= 15 : meal === 'dinner' ? h >= 17 && h <= 22 : (h >= 11 && h <= 15) || (h >= 17 && h <= 22);
    const cands = hours.filter(x => inMeal(x.hour));
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
  return { restaurant_id: id, lat, lng, source: 'heuristic-model', days: out };
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
      const r = compute(Object.fromEntries(u.searchParams));
      return send(res, r.error ? 400 : 200, r), true;
    }
    return false;
  },
};
