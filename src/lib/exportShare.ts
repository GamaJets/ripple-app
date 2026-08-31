// Share/export helpers. Builds a branded PDF, a CSV file and a plain-text
// summary out of one set of rows, and hands whichever the client picked to the
// phone's share sheet.
//
// This header used to promise that the PDF would "upgrade automatically once
// rebuilt". It has not, through thirty-five builds, and the section below
// headed "Why the file share degrades" is the post-mortem of why not. Read it
// before changing anything here: the answer is not what the previous comment
// assumed, and half of it is a probe that has been asking the wrong question.
import { Share } from 'react-native';
// The CSV writer is not written again here. gymExport.ts already quotes on
// every delimiter src/lib/csv.ts is willing to sniff — not just the comma — so
// a value cannot turn into a column break for somebody opening the file in a
// comma-decimal locale, and its csvCell already renders null as an empty cell
// rather than a zero. Both rules matter more in a body-composition export than
// they do in a member list. Nothing in that module imports at runtime, so this
// costs the bundle nothing.
import { progressChangeLines, progressSpanLabel, progressSummary, figure, dayLabel, type ProgressRow } from './progressExport';
// Date-only values are read through localDate for the reason its header
// explains: `new Date('2026-08-01')` is UTC midnight, which is 31 July for
// anybody west of Greenwich, and a scan dated the day before it happened is
// exactly the sort of thing a coach notices and the app never would.
import { localDate } from './localDate';
import { money } from './gymRecord';
// The client's unit reaches these builders as an argument. Nothing here reads a
// provider, so a report can be built for whoever's row is in hand.
import { weightIn, convertedNote, type WeightUnit } from './units';

// ── Why the file share degrades, and what it takes to stop it ───────────────
//
// TestFlight, build 35: "Why can't it share it?", over a screenshot of the
// share sheet reading "this build cannot attach a file". The sentence was true.
// It was true for TWO separate reasons, and only one of them was the one
// everybody assumed.
//
//   1. expo-print and expo-sharing are not dependencies of this app. Not in
//      package.json, not in node_modules, not in ios/Podfile.lock. Every
//      `require` below has therefore always thrown, `Print` and `Sharing` have
//      always been null, and the PDF button has never once been offered to
//      anybody. Nothing caught it, and each thing that might have has a reason:
//      Metro marks a `require` inside a `try/catch` as an OPTIONAL dependency,
//      so an unresolvable one throws at runtime into the catch instead of
//      failing the bundle; the typecheck never sees an untyped `require`; and
//      scripts/check-native.mjs lists the native modules the app DEPENDS on,
//      which a module nobody ever declared is not on the list to be missed by.
//      The pattern reads as "not built in YET", and this file was written on
//      the expectation of a rebuild that then never happened.
//
//   2. The capability probe was wrong for the version of expo-file-system that
//      IS in the binary. That module ships transitively with `expo` and is in
//      Podfile.lock at 57.0.5, so the file system has been present all along —
//      but SDK 54 replaced `FileSystem.cacheDirectory` and
//      `writeAsStringAsync` with `Paths.cache` and `new File().write()`, and
//      left the old names on the module as stubs that THROW when called.
//      `!!FileSystem?.cacheDirectory` therefore reads false against a module
//      that is present and working. Even once expo-sharing lands, the old probe
//      would keep answering "this build cannot attach a file" — the fallback
//      firing when it should not, on top of the module that genuinely is not
//      there.
//
// So both generations of the file-system API are handled below, the probe asks
// a question the installed version actually answers, and the reason a file
// cannot be attached is a value the screen can print rather than a fixed
// parenthetical apology.
//
// What is still needed from the release: `expo-print` and `expo-sharing` as
// dependencies, and a new native binary. Neither reaches a phone over the air.

let Print: any = null;
let Sharing: any = null;
try { Print = require('expo-print'); } catch { /* not a dependency of this app — see the note above */ }
try { Sharing = require('expo-sharing'); } catch { /* likewise */ }

