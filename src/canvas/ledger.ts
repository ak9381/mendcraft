// Ledger of bytes that left the device per AI turn.
// Local Nano turns report 0 bytes; cloud turns (e.g. Gemini) report the UTF-8 byte count.
// Formats user-facing status lines like "0 bytes left this device" or "1.2 KB sent to Gemini".

export interface LedgerEntry {
  engine: string;
  /** Bytes that really left this device (0 for a SIM turn). */
  bytes: number;
  at: number;
  /** A scripted (SIM) turn: nothing left, `simBytes` is what a real run would send. */
  sim?: boolean;
  simBytes?: number;
}

export interface LedgerRecordInput {
  engine: string;
  sentText?: string;
  /** Non-text bytes that left with this turn (e.g. a photo crop's decoded size). */
  extraBytes?: number;
  at?: number;
  /** Scripted (SIM) turn: books 0 real bytes and remembers what it would send. */
  sim?: boolean;
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
  /** AI turns that ran scripted (SIM): what a real run would have sent. Never real bytes. */
  simBytes: number;
}

export const isAiEngine = (engine: string): boolean => engine.toLowerCase() !== 'spotify';

export interface CanvasLedger {
  record(input: LedgerRecordInput): LedgerEntry;
  /** Bytes of a turn that left AFTER the turn was opened (a cloud call books
   *  when it really leaves; a hedge or retry adds again). Never for SIM. */
  addBytes(entry: LedgerEntry, bytes: number): void;
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

/** "412 B" / "1.2 KB" / "1.0 MB". */
export function formatBytesShort(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

/** What a scripted (SIM) turn would have sent — never shown as real bytes. */
export function formatSimBytes(simBytes: number): string {
  return `SIM · would send ${formatBytesShort(simBytes)}`;
}

export function createCanvasLedger(): CanvasLedger {
  const entriesList: LedgerEntry[] = [];

  return {
    record(input: LedgerRecordInput): LedgerEntry {
      const isNano = input.engine.toLowerCase() === 'nano';
      const extra = Number.isFinite(input.extraBytes) ? Math.max(0, Math.round(input.extraBytes!)) : 0;
      const would = isNano ? 0 : utf8ByteLength(input.sentText ?? '') + extra;
      const at = input.at ?? (typeof Date !== 'undefined' ? Date.now() : 0);

      const entry: LedgerEntry = input.sim
        ? { engine: input.engine, bytes: 0, at, sim: true, simBytes: would }
        : { engine: input.engine, bytes: would, at };
      entriesList.push(entry);
      return entry;
    },

    addBytes(entry: LedgerEntry, bytes: number): void {
      if (entry.sim || !entriesList.includes(entry)) return;
      // Negative takes back a send that turned out never to have left.
      entry.bytes = Math.max(0, entry.bytes + Math.round(bytes));
    },

    totals(): LedgerTotals {
      let totalBytes = 0;
      let aiBytes = 0;
      let aiCount = 0;
      let spotifyBytes = 0;
      let spotifyCount = 0;
      let simBytes = 0;
      const byEngine: Record<string, number> = {};

      for (const e of entriesList) {
        totalBytes += e.bytes;
        if (isAiEngine(e.engine)) { aiBytes += e.bytes; aiCount += 1; simBytes += e.simBytes ?? 0; } else { spotifyBytes += e.bytes; spotifyCount += 1; }
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
        simBytes,
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

      const line = formatLedgerLine({ bytes: totalBytes, engine: lastExternalEngine });
      const sim = this.totals().simBytes;
      return sim > 0 ? `${line} · ${formatSimBytes(sim)}` : line;
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
