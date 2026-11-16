// Runs in http(s) tabs. Handles copy (selection or main text), link, and
// confirmed paste. Password and payment fields are skipped. Forms are never
// submitted. Keep the field-guard rules in sync with src/extension/fieldGuard.ts.
(function () {
  'use strict';

  var PASSWORD_AUTOCOMPLETE = {
    'password': 1, 'current-password': 1, 'new-password': 1, 'one-time-code': 1,
  };
  var PAYMENT_AUTOCOMPLETE = {
    'cc-name': 1, 'cc-given-name': 1, 'cc-additional-name': 1, 'cc-family-name': 1,
    'cc-number': 1, 'cc-exp': 1, 'cc-exp-month': 1, 'cc-exp-year': 1, 'cc-csc': 1,
    'cc-type': 1, 'transaction-currency': 1, 'transaction-amount': 1,
  };
  var PASSWORD_RE = /\b(pass(word|wd|code)?|passwd|secret|pin)\b/i;
  var PAYMENT_RE = /\b(card[-_\s]?number|credit[-_\s]?card|debit[-_\s]?card|cc[-_\s]?num(ber)?|card[-_\s]?no|cvc|cvv2?|cid|csc|card[-_\s]?verif|expir(y|ation)|exp[-_\s]?(month|year|date)|iban|routing[-_\s]?number|account[-_\s]?number)\b/i;

  function fieldInfo(el) {
    if (!el || !el.tagName) return null;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable) return null;
    var ac = (el.getAttribute && el.getAttribute('autocomplete')) || el.autocomplete || '';
    var id = el.id || '';
    var label = '';
    if (id) {
      var lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (lab) label = (lab.innerText || lab.textContent || '').trim();
    }
    return {
      tag: tag,
      type: (el.type || '').toLowerCase(),
      name: el.name || '',
      id: id,
      autocomplete: ac,
      inputMode: el.inputMode || '',
      ariaLabel: (el.getAttribute && el.getAttribute('aria-label')) || '',
      placeholder: el.placeholder || '',
      label: label,
      contentEditable: !!el.isContentEditable,
    };
  }

  function autocompleteTokens(value) {
    if (!value) return [];
    return String(value).toLowerCase().split(/\s+/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function sensitiveFieldReason(field) {
    if (!field) return null;
    if ((field.type || '').toLowerCase() === 'password') return 'password';
    var ac = autocompleteTokens(field.autocomplete);
    var i;
    for (i = 0; i < ac.length; i++) {
      if (PASSWORD_AUTOCOMPLETE[ac[i]]) return 'password';
      if (PAYMENT_AUTOCOMPLETE[ac[i]] || ac[i].indexOf('cc-') === 0) return 'payment';
    }
    var blob = [field.name, field.id, field.ariaLabel, field.placeholder, field.label, field.autocomplete].join(' ');
    if (PASSWORD_RE.test(blob)) return 'password';
    if (PAYMENT_RE.test(blob)) return 'payment';
    return null;
  }

  function extractMainText(doc) {
    var sel = '';
    try { sel = String(doc.getSelection && doc.getSelection() ? doc.getSelection().toString() : '').trim(); } catch (e) { sel = ''; }
    if (sel) return sel.slice(0, 20000);
    var root = doc.querySelector('article, main, [role="main"]') || doc.body;
    if (!root) return (doc.title || '').trim();
    var clone = root.cloneNode(true);
    var junk = clone.querySelectorAll('nav, footer, aside, script, style, noscript, iframe, form, [role="navigation"], [role="banner"], [role="contentinfo"]');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    var text = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return text.slice(0, 20000);
  }

  function copyThis() {
    var text = extractMainText(document);
    return {
      ok: !!text,
      data: { kind: 'text', text: text, url: location.href, title: document.title || '' },
      error: text ? undefined : 'no-text',
    };
  }

  function copyLink() {
    return {
      ok: true,
      data: { kind: 'link', text: location.href, url: location.href, title: document.title || '' },
    };
  }

  function inspectField() {
    var el = document.activeElement;
    var info = fieldInfo(el);
    if (!info) return { ok: false, error: 'no-field', data: { kind: 'text' } };
    var skipped = sensitiveFieldReason(info);
    var label = info.label || info.ariaLabel || info.placeholder || info.name || info.id || info.tag;
    return {
      ok: !skipped,
      error: skipped || undefined,
      data: { kind: 'text', fieldLabel: label, skipped: skipped || undefined, title: document.title || '', url: location.href },
    };
  }

  function insertText(el, text) {
    el.focus();
    if (typeof el.setRangeText === 'function' && 'value' in el) {
      var start = el.selectionStart == null ? String(el.value || '').length : el.selectionStart;
      var end = el.selectionEnd == null ? String(el.value || '').length : el.selectionEnd;
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.isContentEditable) {
      try {
        document.execCommand('insertText', false, text);
        return true;
      } catch (e) {
        el.textContent = (el.textContent || '') + text;
        return true;
      }
    }
    return false;
  }

  function pasteHere(text, confirmed) {
    if (!confirmed) {
      var inspected = inspectField();
      inspected.error = inspected.error || 'needs-confirm';
      inspected.ok = false;
      return inspected;
    }
    var el = document.activeElement;
    var info = fieldInfo(el);
    if (!info) return { ok: false, error: 'no-field' };
    var skipped = sensitiveFieldReason(info);
    if (skipped) {
      return { ok: false, error: skipped, data: { kind: 'text', skipped: skipped, fieldLabel: info.label || info.name || '' } };
    }
    // Never submit. Just insert.
    var ok = insertText(el, text || '');
    return {
      ok: ok,
      error: ok ? undefined : 'insert-failed',
      data: { kind: 'text', fieldLabel: info.label || info.ariaLabel || info.name || '', title: document.title || '' },
    };
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || msg.type !== 'mendcraft-ext-tab' || msg.v !== 1) return;
    var action = msg.action;
    var payload = msg.payload || {};
    var out;
    if (action === 'copyThis') out = copyThis();
    else if (action === 'copyLink') out = copyLink();
    else if (action === 'inspectPaste') out = inspectField();
    else if (action === 'pasteHere') out = pasteHere(payload.text || '', payload.confirmed === true);
    else out = { ok: false, error: 'unknown-action' };
    sendResponse(out);
    return true;
  });
})();
