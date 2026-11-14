// MEASURED COMMAND ACCURACY — pure scoring for the fixed eval sets.
//
// A command eval case is a short, realistic, mom-style utterance plus the op we
// expect. The scorer runs a parse function (the deterministic rules path offline,
// or — in Chrome — the Nano/cloud path) and compares the normalized op it
// produced against the expectation. Pure and parser-agnostic so it is unit
// tested without a browser; the harness in tests/eval/runEval.ts wires in the
// real parser and writes the results files.

/** One labelled utterance. `expect` is the normalized op (see opLabel):
 *  an op name ("add_room"), "generate:<template>", or "clarify" when the best
 *  honest outcome is to ask back. `gloss` is an English gloss for non-English. */
export interface EvalCase {
  text: string;
  expect: string;
  gloss?: string;
  tags?: string[];
}

export interface CaseResult {
  text: string;
  expect: string;
  got: string;
  pass: boolean;
}

export interface EvalScore {
  total: number;
  correct: number;
  /** correct / total in [0,1]. */
  accuracy: number;
  results: CaseResult[];
}

/** Any object a parser might return (loose op envelope, generate, or clarify). */
export type ParseResult = Record<string, unknown>;

/** Normalize a parser result to the single label the eval compares on. */
export function opLabel(result: ParseResult | null | undefined): string {
  if (!result || typeof result !== 'object') return 'none';
  if ('clarify' in result) return 'clarify';
  if ('generate' in result) return `generate:${String((result as { generate: unknown }).generate)}`;
  if ('op' in result) return String((result as { op: unknown }).op);
  return 'unknown';
}

/** Does the Kannada (or any non-Latin) script appear in this text? Used to
 *  measure that non-English commands are correctly routed OFF the rules path. */
export function looksKannada(text: string): boolean {
  return /[ಀ-೿]/.test(text);
}

/** Score a set of cases against a parse function. */
export function scoreCases(parse: (u: string) => ParseResult, cases: readonly EvalCase[]): EvalScore {
  const results: CaseResult[] = cases.map((c) => {
    const got = opLabel(parse(c.text));
    return { text: c.text, expect: c.expect, got, pass: got === c.expect };
  });
  const correct = results.filter((r) => r.pass).length;
  return {
    total: results.length,
    correct,
    accuracy: results.length ? correct / results.length : 0,
    results,
  };
}

export interface RoutingScore {
  total: number;
  /** How many non-English cases the rules path correctly declined (clarify/none). */
  routedOff: number;
  rate: number;
}

/** For a non-English set: the rules parser is English-only, so the HONEST,
 *  measurable thing offline is that it declines (clarify) rather than silently
 *  mis-applying an op — those cases are then handled by the cloud translate path. */
export function scoreRouting(parse: (u: string) => ParseResult, cases: readonly EvalCase[]): RoutingScore {
  const nonEnglish = cases.filter((c) => looksKannada(c.text));
  const routedOff = nonEnglish.filter((c) => {
    const label = opLabel(parse(c.text));
    return label === 'clarify' || label === 'none' || label === 'unknown';
  }).length;
  return {
    total: nonEnglish.length,
    routedOff,
    rate: nonEnglish.length ? routedOff / nonEnglish.length : 0,
  };
}

/** Round an accuracy to a whole-percent string, e.g. 0.825 -> "82%". */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
