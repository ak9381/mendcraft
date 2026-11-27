// RULES-FIRST REDACTION — pure and deterministic (no model call; a Nano
// assist is a follow-up, deliberately NOT tonight: a privacy filter must be
// auditable and repeatable). Family names, phone numbers, emails and
// person-like plan text labels are swapped for neutral tokens in the text
// SENT to the cloud; captions, history and the on-screen answer keep her real
// words. The ledger records the redacted payload — that is the receipt.

export interface RedactResult {
  text: string;
  /** Names kept on device (kin-anchored, possessive, plan-label matches). */
  names: number;
  /** Phone numbers / emails kept on device. */
  details: number;
}

const KIN_WORDS = [
  'mother', 'father', 'mom', 'mum', 'dad', 'amma', 'appa', 'ajji', 'thatha',
  'grandmother', 'grandfather', 'granny', 'aunt', 'auntie', 'uncle',
  'sister', 'brother', 'daughter', 'son', 'wife', 'husband', 'cousin',
  'friend', 'neighbour', 'neighbor',
];

/** Nouns a possessive name attaches to ("Meera's room", "Lakshmi's chair"). */
const PLACE_WORDS = [
  'room', 'bedroom', 'bathroom', 'bed', 'chair', 'desk', 'office', 'study',
  'kitchen', 'corner', 'bath', 'wardrobe', 'side',
];

/** Plan labels that are locations, not people — these stay in the payload. */
const ROOM_LABELS = new Set([
  'kitchen', 'bedroom', 'bathroom', 'living', 'hall', 'hallway', 'study',
  'office', 'balcony', 'toilet', 'bath', 'dining', 'pantry', 'store',
  'storage', 'garage', 'entry', 'entrance', 'porch', 'veranda', 'verandah',
  'utility', 'laundry', 'closet', 'room', 'stairs', 'landing', 'lobby',
  'north', 'south', 'east', 'west',
]);

/** Swap personal details for neutral tokens in a payload bound for the cloud.
 *  `planNames` are the plan's text labels; only person-like ones (a single
 *  capitalised word that is not a room word) are treated as names.
 *  Idempotent: "[name]" / "[phone]" / "[email]" never match again.
 *  `phones: false` keeps digit runs (a model reply's JSON numbers). */
export function redactForCloud(text: string, planNames: string[] = [], o: { phones?: boolean } = {}): RedactResult {
  let names = 0;
  let details = 0;
  let out = text;

  // Phone numbers: a digit run (with spaces/dashes/brackets) of 10+ digits.
  // Plan measurements ("4000 by 3000", "200 thick") never reach 10 in one run.
  if (o.phones !== false) out = out.replace(/\+?\d[\d\s()-]*\d/g, (m) => {
    if ((m.match(/\d/g) ?? []).length < 10) return m;
    details += 1;
    return '[phone]';
  });

  out = out.replace(/\b[A-Za-z0-9][\w.+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g, () => {
    details += 1;
    return '[email]';
  });

  // Kin-anchored capitalised names: "my mother Lakshmi" → "my mother [name]".
  const kin = new RegExp(
    `\\b([Mm]y|[Hh]er|[Hh]is|[Oo]ur) (${KIN_WORDS.join('|')}) ([A-Z][\\p{L}'-]+)`,
    'gu',
  );
  out = out.replace(kin, (_m, pro: string, kinWord: string) => {
    names += 1;
    return `${pro} ${kinWord} [name]`;
  });

  // Possessive name before a room-like noun: "Meera's room" → "[name]'s room".
  const poss = new RegExp(`\\b([A-Z][\\p{L}'-]*)['’]s (${PLACE_WORDS.join('|')})\\b`, 'gu');
  out = out.replace(poss, (_m, _name, place: string) => {
    names += 1;
    return `[name]'s ${place}`;
  });

  // Exact matches against person-like plan text labels.
  for (const label of planNames) {
    const l = label.trim();
    if (!/^[A-Z][a-z]+$/.test(l)) continue;
    if (ROOM_LABELS.has(l.toLowerCase())) continue;
    out = out.replace(new RegExp(`\\b${l}\\b`, 'g'), () => {
      names += 1;
      return '[name]';
    });
  }

  return { text: out, names, details };
}
