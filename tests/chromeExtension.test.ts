import { describe, expect, it } from 'vitest';
import { intentToRequest, parseChromeIntent } from '../src/extension/intents';
import { canPaste, maySubmitForm, sensitiveFieldReason, type FieldInfo } from '../src/extension/fieldGuard';
import { parseExtHello, parseExtResult } from '../src/extension/protocol';
import { createExtensionBridge, type BridgeWindow } from '../src/extension/bridge';
import { describeConfirm, initialConfirm, reduceConfirm, trimPreview } from '../src/extension/confirm';
import { addClip, emptyClips } from '../src/extension/clips';

describe('chrome intent mapping', () => {
  it('maps copy this / the page / the selection, but not "copy that" (design duplicate)', () => {
    expect(parseChromeIntent('copy this')).toEqual({ type: 'copy-this' });
    expect(parseChromeIntent('Copy this.')).toEqual({ type: 'copy-this' });
    expect(parseChromeIntent('copy the page')).toEqual({ type: 'copy-this' });
    expect(parseChromeIntent('copy the text')).toEqual({ type: 'copy-this' });
    expect(parseChromeIntent('copy the selection')).toEqual({ type: 'copy-this' });
    expect(parseChromeIntent('copy that')).toBeNull();
    expect(parseChromeIntent('copy it')).toBeNull();
  });

  it('maps copy the link / url', () => {
    expect(parseChromeIntent('copy the link')).toEqual({ type: 'copy-link' });
    expect(parseChromeIntent('copy the url')).toEqual({ type: 'copy-link' });
    expect(parseChromeIntent('copy this link')).toEqual({ type: 'copy-link' });
    expect(parseChromeIntent('get the address')).toEqual({ type: 'copy-link' });
  });

  it('maps send to canvas and paste here', () => {
    expect(parseChromeIntent('send to canvas')).toEqual({ type: 'send-to-canvas' });
    expect(parseChromeIntent('send this to the canvas')).toEqual({ type: 'send-to-canvas' });
    expect(parseChromeIntent('add that to the canvas')).toEqual({ type: 'send-to-canvas' });
    expect(parseChromeIntent('paste here')).toEqual({ type: 'paste-here' });
    expect(parseChromeIntent('paste')).toEqual({ type: 'paste-here' });
    expect(parseChromeIntent('paste it here please')).toEqual({ type: 'paste-here' });
  });

  it('maps tab switching by name, but does not steal "open setup"', () => {
    expect(parseChromeIntent('switch to Gmail')).toEqual({ type: 'switch-tab', query: 'gmail' });
    expect(parseChromeIntent('go to the LinkedIn tab')).toEqual({ type: 'switch-tab', query: 'linkedin' });
    expect(parseChromeIntent('open the news tab')).toEqual({ type: 'switch-tab', query: 'news' });
    expect(parseChromeIntent('show the WhatsApp tab')).toEqual({ type: 'switch-tab', query: 'whatsapp' });
    expect(parseChromeIntent('open setup')).toBeNull();
    expect(parseChromeIntent('open the palette')).toBeNull();
  });

  it('intentToRequest routes each intent onto an extension action or a local canvas add', () => {
    expect(intentToRequest({ type: 'copy-this' })).toEqual({ action: 'copyThis' });
    expect(intentToRequest({ type: 'copy-link' })).toEqual({ action: 'copyLink' });
    expect(intentToRequest({ type: 'paste-here' })).toEqual({ action: 'pasteHere', payload: { confirmed: false } });
    expect(intentToRequest({ type: 'switch-tab', query: 'gmail' })).toEqual({ action: 'switchTab', payload: { query: 'gmail' } });
    expect(intentToRequest({ type: 'send-to-canvas' })).toEqual({ action: 'sendToCanvas' });
  });
});

