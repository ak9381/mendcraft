import { describe, expect, it } from 'vitest';
import { buildUiTemplate } from '../src/ui/design/templates';
import { toHtml, toSvg } from '../src/ui/design/export';
import type { Frame } from '../src/ui/design/doc';

function loginFrame(): Frame {
  return buildUiTemplate('login', 'mobile')!;
}

describe('HTML export', () => {
  const html = toHtml(loginFrame());

  it('is a complete single-file document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('font-family:');
  });

  it('uses semantic tags: h1, p, button, input, label', () => {
    expect(html).toContain('<h1');
    expect(html).toContain('<p');
    expect(html).toContain('<button type="button"');
    expect(html).toContain('<input id="input-email" type="email"');
    expect(html).toContain('<label for="input-email"');
  });

  it('lays out with flexbox and carries the heading text', () => {
    expect(html).toContain('display:flex');
    expect(html).toContain('flex-direction:column');
    expect(html).toContain('Welcome back');
    expect(html).toContain('Sign in');
  });

  it('escapes user text', () => {
    const frame = buildUiTemplate('login')!;
    // Inject a hostile heading (nested in the login card) and ensure it is escaped.
    const card = frame.root.children[0];
    if (card.type === 'stack') card.children[0] = { ...(card.children[0] as never), text: '<script>x</script>' } as never;
    const out = toHtml(frame);
    expect(out).not.toContain('<script>x</script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders a landing hero with an image placeholder (alt text)', () => {
    const out = toHtml(buildUiTemplate('landing')!);
    expect(out).toContain('<img alt="Image placeholder"');
  });

  it('the login card exports a fixed max-width so the preview matches the export', () => {
    const out = toHtml(buildUiTemplate('login')!);
    expect(out).toContain('width:400px');
    expect(out).toContain('max-width:100%');
  });
});

describe('SVG export', () => {
  const svg = toSvg(loginFrame());

  it('is a well-formed SVG sized to the frame', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="390" height="844"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('emits rects for the button and text for the heading', () => {
    expect(svg).toContain('<rect');
    expect(svg).toContain('<text');
    expect(svg).toContain('Welcome back');
    expect(svg).toContain('Sign in');
  });
});
