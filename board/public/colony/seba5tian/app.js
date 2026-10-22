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
  let demoMode = false;
  let fallbackSource = '';

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
      cuisines: r.cuisines || (r.category ? [String(r.category).replace(/_restaurant$/, '').replace(/_/g, ' ')] : []),
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
    demoMode = false;
    setStatus('Searching...');
    markers.clearLayers();
    try {
      let data;
      if ($('#demo').checked) {
        data = { restaurants: demoRestaurants(), fallback: true };
      } else try {
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
        data = { restaurants: await fallbackChain(params), fallback: true };
      }
      let list = (data.restaurants || data || []).map(normalize);
      list = list.filter((r) => !params.price_max || !r.price || r.price.length <= params.price_max);
      map.setView([here.lat, here.lng], 15);
      list.forEach((r) => {
        L.marker([r.lat, r.lng]).addTo(markers).bindTooltip(r.name).on('click', () => select(r));
      });
      renderList(list);
      addBadges(list.slice(0, 10), params);
      setStatus(list.length + ' restaurants found' + (data.fallback ? (demoMode ? ' (DEMO DATA: discovery and OSM are both unavailable)' : ' (fallback: ' + fallbackSource + '; discovery module unavailable)') : ''));
    } catch (e) {
      setStatus('Search failed: ' + e.message);
    }
  }

  const OVERPASS_HOSTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  // Last resort when every OSM server is overloaded: labelled demo points around the search center.
  function demoRestaurants() {
    const names = [['Demo Trattoria', 'italian'], ['Demo Ramen Bar', 'japanese'], ['Demo Thai Kitchen', 'thai'], ['Demo Bistro', 'french'], ['Demo Veggie House', 'vegetarian']];
    demoMode = true;
    return names.map(([n, c], i) => ({
      restaurant_id: 'demo:' + i,
      name: n + ' (demo)',
      lat: here.lat + 0.0025 * Math.cos(i * 1.3),
      lng: here.lng + 0.004 * Math.sin(i * 1.3),
      cuisines: [c],
      contact: { phone: '+46 8 000 000' + i, website: null, opening_hours: 'Mo-Su 11:00-22:00', address: 'Demo street ' + (i + 1) },
    }));
  }

  // Used only when the discovery module fails: same output shape as discovery, straight from OpenStreetMap.
  async function overpassFallback(params) {
    const radius = (params.location && params.location.radius_m) || 1500;
    const q = '[out:json][timeout:15];nwr["amenity"="restaurant"]["name"](around:' + radius + ',' + here.lat + ',' + here.lng + ');out center tags 50;';
    let j = null;
    for (const host of OVERPASS_HOSTS) {
      try {
        const r = await fetch(host, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(8000) });
        if (r.ok) { j = await r.json(); break; }
      } catch (e) { /* try next mirror */ }
    }
    if (!j) return demoRestaurants();
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

  // Fallback: merge bhaeha-team Overture data with OSM Nominatim (keyless, works when Overpass is down),
  // then Overpass, then demo data. Nominatim allows 1 request per second, so queries run in sequence.
  function bbox(radiusM) {
    const dLat = radiusM / 111320;
    const dLng = radiusM / (111320 * Math.cos(here.lat * Math.PI / 180));
    return [here.lng - dLng, here.lat + dLat, here.lng + dLng, here.lat - dLat].map((n) => n.toFixed(5)).join(',');
  }

  async function nominatim(params) {
    const box = bbox((params.location && params.location.radius_m) || 1500);
    const found = [];
    for (const term of ['restaurant', 'restaurang']) {
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q: term, format: 'jsonv2', limit: '40', bounded: '1', viewbox: box, extratags: '1' }), { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        (await r.json()).forEach((x) => {
          const t = x.extratags || {};
          found.push({
            restaurant_id: 'osm:' + x.osm_type + '/' + x.osm_id,
            name: x.name || x.display_name.split(',')[0],
            lat: Number(x.lat), lng: Number(x.lon),
            cuisines: t.cuisine ? t.cuisine.split(';') : [],
            contact: { phone: t.phone || t['contact:phone'], website: t.website || t['contact:website'], opening_hours: t.opening_hours },
          });
        });
      } catch (e) { /* next term */ }
      await new Promise((ok) => setTimeout(ok, 1100));
    }
    return found;
  }

  function mergeSources(lists) {
    const out = [];
    const seen = new Set();
    lists.flat().forEach((r) => {
      const id = r.restaurant_id || r.id;
      const key = String(r.name || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '') + '|' + Number(r.lat).toFixed(3) + '|' + Number(r.lng).toFixed(3);
      if (seen.has(id) || seen.has(key)) return;
      seen.add(id); seen.add(key);
      out.push(r);
    });
    return out;
  }

  async function fallbackChain(params) {
    const radius = (params.location && params.location.radius_m) || 1500;
    const [overture, osm] = await Promise.all([
      getJson('/t/bhaeha-team/restaurants', { lat: here.lat, lng: here.lng, radius_m: radius }).then((d) => d.restaurants || []).catch(() => []),
      nominatim(params),
    ]);
    const merged = mergeSources([osm, overture]);
    if (merged.length) { fallbackSource = [osm.length && 'OSM Nominatim', overture.length && 'bhaeha-team Overture'].filter(Boolean).join(' + '); return merged; }
    fallbackSource = 'OSM Overpass';
    return overpassFallback(params);
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

  async function addBadges(list, params) {
    const buttons = document.querySelectorAll('#list .item');
    await Promise.all(list.map(async (r, i) => {
      try {
        const d = await getJson(modules.timing.path, { id: r.id, lat: r.lat, lng: r.lng, from: params.from, to: params.to, country: 'SE' });
        const t = (d.best_times || [])[0];
        if (t && buttons[i]) buttons[i].textContent += '  [best ' + t.start + (t.est_wait_min != null ? ', ~' + t.est_wait_min + ' min' : '') + ']';
      } catch (e) { /* badge is optional */ }
    }));
  }

  function unavailable(id, why) {
    body(id).appendChild(el('div', 'Not available' + (why ? ' (' + why + ')' : ''), 'muted'));
  }

  function select(r) {
    current.restaurant = r;
    $('#d-name').textContent = r.name + (r.price ? '  ' + r.price : '');
    renderContact(r);
    const q = { id: r.id, restaurant_id: r.id, name: r.name, lat: r.lat, lng: r.lng };
    if (current.params) { q.from = current.params.from; q.to = current.params.to; if (current.params.time) q.time = current.params.time; q.maxWaitMinutes = current.params.max_wait_min; }
    const p = current.params || {};
    window.TableWiseSelect.publish({
      restaurant: { id: r.id, name: r.name, lat: r.lat, lng: r.lng, cuisines: r.cuisines, phone: r.phone, website: r.website, address: r.address },
      from: p.from || null, to: p.to || null, time: p.time || null,
    });
    loadMenu(q); loadReviews(q); loadTiming(Object.assign({ country: 'SE' }, q));
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

  function embedReviews(b, q) {
    if (!/^[A-Za-z0-9:_\/.-]+$/.test(String(q.id))) return;
    const f = document.createElement('iframe');
    f.src = '/colony/gnik/?id=' + encodeURIComponent(q.id);
    f.className = 'embed';
    f.loading = 'lazy';
    b.appendChild(f);
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
      embedReviews(b, q);
    } catch (e) { unavailable('w-reviews', e.message); }
  }

  async function loadTiming(q) {
    body('w-timing').appendChild(el('div', 'Loading...', 'muted'));
    try {
      const d = await getJson(modules.timing.path, q);
      const b = body('w-timing');
      if (d.requested && d.requested.verdict) {
        const r = d.requested;
        b.appendChild(el('div', 'At ' + r.time + ': ' + r.verdict + (r.est_wait_minutes != null ? ' (~' + r.est_wait_minutes + ' min wait)' : '') + (r.better_time ? ', better at ' + r.better_time : ''), r.verdict === 'good' ? 'ok' : 'flag'));
      }
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
      from: f.get('date'),
      to: f.get('date'),
      time: f.get('time') || null,
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

  // Show something on open: today, 19:00, Stockholm center, 1.5 km.
  (function autoload() {
    const today = new Date().toISOString().slice(0, 10);
    $('#form [name=date]').value = today;
    search({ from: today, to: today, time: $('#form [name=time]').value || null, location: { lat: here.lat, lng: here.lng, radius_m: 1500 }, cuisines: [], price_min: 1, price_max: 4, max_wait_min: 20 });
  })();

  window.TableWise = { onSearch: search, select };
})();
