// Content script on Mendcraft origins only. Announces the extension to the
// page and relays typed messages to the service worker. Payloads are forwarded
// as data — this file never evaluates them.
(function () {
  'use strict';
  var SOURCE = 'mendcraft-extension';
  var PAGE = 'mendcraft-page';
  var origin = window.location.origin;

  function hello() {
    window.postMessage({
      source: SOURCE,
      type: 'mendcraft-ext-hello',
      v: 1,
      extensionId: chrome.runtime.id,
    }, origin);
  }

  hello();

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.source !== PAGE) return;
    if (data.type === 'mendcraft-ext-ping') {
      hello();
      return;
    }
    if (data.type !== 'mendcraft-ext' || data.v !== 1) return;
    if (typeof data.requestId !== 'string' || typeof data.action !== 'string') return;
    // Forward the already-typed request. Do not eval.
    try {
      chrome.runtime.sendMessage(data, function (response) {
        var err = chrome.runtime.lastError;
        var result = err
          ? { type: 'mendcraft-ext-result', v: 1, requestId: data.requestId, ok: false, action: data.action, error: 'extension-unavailable' }
          : (response && typeof response === 'object'
            ? response
            : { type: 'mendcraft-ext-result', v: 1, requestId: data.requestId, ok: false, action: data.action, error: 'empty-response' });
        if (result.type !== 'mendcraft-ext-result') {
          result = { type: 'mendcraft-ext-result', v: 1, requestId: data.requestId, ok: false, action: data.action, error: 'invalid-response' };
        }
        window.postMessage(result, origin);
      });
    } catch (e) {
      window.postMessage({
        type: 'mendcraft-ext-result',
        v: 1,
        requestId: data.requestId,
        ok: false,
        action: data.action,
        error: 'send-failed',
      }, origin);
    }
  });
})();
