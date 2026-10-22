// seba5tian: TableWise integration backend. The UI talks to the other teams' modules directly (same origin);
// this plugin only offers a health check and the module registry the UI reads its endpoints from.

const MODULES = {
  discovery: { team: 'daniela', path: '/t/daniela/search' },
  timing: { team: 'omidteam', path: '/t/omidteam/timing' },
  reviews: { team: 'gnik', path: '/t/gnik/reviews' },
  menus: { team: null, path: null },
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
    return false;
  },
};
