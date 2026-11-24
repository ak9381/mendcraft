// Ledger of bytes that left the device per AI turn.
// Local Nano turns report 0 bytes; cloud turns (e.g. Gemini) report the UTF-8 byte count.
// Formats user-facing status lines like "0 bytes left this device" or "1.2 KB sent to Gemini".

export interface LedgerEntry {
  engine: string;
  bytes: number;
  at: number;
}

export interface LedgerRecordInput {
  engine: string;
  sentText?: string;
  /** Non-text bytes that left with this turn (e.g. a photo crop's decoded size). */
  extraBytes?: number;
  at?: number;
}

export interface LedgerTotals {
  totalBytes: number;
  byEngine: Record<string, number>;
  count: number;
  /** AI turns only: everything except non-AI services such as Spotify. */
  aiBytes: number;
  aiCount: number;
  /** Non-AI calls that also left this device (Spotify), counted separately. */
  spotifyBytes: number;
  spotifyCount: number;
}

export const isAiEngine = (engine: string): boolean => engine.toLowerCase() !== 'spotify';

export interface CanvasLedger {
  record(input: LedgerRecordInput): LedgerEntry;
  totals(): LedgerTotals;
  entries(): readonly LedgerEntry[];
  formatLine(): string;
  /** "Also left this device: Spotify · N calls · X (not AI)", or '' when none. */
  formatSpotifyLine(): string;
  clear(): void;
}

export function utf8ByteLength(text: string): number {
  if (!text) return 0;
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  const Buf = (globalThis as unknown as { Buffer?: { from(text: string, enc: string): { length: number } } }).Buffer;
  if (Buf) return Buf.from(text, 'utf-8').length;
  return text.length;
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatLedgerLine(opts: { bytes: number; engine?: string }): string {
  const bytes = opts.bytes;
  if (bytes <= 0) return '0 bytes left this device';

  const engineName = opts.engine ? capitalize(opts.engine) : 'Gemini';

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB sent to ${engineName}`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB sent to ${engineName}`;
  }
  return `${bytes} B sent to ${engineName}`;
}

export function createCanvasLedger(): CanvasLedger {
  const entriesList: LedgerEntry[] = [];

  return {
    record(input: LedgerRecordInput): LedgerEntry {
      const isNano = input.engine.toLowerCase() === 'nano';
      const extra = Number.isFinite(input.extraBytes) ? Math.max(0, Math.round(input.extraBytes!)) : 0;
      const bytes = isNano ? 0 : utf8ByteLength(input.sentText ?? '') + extra;
      const at = input.at ?? (typeof Date !== 'undefined' ? Date.now() : 0);

      const entry: LedgerEntry = {
        engine: input.engine,
        bytes,
        at,
      };
      entriesList.push(entry);
      return entry;
    },

    totals(): LedgerTotals {
      let totalBytes = 0;
      let aiBytes = 0;
      let aiCount = 0;
      let spotifyBytes = 0;
      let spotifyCount = 0;
      const byEngine: Record<string, number> = {};

      for (const e of entriesList) {
        totalBytes += e.bytes;
        if (isAiEngine(e.engine)) { aiBytes += e.bytes; aiCount += 1; } else { spotifyBytes += e.bytes; spotifyCount += 1; }
        byEngine[e.engine] = (byEngine[e.engine] ?? 0) + e.bytes;
      }

      return {
        totalBytes,
        byEngine,
        count: entriesList.length,
        aiBytes,
        aiCount,
        spotifyBytes,
        spotifyCount,
      };
    },

    entries(): readonly LedgerEntry[] {
      return [...entriesList];
    },

    formatLine(): string {
      let totalBytes = 0;
      let lastExternalEngine = 'Gemini';

      for (const e of entriesList) {
        if (!isAiEngine(e.engine)) continue;
        totalBytes += e.bytes;
        if (e.bytes > 0) {
          lastExternalEngine = e.engine;
        }
      }

      return formatLedgerLine({ bytes: totalBytes, engine: lastExternalEngine });
    },

    formatSpotifyLine(): string {
      const t = this.totals();
      if (!t.spotifyCount) return '';
      const b = t.spotifyBytes;
      const size = b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
      return `Also left this device: Spotify · ${t.spotifyCount} call${t.spotifyCount === 1 ? '' : 's'} · ${size} (not AI)`;
    },

    clear(): void {
      entriesList.length = 0;
    },
  };
}

/** The two honest lines of the AI panel: AI turns, and (apart) Spotify calls. */
export function ledgerPanelLines(ledger: CanvasLedger): { ai: string; spotify: string } {
  const t = ledger.totals();
  return {
    ai: `This session: ${t.aiCount} AI turn${t.aiCount === 1 ? '' : 's'} · ${ledger.formatLine()}`,
    spotify: ledger.formatSpotifyLine(),
  };
}
