// seba5tian: TableWise integration backend. The UI talks to the other teams' modules directly (same origin);
// this plugin offers a health check, the module registry and a Google Places search proxy (key stays server-side).

const { handlePlaces } = require('./places');

const MODULES = {
  discovery: { team: 'daniela', path: '/t/daniela/search' },
  timing: { team: 'omidteam', path: '/t/omidteam/timing' },
  reviews: { team: 'gnik', path: '/t/gnik/reviews' },
  menus: { team: 'bhaeha-team', path: '/t/bhaeha-team/menu' },
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

module.exports = {
  async handle(req, res, { path }) {
    if (req.method === 'GET' && path === '/health') {
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'GET' && path === '/modules') {
      json(res, 200, { modules: MODULES });
      return true;
    }
    if (req.method === 'GET' && path === '/places') {
      await handlePlaces(req, res, json);
      return true;
    }
    return false;
  },
};