describe('password and payment field guard', () => {
  const text: FieldInfo = { tag: 'input', type: 'text', name: 'q', autocomplete: 'off' };
  const email: FieldInfo = { tag: 'input', type: 'email', name: 'email', autocomplete: 'email' };

  it('allows ordinary text, search and email fields (after confirm)', () => {
    expect(sensitiveFieldReason(text)).toBeNull();
    expect(sensitiveFieldReason({ tag: 'input', type: 'search', name: 'q' })).toBeNull();
    expect(sensitiveFieldReason(email)).toBeNull();
    expect(canPaste({ confirmed: true, field: text })).toEqual({ ok: true });
  });

  it('blocks password type and password autocomplete / names even after confirm', () => {
    expect(sensitiveFieldReason({ tag: 'input', type: 'password', name: 'pw' })).toBe('password');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', autocomplete: 'current-password' })).toBe('password');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', autocomplete: 'new-password' })).toBe('password');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', name: 'password' })).toBe('password');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', id: 'passwd' })).toBe('password');
    expect(canPaste({ confirmed: true, field: { tag: 'input', type: 'password' } })).toEqual({ ok: false, reason: 'password' });
  });

  it('blocks payment autocomplete and card-number / CVC labels', () => {
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', autocomplete: 'cc-number' })).toBe('payment');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', autocomplete: 'cc-csc' })).toBe('payment');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', autocomplete: 'cc-exp-year' })).toBe('payment');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', name: 'cardNumber' })).toBe('payment');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', ariaLabel: 'CVV' })).toBe('payment');
    expect(sensitiveFieldReason({ tag: 'input', type: 'text', label: 'Credit card number' })).toBe('payment');
    expect(canPaste({ confirmed: true, field: { tag: 'input', autocomplete: 'cc-number' } })).toEqual({ ok: false, reason: 'payment' });
  });

  it('refuses paste without a field or without an explicit confirm', () => {
    expect(canPaste({ confirmed: false, field: text })).toEqual({ ok: false, reason: 'needs-confirm' });
    expect(canPaste({ confirmed: true, field: null })).toEqual({ ok: false, reason: 'no-field' });
  });

  it('never authorises a form submit', () => {
    expect(maySubmitForm()).toBe(false);
  });
});

describe('extension bridge: replies are data only', () => {
  const good = {
    type: 'mendcraft-ext-result',
    v: 1,
    requestId: 'mcx-1',
    ok: true,
    action: 'copyThis',
    data: { kind: 'text', text: 'Hello from the page', url: 'https://example.com/', title: 'Example' },
  };

  it('accepts a well-formed copy result and keeps only known fields', () => {
    expect(parseExtResult(good)).toEqual(good);
  });

  it('accepts an image pick from a references tab and allows openRefs / refsCommand / closeRefs', () => {
    const image = {
      type: 'mendcraft-ext-result',
      v: 1,
      requestId: 'mcx-2',
      ok: true,
      action: 'refsCommand',
      data: { kind: 'image', url: 'https://cdn.example/cup.jpg', title: 'A cup', text: '' },
    };
    expect(parseExtResult(image)).toEqual(image);
    expect(parseExtResult({ ...good, action: 'openRefs' })?.action).toBe('openRefs');
    expect(parseExtResult({ ...good, action: 'closeRefs' })?.action).toBe('closeRefs');
    expect(parseExtResult({ ...image, data: { kind: 'image', url: () => 'nope' } })).toBeNull();
  });

  it('rejects functions, scripts, arrays, and missing fields — never evaluates the payload', () => {
    expect(parseExtResult('copyThis()')).toBeNull();
    expect(parseExtResult(null)).toBeNull();
    expect(parseExtResult(['copyThis'])).toBeNull();
    expect(parseExtResult({ ...good, data: { kind: 'text', text: () => 'nope' } })).toBeNull();
    expect(parseExtResult({ ...good, evil: () => 1 })).toBeNull();
    expect(parseExtResult({ ...good, data: { kind: 'widget' } })).toBeNull();
    expect(parseExtResult({ ...good, action: 'eval' })).toBeNull();
    expect(parseExtResult({ ...good, v: 2 })).toBeNull();
    expect(parseExtResult({ ...good, type: 'mendcraft-ext' })).toBeNull();
  });

  it('accepts a hello only when the extension id looks like a Chrome id', () => {
    const id = 'abcdefghijklmnopqrstuvwxyzabcdef';
    expect(parseExtHello({ source: 'mendcraft-extension', type: 'mendcraft-ext-hello', v: 1, extensionId: id })).toEqual({ extensionId: id });
    expect(parseExtHello({ source: 'mendcraft-extension', type: 'mendcraft-ext-hello', v: 1, extensionId: 'short' })).toBeNull();
    expect(parseExtHello({ source: 'other', type: 'mendcraft-ext-hello', v: 1, extensionId: id })).toBeNull();
  });

  it('createExtensionBridge stays disconnected until a valid hello, then sendMessage replies are parsed as data', async () => {
    const id = 'abcdefghijklmnopqrstuvwxyzabcdef';
    const listeners = new Set<(ev: MessageEvent) => void>();
    const sent: unknown[] = [];
    const win: BridgeWindow = {
      location: { origin: 'https://mendcraft.web.app' },
      chrome: {
        runtime: {
          sendMessage(extensionId, message, cb) {
            sent.push({ extensionId, message });
            cb({
              type: 'mendcraft-ext-result',
              v: 1,
              requestId: (message as { requestId: string }).requestId,
              ok: true,
              action: 'copyThis',
              data: { kind: 'text', text: 'clipped', url: 'https://example.com/' },
            });
          },
        },
      },
      addEventListener(_type, fn) { listeners.add(fn); },
      removeEventListener(_type, fn) { listeners.delete(fn); },
      postMessage() { /* ping */ },
    };
    const bridge = createExtensionBridge(win);
    bridge.start();
    expect(bridge.isConnected()).toBe(false);
    expect((await bridge.request('copyThis')).error).toBe('not-connected');

    listeners.forEach((fn) => fn({ origin: 'https://mendcraft.web.app', data: { source: 'mendcraft-extension', type: 'mendcraft-ext-hello', v: 1, extensionId: id } } as MessageEvent));
    expect(bridge.isConnected()).toBe(true);
    expect(bridge.status()).toBe('connected');

    const res = await bridge.request('copyThis');
    expect(res.ok).toBe(true);
    expect(res.data?.text).toBe('clipped');
    expect(bridge.lastCopied()?.text).toBe('clipped');
    expect(sent).toHaveLength(1);
    expect((sent[0] as { extensionId: string }).extensionId).toBe(id);
    bridge.stop();
  });
});

