import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import discovery from '../../../board/plugins/daniela/index.js';

async function invoke(url, path = '/search') {
  let status;
  let body = '';
  const response = {
    writeHead(code) {
      status = code;
    },
    end(value) {
      body = value;
    },
  };

  const handled = await discovery.handle(
    { method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } },
    response,
    { path },
  );
  return { handled, status, body: JSON.parse(body) };
}

test('rejects a search without coordinates', async () => {
  const result = await invoke('/search?lng=18.0686');

  assert.equal(result.handled, true);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'lat is required');
});

test('normalizes and caches Overpass restaurant results', async (t) => {
  let calls = 0;
  const provider = http.createServer((request, response) => {
    calls += 1;
    assert.equal(request.headers.accept, 'application/json');
    assert.equal(request.headers['user-agent'], 'tablewise-workshop/1.0');
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      elements: [{
        type: 'node',
        id: 123,
        lat: 59.3293,
        lon: 18.0686,
        tags: {
          name: 'Example Bistro',
          cuisine: 'italian;pizza',
          price: '$$',
          'addr:street': 'Example Street',
          'addr:housenumber': '1',
          phone: '+46 8 123 45 67',
        },
      }],
    }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const { port } = provider.address();
  const previousProvider = process.env.OVERPASS_URL;
  process.env.OVERPASS_URL = `http://127.0.0.1:${port}`;
  t.after(() => {
    if (previousProvider === undefined) {
      delete process.env.OVERPASS_URL;
    } else {
      process.env.OVERPASS_URL = previousProvider;
    }
    provider.close();
  });

  const first = await invoke('/search?lat=59.3293&lng=18.0686&radius_m=1500&cuisines=italian&price_min=2&price_max=3');
  const second = await invoke('/search?lat=59.3293&lng=18.0686&radius_m=1500&cuisines=italian&price_min=2&price_max=3');

  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    restaurants: [{
      restaurant_id: 'osm:node/123',
      name: 'Example Bistro',
      lat: 59.3293,
      lng: 18.0686,
      cuisines: ['italian', 'pizza'],
      price_level: 2,
      address: 'Example Street 1',
      phone: '+46 8 123 45 67',
      website: null,
      openingHours: null,
      source: 'openstreetmap',
    }],
  });
  assert.deepEqual(second.body, first.body);
  assert.equal(calls, 1);
});

test('reports aggregate traffic without client identifiers', async () => {
  const result = await invoke('/stats', '/stats');

  assert.equal(result.status, 200);
  assert.equal(result.body.period_seconds, 300);
  assert.ok(result.body.searches.total >= 2);
  assert.ok(result.body.active.users_recent >= 1);
  assert.ok(result.body.active.restaurants_recent >= 1);
  assert.equal(JSON.stringify(result.body).includes('127.0.0.1'), false);
});
