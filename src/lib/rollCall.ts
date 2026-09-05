// The list of who is in the building, on paper.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// The Door screen says out loud that Inside now "is the figure somebody would
// read out in an evacuation", and there was no way to get it out of the tablet.
// During an alarm the only copy of the roll call is inside the building, on a
// device that needs wifi, held by whoever happened to be at the desk — and the
// one instruction every evacuation procedure in the world gives is to leave and
// not go back in.
//
// So: a printable snapshot, and the paper says what it is. A roll call that
// does not print the minute it was taken is worse than none, because the person
// reading it out has no way to know it predates the four people who came in
// while the printer was warming up.
//
// ── Why it carries the next of kin and the medical note ───────────────────
//
// Because they are read at the same moment by the same person. `medical_note`
// is the GYM's operational note — supabase/parts/197 argues at length that it
// is written by the desk, from what the member told the desk, for the people
// standing on the floor, which is why staff may read it at all. It is not the
// client's own injury record: parts 90, 91 and 96 keep that the client's, and
// nothing here reads, writes or widens any of it.
//
// A printed sheet with a member's phone number and a medical note on it is
// personal data leaving the screen, and the header says so — it is a document
// to hold onto and destroy afterwards rather than leave on the desk.
//
// ── Whose clock the sheet is on ────────────────────────────────────────────
//
// Every time on this page used to be `toLocaleTimeString()` and `toLocaleString()`
// with no zone, which is the READER's clock — the machine that happened to have
// the console open when somebody pressed print. That is wrong here in a way it
// is not wrong on a screen, and for a reason peculiar to paper.
//
// A screen can be argued about. The person looking at it knows which laptop
// they are sitting at, and if the times look four hours out they can ask. This
// sheet is PRINTED and pinned to a door. It outlives the browser that drew it,
// it is read by whoever is holding it in a car park, and there is nobody left
// to ask whose clock "09:14" was. A gym in Dubai whose owner prints the roll
// call from a laptop still set to London hands the fire marshal a sheet saying
// people arrived at 05:10 for a class that started at 09:00 — and the one
// number on it that matters, "in since", is the one used to decide whether
// somebody has been unaccounted for long enough to send anybody back in.
//
// So the clock on this sheet is the GYM's by definition, and `zone` is carried
// on `RollCall` rather than read at the point of printing: the document is
// built by a pure function and rendered by another, and a zone that only
// existed inside the renderer could not be asserted. Where the gym has not set
// one, `src/lib/gymWhen.ts` falls back to the reader's zone and the sheet SAYS
// SO in its own caveats — on paper more than anywhere else, because "printed
// on a clock we cannot name" is a thing the sheet has to carry with it.
//
// ── Pure ───────────────────────────────────────────────────────────────────
//
// No DOM, no Supabase, no React. The screen hands it rows it has already read
// and gets back a document; the caveats can therefore be asserted without a
// browser, and they are the half that decides whether the paper lies.
import { gymDateTimeText, gymTimeText, whoseClockNote } from './gymWhen';

/** One line of the roll call. */
export interface RollCallPerson {
  /** Null is a visit the desk could not attribute, which is a real person. */
  name: string | null;
  /** When they came in. ISO instant. */
  inSinceIso: string;
  /** "Name — number", or whichever half the gym has. Null is nothing recorded. */
  emergency: string | null;
  /** What the floor was told. Null is nothing recorded. */
  medical: string | null;
}

export interface RollCall {
  gymName: string | null;
  printedAtIso: string;
  /**
   * `tenants.timezone`, or null when the gym has not set one. The zone every
   * time on the printed sheet is drawn in — see the header: the paper is the
   * gym's, so the clock on it is too, and it cannot be recovered later from a
   * sheet in somebody's hand.
   */
  zone: string | null;
  people: RollCallPerson[];
  /**
   * What the paper cannot say, said on the paper. Never empty: the first line
   * is always the minute it was taken, because a roll call with no time on it
   * is read as current for the rest of the evening.
   */
  caveats: string[];
}

