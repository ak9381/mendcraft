// C041/C042: Back / Forward for the reference panel. The page inside is
// cross-origin, so its own history can't be driven from here — this stack
// remembers the addresses the panel itself opened, like a browser's.

export interface NavStack {
  visit(url: string): void;
  back(): string | null;
  forward(): string | null;
  canBack(): boolean;
  canForward(): boolean;
  current(): string | null;
}

export function createNavStack(cap = 50): NavStack {
  let urls: string[] = [];
  let i = -1;
  return {
    visit(url) {
      if (urls[i] === url) return;
      urls = urls.slice(0, i + 1);
      urls.push(url);
      if (urls.length > cap) urls = urls.slice(urls.length - cap);
      i = urls.length - 1;
    },
    back() { if (i <= 0) return null; i--; return urls[i]; },
    forward() { if (i >= urls.length - 1) return null; i++; return urls[i]; },
    canBack: () => i > 0,
    canForward: () => i < urls.length - 1,
    current: () => urls[i] ?? null,
  };
}
