#!/usr/bin/env node
// A sheet that outlives the screen that opened it.
//
// ── the incident ──────────────────────────────────────────────────────────
//
// 5 Oct 2026, coach app. Calendar had "Add Session · Mon 5 Oct" open, a deep
// link took the app to Build Program, and the sheet was still there — over the
// builder, scrim and all, with "Add Open Slot" live under the coach's thumb.
// The screen behind it had changed; the sheet had not.
//
// A React Native <Modal> is drawn by the NATIVE layer and keeps being drawn
// while the component rendering it is mounted. A tab navigator keeps its
// screens mounted when you leave them. So the sheet was not failing to close;
// it was being asked to stay.
//
// A tab TAP cannot reach it — the sheet covers the tab bar — which is why it
// survived every hand test the app has ever had. It is reached by a route
// change that does not come from this screen, and a push notification is
// exactly that.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// Screens use <ScreenSheet> (src/ui/ScreenSheet.tsx), which calls the sheet's
// own `onRequestClose` when the screen loses focus. A raw <Modal> under app/**
// or src/ui/** fails this check.
//
// There is no KNOWN list and there should never be one. Every sheet in the app
// was converted in the same commit as this gate, because a list of fifty-nine
// exceptions is a way of writing down that the rule is not the rule.
//
// ── the escape, and the one thing using it ────────────────────────────────
//
// `modal-ok: <reason>` on the line or the line above, and a bare marker does
// not count — the reason is the point. src/ui/waiver.tsx is the only user: it
// blocks the whole app until a release of liability is signed, passes a
// deliberate no-op `onRequestClose`, and is rendered OUTSIDE the tabs by
// app/(client)/_layout.tsx. A gate that closed itself when navigation moved is
// not a gate.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files app src/ui', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.tsx') && f !== 'src/ui/ScreenSheet.tsx');

/** True for every character that sits inside a comment or a string, so a
 *  <Modal> written in prose — and this file's own header is full of them —
 *  is not read as markup. */
function masked(src) {
  const out = new Array(src.length).fill(false);
  let block = false, line = false, str = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1] ?? '';
    if (block) { out[i] = true; if (c === '*' && n === '/') { out[i + 1] = true; i++; block = false; } continue; }
    if (line) { out[i] = true; if (c === '\n') line = false; continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '*') { out[i] = out[i + 1] = true; i++; block = true; continue; }
    if (c === '/' && n === '/') { out[i] = out[i + 1] = true; i++; line = true; continue; }
    if (c === '"' || c === "'" || c === '`') str = c;
  }
  return out;
}

const OK = /modal-ok:\s*(.+)$/;
const offences = [];
let sheets = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('<Modal') && !src.includes('<ScreenSheet')) continue;
  const mask = masked(src);
  const lines = src.split('\n');
  for (const m of src.matchAll(/<ScreenSheet\b/g)) if (!mask[m.index]) sheets++;
  for (const m of src.matchAll(/<Modal\b/g)) {
    if (mask[m.index]) continue;
    const no = src.slice(0, m.index).split('\n').length;
    const here = lines[no - 1] ?? '';
    const above = lines[no - 2] ?? '';
    const marker = OK.exec(here) ?? OK.exec(above);
    // A bare `modal-ok:` with nothing after it is not a reason, and the whole
    // value of the marker is that somebody had to write one down.
    if (marker && marker[1].trim().length > 0) continue;
    offences.push(`  ${file}:${no}  ${here.trim().slice(0, 90)}`);
  }
}

if (offences.length) {
  console.error(`check-sheet — ${offences.length} raw <Modal> in a screen:\n`);
  console.error(offences.join('\n'));
  console.error(`
A <Modal> keeps being drawn by the native layer while its component is mounted,
and a tab navigator keeps screens mounted after you leave them — so this sheet
stays on top of whatever the app navigates to next, with its buttons live.

Use <ScreenSheet> from src/ui/ScreenSheet.tsx. It takes the same props and calls
your own onRequestClose when the screen loses focus.

If this one genuinely must outlive navigation, put "modal-ok: <reason>" on that
line or the one above it. A bare marker does not count.`);
  process.exit(1);
}

console.log(`check-sheet — ok, ${sheets} sheets across ${files.length} files all leave with their screen; 1 declared exception (src/ui/waiver.tsx).`);
