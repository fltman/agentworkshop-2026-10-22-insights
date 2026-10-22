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
      hours: c.opening_hours || r.openingHours || r.opening_hours || null,
    };
  }


  // Minimal OSM opening_hours evaluation (day ranges, time ranges, off, 24/7). Returns true, false or null (unknown).
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  function dayList(sel) {
    const out = new Set();
    for (const part of sel.split(',')) {
      const [from, to] = part.split('-');
      const i = DAYS.indexOf(from), j = to ? DAYS.indexOf(to) : i;
      if (i < 0 || j < 0) return null;
      for (let k = i; ; k = (k + 1) % 7) { out.add(k); if (k === j) break; }
    }
    return out;
  }
  function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
  function parseHours(str) {
    const rules = [];
    for (let raw of String(str).split(';')) {
      raw = raw.trim();
      if (!raw) continue;
      if (/^24\/7$/.test(raw)) { rules.push({ days: new Set([0, 1, 2, 3, 4, 5, 6]), ranges: [[0, 1440]] }); continue; }
      if (/\bPH\b|\bSH\b/.test(raw) && !/^(Mo|Tu|We|Th|Fr|Sa|Su)/.test(raw)) continue;
      const m = raw.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(.+)$/);
      const days = m ? dayList(m[1]) : new Set([0, 1, 2, 3, 4, 5, 6]);
      const rest = (m ? m[2] : raw).replace(/,\s*(PH|SH).*$/, '').trim();
      if (!days) return null;
      if (/^(off|closed)$/i.test(rest)) { rules.push({ days, ranges: [] }); continue; }
      if (!/^\d{1,2}:\d{2}-\d{1,2}:\d{2}(,\s*\d{1,2}:\d{2}-\d{1,2}:\d{2})*$/.test(rest)) return null;
      rules.push({ days, ranges: rest.split(',').map((x) => x.trim().split('-').map(toMin)) });
    }
    return rules.length ? rules : null;
  }
  function rangesFor(rules, day) {
    let r = null;
    rules.forEach((x) => { if (x.days.has(day)) r = x.ranges; });
    return r;
  }
  function isOpenAt(hoursStr, dateStr, timeStr) {
    if (!hoursStr || !dateStr || !timeStr) return null;
    const rules = parseHours(hoursStr);
    if (!rules) return null;
    const day = (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7;
    const t = toMin(timeStr);
    const today = rangesFor(rules, day);
    if (today && today.some(([s, e]) => (s < e ? t >= s && t < e : t >= s))) return true;
    const prev = rangesFor(rules, (day + 6) % 7);
    if (prev && prev.some(([s, e]) => e < s && t < e)) return true;
    return today === null && prev === null ? null : false;
  }

  // Pins: blue = fits the search, red = closed at the chosen time or expected wait above the maximum. Hover shows why.
  const pins = new Map();
  function paintPin(id) {
    const p = pins.get(id);
    if (!p) return;
    const bad = p.reasons.length > 0;
    p.marker.setStyle({ color: bad ? '#8e1b1b' : '#1a4f9c', fillColor: bad ? '#e53935' : '#2a7fff' });
    p.marker.setTooltipContent(p.r.name + (bad ? '\n' + p.reasons.join('\n') : ''));
    if (p.button) { p.button.classList.toggle('bad', bad); p.button.title = p.reasons.join('; '); }
  }
  function setReason(id, key, text) {
    const p = pins.get(id);
    if (!p) return;
    if (text) p.why.set(key, text); else p.why.delete(key);
    p.reasons = [...p.why.values()];
    paintPin(id);
  }

  async function search(params) {
    current.params = params;
    if (params.location) { here.lat = params.location.lat; here.lng = params.location.lng; }
    setStatus('Searching...');
    markers.clearLayers();
    try {
      let data;
      // Google Places (our server-side proxy) when a key is configured, then daniela's discovery, then the fallback chain.
      try {
        data = await getJson('/t/seba5tian/places', {
          lat: here.lat, lng: here.lng,
          radius_m: (params.location && params.location.radius_m) || 1500,
          cuisines: (params.cuisines || []).join(','),
        });
        if (!(data.restaurants || []).length) throw new Error('no places');
        data.source = 'Google Places';
      } catch (g) {
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
        data = { restaurants: await fallbackChain(params), fallback: true };
      }
      }
      let list = (data.restaurants || data || []).map(normalize);
      list = list.filter((r) => !params.price_max || !r.price || r.price.length <= params.price_max);
      map.setView([here.lat, here.lng], 15);
      pins.clear();
      list.forEach((r) => {
        const marker = L.circleMarker([r.lat, r.lng], { radius: 8, weight: 2, fillOpacity: 0.85 }).addTo(markers).bindTooltip(r.name).on('click', () => select(r));
        pins.set(r.id, { r, marker, reasons: [], why: new Map(), button: null });
        const open = isOpenAt(r.hours, params.from, params.time);
        if (open === false) setReason(r.id, 'hours', 'Closed at ' + params.time + ' on ' + params.from + ' (opening hours: ' + r.hours + ')');
        paintPin(r.id);
      });
      renderList(list);
      addBadges(list.slice(0, 25), params);
      setStatus(list.length + ' restaurants found' + (data.fallback ? ' (fallback: ' + fallbackSource + '; discovery module unavailable)' : (data.source === 'Google Places' ? ' (Google Places)' : '')));
    } catch (e) {
      setStatus('Search failed: ' + e.message);
    }
  }

  const OVERPASS_HOSTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

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
    if (!j) return [];
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
  // then Overpass. Nominatim allows 1 request per second, so queries run in sequence.
  function bbox(radiusM) {
    const dLat = radiusM / 111320;
    const dLng = radiusM / (111320 * Math.cos(here.lat * Math.PI / 180));
    return [here.lng - dLng, here.lat + dLat, here.lng + dLng, here.lat - dLat].map((n) => n.toFixed(3)).join(',');
  }

  // Cache per rounded box for 10 minutes and share one in-flight run, so map interactions never fan out public calls.
  const nomCache = new Map();
  function nominatim(params) {
    const box = bbox((params.location && params.location.radius_m) || 1500);
    const hit = nomCache.get(box);
    if (hit && Date.now() - hit.at < 600000) return hit.promise;
    const promise = nominatimRun(box);
    nomCache.set(box, { at: Date.now(), promise });
    promise.then((list) => { if (!list.length) nomCache.delete(box); });
    return promise;
  }

  async function nominatimRun(box) {
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
      if (pins.get(r.id)) { pins.get(r.id).button = b; paintPin(r.id); }
    });
  }

  async function addBadges(list, params) {
    await Promise.all(list.map(async (r) => {
      try {
        const q = { id: r.id, lat: r.lat, lng: r.lng, from: params.from, to: params.to, country: 'SE' };
        if (params.time) q.time = params.time;
        if (params.max_wait_min) q.maxWaitMinutes = params.max_wait_min;
        const d = await getJson(modules.timing.path, q);
        const p = pins.get(r.id);
        const req = d.requested;
        if (req) {
          if (req.open === false || req.verdict === 'closed') setReason(r.id, 'timing-open', 'Closed at ' + params.time + ' (timing module)');
          const wait = req.est_wait_minutes != null ? req.est_wait_minutes : req.est_wait_min;
          if (params.max_wait_min && wait != null && wait > params.max_wait_min) {
            setReason(r.id, 'wait', 'Expected wait ~' + wait + ' min at ' + params.time + ' is above your maximum of ' + params.max_wait_min + ' min' + (req.better_time ? ' (better at ' + req.better_time + ')' : ''));
          }
        }
        const t = (d.best_times || [])[0];
        if (t && p && p.button) p.button.textContent += '  [best ' + t.start + (t.est_wait_min != null ? ', ~' + t.est_wait_min + ' min' : '') + ']';
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

  function loadReviews(q) {
    const b = body('w-reviews');
    if (!/^[A-Za-z0-9:_\/.-]+$/.test(String(q.id))) { b.appendChild(el('div', 'No reviews found', 'muted')); return; }
    const f = document.createElement('iframe');
    f.src = '/colony/gnik/?id=' + encodeURIComponent(q.id) + '&name=' + encodeURIComponent(q.name || '');
    f.className = 'embed';
    b.appendChild(f);
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
