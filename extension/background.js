// Service worker: talks to Mendcraft (externally_connectable) and to tab
// content scripts. Stores the last copied item in chrome.storage.local.
'use strict';

var APP_HOSTS = {
  'mendcraft.web.app': 1,
  'mendcraft.firebaseapp.com': 1,
  'localhost': 1,
  '127.0.0.1': 1,
};

var LAST_KEY = 'mendcraft.lastCopied';

var refsSession = { tabId: null, appTabId: null, appWindowId: null };

function googleImagesUrl(query) {
  return 'https://www.google.com/search?udm=2&tbm=isch&q=' + encodeURIComponent(String(query || 'drawings').trim() || 'drawings');
}

function pinterestSearchUrl(query) {
  return 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(String(query || 'drawings').trim() || 'drawings');
}

function isAllowedRefsUrl(url) {
  try {
    var u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return true;
  } catch (e) {
    return false;
  }
}

async function focusTab(tabId) {
  if (!tabId) return;
  try {
    var tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) { /* tab may be gone */ }
}

async function sendToRefs(action, payload, tries) {
  var n = tries == null ? 8 : tries;
  if (!refsSession.tabId) return { ok: false, error: 'no-refs-tab' };
  var last = { ok: false, error: 'no-content-script' };
  for (var i = 0; i < n; i++) {
    last = await sendToTab(refsSession.tabId, action, payload);
    if (last.ok || last.error !== 'no-content-script') return last;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  return last;
}


function isAppUrl(url) {
  try {
    var u = new URL(url);
    if (!APP_HOSTS[u.hostname]) return false;
    return u.port === '' || u.port === '443' || u.port === '80' || u.port === '5173';
  } catch (e) {
    return false;
  }
}

function resultOf(requestId, action, ok, data, error) {
  var out = { type: 'mendcraft-ext-result', v: 1, requestId: requestId || '', ok: !!ok, action: action };
  if (data) out.data = data;
  if (error) out.error = String(error).slice(0, 300);
  return out;
}

function getLastCopied() {
  return chrome.storage.local.get(LAST_KEY).then(function (got) {
    return got[LAST_KEY] || null;
  });
}

function setLastCopied(data) {
  if (!data) return Promise.resolve();
  var clip = {
    kind: data.kind === 'link' ? 'link' : 'text',
    text: data.text ? String(data.text).slice(0, 20000) : undefined,
    url: data.url ? String(data.url).slice(0, 2000) : undefined,
    title: data.title ? String(data.title).slice(0, 300) : undefined,
    tabId: typeof data.tabId === 'number' ? data.tabId : undefined,
  };
  return chrome.storage.local.set({ [LAST_KEY]: clip }).then(function () { return clip; });
}

async function allTabs() {
  try {
    return await chrome.tabs.query({});
  } catch (e) {
    return [];
  }
}

async function targetTab() {
  var tabs = await allTabs();
  var usable = tabs.filter(function (t) {
    return t.id && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://') && !isAppUrl(t.url);
  });
  var focused = usable.filter(function (t) { return t.active && t.lastAccessed; });
  focused.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
  if (focused[0]) return focused[0];
  var active = usable.filter(function (t) { return t.active; });
  if (active[0]) return active[0];
  usable.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
  return usable[0] || null;
}

function sendToTab(tabId, action, payload) {
  return new Promise(function (resolve) {
    try {
      chrome.tabs.sendMessage(tabId, {
        type: 'mendcraft-ext-tab',
        v: 1,
        action: action,
        payload: payload || {},
      }, function (response) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: 'no-content-script' });
          return;
        }
        resolve(response && typeof response === 'object' ? response : { ok: false, error: 'empty-response' });
      });
    } catch (e) {
      resolve({ ok: false, error: 'send-failed' });
    }
  });
}

function findTabByQuery(query, tabs) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  var scored = [];
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    if (!t.id || !t.url || t.url.startsWith('chrome://')) continue;
    var title = (t.title || '').toLowerCase();
    var url = (t.url || '').toLowerCase();
    var score = 0;
    if (title === q) score = 5;
    else if (title.indexOf(q) !== -1) score = 4;
    else if (url.indexOf(q) !== -1) score = 3;
    if (score) scored.push({ score: score, tab: t, accessed: t.lastAccessed || 0 });
  }
  scored.sort(function (a, b) { return b.score - a.score || b.accessed - a.accessed; });
  return scored[0] ? scored[0].tab : null;
}

