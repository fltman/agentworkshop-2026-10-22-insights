const { parseSearch, searchRestaurants } = require('./discovery');
const { createMetrics } = require('./metrics');

const metrics = createMetrics();

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function clientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  return (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
}

module.exports = {
  async handle(req, res, ctx) {
    if (ctx.path === '/stats') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method must be GET' });
        return true;
      }
      sendJson(res, 200, metrics.stats());
      return true;
    }
    if (ctx.path !== '/search') {
      return false;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method must be GET' });
      return true;
    }

    const startedAt = performance.now();
    try {
      const startedAt = performance.now();
      const search = parseSearch(new URL(req.url, 'http://localhost'));
      const result = await searchRestaurants(search);
      metrics.record({
        client: clientKey(req),
        cacheHit: result.cacheHit,
        durationMs: performance.now() - startedAt,
        restaurants: result.restaurants,
        failed: false,
      });
      sendJson(res, 200, { restaurants: result.restaurants });
    } catch (error) {
      metrics.record({
        client: clientKey(req),
        cacheHit: false,
        durationMs: performance.now() - startedAt,
        restaurants: [],
        failed: true,
      });
      const message = error instanceof Error ? error.message : 'unexpected discovery error';
      const status = message.includes('must be a number')
        || message.endsWith('is required')
        || message === 'price_min must not exceed price_max'
        ? 400
        : 502;
      sendJson(res, status, { error: message });
    }
    return true;
  },
};
