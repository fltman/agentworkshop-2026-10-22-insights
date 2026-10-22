// gnik: review analysis (suggested meals + red-flag outliers). See projects/gnik/CONTRACT.md
const DISHES = ['carbonara', 'margherita pizza', 'tiramisu', 'ramen', 'pad thai', 'burger', 'risotto', 'caesar salad', 'fish and chips', 'lasagna'];
const FLAGS = [
  { type: 'wait_time', re: /(long|huge) (wait|queue|line)|slow service|hour for/i, text: 'Long waits reported' },
  { type: 'cleanliness', re: /dirty|unclean|filthy|sticky tables?|cockroach/i, text: 'Cleanliness complaints' },
  { type: 'service', re: /rude|ignored us|unfriendly|wrong order/i, text: 'Service complaints' },
  { type: 'price', re: /overpriced|rip.?off|too expensive/i, text: 'Perceived as overpriced' },
];
const POS = /(great|amazing|delicious|best|love|perfect|fresh|excellent)/i;
const NEG = /(bad|bland|cold|awful|terrible|worst|disappoint|overcooked|undercooked)/i;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Deterministic placeholder reviews until a real review source is plugged in
function mockReviews(id) {
  let h = hash(id);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return h / 4294967296; };
  const dishes = [0, 1, 2].map(() => DISHES[Math.floor(rnd() * DISHES.length)]);
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
    for (const d of DISHES) {
      if (text.toLowerCase().includes(d)) {
        const e = dishes[d] || (dishes[d] = { dish: d, mentions: 0, score: 0 });
        e.mentions++;
        e.score += NEG.test(text) ? -1 : POS.test(text) ? 1 : 0;
      }
    }
    for (const f of FLAGS) {
      if (f.re.test(text)) {
        const e = flags[f.type] || (flags[f.type] = { type: f.type, text: f.text, evidence_count: 0 });
        e.evidence_count++;
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
      red_flags.push({ type: 'dish_warning', text: `Reviewers advise against the ${e.dish}`, severity: 'medium', evidence_count: e.mentions });
    }
  }
  return { review_count: reviews.length, suggested_meals, red_flags };
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

module.exports = {
  async handle(req, res, ctx) {
    const url = new URL(req.url, 'http://x');
    if (ctx.path.replace(/\/+$/, '') !== '/analysis') return false;
    const id = (url.searchParams.get('id') || '').slice(0, 200);
    if (!id) { send(res, 400, { error: 'id required' }); return true; }
    send(res, 200, { id, ...analyze(mockReviews(id)), source: 'mock' });
    return true;
  },
};