// Ships transitively with `expo` and is in the binary today. What changed under
// it is the API, not its presence.
let FileSystem: any = null;
try { FileSystem = require('expo-file-system'); } catch { /* would be a broken install */ }

export const pdfExportAvailable = () => !!Print?.printToFileAsync;

/**
 * Whether this build can write a file at all, either way round.
 *
 * `Paths.cache` is the SDK 54+ answer and `cacheDirectory` the one before it.
 * Asking for both is not defensiveness for its own sake: the old names survive
 * on the new module as throwing stubs, so a probe that names only one of them
 * gets a confident wrong answer rather than an error anybody would notice.
 */
const fileSystemWritable = (): boolean =>
  !!(FileSystem?.Paths?.cache && FileSystem?.File) || !!(FileSystem?.cacheDirectory && FileSystem?.writeAsStringAsync);

/**
 * Write `content` into the cache directory and return its `file://` URI.
 *
 * Throws rather than returning null on failure, so a caller cannot mistake "the
 * write failed" for "there was nothing to write" — the share paths below turn
 * the throw into the text fallback, which is the only place that decision
 * belongs.
 */
async function writeCacheFile(content: string, filename: string): Promise<string> {
  if (FileSystem?.Paths?.cache && FileSystem?.File) {
    // Synchronous by design in the new API — `write` returns void, not a
    // promise, so there is nothing here to await and awaiting it would silently
    // succeed on a failed write.
    const f = new FileSystem.File(FileSystem.Paths.cache, filename);
    // A cached export from a previous share is still sitting there, and
    // `create()` refuses an existing path without this.
    f.create({ overwrite: true, intermediates: true });
    f.write(content);
    return f.uri;
  }
  // The pre-SDK-54 path, kept for anybody still on an older binary. It is a
  // promise and must stay awaited: handing the share sheet a URI before the
  // bytes are on disk attaches an empty file, which looks to whoever receives
  // it like a client with no history rather than like a race.
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8' });
  return uri;
}

/**
 * Whether a real file can be written AND handed to the share sheet.
 *
 * The companion of pdfExportAvailable, and it exists for the same reason: a
 * button that offers "CSV" and then shares a wall of comma-separated text has
 * told the user the wrong thing about what they just sent. A screen can ask
 * first and word itself honestly.
 */
export const fileExportAvailable = () => !!(fileSystemWritable() && Sharing?.shareAsync);

/**
 * Why not — in a sentence a person can act on, or null when a file can be sent.
 *
 * The build 35 wording was "(this build cannot attach a file)", which is a
 * parenthetical apology: it names no cause, gives the client nothing to do, and
 * leaves them to conclude the export is broken rather than that this particular
 * copy of the app is behind. The client cannot fix either cause — but they can
 * update the app, and they can stop waiting for a file that is not coming.
 */
export function fileShareBlocker(): string | null {
  if (!Sharing?.shareAsync) {
    return 'This version of the app can’t attach files — the part that hands a file to your phone’s share sheet isn’t in it yet. Update to the next release and the file itself will send. The rows below go as text in the meantime, and nothing is missing from them.';
  }
  if (!fileSystemWritable()) {
    return 'This version of the app can’t save the file to your phone before sending it. Update to the next release and the file itself will send. The rows below go as text in the meantime, and nothing is missing from them.';
  }
  return null;
}

// ── Calendar (.ics) export ───────────────────────────────────────────────────
// Standards-compliant iCalendar so a client/coach can drop their sessions into
// Apple Calendar, Google Calendar, etc. Writes a real .ics file when the share
// sheet can take one; otherwise falls back to the Share sheet with the calendar
// text, which every calendar app can still be pasted into.
export { buildIcs, type IcsEvent } from './ics';

export async function shareTextFile(content: string, filename: string, mime: string, title: string): Promise<'file' | 'text'> {
  if (fileExportAvailable()) {
    try {
      const uri = await writeCacheFile(content, filename);
      const ok = Sharing.isAvailableAsync ? await Sharing.isAvailableAsync() : true;
      if (ok) { await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: title }); return 'file'; }
    } catch { /* fall through */ }
  }
  try { await Share.share({ message: content, title }); } catch { /* ignore */ }
  return 'text';
}

