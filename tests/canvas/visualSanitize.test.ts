import { describe, expect, it } from 'vitest';
import { sanitizeVisualMarkup } from '../../src/canvas/visualSanitize';

describe('sanitizeVisualMarkup — threat vectors', () => {
  it('strips <script> tags and their content entirely', () => {
    const r = sanitizeVisualMarkup('<svg><script>alert(1)</script><rect width="10" height="10"/></svg>');
    expect(r.html).not.toMatch(/script/i);
    expect(r.html).not.toMatch(/alert/);
    expect(r.html).toContain('<rect');
  });

  it('strips a script tag with an external src and no closing tag', () => {
    const r = sanitizeVisualMarkup('<svg><script src="https://evil.example/x.js"></script></svg>');
    expect(r.html).not.toMatch(/script/i);
    expect(r.html).not.toMatch(/evil\.example/);
  });

  it('strips onload/onclick and any on* handler, keeping the element', () => {
    const r = sanitizeVisualMarkup('<svg><rect onload="evil()" onclick="evil()" onmouseover="evil()" width="10" height="10"/></svg>');
    expect(r.html).toContain('<rect');
    expect(r.html).not.toMatch(/on\w+\s*=/i);
    expect(r.html).not.toMatch(/evil/);
  });

  it('strips javascript: hrefs', () => {
    const r = sanitizeVisualMarkup('<svg><use href="javascript:evil()" /></svg>');
    expect(r.html).not.toMatch(/javascript:/i);
  });

  it('strips data: URLs that execute', () => {
    const r = sanitizeVisualMarkup('<svg><use href="data:text/html,<script>evil()</script>" /></svg>');
    expect(r.html).not.toMatch(/data:/i);
    expect(r.html).not.toMatch(/script/i);
  });

  it('strips <iframe> entirely', () => {
    const r = sanitizeVisualMarkup('<div><iframe src="https://evil.example"></iframe><span>ok</span></div>');
    expect(r.html).not.toMatch(/iframe/i);
    expect(r.html).toContain('<span');
  });

  it('strips <foreignObject> and its content', () => {
    const r = sanitizeVisualMarkup('<svg><foreignObject><div onclick="evil()">hi</div></foreignObject><circle r="5"/></svg>');
    expect(r.html).not.toMatch(/foreignobject/i);
    expect(r.html).not.toMatch(/onclick/i);
    expect(r.html).toContain('<circle');
  });

  it('strips <object>, <embed>, <link>, <meta>, <base>', () => {
    const r = sanitizeVisualMarkup(
      '<div><object data="x"></object><embed src="x"/><link rel="stylesheet" href="https://evil.example/x.css"/><meta http-equiv="refresh" content="0;url=https://evil.example"/><base href="https://evil.example/"/><span>ok</span></div>',
    );
    expect(r.html).not.toMatch(/object|embed|link|meta|base/i);
    expect(r.html).toContain('<span');
  });

  it('strips an external <use href> but keeps a local fragment <use href="#id">', () => {
    const external = sanitizeVisualMarkup('<svg><use href="https://evil.example/sprite.svg#icon" /></svg>');
    expect(external.html).not.toMatch(/evil\.example/);
    const local = sanitizeVisualMarkup('<svg><defs><symbol id="bulb"></symbol></defs><use href="#bulb" /></svg>');
    expect(local.html).toContain('href="#bulb"');
  });

  it('drops <img> entirely (no external image loads survive)', () => {
    const r = sanitizeVisualMarkup('<div><img src="http://evil.example/track.png"/><span>ok</span></div>');
    expect(r.html).not.toMatch(/img/i);
    expect(r.html).not.toMatch(/evil\.example/);
    expect(r.html).toContain('<span');
  });

  it('drops a style attribute carrying a url(...) background exfil attempt', () => {
    const r = sanitizeVisualMarkup('<svg><rect style="fill:red;background:url(https://evil.example/x)" width="1" height="1"/></svg>');
    expect(r.html).not.toMatch(/url\(/i);
    expect(r.html).not.toMatch(/evil\.example/);
  });

  it('keeps ordinary inline SVG shapes, text and presentation attributes', () => {
    const r = sanitizeVisualMarkup('<svg viewBox="0 0 100 100"><g><rect x="0" y="0" width="40" height="20" fill="#6B8F71"/><text x="5" y="15">Living room</text></g></svg>');
    expect(r.html).toContain('<svg');
    expect(r.html).toContain('viewBox="0 0 100 100"');
    expect(r.html).toContain('<rect');
    expect(r.html).toContain('fill="#6B8F71"');
    expect(r.html).toContain('Living room');
  });

  it('promotes a data-action element to a real hand-reachable button-like node', () => {
    const r = sanitizeVisualMarkup('<svg><rect data-action="toggle-lamp" data-label="Toggle the desk lamp" width="10" height="10"/></svg>');
    expect(r.html).toMatch(/role="button"/);
    expect(r.html).toMatch(/tabindex="0"/);
    expect(r.html).toMatch(/aria-label="Toggle the desk lamp"/);
    expect(r.html).toMatch(/data-action="toggle-lamp"/);
  });

  it('fills a reasonable aria-label from data-action when data-label is missing', () => {
    const r = sanitizeVisualMarkup('<svg><rect data-action="toggle-lamp" width="10" height="10"/></svg>');
    expect(r.html).toMatch(/aria-label="[^"]*[Tt]oggle[^"]*[Ll]amp[^"]*"/);
  });

  it('does not touch an existing explicit role/aria-label on a data-action element', () => {
    const r = sanitizeVisualMarkup('<svg><g data-action="scene" role="button" aria-label="Activate evening scene" tabindex="0"><rect width="1" height="1"/></g></svg>');
    expect(r.html).toMatch(/aria-label="Activate evening scene"/);
    expect((r.html.match(/role="button"/g) ?? []).length).toBe(1);
  });

  it('drops an unknown/unlisted tag but keeps safe siblings', () => {
    const r = sanitizeVisualMarkup('<svg><bogus-widget>x</bogus-widget><circle r="3"/></svg>');
    expect(r.html).not.toMatch(/bogus-widget/i);
    expect(r.html).toContain('<circle');
  });

  it('is a pure function: same input always gives the same output', () => {
    const input = '<svg><rect data-action="a" width="1" height="1"/></svg>';
    expect(sanitizeVisualMarkup(input)).toEqual(sanitizeVisualMarkup(input));
  });

  it('handles empty / non-string input without throwing', () => {
    expect(sanitizeVisualMarkup('').html).toBe('');
    // @ts-expect-error - defensive runtime check
    expect(sanitizeVisualMarkup(null).html).toBe('');
  });
});
