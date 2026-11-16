// Hands-free numbered badges on Google Images / Pinterest result tiles.
// Commands come from Mendcraft via the service worker. This script never
// types into fields and never submits a form. Keep URL helpers in sync with
// src/references/browserSearch.ts.
(function () {
  'use strict';

  var MAX = 8;
  var MIN = 80;
  var OVERLAY_ID = 'mendcraft-refs-overlay';
  var highlighted = 1;
  var images = [];
  var cursor = null;

  function bestImageUrl(src, href) {
    var link = href || '';
    try {
      var u = new URL(link, location.href);
      var imgurl = u.searchParams.get('imgurl') || u.searchParams.get('img_url');
      if (imgurl && /^https?:\/\//i.test(imgurl)) return imgurl.slice(0, 2000);
    } catch (e) { /* ignore */ }
    var m = link.match(/[?&]imgurl=([^&]+)/i);
    if (m) {
      try {
        var decoded = decodeURIComponent(m[1]);
        if (/^https?:\/\//i.test(decoded)) return decoded.slice(0, 2000);
      } catch (e2) { /* ignore */ }
    }
    return String(src || '').slice(0, 2000);
  }

  function isOurs(el) {
    return !!(el && el.closest && el.closest('#' + OVERLAY_ID));
  }

  function collect() {
    var boxes = [];
    var imgs = document.querySelectorAll('img');
    var i, img, r, src, a, title;
    for (i = 0; i < imgs.length; i++) {
      img = imgs[i];
      if (isOurs(img)) continue;
      r = img.getBoundingClientRect();
      if (r.width < MIN || r.height < MIN) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      src = img.currentSrc || img.src || '';
      if (!src) continue;
      a = img.closest('a');
      title = img.alt || (a && (a.getAttribute('aria-label') || a.title)) || '';
      boxes.push({
        src: bestImageUrl(src, a && a.href),
        href: a && a.href,
        title: title,
        x: r.left, y: r.top, w: r.width, h: r.height,
      });
    }
    var out = [];
    var seen = {};
    for (i = 0; i < boxes.length; i++) {
      if (seen[boxes[i].src]) continue;
      seen[boxes[i].src] = 1;
      out.push({
        index: out.length + 1,
        src: boxes[i].src,
        href: boxes[i].href,
        title: boxes[i].title,
        x: boxes[i].x, y: boxes[i].y, w: boxes[i].w, h: boxes[i].h,
      });
      if (out.length >= MAX) break;
    }
    return out;
  }

  function ensureOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('data-mendcraft', 'refs');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:system-ui,sans-serif;';
    (document.documentElement || document.body).appendChild(el);
    return el;
  }

  function paint() {
    var el = ensureOverlay();
    el.innerHTML = '';
    images = collect();
    if (images.length && (highlighted < 1 || highlighted > images.length)) highlighted = 1;
    var i, img, badge, ring;
    for (i = 0; i < images.length; i++) {
      img = images[i];
      badge = document.createElement('div');
      badge.textContent = String(img.index);
      badge.style.cssText = [
        'position:fixed',
        'left:' + Math.max(8, img.x + 8) + 'px',
        'top:' + Math.max(8, img.y + 8) + 'px',
        'width:56px',
        'height:56px',
        'border-radius:50%',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'font-size:28px',
        'font-weight:800',
        'color:#fff',
        'background:' + (img.index === highlighted ? '#0f766e' : 'rgba(15,23,42,0.88)'),
        'border:3px solid #fff',
        'box-shadow:0 2px 10px rgba(0,0,0,0.45)',
        'pointer-events:none',
      ].join(';');
      el.appendChild(badge);
      if (img.index === highlighted) {
        ring = document.createElement('div');
        ring.style.cssText = [
          'position:fixed',
          'left:' + img.x + 'px',
          'top:' + img.y + 'px',
          'width:' + img.w + 'px',
          'height:' + img.h + 'px',
          'box-sizing:border-box',
          'border:6px solid #14b8a6',
          'border-radius:12px',
          'pointer-events:none',
        ].join(';');
        el.appendChild(ring);
      }
    }
    if (cursor) {
      var cur = document.createElement('div');
      cur.style.cssText = [
        'position:fixed',
        'left:' + (cursor.x - 28) + 'px',
        'top:' + (cursor.y - 28) + 'px',
        'width:56px',
        'height:56px',
        'border-radius:50%',
        'border:5px solid #facc15',
        'background:rgba(250,204,21,0.2)',
        'box-shadow:0 0 0 8px rgba(250,204,21,0.15)',
        'pointer-events:none',
      ].join(';');
      el.appendChild(cur);
    }
  }

  function imageAt(x, y) {
    var hit = null;
    for (var i = 0; i < images.length; i++) {
      var im = images[i];
      if (x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h) hit = im;
    }
    return hit;
  }

  function pickedData(img) {
    if (!img) return { ok: false, error: 'no-image' };
    return {
      ok: true,
      data: {
        kind: 'image',
        url: img.src,
        title: (img.title || '').slice(0, 300),
        text: (img.title || '').slice(0, 300),
      },
    };
  }

  function nextPage() {
    var btn = document.querySelector('a#pnnext, a[aria-label="Next page"], a[aria-label="Next"], button[aria-label="Next page"]');
    if (btn && typeof btn.click === 'function') {
      btn.click();
      return true;
    }
    window.scrollBy(0, Math.round(innerHeight * 0.9));
    return false;
  }

  function handle(action, payload) {
    payload = payload || {};
    if (action === 'refsStart' || (action === 'refsCommand' && payload.cmd === 'start')) {
      paint();
      return { ok: true, data: { kind: 'text', title: 'ready', text: String(images.length) } };
    }
    if (action !== 'refsCommand') return { ok: false, error: 'unknown-action' };
    var cmd = payload.cmd;
    if (cmd === 'scrollUp' || cmd === 'scrollDown') {
      window.scrollBy({ top: (cmd === 'scrollDown' ? 1 : -1) * Math.round(innerHeight * 0.8), behavior: 'smooth' });
      setTimeout(paint, 200);
      return { ok: true, data: { kind: 'text', title: cmd } };
    }
    if (cmd === 'nextPage') {
      nextPage();
      setTimeout(paint, 400);
      return { ok: true, data: { kind: 'text', title: 'nextPage' } };
    }
    if (cmd === 'highlight') {
      paint();
      var n = Number(payload.index);
      if (images.some(function (im) { return im.index === n; })) highlighted = n;
      paint();
      return { ok: true, data: { kind: 'text', title: 'highlight', text: String(highlighted) } };
    }
    if (cmd === 'cursor') {
      var cx = typeof payload.cursor === 'object' && payload.cursor ? payload.cursor.x : payload.x;
      var cy = typeof payload.cursor === 'object' && payload.cursor ? payload.cursor.y : payload.y;
      if (typeof cx === 'number' && typeof cy === 'number') {
        cursor = { x: cx * innerWidth, y: cy * innerHeight };
        paint();
        var hit = imageAt(cursor.x, cursor.y);
        if (hit) {
          highlighted = hit.index;
          paint();
        }
      }
      return { ok: true, data: { kind: 'text', title: 'cursor', text: String(highlighted) } };
    }
    if (cmd === 'pick') {
      paint();
      var index = payload.index != null ? Number(payload.index) : highlighted;
      var img = null;
      for (var i = 0; i < images.length; i++) if (images[i].index === index) img = images[i];
      if (!img && index === -1) img = images[images.length - 1] || null;
      return pickedData(img);
    }
    return { ok: false, error: 'unknown-cmd' };
  }

  var scrollTick = 0;
  window.addEventListener('scroll', function () {
    if (scrollTick) return;
    scrollTick = 1;
    requestAnimationFrame(function () { scrollTick = 0; if (document.getElementById(OVERLAY_ID)) paint(); });
  }, { passive: true });
  window.addEventListener('resize', function () { if (document.getElementById(OVERLAY_ID)) paint(); });

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || msg.type !== 'mendcraft-ext-tab' || msg.v !== 1) return;
    if (msg.action !== 'refsCommand' && msg.action !== 'refsStart') return;
    var out = handle(msg.action, msg.payload || {});
    sendResponse(out);
    return true;
  });
})();
