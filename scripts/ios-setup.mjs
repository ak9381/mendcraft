#!/usr/bin/env node
// Make ios/App (the generated, git-ignored Xcode project) build the iPhone app
// from THIS checkout's sources, the same way every time (macOS + Xcode only):
//
//   npm run build && npm run ios:setup
//
// 1. ios/App missing → `npx cap add ios` (the tracked ios/README.md and
//    ios/plugins/ are set aside meanwhile: Capacitor refuses to add a platform
//    whose folder exists).
// 2. ios-src/*.swift → ios/App/App/, and each file is put in the App target
//    (project.pbxproj) if it is not there yet.
// 3. ios-src/Info.plist.additions.xml → merged into ios/App/App/Info.plist
//    (each key replaced or added; everything else kept).
// 4. `npx cap sync ios` (web bundle + Capacitor plugins).
// 5. Checks: every Swift copy is byte-identical to ios-src, in the target, and
//    no old copy still calls requestSystemTrackingOff.
//
// Signing is not touched: pick the team in Xcode (or pass DEVELOPMENT_TEAM to
// xcodebuild). The custom plugins are registered in MendcraftViewController
// (registerPluginInstance), which SceneDelegate roots the window in.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const ios = join(root, 'ios');
const app = join(ios, 'App', 'App');
const pbxPath = join(ios, 'App', 'App.xcodeproj', 'project.pbxproj');
const src = join(root, 'ios-src');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
const fail = (msg) => { console.error(`[ios:setup] ${msg}`); process.exit(1); };

if (process.platform !== 'darwin') fail('needs macOS with Xcode.');
if (!existsSync(join(root, 'dist', 'index.html'))) fail('no dist/ — run `npm run build` first.');

// 1. Generate the project once.
if (!existsSync(pbxPath)) {
  const aside = mkdtempSync(join(tmpdir(), 'mendcraft-ios-'));
  const tracked = ['README.md', 'plugins'].filter((f) => existsSync(join(ios, f)));
  for (const f of tracked) renameSync(join(ios, f), join(aside, f));
  try {
    if (existsSync(ios) && !readdirSync(ios).length) rmSync(ios, { recursive: true });
    run('npx', ['cap', 'add', 'ios']);
  } finally {
    for (const f of tracked) renameSync(join(aside, f), join(ios, f));
    rmSync(aside, { recursive: true, force: true });
  }
}

// 2. The Swift sources, in the App target.
const swift = readdirSync(src).filter((f) => f.endsWith('.swift')).sort();
for (const f of swift) copyFileSync(join(src, f), join(app, f));
const id = (name, kind) => createHash('sha1').update(`mendcraft:${name}:${kind}`).digest('hex').slice(0, 24).toUpperCase();
let pbx = readFileSync(pbxPath, 'utf8');
const insertAfter = (marker, text) => {
  const at = pbx.indexOf(marker);
  if (at < 0) fail(`project.pbxproj: "${marker.trim()}" not found`);
  pbx = pbx.slice(0, at + marker.length) + text + pbx.slice(at + marker.length);
};
const appGroup = /(\/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \(\n)/;
const sourcesPhase = /(\/\* Sources \*\/ = \{\s*isa = PBXSourcesBuildPhase;\s*buildActionMask = \d+;\s*files = \(\n)/;
for (const f of swift) {
  if (new RegExp(`/\\* ${f.replace('.', '\\.')} \\*/ = \\{isa = PBXFileReference`).test(pbx)) {
    if (!pbx.includes(`/* ${f} in Sources */,`)) fail(`${f} is in the project but not built by the App target — add it to the target in Xcode.`);
    continue;
  }
  const ref = id(f, 'ref'), build = id(f, 'build');
  insertAfter('/* Begin PBXBuildFile section */\n', `\t\t${build} /* ${f} in Sources */ = {isa = PBXBuildFile; fileRef = ${ref} /* ${f} */; };\n`);
  insertAfter('/* Begin PBXFileReference section */\n', `\t\t${ref} /* ${f} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${f}; sourceTree = "<group>"; };\n`);
  const g = appGroup.exec(pbx); if (!g) fail('project.pbxproj: the App group was not found');
  insertAfter(g[1], `\t\t\t\t${ref} /* ${f} */,\n`);
  const s = sourcesPhase.exec(pbx); if (!s) fail('project.pbxproj: the Sources build phase was not found');
  insertAfter(s[1], `\t\t\t\t${build} /* ${f} in Sources */,\n`);
}
writeFileSync(pbxPath, pbx);

// 3. Info.plist keys (permission strings, local network, scene manifest).
const additions = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(src, 'Info.plist.additions.xml')], { encoding: 'utf8' }));
const plist = join(app, 'Info.plist');
for (const [key, value] of Object.entries(additions)) {
  try { execFileSync('plutil', ['-remove', key, plist], { stdio: 'ignore' }); } catch { /* not there yet */ }
  execFileSync('plutil', ['-insert', key, '-json', JSON.stringify(value), plist]);
}

// 4. Web bundle + Capacitor plugins.
run('npx', ['cap', 'sync', 'ios']);

// 5. Checks.
pbx = readFileSync(pbxPath, 'utf8');
for (const f of swift) {
  if (readFileSync(join(app, f), 'utf8') !== readFileSync(join(src, f), 'utf8')) fail(`${f} differs from ios-src`);
  if (!pbx.includes(`/* ${f} in Sources */,`)) fail(`${f} is not in the App target`);
}
const stale = readdirSync(app).filter((f) => f.endsWith('.swift') && /requestSystemTrackingOff/.test(readFileSync(join(app, f), 'utf8')));
if (stale.length) fail(`an old copy still calls requestSystemTrackingOff: ${stale.join(', ')}`);
const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
for (const key of Object.keys(additions)) if (!(key in info)) fail(`Info.plist is missing ${key}`);
console.log(`[ios:setup] ios/App is ready: ${swift.length} Swift files in the App target, ${Object.keys(additions).length} Info.plist keys merged. Open it with \`npx cap open ios\`, pick your signing team, Run.`);
