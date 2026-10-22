/* Drop-in timing widget for the group app. One script tag, one call:
 *   <script src="/colony/omidteam/widget.js"></script>
 *   OmidTiming.mount(container, { id, lat, lng, from, to, time, name })
 * Call mount() again with the new restaurant; it updates the same iframe and keeps its height. */
(function () {
  var frames = new WeakMap();
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'omidteam-height') return;
    document.querySelectorAll('iframe[data-omidteam]').forEach(function (f) {
      if (f.contentWindow === e.source) f.style.height = Math.max(200, Math.ceil(d.height)) + 'px';
    });
  });
  window.OmidTiming = {
    url: function (o) {
      var p = new URLSearchParams({ embed: '1' });
      ['id', 'lat', 'lng', 'from', 'to', 'time', 'meal', 'max_wait_min'].forEach(function (k) { if (o[k] != null && o[k] !== '') p.set(k, o[k]); });
      return '/colony/omidteam/?' + p;
    },
    mount: function (box, o) {
      var f = frames.get(box);
      if (!f) {
        f = document.createElement('iframe'); f.setAttribute('data-omidteam', '1'); f.title = 'Visit timing';
        f.style.cssText = 'width:100%;height:520px;border:0;display:block'; box.textContent = ''; box.appendChild(f); frames.set(box, f);
      }
      var u = this.url(o); if (f.getAttribute('src') !== u) f.setAttribute('src', u);
      return f;
    }
  };
})();
