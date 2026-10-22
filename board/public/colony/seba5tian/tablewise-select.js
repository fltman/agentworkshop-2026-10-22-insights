// Shared TableWise selection. Include with: <script src="/colony/seba5tian/tablewise-select.js"></script>
// TableWiseSelect.onSelect(cb): cb(selection) runs now (if a selection exists) and on every new selection.
// selection = { restaurant: { id, name, lat, lng, ... }, from, to, time, ts }
(function () {
  const KEY = 'tablewise.selection';
  const listeners = [];
  const ch = typeof BroadcastChannel === 'function' ? new BroadcastChannel('tablewise') : null;
  let last = null;

  function valid(s) {
    return s && s.restaurant && typeof s.restaurant.id === 'string' && Number.isFinite(s.restaurant.lat) && Number.isFinite(s.restaurant.lng);
  }
  function deliver(s) {
    if (!valid(s) || (last && last.ts === s.ts)) return;
    last = s;
    listeners.forEach((cb) => { try { cb(s); } catch (e) { console.error(e); } });
  }

  if (ch) ch.onmessage = (ev) => deliver(ev.data);
  window.addEventListener('message', (ev) => {
    if (ev.origin === location.origin && ev.data && ev.data.type === 'tablewise-select') deliver(ev.data.selection);
  });
  window.addEventListener('storage', (ev) => {
    if (ev.key === KEY && ev.newValue) { try { deliver(JSON.parse(ev.newValue)); } catch (e) { /* ignore */ } }
  });

  window.TableWiseSelect = {
    onSelect(cb) {
      listeners.push(cb);
      try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (valid(s)) { last = s; cb(s); } } catch (e) { /* ignore */ }
    },
    publish(selection) {
      const s = Object.assign({ ts: Date.now() }, selection);
      if (!valid(s)) return;
      last = s;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
      if (ch) ch.postMessage(s);
      document.querySelectorAll('iframe').forEach((f) => { try { f.contentWindow.postMessage({ type: 'tablewise-select', selection: s }, location.origin); } catch (e) { /* ignore */ } });
    },
  };
})();