/** The gym's own record of a person, as much of it as a roll call needs. */
export interface RollCallRecord {
  emergencyName: string | null;
  emergencyPhone: string | null;
  medicalNote: string | null;
}

/** One open visit, as much of it as a roll call needs. */
export interface RollCallVisit {
  memberId: string | null;
  memberName: string | null;
  enteredAt: string;
}

/** "Ada Kowalski — 050 111 2222", or whichever half exists, or null. */
export function emergencyLine(r: RollCallRecord | null | undefined): string | null {
  if (!r) return null;
  const bits = [r.emergencyName?.trim(), r.emergencyPhone?.trim()]
    .filter((b): b is string => !!b);
  return bits.length ? bits.join(' — ') : null;
}

/**
 * Build the roll call.
 *
 * `records` is null when the gym's own notes could not be read, and that is not
 * the same as a gym that has recorded none: the first prints "not read" against
 * every line and says so in the caveats, the second prints a dash. An owner
 * handed a sheet of blank emergency contacts must be able to tell which of the
 * two they are holding, at the one moment nobody has time to go and check.
 */
export function buildRollCall(input: {
  gymName: string | null;
  inside: RollCallVisit[];
  records: Map<string, RollCallRecord> | null;
  /** Visits still open from an earlier day. Not people in the building, and
   *  deliberately not on the list — but their number is on the paper. */
  openFromEarlierDays: number;
  /**
   * `tenants.timezone`. Optional, and omitting it is NOT the same as a caller
   * that does not care: it means the reader's own zone is used and the sheet
   * prints `NO_ZONE_NOTE` in its caveats, which is what a gym that has not set
   * a timezone gets everywhere else in this codebase. It is optional rather
   * than required because a screen that has not read `tenants` yet still has to
   * be able to print the list — an evacuation is not the moment to refuse a
   * roll call over a settings row.
   */
  zone?: string | null;
  nowIso?: string;
}): RollCall {
  const printedAtIso = input.nowIso ?? new Date().toISOString();
  const people: RollCallPerson[] = [...input.inside]
    // Oldest arrival first. The person who has been in longest is the one
    // furthest from the door and the least likely to have heard the alarm.
    .sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt))
    .map((v) => {
      const rec = v.memberId && input.records ? input.records.get(v.memberId) ?? null : null;
      return {
        name: v.memberName,
        inSinceIso: v.enteredAt,
        emergency: emergencyLine(rec),
        medical: rec?.medicalNote?.trim() || null,
      };
    });

  const unnamed = people.filter((p) => !p.name).length;
  const caveats: string[] = [
    'This is a snapshot of the minute it was printed. Anybody who arrived after that is not on it, and anybody who left without scanning out still is.',
  ];
  // Second, directly under the sentence about the minute it was printed,
  // because it qualifies that sentence: which minute, on whose clock. Null is
  // the gym having set a timezone, in which case there is nothing to say — the
  // times are the gym's and that is what a reader already assumes.
  const clock = whoseClockNote(input.zone ?? null);
  if (clock) caveats.push(clock);
  if (input.records === null) {
    caveats.push(
      'The gym’s own notes did not load, so no next-of-kin number and no medical note could be printed. Those columns are UNKNOWN on this sheet, not empty — do not read a blank as “nobody to ring”.',
    );
  }
  if (unnamed > 0) {
    caveats.push(
      `${unnamed} of these ${unnamed === 1 ? 'is a visit' : 'are visits'} the desk could not put a name to. ${unnamed === 1 ? 'It is' : 'They are'} still ${unnamed === 1 ? 'a person' : 'people'} in the building and ${unnamed === 1 ? 'is' : 'are'} counted here.`,
    );
  }
  if (input.openFromEarlierDays > 0) {
    caveats.push(
      `${input.openFromEarlierDays} check-${input.openFromEarlierDays === 1 ? 'in is' : 'ins are'} still open from an earlier day and ${input.openFromEarlierDays === 1 ? 'is' : 'are'} deliberately NOT on this list — ${input.openFromEarlierDays === 1 ? 'it is a row' : 'they are rows'} nobody closed rather than ${input.openFromEarlierDays === 1 ? 'a person' : 'people'} standing in the gym.`,
    );
  }
  caveats.push(
    'It carries phone numbers and, where the desk recorded one, a medical note. Take it with you and destroy it afterwards rather than leaving it on the desk.',
  );
  return { gymName: input.gymName, printedAtIso, zone: input.zone ?? null, people, caveats };
}

