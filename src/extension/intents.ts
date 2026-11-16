// Voice → Chrome-extension intent (pure, DOM-free). English phrases only;
// non-English commands reach here after the studio has translated them, or
// not at all. "Copy that / copy it" is left alone so UI-mode "duplicate this
// node" still works. "Paste" always goes through the pinch-confirm path.

export type ChromeIntent =
  | { type: 'copy-this' }
  | { type: 'copy-link' }
  | { type: 'send-to-canvas' }
  | { type: 'paste-here' }
  | { type: 'switch-tab'; query: string };

export type ExtAction = 'copyThis' | 'copyLink' | 'pasteHere' | 'switchTab' | 'openTab' | 'getStatus' | 'getLastCopied';

export interface ExtRequestPayload {
  query?: string;
  url?: string;
  text?: string;
  confirmed?: boolean;
}

function norm(utterance: string): string {
  return utterance.trim().toLowerCase().replace(/[.!?।]+$/u, '').replace(/\s+/g, ' ');
}

const COPY_LINK = /^(copy|grab|get)\s+(the\s+|this\s+)?(link|url|address|page\s+link)(\s+please)?$/;
const COPY_THIS = /^(copy|grab)\s+(this|the\s+text|the\s+page|the\s+selection|this\s+text|this\s+page|the\s+main\s+text)(\s+please)?$/;
const SEND_CANVAS = /^(send|add|put|drop)\s+(this|that|it|the\s+text|the\s+link)?\s*(to|on|onto)\s+(the\s+)?canvas$/;
const PASTE_HERE = /^(paste)(\s+(it|this|that))?(\s+here)?(\s+please)?$/;
const SWITCH_TO = /^(switch\s+to)\s+(.+)$/;
const GO_TAB = /^(go\s+to|open|show)(\s+the)?\s+(.+)\s+tab$/;

export function parseChromeIntent(utterance: string): ChromeIntent | null {
  const t = norm(utterance);
  if (!t) return null;
  if (COPY_LINK.test(t)) return { type: 'copy-link' };
  if (COPY_THIS.test(t)) return { type: 'copy-this' };
  if (SEND_CANVAS.test(t)) return { type: 'send-to-canvas' };
  if (PASTE_HERE.test(t)) return { type: 'paste-here' };
  const sw = t.match(SWITCH_TO) || t.match(GO_TAB);
  if (sw) {
    let query = (sw[2] && sw[0].startsWith('switch') ? sw[2] : sw[sw.length - 1]).trim();
    query = query.replace(/\s+tab$/, '').trim();
    query = query.replace(/^(the|a|my)\s+/, '').trim();
    if (query && query !== 'canvas' && query !== 'tab') return { type: 'switch-tab', query };
  }
  return null;
}

/** Map a parsed intent onto the extension message (send-to-canvas is local). */
export function intentToRequest(intent: ChromeIntent): { action: ExtAction; payload?: ExtRequestPayload } | { action: 'sendToCanvas' } {
  switch (intent.type) {
    case 'copy-this': return { action: 'copyThis' };
    case 'copy-link': return { action: 'copyLink' };
    case 'paste-here': return { action: 'pasteHere', payload: { confirmed: false } };
    case 'switch-tab': return { action: 'switchTab', payload: { query: intent.query } };
    case 'send-to-canvas': return { action: 'sendToCanvas' };
  }
}
