// gnik: review analysis (suggested meals + red-flag outliers). See projects/gnik/CONTRACT.md
// The first 10 dishes are also used by the demo generator
const DISHES = ['carbonara', 'margherita pizza', 'tiramisu', 'ramen', 'pad thai', 'burger', 'risotto', 'caesar salad', 'fish and chips', 'lasagna',
  'pizza', 'pasta', 'sushi', 'steak', 'taco', 'curry', 'falafel', 'kebab', 'schnitzel', 'salmon', 'ceviche', 'paella', 'pho', 'dumplings', 'gnocchi', 'bruschetta',
  'meatballs', 'k\u00F6ttbullar', 'raggmunk', 'pyttipanna', 'sill', 'r\u00E4ksm\u00F6rg\u00E5s', 'toast skagen', 'laxsoppa', 'fiskgryta', 'dagens', 'hamburgare', 'pannkakor', 'wallenbergare', 'biff', 'lax'];
const FLAGS = [
  { type: 'wait_time', re: /(long|huge|endless) (wait|queue|line)|slow service|hour for|waited (over |more than )?\d+ ?(min|hour)|l\u00E5ng v\u00E4ntetid|v\u00E4ntade (i )?(en )?(timme|l\u00E4nge)|l\u00E5ngsam|k\u00F6ade|lång kö|lång väntan/i, text: 'Long waits reported' },
  { type: 'cleanliness', re: /dirty|unclean|filthy|sticky tables?|cockroach|smelled|sm\u00E5tt|smutsig|skitig|\u00E4cklig|kackerlack|lortig|ostädat|ostädad/i, text: 'Cleanliness complaints' },
  { type: 'service', re: /rude|ignored us|unfriendly|wrong order|inattentive|otrevlig|ohyfsad|oh\u00F6flig|ignorerade|fel best\u00E4llning|d\u00E5lig service|dålig service/i, text: 'Service complaints' },
  { type: 'price', re: /overpriced|rip.?off|too expensive|not worth the (price|money)|\u00F6verpriset|\u00F6verpris|f\u00F6r dyrt|dyrt f\u00F6r|inte v\u00E4rt/i, text: 'Perceived as overpriced' },
  { type: 'food_safety', re: /food poisoning|got sick|stomach ache|matf\u00F6rgiftning|blev sjuk|magont/i, text: 'Food safety concerns' },
];
const POS = /(great|amazing|delicious|best|love[d]?|perfect|fresh|excellent|tasty|g\u00F6tt|gott|utm\u00E4rkt|fantastisk|b\u00E4st|toppen|favorit|perfekt|underbar|nyttlagad|jättegod|jättegott)/i;
const NEG = /(bad|bland|cold|awful|terrible|worst|disappoint|overcooked|undercooked|dry|greasy|d\u00E5lig|tr\u00E5kig|smaklös|kall|torr|besviken|seg|fet|vidrig|äcklig)/i;
// Drops "not dirty", "inte gott" style phrases so negated words do not count
const negated = (t) => t.replace(/\b(not|never|no|n't|inte|aldrig|ingen|inget|utan)\s+(?:very\s+|so\s+|too\s+|s\u00E4rskilt\s+|speciellt\s+)?[\p{L}]+/giu, ' ');

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Deterministic placeholder reviews until a real review source is plugged in
function mockReviews(id) {
  let h = hash(id);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return h / 4294967296; };
  const dishes = [0, 1, 2].map(() => DISHES[Math.floor(rnd() * 10)]);
  const out = [];
  const n = 12 + Math.floor(rnd() * 20);
  for (let i = 0; i < n; i++) {
    const d = dishes[Math.floor(rnd() * dishes.length)];
    out.push(rnd() < 0.8 ? `Loved the ${d}, delicious and fresh.` : `The ${d} was bland and cold.`);
  }
  if (rnd() < 0.5) for (let i = 0; i < 4; i++) out.push('Long wait on the weekend, slow service.');
  if (rnd() < 0.25) for (let i = 0; i < 3; i++) out.push('Tables were dirty and sticky.');
  return out;
}

function analyze(reviews) {
  const dishes = {};
  const flags = {};
  for (const r of reviews) {
    const text = String(r).slice(0, 1000);
    const clean = negated(text);
    for (const d of DISHES) {
      if (text.toLowerCase().includes(d)) {
        const e = dishes[d] || (dishes[d] = { dish: d, mentions: 0, score: 0, neg: [] });
        e.mentions++;
        e.score += NEG.test(clean) ? -1 : POS.test(clean) ? 1 : 0;
        if (NEG.test(clean) && e.neg.length < 3) e.neg.push(text.slice(0, 200));
      }
    }
    for (const f of FLAGS) {
      if (f.re.test(clean)) {
        const e = flags[f.type] || (flags[f.type] = { type: f.type, text: f.text, evidence_count: 0, evidence: [] });
        e.evidence_count++;
        if (e.evidence.length < 3) e.evidence.push(text.slice(0, 200));
      }
    }
  }
  const suggested_meals = Object.values(dishes)
    .map((e) => ({ dish: e.dish, mentions: e.mentions, sentiment: Math.round((e.score / e.mentions) * 100) / 100 }))
    .filter((e) => e.sentiment > 0)
    .sort((a, b) => b.sentiment * b.mentions - a.sentiment * a.mentions)
    .slice(0, 5);
  const red_flags = Object.values(flags).map((e) => ({
    ...e,
    severity: e.evidence_count >= 5 ? 'high' : e.evidence_count >= 3 ? 'medium' : 'low',
  }));
  for (const e of Object.values(dishes)) {
    if (e.mentions >= 2 && e.score < 0) {
      red_flags.push({ type: 'dish_warning', text: `Reviewers advise against the ${e.dish}`, severity: 'medium', evidence_count: e.mentions, evidence: e.neg });
    }
  }
  return { review_count: reviews.length, suggested_meals, red_flags };
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const fs = require('fs');
const net = require('net');
const dns = require('dns').promises;
const path = require('path');
const MAX_REVIEWS = 200;

function file(ctx, id) {
  return path.join(ctx.dataDir, `r_${hash(id).toString(16)}.json`);
}

function load(ctx, id) {
  try { return JSON.parse(fs.readFileSync(file(ctx, id), 'utf8')); } catch (e) { return []; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 20000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

const BASE = process.env.BOARD_URL || 'https://insights.torget.bjarby.com';
const CACHE_TTL = 30 * 60 * 1000;
const siteCache = new Map();

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1?$|fc|fd|fe80|::ffff:)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
}

async function websiteFor(id, lat, lng) {
  try {
    const d = new Date().toISOString().slice(0, 10);
    const q = new URLSearchParams({ id, lat: lat || '0', lng: lng || '0', from: d, to: d });
    const r = await fetch(`${BASE}/t/bhaeha-team/menu?${q}`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return /^https?:\/\//.test(j.website || '') ? j.website : null;
  } catch (e) { return null; }
}

// Review-like sentences from a restaurant's own public page. Pages often have none, then the result is empty.
async function siteReviews(url) {
  const hit = siteCache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.texts;
  let texts = [];
  try {
    const u = new URL(url);
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return [];
    const r = await fetch(url, { headers: { 'user-agent': 'tablewise-workshop/1.0', accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(6000) });
    if (!r.ok || !/text\/html/.test(r.headers.get('content-type') || '')) return [];
    const html = (await r.text()).slice(0, 300000);
    const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    for (const raw of text.split(/\n|(?<=[.!?])\s+/)) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (line.length < 20 || line.length > 300) continue;
      if (DISHES.some((d) => line.toLowerCase().includes(d)) || FLAGS.some((f) => f.re.test(line))) texts.push(line);
      if (texts.length >= 100) break;
    }
  } catch (e) { texts = []; }
  siteCache.set(url, { ts: Date.now(), texts });
  return texts;
}

module.exports = {
  async handle(req, res, ctx) {
    const url = new URL(req.url, 'http://x');
    const route = ctx.path.replace(/\/+$/, '');
    if (route !== '/analysis' && route !== '/reviews') return false;
    const id = (url.searchParams.get('id') || url.searchParams.get('restaurant_id') || '').slice(0, 200);
    if (!id) { send(res, 400, { error: 'id required' }); return true; }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const texts = (Array.isArray(body.reviews) ? body.reviews : [body.review])
          .filter((t) => typeof t === 'string' && t.trim()).map((t) => t.slice(0, 1000));
        if (!texts.length) { send(res, 400, { error: 'review or reviews[] (strings) required' }); return true; }
        fs.mkdirSync(ctx.dataDir, { recursive: true });
        const all = load(ctx, id).concat(texts).slice(-MAX_REVIEWS);
        fs.writeFileSync(file(ctx, id), JSON.stringify(all));
        send(res, 201, { id, stored: texts.length, review_count: all.length });
      } catch (e) {
        send(res, 400, { error: 'invalid JSON body' });
      }
      return true;
    }
    const name = (url.searchParams.get('name') || '').slice(0, 200);
    const real = load(ctx, id);
    if (real.length) { send(res, 200, { id, name, ...analyze(real), source: 'reviews' }); return true; }
    if (url.searchParams.get('demo') === '1') { send(res, 200, { id, name, ...analyze(mockReviews(id)), source: 'mock' }); return true; }
    const site = (url.searchParams.get('website') && /^https?:\/\//.test(url.searchParams.get('website'))) ? url.searchParams.get('website')
      : await websiteFor(id, url.searchParams.get('lat'), url.searchParams.get('lng'));
    const texts = site ? await siteReviews(site) : [];
    if (texts.length >= 3) send(res, 200, { id, name, ...analyze(texts), source: 'website' });
    else send(res, 200, { id, name, review_count: 0, suggested_meals: [], red_flags: [], source: 'none' });
    return true;
  },
};