/** HTML entities, so a member called O'Neill & Sons prints as their name rather
 *  than as markup. Everything below goes through it without exception. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A row whose time will not parse still names a person who is in the building.
// `gymTimeText` is null for exactly that — an instant that is not one — so it
// prints with the time withheld rather than the row being left off, which is
// what the old `Number.isNaN(Date.parse(...))` guard did and is the behaviour
// worth keeping.
//
// Two digits on both halves, as before: this is read down a column under an
// alarm, and a ragged 9:05 next to 10:41 costs a beat that column does not have.
const hhmm = (iso: string, zone: string | null): string =>
  gymTimeText(iso, zone, { hour: '2-digit', minute: '2-digit' }) ?? '—';

/**
 * The whole sheet, as a document a browser can print.
 *
 * Black on white with no colour anywhere: this is read under an alarm, quite
 * possibly through a photocopier, and by torchlight in a car park in January.
 */
export function rollCallHtml(r: RollCall): string {
  // The gym's zone, the reader's locale. Null is a `printedAtIso` that is not
  // an instant at all, and the raw string is printed instead of nothing: a
  // sheet whose header says "Printed —" is a sheet nobody can date, which is
  // the single failure the first caveat exists to prevent.
  const when = gymDateTimeText(r.printedAtIso, r.zone) ?? r.printedAtIso;
  const head = escapeHtml(r.gymName?.trim() || 'This gym');
  const rows = r.people.map((p) => `<tr>
      <td>${escapeHtml(p.name ?? 'not identified')}</td>
      <td class="mono">${escapeHtml(hhmm(p.inSinceIso, r.zone))}</td>
      <td>${p.emergency ? escapeHtml(p.emergency) : '<span class="none">none recorded</span>'}</td>
      <td>${p.medical ? escapeHtml(p.medical) : '<span class="none">—</span>'}</td>
      <td class="tick"></td>
    </tr>`).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Roll call — ${head}</title>
<style>
  body { font: 12pt/1.4 system-ui, sans-serif; color: #000; background: #fff; margin: 18mm; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  p.when { margin: 0 0 6mm; font-size: 11pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #000; padding: 2mm 2.5mm; text-align: left; vertical-align: top; font-size: 11pt; }
  th { font-size: 9.5pt; text-transform: uppercase; letter-spacing: .04em; }
  .mono { font-family: ui-monospace, monospace; white-space: nowrap; }
  .none { color: #555; }
  .tick { width: 16mm; }
  ul { margin: 6mm 0 0; padding-left: 5mm; font-size: 10pt; }
  li { margin-bottom: 1.5mm; }
  @page { margin: 12mm; }
</style></head>
<body>
  <h1>Roll call — ${head}</h1>
  <p class="when">${escapeHtml(String(r.people.length))} in the building. Printed ${escapeHtml(when)}.</p>
  <table>
    <thead><tr>
      <th>Who</th><th>In since</th><th>In an emergency, ring</th><th>The floor was told</th><th>Out</th>
    </tr></thead>
    <tbody>
${rows || '<tr><td colspan="5">Nobody was checked in when this was printed.</td></tr>'}
    </tbody>
  </table>
  <ul>${r.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
</body></html>`;
}
