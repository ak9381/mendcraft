// sim-main: which loads open the smart canvas. Native shells (iOS and
// Android) always do; on the web, /canvas, ?canvas=1 or canvas.html.
export function wantsCanvas(pathname: string, search: string, nativeShell: boolean): boolean {
  if (/\/canvas\.html$/.test(pathname)) return false; // already there
  if (nativeShell) return true;
  if (/^\/canvas\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('canvas') === '1';
}

export function canvasUrl(search: string): string {
  const p = new URLSearchParams(search);
  p.delete('canvas');
  const q = p.toString();
  return `/canvas.html${q ? `?${q}` : ''}`;
}