export async function shareIcs(ics: string, filename: string, title: string): Promise<'file' | 'text'> {
  if (fileExportAvailable()) {
    try {
      const uri = await writeCacheFile(ics, filename);
      const ok = Sharing.isAvailableAsync ? await Sharing.isAvailableAsync() : true;
      if (ok) { await Sharing.shareAsync(uri, { mimeType: 'text/calendar', dialogTitle: title, UTI: 'com.apple.ical.ics' }); return 'file'; }
    } catch { /* fall through to text */ }
  }
  try { await Share.share({ message: ics, title }); } catch { /* ignore */ }
  return 'text';
}


export async function shareDoc(html: string, text: string, title: string): Promise<'pdf' | 'text'> {
  if (Print?.printToFileAsync) {
    try {
      const { uri } = await Print.printToFileAsync({ html });
      if (uri && Sharing?.shareAsync) {
        const ok = Sharing.isAvailableAsync ? await Sharing.isAvailableAsync() : true;
        if (ok) { await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' }); return 'pdf'; }
      }
    } catch { /* fall through to text */ }
  }
  try { await Share.share({ message: text, title }); } catch { /* ignore */ }
  return 'text';
}

/**
 * The system share sheet with a plain message.
 *
 * TF-25 and TF-33 asked for Facebook, Instagram, WhatsApp and TikTok buttons.
 * This is that feature: the sheet iOS and Android open here already lists every
 * app the phone has, so it reaches all four plus whatever the client actually
 * uses, keeps working when any of them changes its SDK, and — unlike a row of
 * per-network buttons — never offers a network the client has not installed.
 * Repple gets no posting access from it either: the user picks the destination
 * and confirms the post themselves.
 */
export async function shareText(message: string, title: string): Promise<void> {
  // A dismissed share sheet rejects on some platforms. The user changing their
  // mind is not an error and must not raise one at the call site.
  try { await Share.share({ message, title }); } catch { /* dismissed */ }
}

const page = (title: string, body: string, brand = 'Repple', accent?: string) =>
  `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
   body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;padding:26px;margin:0}
   .h{background:${accent ? accent : 'linear-gradient(135deg,#2dd4bf,#0d9488)'};color:#fff;padding:18px 22px;border-radius:14px}
   .h h1{margin:0;font-size:22px} .h p{margin:4px 0 0;opacity:.9;font-size:13px}
   table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px}
   th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #e2e8f0}
   th{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
   .r{text-align:right} .tot td{font-weight:800;border-top:2px solid #0f172a}
   .foot{margin-top:20px;color:#94a3b8;font-size:11px}
   </style></head><body><div class="h"><h1>${title}</h1><p>${brand}</p></div>${body}<p class="foot">Generated by ${brand}</p></body></html>`;

export interface PlanMealRow { slot: string; name: string; K: number; P: number; C: number; F: number }

export function mealPlanDoc(name: string, targetKcal: number, meals: PlanMealRow[], avoid: string[] = [], brand = 'Repple', accent?: string): { html: string; text: string } {
  const first = (name || '').split(' ')[0] || 'Your';
  const rows = meals.map((m) => `<tr><td><b>${m.slot}</b><br><span style="color:#64748b">${m.name}</span></td><td class="r">${m.K}</td><td class="r">${m.P}g</td><td class="r">${m.C}g</td><td class="r">${m.F}g</td></tr>`).join('');
  const totK = meals.reduce((a, m) => a + m.K, 0), totP = meals.reduce((a, m) => a + m.P, 0), totC = meals.reduce((a, m) => a + m.C, 0), totF = meals.reduce((a, m) => a + m.F, 0);
  const avoidLine = avoid.length ? `<p style="color:#64748b;font-size:13px;margin-top:10px">Excludes: ${avoid.join(', ')}</p>` : '';
  const body = `<h2 style="margin-top:20px">${first}'s meal plan</h2><p style="color:#64748b;margin:0">Daily target ~${targetKcal.toLocaleString()} kcal</p>${avoidLine}
    <table><tr><th>Meal</th><th class="r">Kcal</th><th class="r">P</th><th class="r">C</th><th class="r">F</th></tr>
    ${rows}<tr class="tot"><td>Total</td><td class="r">${totK}</td><td class="r">${totP}g</td><td class="r">${totC}g</td><td class="r">${totF}g</td></tr></table>`;
  const text = `${first}'s meal plan (${brand}) — target ~${targetKcal} kcal\n` +
    meals.map((m) => `• ${m.slot}: ${m.name} — ${m.K} kcal (P${m.P}/C${m.C}/F${m.F})`).join('\n') +
    `\nTotal: ${totK} kcal · P${totP} C${totC} F${totF}` + (avoid.length ? `\nExcludes: ${avoid.join(', ')}` : '');
  return { html: page('Meal Plan', body, brand, accent), text };
}

// ── A client's body-composition record, in three shapes ──────────────────────
//
// TF-21 asked of the share button on the progress screen: "what gets sent and
// in what format?". It had one answer — a PDF, or silently plain text on a
// build without expo-print — and no way to find that out except by sending it.
// There are now three, each named before anything leaves the phone:
//
//   progressDoc      a one-page report a person reads
//   progressCsv      a file another app imports
//   progressSummary  a few lines for a message, a story or a post
//
// All three are built from the same rows so they cannot disagree, and all three
// are pure: no React, no side effects, nothing read from a provider. The share
// itself is a separate step.
//
// TF-37 added a fourth thing they have in common: the client's weight unit is
// an argument to the two a person reads, defaulting to kilograms. The CSV is
// deliberately not among them — progressExport.ts sets out why at the header
// constant, and the share sheet says so out loud before the file leaves.

// The data half lives in ./progressExport — no react-native, so the suite can
// assert on it. Re-exported here so no call site had to move.
export {
  progressChange, progressChangeLines, progressSpanLabel, progressSummary,
  progressCsv, PROGRESS_CSV_HEADER,
} from './progressExport';
export type { ProgressRow, ProgressMetric } from './progressExport';

/**
 * The one-page report, in the unit the client reads in (TF-37).
 *
 * The unit is a parameter and not a hook for the reason the header of this
 * section gives: all three builders are pure, and a document builder that
 * reached into a provider could not be handed a client's row from the coach's
 * side without dragging their screen's context along with it. `scans.tsx`
 * passes what `useSettings()` already gave it.
 *
 * It defaults to kilograms so that every existing call site — and the node
 * suite, which asserts on these without a settings provider to give it one —
 * keeps producing exactly the document it produced before.
 */
export function progressDoc(name: string, rows: ProgressRow[], brand = 'Repple', accent?: string, unit: WeightUnit = 'kg'): { html: string; text: string } {
  const first = (name || '').split(' ')[0] || 'Your';
  // Point by point, because each cell is a reading rather than a change, and
  // through weightIn so a missing figure stays missing: `figure()` turns the
  // null back into the em-dash the caption promises, and never into a 0 kg
  // scan of somebody nobody weighed that day. Body fat goes past untouched —
  // a percentage of a body is the same percentage in pounds.
  const w = (kg: number | null) => figure(weightIn(kg, unit));
  const tr = rows.map((r) => `<tr><td>${dayLabel(r.date)}</td><td class="r">${w(r.weightKg)}</td><td class="r">${figure(r.bodyFatPct, '%')}</td><td class="r">${w(r.muscleKg)}</td></tr>`).join('');
  const lines = progressChangeLines(rows, unit);
  // A single scan gets a sentence saying so. The previous version printed a
  // delta line built from `rows[0]` and `rows[last]` being the same row, which
  // reported "weight 0.0kg · body fat 0.0%" — a client's first scan rendered as
  // having achieved nothing.
  const note = lines.length ? lines.join(' · ')
    : rows.length ? 'One scan so far — a change needs two.'
    : 'No scans recorded yet.';
  // Said in the document, not just on the screen that made it. This page is
  // built to be sent, and the coach who opens it is entitled to know that the
  // pounds in it were measured in kilograms — otherwise the report and the
  // client's own scan sheet look like two different readings.
  const converted = convertedNote(unit);
  const body = `<h2 style="margin-top:20px">${first}'s progress</h2><p style="color:#64748b;margin:0">${note}</p>
    <p style="color:#94a3b8;margin:6px 0 0;font-size:12px">${progressSpanLabel(rows)}. A dash means that scan did not record the figure.${converted ? ' ' + converted : ''}</p>
    <table><tr><th>Date</th><th class="r">Weight (${unit})</th><th class="r">Body fat</th><th class="r">Muscle (${unit})</th></tr>${tr}</table>`;
  const text = progressSummary(name, rows, brand, unit) + '\n\n' +
    rows.map((r) => `• ${dayLabel(r.date)}: ${figure(weightIn(r.weightKg, unit), ' ' + unit)} · ${figure(r.bodyFatPct, '%')} BF · ${figure(weightIn(r.muscleKg, unit), ' ' + unit)} muscle`).join('\n');
  return { html: page('Progress', body, brand, accent), text };
}

// ── Owner investor/board report ──────────────────────────────────────────────
export interface OwnerReportData {
  trainers: number;
  clients: number;
  sessions30: number;
  payroll30: number | null;
  atRiskCount: number;
  atRiskClients: number;
  /** NULL with no trainers — an average over an empty set, not zero. */
  avgClientsPerTrainer: number | null;
  cohorts: { label: string; total: number; active: number; pct: number }[];
  generatedOn: string;
}

export function ownerReportDoc(d: OwnerReportData, brand = 'Repple'): { html: string; text: string } {
  const metrics: [string, string][] = [
    ['Trainers', String(d.trainers)],
    ['Clients', String(d.clients)],
    ['Sessions · 30d', String(d.sessions30)],
    // The last surface in the owner app that still said "$". Everything the
    // gym is denominated in is AED — every money column in the operating record
    // defaults to it and `money()` does too — so a report that went out with a
    // dollar sign was the one artefact of the lot that leaves the app and gets
    // forwarded. `payroll30` is a MAJOR-unit amount (session_fee is whole
    // currency and payroll30For multiplies by it) and `money()` takes minor
    // units, which is the mismatch that once printed AED 63.00 for a gym owed
    // AED 6,300 — so it is converted here rather than assumed either way.
    ['Value of those sessions', money(d.payroll30 == null ? null : Math.round(d.payroll30 * 100)) ?? '\u2014'],
    ['Avg clients / trainer', d.avgClientsPerTrainer == null ? '\u2014' : String(d.avgClientsPerTrainer)],
    ['Trainers needing a look', String(d.atRiskCount)],
    ['Clients with those trainers', String(d.atRiskClients)],
  ];

  const mRows = metrics.map(([k, v]) => `<tr><td>${k}</td><td class="r">${v}</td></tr>`).join('');
  const cRows = d.cohorts.map((c) => `<tr><td>${c.label}</td><td class="r">${c.active}/${c.total}</td><td class="r">${c.pct}%</td></tr>`).join('');
  const body = `
    <table><thead><tr><th>Metric</th><th class="r">Value</th></tr></thead><tbody>${mRows}</tbody></table>
    <table><thead><tr><th>Cohort (signup)</th><th class="r">Active</th><th class="r">Retention</th></tr></thead><tbody>${cRows || '<tr><td colspan="3">No cohorts yet</td></tr>'}</tbody></table>`;
  const html = page(`Platform report — ${d.generatedOn}`, body, brand);
  const text = `${brand} — Platform report (${d.generatedOn})\n` +
    metrics.map(([k, v]) => `${k}: ${v}`).join('\n') +
    (d.cohorts.length ? '\n\nCohort retention:\n' + d.cohorts.map((c) => `${c.label}: ${c.active}/${c.total} (${c.pct}%)`).join('\n') : '');
  return { html, text };
}
