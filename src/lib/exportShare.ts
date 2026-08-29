// Share/export helpers. Generates a branded PDF when the native modules are
// present (expo-print / expo-sharing, after the next build); otherwise falls
// back to the built-in Share sheet with a formatted text version — so this works
// TODAY over-the-air and upgrades to real PDFs automatically once rebuilt.
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

let Print: any = null;
let Sharing: any = null;
try { Print = require('expo-print'); } catch { /* not in this build yet */ }
try { Sharing = require('expo-sharing'); } catch { /* optional */ }

export const pdfExportAvailable = () => !!Print;

// ── Calendar (.ics) export ───────────────────────────────────────────────────
// Standards-compliant iCalendar so a client/coach can drop their sessions into
// Apple Calendar, Google Calendar, etc. Writes a real .ics file when the native
// file-system module is present (after a rebuild); otherwise falls back to the
// Share sheet with the calendar text, so it works over-the-air today.
let FileSystem: any = null;
try { FileSystem = require('expo-file-system'); } catch { /* lights up after a rebuild */ }

/**
 * Whether a real file can be written and handed to the share sheet.
 *
 * The companion of pdfExportAvailable, and it exists for the same reason: a
 * button that offers "CSV" and then shares a wall of comma-separated text
 * because this build has no expo-file-system has told the user the wrong thing
 * about what they just sent. A screen can ask first and word itself honestly.
 */
export const fileExportAvailable = () => !!(FileSystem?.cacheDirectory && Sharing?.shareAsync);

export { buildIcs, type IcsEvent } from './ics';

export async function shareTextFile(content: string, filename: string, mime: string, title: string): Promise<'file' | 'text'> {
  if (FileSystem?.cacheDirectory && Sharing?.shareAsync) {
    try {
      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8' });
      const ok = Sharing.isAvailableAsync ? await Sharing.isAvailableAsync() : true;
      if (ok) { await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: title }); return 'file'; }
    } catch { /* fall through */ }
  }
  try { await Share.share({ message: content, title }); } catch { /* ignore */ }
  return 'text';
}

export async function shareIcs(ics: string, filename: string, title: string): Promise<'file' | 'text'> {
  if (FileSystem?.cacheDirectory && Sharing?.shareAsync) {
    try {
      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, ics, { encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8' });
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

// The data half lives in ./progressExport — no react-native, so the suite can
// assert on it. Re-exported here so no call site had to move.
export {
  progressChange, progressChangeLines, progressSpanLabel, progressSummary,
  progressCsv, PROGRESS_CSV_HEADER,
} from './progressExport';
export type { ProgressRow, ProgressMetric } from './progressExport';

export function progressDoc(name: string, rows: ProgressRow[], brand = 'Repple', accent?: string): { html: string; text: string } {
  const first = (name || '').split(' ')[0] || 'Your';
  const tr = rows.map((r) => `<tr><td>${dayLabel(r.date)}</td><td class="r">${figure(r.weightKg)}</td><td class="r">${figure(r.bodyFatPct, '%')}</td><td class="r">${figure(r.muscleKg)}</td></tr>`).join('');
  const lines = progressChangeLines(rows);
  // A single scan gets a sentence saying so. The previous version printed a
  // delta line built from `rows[0]` and `rows[last]` being the same row, which
  // reported "weight 0.0kg · body fat 0.0%" — a client's first scan rendered as
  // having achieved nothing.
  const note = lines.length ? lines.join(' · ')
    : rows.length ? 'One scan so far — a change needs two.'
    : 'No scans recorded yet.';
  const body = `<h2 style="margin-top:20px">${first}'s progress</h2><p style="color:#64748b;margin:0">${note}</p>
    <p style="color:#94a3b8;margin:6px 0 0;font-size:12px">${progressSpanLabel(rows)}. A dash means that scan did not record the figure.</p>
    <table><tr><th>Date</th><th class="r">Weight (kg)</th><th class="r">Body fat</th><th class="r">Muscle (kg)</th></tr>${tr}</table>`;
  const text = progressSummary(name, rows, brand) + '\n\n' +
    rows.map((r) => `• ${dayLabel(r.date)}: ${figure(r.weightKg, ' kg')} · ${figure(r.bodyFatPct, '%')} BF · ${figure(r.muscleKg, ' kg')} muscle`).join('\n');
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
    ['Value of those sessions', d.payroll30 == null ? '—' : '$' + d.payroll30.toLocaleString()],
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
