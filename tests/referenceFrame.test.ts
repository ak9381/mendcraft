import { describe, expect, it } from 'vitest';
import {
  FRAME_LOAD_TIMEOUT_MS,
  frameFallbackPolicy,
  hostBlocksFraming,
} from '../src/ui/frameHosts';

describe('reference panel: known frame-busting hosts', () => {
  it('shows the Open card immediately for LinkedIn, Google, Spotify, Instagram, Facebook, X, WhatsApp, and GitHub login', () => {
    const immediate = [
      'https://www.linkedin.com/in/someone',
      'https://linkedin.com/feed/',
      'https://www.google.com/search?q=mendcraft',
      'https://accounts.google.com/',
      'https://mail.google.com/',
      'https://www.google.co.uk/',
      'https://open.spotify.com/',
      'https://accounts.spotify.com/authorize',
      'https://www.instagram.com/',
      'https://www.facebook.com/login',
      'https://m.facebook.com/',
      'https://fb.com/',
      'https://x.com/home',
      'https://twitter.com/intent/tweet',
      'https://web.whatsapp.com/',
      'https://www.whatsapp.com/',
      'https://github.com/login',
      'https://github.com/login?return_to=https://github.com/ak9381/mendcraft',
      'https://github.com/session',
    ];
    for (const url of immediate) {
      expect(hostBlocksFraming(url), url).toBe(true);
      expect(frameFallbackPolicy(url), url).toBe('immediate');
    }
  });

  it('waits for a load event (then ~4s) on ordinary sites, including GitHub repo pages', () => {
    const wait = [
      'https://developer.mozilla.org/en-US/docs/Web/HTML',
      'https://example.com/',
      'https://mendcraft.web.app/studio',
      'https://github.com/ak9381/mendcraft',
      'https://duckduckgo.com/?q=handrail',
    ];
    for (const url of wait) {
      expect(hostBlocksFraming(url), url).toBe(false);
      expect(frameFallbackPolicy(url), url).toBe('wait-load');
    }
    expect(FRAME_LOAD_TIMEOUT_MS).toBe(4000);
  });

  it('does not treat notgoogle.com or a similar lookalike as Google', () => {
    expect(hostBlocksFraming('https://notgoogle.com/')).toBe(false);
    expect(hostBlocksFraming('https://linkedin.example.com/')).toBe(false);
  });
});
