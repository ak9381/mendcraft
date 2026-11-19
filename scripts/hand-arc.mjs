// FULL DEMO ARC, zero mouse: drives the whole story in demo-video-script.md
// end to end with the simulated hand (window.__mcHand) for every press, and
// the say box as voice's stand-in (no real recogniser) for every utterance.
// Screenshots each beat to OUT/arc/NN-name.png. Resilient: a missing control
// is recorded as a miss and the arc continues rather than hanging.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Real hand activation of the first control matching a predicate — same
 *  approach as scripts/hand-reach.mjs's handPress, duplicated here so this
 *  file stays self-contained. */
async function press(page, test) {
  return page.evaluate(async (src) => {
    const pred = new Function('el', 'label', `return (${src})(el, label);`);
    const { collectControls, controlLabel } = window.__mcHandLib;
    const el = collectControls(document).find((e) => pred(e, controlLabel(e)));
    if (!el) return { ok: false, why: 'not found' };
    const r = el.getBoundingClientRect();
    const got = window.__mcHand.pointAt(r.left + r.width / 2, r.top + r.height / 2);
    window.__mcHand.pinch(true);
    await new Promise((res) => setTimeout(res, 100));
    window.__mcHand.pinch(false);
    return { ok: got === el, label: controlLabel(el) };
  }, test.toString());
}

/** Waits for a selector to exist AND be on-screen (not [hidden], non-zero
 *  box) — used instead of fixed sleeps before pressing a control or taking
 *  a "this must be visible now" screenshot. Never throws: resolves false on
 *  timeout so the arc can record a miss and keep going. */
async function waitVisible(page, selector, timeout = 8000) {
  try {
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      if (el.hidden) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, { timeout }, selector);
    return true;
  } catch {
    return false;
  }
}

/** Sets an input's value via focus() + keyboard typing — never page.type()
 *  or page.click(), both of which synthesize a real (trusted) mousedown to
 *  focus the element. A simulated hand/voice never clicks with a mouse. */
async function typeText(page, selector, text) {
  const found = await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!input) return false;
    input.focus();
    input.value = '';
    return true;
  }, selector);
  if (!found) return false;
  await page.keyboard.type(text);
  return true;
}

/** Voice's stand-in: the say box lives inside the palm/voice-summoned tool
 *  palette, hidden until opened and auto-closing once a command runs — so
 *  every utterance presses the always-visible Tools chip by hand first,
 *  then types (keyboard only, never a mouse click) and presses Enter. */
async function say(page, text) {
  await press(page, (el) => el.classList?.contains('mc-tools-chip'));
  await waitVisible(page, '#mc-say-in', 3000);
  await typeText(page, '#mc-say-in', text);
  await page.keyboard.press('Enter');
}

async function shot(page, dir, name) {
  await page.screenshot({ path: join(dir, `${name}.png`) }).catch(() => {});
}

/** Polls until at least one agent dock chip for `kind` exists (mid-build,
 *  review not yet open) and shoots the instant that's true. */
async function shotDockFilling(page, dir, name, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await page.evaluate(() => ({
      chips: document.querySelectorAll('.mc-dock-chip').length,
      reviewOpen: !!document.querySelector('.mc-review-dialog:not([hidden])'),
    }));
    if (state.chips > 0 && !state.reviewOpen) { await shot(page, dir, name); return { ok: true }; }
    if (state.reviewOpen) break;
    await sleep(80);
  }
  await shot(page, dir, name);
  return { ok: false, why: 'dock chips not caught filling' };
}

/** Waits for at least one working dock chip of `kind`, pinches it (opening
 *  its mini terminal), and returns whether that succeeded. */
async function openDockMini(page, kind, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const has = await page.evaluate((k) => !!document.querySelector(`.mc-term-dock[data-engine="${k}"] .mc-dock-chip`), kind);
    if (has) break;
    await sleep(80);
  }
  // The hand pointer caches its control list for 250ms (handPointer.ts's
  // refreshControls); a chip that just appeared needs that cache to turn
  // over before pointAt() will resolve to it.
  await sleep(300);
  const body = `return el.classList.contains('mc-dock-chip') && !!el.closest('[data-engine="${kind}"]');`;
  return press(page, new Function('el', body));
}