async function handle(msg, sender) {
  var action = msg && msg.action;
  var requestId = msg && msg.requestId;
  var payload = (msg && msg.payload) || {};
  if (!action) return resultOf(requestId, 'getStatus', false, undefined, 'bad-request');

  if (action === 'getStatus') {
    return resultOf(requestId, action, true, { kind: 'text', title: 'connected' });
  }

  if (action === 'getLastCopied') {
    var last = await getLastCopied();
    if (!last) return resultOf(requestId, action, false, undefined, 'empty');
    return resultOf(requestId, action, true, last);
  }

  if (action === 'openTab') {
    var url = String(payload.url || '');
    if (!/^https?:\/\//i.test(url)) return resultOf(requestId, action, false, undefined, 'bad-url');
    try {
      var created = await chrome.tabs.create({ url: url, active: true });
      return resultOf(requestId, action, true, { kind: 'link', url: url, title: created.title || '', tabId: created.id });
    } catch (e) {
      return resultOf(requestId, action, false, undefined, 'open-failed');
    }
  }

  if (action === 'switchTab') {
    var tabs = await allTabs();
    var hit = findTabByQuery(payload.query, tabs);
    if (!hit) return resultOf(requestId, action, false, undefined, 'tab-not-found');
    try {
      await chrome.tabs.update(hit.id, { active: true });
      if (hit.windowId) await chrome.windows.update(hit.windowId, { focused: true });
      return resultOf(requestId, action, true, { kind: 'link', url: hit.url, title: hit.title || '', tabId: hit.id });
    } catch (e) {
      return resultOf(requestId, action, false, undefined, 'switch-failed');
    }
  }

  if (action === 'openRefs') {
    var url = String(payload.url || '');
    if (!url) {
      url = payload.engine === 'pinterest' ? pinterestSearchUrl(payload.query) : googleImagesUrl(payload.query);
    }
    if (!isAllowedRefsUrl(url) || !/^https?:\/\//i.test(url)) {
      return resultOf(requestId, action, false, undefined, 'bad-url');
    }
    var appTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : refsSession.appTabId;
    var appWindowId = sender && sender.tab && sender.tab.windowId ? sender.tab.windowId : refsSession.appWindowId;
    try {
      var created = await chrome.tabs.create({ url: url, active: true });
      refsSession = { tabId: created.id, appTabId: appTabId, appWindowId: appWindowId };
      // Give the content script a moment, then start badges. Retry if the
      // page is still on a consent interstitial.
      await sendToRefs('refsStart', { query: payload.query || '' }, 12);
      return resultOf(requestId, action, true, { kind: 'link', url: url, title: created.title || '', tabId: created.id });
    } catch (e) {
      return resultOf(requestId, action, false, undefined, 'open-failed');
    }
  }

  if (action === 'refsCommand') {
    if (!refsSession.tabId) return resultOf(requestId, action, false, undefined, 'no-refs-tab');
    try { await chrome.tabs.update(refsSession.tabId, { active: true }); } catch (e) { /* ok */ }
    var sent = await sendToRefs('refsCommand', payload, 4);
    if (!sent.ok) return resultOf(requestId, action, false, sent.data, sent.error || 'refs-failed');
    var data = sent.data || {};
    if (data.kind === 'image' && data.url && refsSession.appTabId) {
      // After a pick, bring Mendcraft back so she sees the card on the canvas.
      await focusTab(refsSession.appTabId);
    }
    return resultOf(requestId, action, true, data);
  }

  if (action === 'closeRefs') {
    var tid = refsSession.tabId;
    var app = refsSession.appTabId;
    refsSession = { tabId: null, appTabId: app, appWindowId: refsSession.appWindowId };
    if (tid) {
      try { await chrome.tabs.remove(tid); } catch (e) { /* already closed */ }
    }
    if (app) await focusTab(app);
    return resultOf(requestId, action, true, { kind: 'link', title: 'closed', tabId: app });
  }

  var tab = await targetTab();
  if (!tab || !tab.id) return resultOf(requestId, action, false, undefined, 'no-tab');

  if (action === 'copyThis' || action === 'copyLink') {
    var copied = await sendToTab(tab.id, action, payload);
    if (!copied.ok) return resultOf(requestId, action, false, undefined, copied.error || 'copy-failed');
    var stored = await setLastCopied(Object.assign({}, copied.data, { tabId: tab.id }));
    return resultOf(requestId, action, true, stored);
  }

  if (action === 'pasteHere') {
    var confirmed = payload.confirmed === true;
    var inspect = await sendToTab(tab.id, confirmed ? 'pasteHere' : 'inspectPaste', payload);
    if (!confirmed) {
      var skipped = inspect.data && inspect.data.skipped;
      if (skipped) return resultOf(requestId, action, false, inspect.data, skipped);
      if (!inspect.ok && inspect.error === 'no-field') {
        return resultOf(requestId, action, false, inspect.data, 'no-field');
      }
      // Tell Mendcraft to show the pinch-to-confirm card. Do not insert yet.
      return resultOf(requestId, action, true, Object.assign({ kind: 'text', title: tab.title || '' }, inspect.data || {}), 'needs-confirm');
    }
    var text = payload.text;
    if (!text) {
      var remembered = await getLastCopied();
      text = remembered && remembered.text ? remembered.text : '';
    }
    if (!text) return resultOf(requestId, action, false, undefined, 'empty');
    var pasted = await sendToTab(tab.id, 'pasteHere', { text: text, confirmed: true });
    if (!pasted.ok) return resultOf(requestId, action, false, pasted.data, pasted.error || 'paste-failed');
    return resultOf(requestId, action, true, Object.assign({}, pasted.data, { tabId: tab.id }));
  }

  return resultOf(requestId, action, false, undefined, 'unknown-action');
}

function onMessage(msg, sender, sendResponse) {
  if (!msg || msg.type !== 'mendcraft-ext' || msg.v !== 1) return;
  handle(msg, sender).then(function (res) { sendResponse(res); });
  return true;
}

chrome.runtime.onMessage.addListener(onMessage);
chrome.runtime.onMessageExternal.addListener(onMessage);

chrome.tabs.onRemoved.addListener(function (id) {
  if (refsSession.tabId === id) refsSession.tabId = null;
});

