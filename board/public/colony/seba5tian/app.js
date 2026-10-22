// TableWise UI. All text from other modules goes in via textContent, never innerHTML.
(function () {
  const $ = (s) => document.querySelector(s);
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  };

  let modules = {
    discovery: { path: '/t/daniela/search' },
    timing: { path: '/t/omidteam/timing' },
    reviews: { path: '/t/gnik/reviews' },
    menus: { path: '/t/bhaeha-team/menu' },
  };

  const map = L.map('map').setView([59.3293, 18.0686], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const markers = L.layerGroup().addTo(map);
  const here = { lat: 59.3293, lng: 18.0686 };
  let current = { params: null, restaurant: null };

  const setStatus = (t) => { $('#status').textContent = t; };
  const body = (id) => { const b = $('#' + id + ' .body'); b.replaceChildren(); return b; };

  async function getJson(path, query) {
    const r = await fetch(path + '?' + new URLSearchParams(query));
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || 'HTTP ' + r.status);
    return data;
  }

  // Accept both our contract shape and daniela's published shape.
  function normalize(r) {
    const c = r.contact || {};
    return {
      id: r.restaurant_id || r.id,
      name: r.name || 'Unnamed',
      lat: r.lat,
      lng: r.lng,
      cuisines: r.cuisines || [],
      price: r.price_level != null ? '$'.repeat(r.price_level) : (r.priceLevel || null),
      rating: r.rating != null ? r.rating : null,
      phone: c.phone || r.phone || null,
      website: c.website || r.website || null,
      address: c.address || r.address || null,
      hours: c.opening_hours || r.openingHours || null,
    };
  }

  async function search(params) {
    current.params = params;
    if (params.location) { here.lat = params.location.lat; here.lng = params.location.lng; }
    setStatus('Searching...');
    markers.clearLayers();
    try {
      let data;
      try {
        data = await getJson(modules.discovery.path, {
        lat: here.lat,
        lng: here.lng,
        radius_m: (params.location && params.location.radius_m) || 1500,
        cuisines: (params.cuisines || []).join(','),
        price_min: params.price_min || 1,
        price_max: params.price_max || 4,
        limit: 50,
        });
      } catch (e) {
        data = { restaurants: await overpassFallback(params), fallback: true };
      }
      let list = (data.restaurants || data || []).map(normalize);
      list = list.filter((r) => !params.price_max || !r.price || r.price.length <= params.price_max);
      map.setView([here.lat, here.lng], 15);
      list.forEach((r) => {
        L.marker([r.lat, r.lng]).addTo(markers).bindTooltip(r.name).on('click', () => select(r));
      });
      renderList(list);
      setStatus(list.length + ' restaurants found' + (data.fallback ? ' (direct OSM fallback, discovery module unavailable)' : ''));
    } catch (e) {
      setStatus('Search failed: ' + e.message);
    }
  }

  // Used only when the discovery module fails: same output shape as discovery, straight from OpenStreetMap.
  async function overpassFallback(params) {
    const radius = (params.location && params.location.radius_m) || 1500;
    const q = '[out:json][timeout:15];nwr["amenity"="restaurant"]["name"](around:' + radius + ',' + here.lat + ',' + here.lng + ');out center tags 50;';
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }) });
    if (!r.ok) throw new Error('OSM fallback HTTP ' + r.status);
    const j = await r.json();
    const wanted = new Set(params.cuisines || []);
    return (j.elements || []).map((e) => {
      const t = e.tags || {};
      const cuisines = (t.cuisine || '').split(';').map((x) => x.trim()).filter(Boolean);
      return {
        restaurant_id: 'osm:' + e.type + '/' + e.id,
        name: t.name,
        lat: e.lat != null ? e.lat : e.center && e.center.lat,
        lng: e.lon != null ? e.lon : e.center && e.center.lon,
        cuisines,
        contact: { phone: t.phone || t['contact:phone'], website: t.website || t['contact:website'], opening_hours: t.opening_hours,
          address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null },
      };
    }).filter((x) => x.lat != null && x.lng != null && (!wanted.size || x.cuisines.some((c) => wanted.has(c.toLowerCase()))));
  }

  function renderList(list) {
    const box = $('#list');
    box.replaceChildren();
    list.forEach((r) => {
      const b = el('button', r.name + (r.price ? '  ' + r.price : ''), 'item');
      b.type = 'button';
      b.addEventListener('click', () => { map.setView([r.lat, r.lng], 17); select(r); });
      box.appendChild(b);
    });
  }

  function unavailable(id, why) {
    body(id).appendChild(el('div', 'Not available' + (why ? ' (' + why + ')' : ''), 'muted'));
  }

  function select(r) {
    current.restaurant = r;
    $('#d-name').textContent = r.name + (r.price ? '  ' + r.price : '');
    renderContact(r);
    const q = { id: r.id, restaurant_id: r.id, name: r.name, lat: r.lat, lng: r.lng };
    if (current.params) { q.from = current.params.from; q.to = current.params.to; q.maxWaitMinutes = current.params.max_wait_min; }
    loadMenu(q); loadReviews(q); loadTiming(q);
  }

  function renderContact(r) {
    const b = body('w-contact');
    [['Address', r.address], ['Phone', r.phone], ['Hours', r.hours]].forEach(([k, v]) => {
      if (v) b.appendChild(el('div', k + ': ' + v));
    });
    if (r.website && /^https?:\/\//i.test(r.website)) {
      const a = el('a', r.website); a.href = r.website; a.target = '_blank'; a.rel = 'noopener';
      b.appendChild(a);
    }
    if (!b.children.length) b.appendChild(el('div', 'No contact info', 'muted'));
  }

  async function loadMenu(q) {
    if (!modules.menus.path) return unavailable('w-menu', 'module not claimed yet');
    body('w-menu').appendChild(el('div', 'Loading...', 'muted'));
    try {
      const d = await getJson(modules.menus.path, q);
      const b = body('w-menu');
      (d.days || d.menus || []).forEach((m) => {
        b.appendChild(el('strong', m.date));
        const ul = el('ul');
        (m.items || []).forEach((i) => ul.appendChild(el('li', (i.daily_special ? '* ' : '') + i.name + (i.price != null ? ' - ' + i.price + ' ' + (i.currency || '') : ''))));
        b.appendChild(ul);
      });
      if (d.menu_url && /^https?:\/\//i.test(d.menu_url)) {
        const a = el('a', 'Menu link'); a.href = d.menu_url; a.target = '_blank'; a.rel = 'noopener'; b.appendChild(a);
      }
      if (d.source === 'mock') b.appendChild(el('div', 'Demo data', 'muted'));
      (d.offers || []).forEach((o) => b.appendChild(el('div', 'Offer: ' + o.title + (o.description ? ' - ' + o.description : ''))));
      if (!b.children.length) b.appendChild(el('div', 'No menu or offers for these dates', 'muted'));
    } catch (e) { unavailable('w-menu', e.message); }
  }

  async function loadReviews(q) {
    body('w-reviews').appendChild(el('div', 'Loading...', 'muted'));
    try {
      const d = await getJson(modules.reviews.path, q);
      const b = body('w-reviews');
      if ((d.suggested_meals || []).length) {
        b.appendChild(el('strong', 'Suggested meals'));
        const ul = el('ul');
        d.suggested_meals.forEach((m) => ul.appendChild(el('li', (m.dish || m.name) + (m.mentions ? ' (' + m.mentions + ' mentions)' : '') + (m.reason ? ' - ' + m.reason : ''))));
        b.appendChild(ul);
      }
      if ((d.red_flags || []).length) {
        b.appendChild(el('strong', 'Red flags', 'flag'));
        const ul = el('ul');
        d.red_flags.forEach((f) => ul.appendChild(el('li', (f.type ? f.type + ': ' : '') + f.text, 'flag')));
        b.appendChild(ul);
      }
      if (!b.children.length) b.appendChild(el('div', 'No review insights', 'muted'));
    } catch (e) { unavailable('w-reviews', e.message); }
  }

  async function loadTiming(q) {
    body('w-timing').appendChild(el('div', 'Loading...', 'muted'));
    try {
      const d = await getJson(modules.timing.path, q);
      const b = body('w-timing');
      if (d.avg_wait_min != null) b.appendChild(el('div', 'Average wait: ' + d.avg_wait_min + ' min'));
      const ul = el('ul');
      if (!(d.best_times || []).length && (d.days || []).length) {
        d.days.forEach((day) => {
          const open = (day.hours || []).filter((h) => h.open !== false && h.crowd != null);
          if (!open.length) return;
          const best = open.reduce((a, h) => (h.crowd < a.crowd ? h : a));
          ul.appendChild(el('li', day.date + ' around ' + best.hour + ':00 (' + (best.level || best.crowd) + ' crowd, ~' + best.est_wait_minutes + ' min wait)'));
        });
      }
      (d.best_times || []).forEach((t) => {
        ul.appendChild(el('li', [t.date, t.start && t.end ? t.start + '-' + t.end : t.hour, t.crowd ? '(' + t.crowd + ' crowd)' : '', t.est_wait_min != null ? '~' + t.est_wait_min + ' min wait' : ''].filter(Boolean).join(' ')));
      });
      b.appendChild(ul);
      if (!ul.children.length) b.appendChild(el('div', 'No timing data', 'muted'));
    } catch (e) { unavailable('w-timing', e.message); }
  }

  $('#form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    search({
      from: f.get('from'),
      to: f.get('to'),
      location: { lat: here.lat, lng: here.lng, radius_m: Number(f.get('radius_m')) || 1500 },
      cuisines: String(f.get('cuisines') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      price_min: 1,
      price_max: Number(f.get('price_max')) || 4,
      max_wait_min: Number(f.get('max_wait_min')) || null,
    });
  });

  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return setStatus('Geolocation not supported');
    navigator.geolocation.getCurrentPosition((p) => {
      here.lat = p.coords.latitude; here.lng = p.coords.longitude;
      map.setView([here.lat, here.lng], 15);
      setStatus('Location set');
    }, () => setStatus('Location denied'));
  });

  map.on('click', (e) => { here.lat = e.latlng.lat; here.lng = e.latlng.lng; setStatus('Search center set from map'); });

  fetch('/t/seba5tian/modules').then((r) => r.json()).then((d) => {
    Object.keys(d.modules || {}).forEach((k) => { if (modules[k]) modules[k] = { path: d.modules[k].path }; });
  }).catch(() => {});

  window.TableWise = { onSearch: search, select };
})();
