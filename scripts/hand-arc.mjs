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

/** Voice's stand-in: the say box lives inside the palm/voice-summoned tool
 *  palette, hidden until opened and auto-closing once a command runs — so
 *  every utterance presses the always-visible Tools chip by hand first,
 *  then types (keyboard only, never a mouse click) and presses Enter. */
async function say(page, text) {
  await press(page, (el) => el.classList?.contains('mc-tools-chip'));
  await sleep(150);
  await page.type('#mc-say-in', text);
  await page.keyboard.press('Enter');
}

async function shot(page, dir, name) {
  await page.screenshot({ path: join(dir, `${name}.png`) }).catch(() => {});
}

/** `data-cmd` buttons (Offline, Teach, ...) live in the same palm/voice
 *  palette as the say box: open it by hand, press the button (which closes
 *  the palette again), same as a real hand would reach it. */
async function pressToolCmd(page, cmd) {
  await press(page, (el) => el.classList?.contains('mc-tools-chip'));
  await sleep(150);
  const r = await press(page, new Function('el', `return el.dataset && el.dataset.cmd === ${JSON.stringify(cmd)};`));
  return r;
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

  // 02 — "connect devices and make a dashboard to control them": the swarm
  // builds it live.
  await say(page, 'connect devices and make a dashboard to control them');
  await sleep(500);
  await shot(page, outDir, '02-dashboard-swarm');
  await sleep(2200);

  // 03 — full-screen review open
  await shot(page, outDir, '03-review');
  note('approve-dashboard', await press(page, (_el, l) => /^approve$/i.test(l)));
  await sleep(300);
  // The quick draft is followed by a Gemini-upgrade proposal; approve that too.
  for (let i = 0; i < 2; i++) {
    const more = await press(page, (_el, l) => /^approve$/i.test(l));
    if (!more.ok) break;
    await sleep(2200);
  }
  // 04 — dashboard kept, pinned
  await say(page, 'save');
  await sleep(500);
  await shot(page, outDir, '04-dashboard-kept');

  // 05 — floor plan for Mrs Sharma's flat (privacy strip + review)
  await say(page, "floor plan for Mrs Sharma's flat");
  await sleep(2200);
  note('approve-floorplan', await press(page, (_el, l) => /^approve$/i.test(l)));
  await sleep(500);
  await shot(page, outDir, '05-floorplan');

  // 06 — add Kannada (handoff cards, review, Approve)
  await say(page, 'add kannada');
  await sleep(2200);
  note('approve-kannada', await press(page, (_el, l) => /^approve$/i.test(l)));
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
  note('approve-offline-kannada', await press(page, (_el, l) => /^approve$/i.test(l)));
  await sleep(500);

  // 08 — teach a gesture: ?sim=1 records a deterministic synthetic sample
  // instead of the camera, so this never needs a real hand pose.
  note('teach-open', await pressToolCmd(page, 'teach'));
  await sleep(6500); // two synthetic samples record under sim
  await page.type('.mc-teach-describe input', 'save the canvas').catch(() => {});
  await page.keyboard.press('Enter');
  await sleep(400);
  note('approve-teach', await press(page, (_el, l) => /^approve$/i.test(l)));
  await sleep(400);
  await shot(page, outDir, '08-teach');

  const mouseViolations = await page.evaluate(() => window.__mcMouseViolations);
  return { misses, mouseViolations };
}