describe('pinch-to-confirm card', () => {
  const req = { kind: 'paste' as const, preview: 'Please call me about the ramp.', fieldLabel: 'Message', tabTitle: 'Demo form' };

  it('does not paste until an explicit pinch or button confirm', () => {
    let s = initialConfirm();
    let step = reduceConfirm(s, { type: 'stage', request: req });
    expect(step.state.phase).toBe('pending');
    expect(step.performPaste).toBe(false);
    expect(describeConfirm(step.state.request!)).toMatch(/Pinch or press Confirm/);
    expect(describeConfirm(step.state.request!)).toMatch(/Message on Demo form|into Message/);

    step = reduceConfirm(step.state, { type: 'timer' });
    expect(step.performPaste).toBe(false);
    expect(step.state.phase).toBe('pending');
    step = reduceConfirm(step.state, { type: 'field-filled' });
    expect(step.performPaste).toBe(false);

    step = reduceConfirm(step.state, { type: 'confirm', source: 'pinch' });
    expect(step.performPaste).toBe(true);
    expect(step.performSubmit).toBe(false);
    expect(step.state.phase).toBe('confirmed');
  });

  it('never sets performSubmit, even if a submit request is confirmed', () => {
    const step = reduceConfirm(initialConfirm(), { type: 'stage', request: { kind: 'submit', preview: 'Send message' } });
    const done = reduceConfirm(step.state, { type: 'confirm', source: 'button' });
    expect(done.performSubmit).toBe(false);
    expect(done.performPaste).toBe(false);
  });

  it('cancel clears the card; trimPreview shortens long text', () => {
    const staged = reduceConfirm(initialConfirm(), { type: 'stage', request: req });
    const cancelled = reduceConfirm(staged.state, { type: 'cancel' });
    expect(cancelled.state.phase).toBe('idle');
    expect(cancelled.performPaste).toBe(false);
    expect(trimPreview('x'.repeat(100), 20).endsWith('…')).toBe(true);
    expect(trimPreview('short')).toBe('short');
  });
});

describe('canvas clips', () => {
  it('adds a text or link node and ignores an empty payload', () => {
    const text = addClip(emptyClips(), { kind: 'text', text: 'Hello', now: 1, id: 'c1' });
    expect(text.clip?.kind).toBe('text');
    expect(text.state.clips).toHaveLength(1);
    const link = addClip(text.state, { kind: 'link', url: 'https://example.com/', title: 'Example', now: 2, id: 'c2' });
    expect(link.clip?.kind).toBe('link');
    expect(link.state.clips).toHaveLength(2);
    expect(addClip(emptyClips(), { text: '  ', url: '' }).clip).toBeNull();
  });
});
