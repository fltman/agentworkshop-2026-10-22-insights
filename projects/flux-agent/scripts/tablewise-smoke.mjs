import assert from 'node:assert/strict';

const baseUrl = (process.env.TABLEWISE_URL || 'https://insights.torget.bjarby.com').replace(/\/$/, '');
const visitDate = process.env.TABLEWISE_DATE || new Date().toISOString().slice(0, 10);
const timeoutMs = Number(process.env.TABLEWISE_TIMEOUT_MS || 10_000);
const failures = [];

function report(label, action) {
  return action()
    .then(() => console.log(`PASS ${label}`))
    .catch((error) => {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`FAIL ${label}`);
    });
}

async function request(path, query = {}) {
  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}: ${text.slice(0, 160)}`);
  const contentType = response.headers.get('content-type') || '';
  return {
    response,
    text,
    json: contentType.includes('application/json') ? JSON.parse(text) : null,
  };
}

let restaurant;

await report('group tile advertises group-app and shared selection', async () => {
  const { text } = await request('/colony/seba5tian/');
  assert.match(text, /<meta\s+name=["']colony["']\s+content=["']group-app["']\s*>/i);

  const selection = await request('/colony/seba5tian/tablewise-select.js');
  assert.match(selection.text, /TableWiseSelect/);
});

await report('restaurant fallback returns real data', async () => {
  const { json } = await request('/t/bhaeha-team/restaurants', {
    lat: 59.3293,
    lng: 18.0686,
    radius_m: 1500,
    limit: 1,
  });
  assert.equal(typeof json.source, 'string');
  assert.ok(Array.isArray(json.restaurants) && json.restaurants.length > 0, 'expected at least one restaurant');

  restaurant = json.restaurants[0];
  assert.equal(typeof restaurant.id, 'string');
  assert.equal(typeof restaurant.lat, 'number');
  assert.equal(typeof restaurant.lng, 'number');
});

await report('selected restaurant loads menu contract', async () => {
  const { json } = await request('/t/bhaeha-team/menu', {
    id: restaurant.id,
    lat: restaurant.lat,
    lng: restaurant.lng,
    from: visitDate,
    to: visitDate,
  });
  assert.equal(json.id, restaurant.id);
  assert.equal(typeof json.source, 'string');
  assert.ok(Array.isArray(json.days));
  assert.ok(Array.isArray(json.offers));
});

await report('selected restaurant loads reviews contract', async () => {
  const { json } = await request('/t/gnik/reviews', {
    id: restaurant.id,
    restaurant_id: restaurant.id,
    name: restaurant.name,
    lat: restaurant.lat,
    lng: restaurant.lng,
    from: visitDate,
    to: visitDate,
  });
  assert.equal(typeof json.source, 'string');
  assert.equal(typeof json.review_count, 'number');
  assert.ok(Array.isArray(json.suggested_meals));
  assert.ok(Array.isArray(json.red_flags));
});

await report('selected restaurant loads timing contract', async () => {
  const { json } = await request('/t/omidteam/timing', {
    id: restaurant.id,
    lat: restaurant.lat,
    lng: restaurant.lng,
    from: visitDate,
    to: visitDate,
    time: '19:00',
    country: 'SE',
  });
  assert.equal(json.restaurant_id, restaurant.id);
  assert.ok(Array.isArray(json.days) && json.days.length > 0);
  assert.ok(Array.isArray(json.best_times));
});

if (failures.length) {
  console.error(`\n${failures.length} TableWise smoke check(s) failed:`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`\nAll TableWise smoke checks passed against ${baseUrl} for ${visitDate}.`);
}
