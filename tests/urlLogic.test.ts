import { describe, it, expect } from 'vitest';
import { normalizeUrl, looksLikeUrl, hostLabel } from '../src/input/urlLogic';

describe('looksLikeUrl', () => {
  it('accepts hosts and full URLs', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('https://example.com/x')).toBe(true);
    expect(looksLikeUrl('sub.example.co.uk/path')).toBe(true);
    expect(looksLikeUrl('localhost:3000/x')).toBe(false); // no dot → treated as search
  });

  it('rejects search-like text', () => {
    expect(looksLikeUrl('how to frame an iframe')).toBe(false);
    expect(looksLikeUrl('single')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('prefixes https on bare hosts', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
  });

  it('keeps an explicit scheme', () => {
    expect(normalizeUrl('http://example.com/a')).toBe('http://example.com/a');
  });

  it('trims whitespace', () => {
    expect(normalizeUrl('  example.org/x  ')).toBe('https://example.org/x');
  });

  it('turns free text into a search URL', () => {
    const u = normalizeUrl('mediapipe hands');
    expect(u).toContain('duckduckgo.com');
    expect(u).toContain('mediapipe%20hands');
  });

  it('returns null for empty input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });
});

describe('hostLabel', () => {
  it('extracts the host', () => {
    expect(hostLabel('https://example.com/a/b')).toBe('example.com');
  });
  it('falls back to the raw string', () => {
    expect(hostLabel('not a url')).toBe('not a url');
  });
});