/** Polls for the swarm mid-flight (cursors visible, review not yet open)
 *  and shoots the instant that's true — the app's own minimum swarm hold
 *  (canvasApp.ts's holdSwarmMinimum, sim-only) keeps that window open for a
 *  few seconds, but this still polls rather than guessing a fixed sleep. */
async function shotMidBuild(page, dir, name, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await page.evaluate(() => ({
      cursors: document.querySelectorAll('.mc-swarm-cursor').length,
      reviewOpen: !!document.querySelector('.mc-review-dialog:not([hidden])'),
    }));
    if (state.cursors > 0 && !state.reviewOpen) {
      await shot(page, dir, name);
      return { ok: true };
    }
    if (state.reviewOpen) break; // too late — settled before this landed
    await sleep(80);
  }
  await shot(page, dir, name); // best-effort shot either way
  return { ok: false, why: 'swarm not caught mid-flight' };
}

/** `data-cmd` buttons (Offline, Teach, ...) live in the same palm/voice
 *  palette as the say box: open it by hand, wait for the button to actually
 *  be visible (the palette animates in), then press it — same as a real
 *  hand would reach it. */
async function pressToolCmd(page, cmd) {
  await press(page, (el) => el.classList?.contains('mc-tools-chip'));
  const visible = await waitVisible(page, `[data-cmd="${cmd}"]`, 5000);
  if (!visible) return { ok: false, why: 'tool not visible' };
  return press(page, new Function('el', `return el.dataset && el.dataset.cmd === ${JSON.stringify(cmd)};`));
}

/** Waits for the full-screen review's Approve button to be visible, then
 *  presses it. Records a miss (and returns false) rather than hanging if
 *  the review never opens. */
async function approve(page, note, step) {
  const visible = await waitVisible(page, '.mc-review-approve', 10000);
  if (!visible) { note(step, { ok: false, why: 'review not visible' }); return false; }
  const r = await press(page, (_el, l) => /^approve$/i.test(l));
  note(step, r);
  return r.ok;
}

/** Runs the full zero-mouse arc on an already-navigated `?fresh=1&sim=1`
 *  page with window.__mcHand/__mcHandLib ready. Returns misses (controls
 *  the arc couldn't find/press) and how many *real* (OS-trusted) mouse
 *  events fired during the run — should always be zero. */
