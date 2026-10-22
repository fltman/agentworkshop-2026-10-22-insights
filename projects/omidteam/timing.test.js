// Run: node --test projects/omidteam/timing.test.js
const test = require('node:test');
const assert = require('node:assert');
const plugin = require('../../board/plugins/omidteam/index.js');

async function call(url) {
  let code, body;
  const res = { writeHead(c) { code = c; }, end(b) { body = JSON.parse(b); } };
  await plugin.handle({ url }, res, { path: new URL(url, 'http://x').pathname });
  return { code, body };
}

test('requires id', async () => {
  const r = await call('/timing');
  assert.strictEqual(r.code, 400);
});

test('contract shape', async () => {
  const r = await call('/timing?id=t1&from=2026-10-23&to=2026-10-24&meal=dinner');
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.days.length, 2);
  const d = r.body.days[0];
  assert.ok(d.hours.every(h => h.crowd >= 0 && h.crowd <= 100 && ['low', 'medium', 'high'].includes(h.level)));
  assert.ok(d.best_times.length >= 1 && d.best_times.length <= 3);
  assert.ok(r.body.best_times.every(b => b.date && b.start && b.end && b.est_wait_min != null));
});

test('rejects ranges over 14 days', async () => {
  const r = await call('/timing?id=t1&from=2026-10-01&to=2026-11-30');
  assert.strictEqual(r.code, 400);
});

test('max_wait_min alias is honored', async () => {
  const r = await call('/timing?id=t1&from=2026-10-23&max_wait_min=0');
  assert.strictEqual(r.code, 200);
});

test('time param gives a verdict', async () => {
  const r = await call('/timing?id=t1&from=2026-10-23&max_wait_min=10&time=20:00');
  assert.ok(['good', 'busy', 'closed'].includes(r.body.requested.verdict));
  const none = await call('/timing?id=t1&from=2026-10-23');
  assert.strictEqual(none.body.requested, null);
});

test('now: batch current crowd for several ids', async () => {
  const r = await call('/now?ids=a,b,osm:node/1&time=12:00&date=2026-10-23');
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.results.length, 3);
  assert.strictEqual(r.body.hour, 12);
  assert.ok(r.body.results.every(x => x.id && x.crowd >= 0 && x.crowd <= 100 && x.level && x.open !== undefined));
  assert.strictEqual((await call('/now')).code, 400);
});

test('days have factors and health reports cache state', async () => {
  const r = await call('/timing?id=t2&from=2026-10-24&to=2026-10-24');
  assert.ok(Array.isArray(r.body.days[0].factors) && r.body.days[0].factors.includes('weekend'));
  const h = await call('/health');
  assert.ok(h.body.ok && h.body.opening_hours_cache && typeof h.body.opening_hours_cache.entries === 'number');
});

test('invalid from date is rejected', async () => {
  const r = await call('/timing?id=t3&from=bad&to=2026-10-23');
  assert.strictEqual(r.code, 400);
});
