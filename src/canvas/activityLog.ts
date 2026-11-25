// Live activity feed in the AI panel: AI turns plus hand events (dwell
// clicks, two-fist board grabs). Newest sits at the top; the list is capped
// so a long session cannot grow without bound.

export const ACTIVITY_LOG_CAP = 40;

export type ActivityKind = 'click' | 'grab' | 'ai' | 'spotify' | 'gesture' | 'note';

export interface ActivityEntry {
  kind: ActivityKind;
  text: string;
  at: number;
  target?: string | null;
}

export interface ActivityLog {
  push(entry: Omit<ActivityEntry, 'at'> & { at?: number }): ActivityEntry;
  list(): ActivityEntry[];
  clear(): void;
}

const KIND_LABEL: Record<ActivityKind, string> = {
  click: 'Click',
  grab: 'Grab',
  ai: 'AI',
  spotify: 'Spotify',
  gesture: 'Gesture',
  note: 'Note',
};

export function formatActivityLine(entry: ActivityEntry): string {
  if (entry.kind === 'click') {
    return entry.target ? `Click · ${entry.target}` : 'Click';
  }
  if (entry.kind === 'grab') return entry.target ? `Grab · ${entry.target}` : (entry.text || 'Grab');
  return entry.text || 'AI activity';
}

export function createActivityLog(list?: HTMLElement | null, cap = ACTIVITY_LOG_CAP): ActivityLog {
  const entries: ActivityEntry[] = [];

  function paint(): void {
    if (!list) return;
    list.innerHTML = entries.map((e) => {
      const label = KIND_LABEL[e.kind];
      const line = formatActivityLine(e);
      return `<li data-kind="${e.kind}"><span class="mc-ai-live-kind">${escapeHtml(label)}</span> ${escapeHtml(line)}</li>`;
    }).join('');
  }

  return {
    push(entry) {
      const next: ActivityEntry = { ...entry, at: entry.at ?? Date.now() };
      entries.unshift(next);
      if (entries.length > cap) entries.length = cap;
      paint();
      return next;
    },
    list: () => entries.slice(),
    clear() { entries.length = 0; paint(); },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ));
}

/** The AI activity drawer is not pinned open: it opens while a model works or
 *  a review waits, and folds away ~3 s after the turn ends. The engine bar
 *  keeps both engines visible in the meantime. */
export const AI_PANEL_ALWAYS_OPEN = false;