export async function runArc(page, outDir) {
  mkdirSync(outDir, { recursive: true });
  const misses = [];
  const note = (step, info) => { if (!info?.ok) misses.push({ step, ...info }); };

  await page.evaluate(() => {
    window.__mcMouseViolations = 0;
    // mousedown/pointerdown only fire for a real pointing device; a trusted
    // 'click' can also come from the browser's own Enter-submits-the-form
    // default action, which is keyboard, not a mouse — so it's excluded.
    ['mousedown', 'pointerdown'].forEach((t) =>
      document.addEventListener(t, (e) => { if (e.isTrusted) window.__mcMouseViolations++; }, true));
  });

  // 01 — empty canvas: "Let's build something fun", floating mic, tool tiles
  await shot(page, outDir, '01-empty');

  // 02 — "connect devices for Mrs Sharma's flat and make a dashboard to
  // control them": the swarm builds it live, with a name in the utterance so
  // both the nano draft and the gemini upgrade below exercise redaction, not
  // just the floor-plan beat. Shot MUST land mid-build: cursors visible,
  // review not yet open — wait for the swarm layer instead of guessing a sleep.
  await say(page, "connect devices for Mrs Sharma's flat and make a dashboard to control them");
  note('swarm-visible-dashboard', await shotMidBuild(page, outDir, '02-dashboard-swarm'));
  note('swarm-dock-filling', await shotDockFilling(page, outDir, '00-swarm-dock'));

  // 03 — full-screen review open
  note('review-visible-dashboard', { ok: await waitVisible(page, '.mc-review-dialog:not([hidden])', 8000) });
  await shot(page, outDir, '03-review');
  await approve(page, note, 'approve-dashboard');

  // Mid-swarm on the Gemini upgrade call: pinch a Gemini dock chip, confirm
  // its mini terminal shows the redacted payload (never the raw "Sharma"),
  // then close it again — before approving the upgrade below.
  note('open-gemini-dock-mini', await openDockMini(page, 'gemini'));
  await sleep(200);
  const miniPayload = await page.evaluate(() => document.querySelector('.mc-mini-terminal .mc-term-lines')?.textContent ?? '');
  note('mini-terminal-redacted', { ok: miniPayload.length > 0 && !/sharma/i.test(miniPayload) });
  await shot(page, outDir, '00-mini-terminal');
  await shot(page, outDir, '00-gemini-redacted');
  note('close-gemini-dock-mini', await openDockMini(page, 'gemini'));

  // 00 — both terminals now carry real content from this one turn: Nano's
  // redact line ("Sharma → [Client A]"), the handoff between engines (logged
  // the moment the gemini call started, above), and a non-zero footer byte
  // count (recorded when that call's prompt was sent) — captured right after
  // closing the mini terminal, before the approve loop below, so no stray
  // re-render can leave a mini terminal open in this shot.
  await shot(page, outDir, '00-panels-after');

  // The quick draft is followed by a Gemini-upgrade proposal; approve that too.
  for (let i = 0; i < 2; i++) {
    const visible = await waitVisible(page, '.mc-review-approve', 4000);
    if (!visible) break;
    await approve(page, note, `approve-dashboard-upgrade-${i}`);
  }

  // 04 — dashboard kept, pinned
  await say(page, 'save');
  await sleep(500);
  await shot(page, outDir, '04-dashboard-kept');

  // 05 — floor plan for Mrs Sharma's flat (privacy strip + review). Grab a
  // mid-build CAD shot before approving, same folder as 05-floorplan.png.
  await say(page, "floor plan for Mrs Sharma's flat");
  note('swarm-visible-floorplan', await shotMidBuild(page, outDir, '05-floorplan-swarm'));
  await approve(page, note, 'approve-floorplan');
  await sleep(500);
  await shot(page, outDir, '05-floorplan');

  // 06 — add Kannada (handoff log lines in both terminals, review, Approve)
  await say(page, 'add kannada');
  note('handoff-visible-kannada', { ok: await waitVisible(page, '.mc-term-line--handoff', 4000) });
  await shot(page, outDir, '06-kannada-handoff');
  await approve(page, note, 'approve-kannada');
  await sleep(500);
  await shot(page, outDir, '06-kannada');

  // 07 — offline: back to English, go offline, ask for Kannada again (queues
  // in Nano's panel), come back online (drains, runs, review), Approve.
  await say(page, 'undo');
  await sleep(400);
  note('offline-on', await pressToolCmd(page, 'offline'));
  await sleep(300);
  await say(page, 'add kannada');
  await sleep(500);
  await shot(page, outDir, '07-offline');
  note('offline-off', await pressToolCmd(page, 'offline'));
  await sleep(1200);
  await approve(page, note, 'approve-offline-kannada');
  await sleep(500);

  // 08 — teach a gesture: ?sim=1 records a deterministic synthetic sample
  // instead of the camera, so this never needs a real hand pose.
  note('teach-open', await pressToolCmd(page, 'teach'));
  await sleep(6500); // two synthetic samples record under sim
  const describeVisible = await waitVisible(page, '.mc-teach-describe input', 4000);
  if (describeVisible) {
    await typeText(page, '.mc-teach-describe input', 'save the canvas');
    await page.keyboard.press('Enter');
  } else {
    note('teach-describe', { ok: false, why: 'describe input not visible' });
  }
  await sleep(400);
  await approve(page, note, 'approve-teach');
  await sleep(400);
  await shot(page, outDir, '08-teach');

  const mouseViolations = await page.evaluate(() => window.__mcMouseViolations);
  return { misses, mouseViolations };
}
