import { describe, expect, it, vi } from 'vitest';
import {
  mountConnectSheet,
  showPairing,
  formatPairingCode,
  sanitizeDeviceName,
  buildPairingCard,
  connectSheetOptions,
  type ConnectSheetCallbacks,
} from '../../src/canvas/connectSheet';

// Simple lightweight mock element for node env
function createMockElement(tagName = 'div'): any {
  const listeners: Record<string, Function[]> = {};
  const children: any[] = [];
  const attributes: Record<string, string> = {};

  const el = {
    tagName: tagName.toUpperCase(),
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    value: '',
    children,
    attributes,
    setAttribute(name: string, val: string) {
      attributes[name] = val;
    },
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
    addEventListener(event: string, handler: Function) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    dispatchEvent(eventObj: { type: string; preventDefault?: () => void }) {
      const handlers = listeners[eventObj.type] || [];
      handlers.forEach((h) => h(eventObj));
    },
    appendChild(child: any) {
      children.push(child);
      return child;
    },
    append(...newChildren: any[]) {
      children.push(...newChildren);
    },
    querySelector(selector: string): any {
      if (selector === '.mc-connect-point' || selector.includes('point')) {
        return createMockElement('button');
      }
      if (selector === '.mc-connect-phone' || selector.includes('phone')) {
        return createMockElement('button');
      }
      if (selector === '.mc-connect-name-form' || selector.includes('form')) {
        return createMockElement('form');
      }
      if (selector === '.mc-connect-input' || selector.includes('input')) {
        return createMockElement('input');
      }
      if (selector.includes('status')) {
        return createMockElement('p');
      }
      if (selector.includes('note')) {
        return createMockElement('p');
      }
      return createMockElement('div');
    },
    querySelectorAll(selector: string): any[] {
      return [this.querySelector(selector)];
    },
  };
  return el;
}

describe('connectSheet', () => {
  describe('pure helpers', () => {
    it('formatPairingCode formats 8-character code as ABCD-1234', () => {
      expect(formatPairingCode('ABCD1234')).toBe('ABCD-1234');
      expect(formatPairingCode('abcd1234')).toBe('ABCD-1234');
      expect(formatPairingCode('ABCD-1234')).toBe('ABCD-1234');
    });

    it('sanitizeDeviceName cleans whitespace and punctuation', () => {
      expect(sanitizeDeviceName('  Living Room Lamp!  ')).toBe('Living Room Lamp');
      expect(sanitizeDeviceName('<script>alert()</script>speaker')).toBe('alert()speaker');
    });

    it('buildPairingCard constructs structured card object', () => {
      const card = buildPairingCard({
        code: '12345678',
        qrDataUrl: 'data:image/png;base64,...',
        note: 'Scan or type',
      });
      expect(card.code).toBe('1234-5678');
      expect(card.qrDataUrl).toBe('data:image/png;base64,...');
      expect(card.note).toBe('Scan or type');
    });

    it('connectSheetOptions provides the three big options', () => {
      const opts = connectSheetOptions();
      expect(opts).toHaveLength(3);
      expect(opts.map((o) => o.id)).toEqual(['point', 'name', 'phone']);
      expect(opts[0].label).toBe('Point at it');
      expect(opts[1].label).toBe('Say its name');
      expect(opts[2].label).toBe('Join a phone');
    });
  });

  describe('mountConnectSheet DOM module', () => {
    it('mounts into host and exposes controls', () => {
      const host = createMockElement('div');
      const callbacks: ConnectSheetCallbacks = {
        onPoint: vi.fn(),
        onName: vi.fn(),
        onJoinPhone: vi.fn(),
      };

      const sheet = mountConnectSheet(host, callbacks);
      expect(sheet).toBeDefined();
      expect(typeof sheet.setStatus).toBe('function');
      expect(typeof sheet.unmount).toBe('function');
      expect(host.innerHTML).toContain('Point at it');
      expect(host.innerHTML).toContain('Say its name');
      expect(host.innerHTML).toContain('Join a phone');
    });

    it('showPairing renders pairing info into host', () => {
      const host = createMockElement('div');
      const pairing = showPairing(host, {
        code: 'WXYZ-5678',
        qrDataUrl: 'data:image/png;base64,mockqr',
        note: 'Relay active',
      });

      expect(pairing).toBeDefined();
      expect(typeof pairing.setStatus).toBe('function');
      expect(typeof pairing.setNote).toBe('function');
      expect(host.innerHTML).toContain('WXYZ-5678');
      expect(host.innerHTML).toContain('data:image/png;base64,mockqr');
      expect(host.innerHTML).toContain('Relay active');
    });

    it('marks point, name (form with input + Go) and phone with stable data-connect selectors', () => {
      const host = createMockElement('div');
      mountConnectSheet(host, {});
      expect(host.innerHTML).toContain('data-connect="point"');
      expect(host.innerHTML).toContain('data-connect="name"');
      expect(host.innerHTML).toContain('data-connect="phone"');
    });
  });
});
