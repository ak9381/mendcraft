// Static /judges page: the 30-second path, what runs on-device vs. in the cloud
// and why, what still works with no camera/mic/Nano, the honest limits, and
// links to the walks and the /control dashboard. Mounted by src/boot.ts BEFORE
// the editor shell, so none of the editor (camera, MediaPipe, AI) loads here —
// it is a plain, fast landing page that shares the same build and styles.

import '../style.css';

export async function mountJudgesPage(root: HTMLElement): Promise<void> {
  document.title = 'Mendcraft — for the judges';
  root.innerHTML = `
    <div class="judges-page">
      <header class="judges-head">
        <span class="brand">Mendcraft</span>
        <span class="judges-sub">for the #BuildHybridAI judges</span>
      </header>

      <p class="judges-lede">
        A hands-free pinch-and-voice design tool for people with limited hand use.
        Built around one real user — the builder’s mother, who has arthritis and
        speaks Kannada. Firebase AI Logic hybrid: Chrome’s on-device Gemini Nano
        when it can, <code>gemini-flash-lite</code> cloud when it must, and an
        honest badge that always says which.
      </p>

      <section class="judges-card judges-path">
        <h2>30-second path (3 clicks)</h2>
        <ol>
          <li><a class="judges-cta" href="/studio?sim=1&amp;play=1">① Play the Plan walk</a> — builds a 2-bedroom plan, resizes a wall, speaks Kannada, Hindi, Spanish &amp; Japanese, offline &amp; back, then opens “what left this device”. No camera or mic needed.</li>
          <li><a class="judges-cta" href="/studio">② Open the editor</a> and press <strong>Help / tour</strong> → <strong>Take the tour</strong> to spotlight the real controls.</li>
          <li><a class="judges-cta" href="/control">③ Open /control</a> on a second screen — the read-only room dashboard.</li>
        </ol>
      </section>

      <div class="judges-grid">
        <section class="judges-card">
          <h2>On-device vs. cloud — and why</h2>
          <table class="judges-table">
            <thead><tr><th>Step</th><th>Where</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>Camera, face &amp; pinch</td><td class="j-on">On-device</td><td>Video never leaves the laptop — privacy and latency.</td></tr>
              <tr><td>Hand-adapt (effort/tremor)</td><td class="j-on">On-device (Nano)</td><td>The raw numbers are personal; the pick stays local.</td></tr>
              <tr><td>Simple commands</td><td class="j-rules">Rules</td><td>Deterministic parse — no model, no network, instant.</td></tr>
              <tr><td>Fuzzy English intent</td><td class="j-on">On-device (Nano)</td><td>Small, private, offline-capable when the model is present.</td></tr>
              <tr><td>Big jobs &amp; languages Nano can’t run</td><td class="j-cloud">Cloud</td><td>Templates, translation (Kannada, Hindi…) and heavier reasoning Nano can’t do.</td></tr>
            </tbody>
          </table>
          <p class="judges-note">Every cloud call is listed in the in-app “What left this device” ledger with its byte count.</p>
        </section>

        <section class="judges-card">
          <h2>Works with no camera / mic / Nano</h2>
          <ul class="judges-list">
            <li><strong>No camera or mic:</strong> type commands, or run the sim walks (a mouse drag = a pinch).</li>
            <li><strong>No Gemini Nano:</strong> the rules parser and the cloud still cover every command; the badge shows Rules or Gemini · cloud instead of Gemini Nano · on device.</li>
            <li><strong>No network:</strong> rules + on-device keep working; big jobs queue and drain on reconnect.</li>
            <li><strong>The sim walks</strong> (<code>/?sim=1</code>) need none of the above and are fully deterministic.</li>
          </ul>
        </section>

        <section class="judges-card">
          <h2>Honest limits</h2>
          <ul class="judges-list">
            <li>On-device Gemini Nano needs <strong>desktop Chrome</strong> with the model downloaded; elsewhere it falls back to cloud or rules (the badge is honest about it).</li>
            <li><strong>Polished in English. Speak any language.</strong> Chrome’s on-device Language Detector names the language; Nano handles languages it accepts (English, Spanish, Japanese), others go to the cloud (translate + intent in one call) and the badge says why.</li>
            <li>Real-device features — the camera pinch, the WiZ lamp bridge, phone pairing over Firestore — can’t be shown on this hosted page; the sim walks stand in for them.</li>
            <li>The sim and /control fall back to an in-page fake transport when no paired room is reachable, and say so rather than faking a live link.</li>
          </ul>
        </section>

        <section class="judges-card">
          <h2>The walk</h2>
          <ul class="judges-list">
            <li><a href="/studio?sim=1&amp;play=1">Plan 2D</a> — floor plan: resize a wall, teach a phrase, any language, offline, accessibility.</li>
          </ul>
          <p class="judges-note">Each walk has Pause / Next / Skip, then a “Try it yourself” hint with three commands to say.</p>
        </section>
      </div>

      <footer class="judges-foot">
        <a class="judges-cta" href="/studio">Open the editor →</a>
      </footer>
    </div>
  `;
}
