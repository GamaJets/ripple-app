// The check-in, as the coach it was addressed to should read it.
//
// ── What was actually being thrown away ────────────────────────────────────
//
// `check_ins` carries seven things a client fills in once a week: a weight, four
// self-ratings — energy, sleep, mood, adherence — and a free-text NOTE to their
// coach. src/ui/checkins.tsx writes all seven and its own header says why the
// note matters: "this is a form somebody sits down and fills in once a week,
// with a written note to their coach in it."
//
// Every coach-side read in the repository was measured. There were four:
//
//   app/(trainer)/client-goals.tsx     'at, weight_kg'
//   app/(trainer)/client-nutrition.tsx 'at, weight_kg'
//   src/lib/clientDrift.ts             'user_id, at'      — a timestamp only
//   src/ui/roster.tsx                  reads `adherence`, for the roster figure
//
// So the weight was read, the timestamp was read, adherence was read as a
// number — and energy, sleep, mood and the note were read by NOTHING. A client
// writes their coach a paragraph about their week every Monday and the app has
// never once shown it to them. It is not a permissions problem and it never
// was: `check_ins_coach_read` is `using (is_my_client(user_id))`, RLS is
// row-level and does not narrow columns, and an anon probe of the full select
// list comes back 42501 from `is_my_client` — which is the policy refusing the
// ROWS, and therefore proof the column list itself is valid and granted. The
// coach could always have asked. Nobody wrote the query.
//
// ── The three ways this is wrong in a way that reads fine ──────────────────
//
// 1. A RATING OF FOUR IS NOT FOUR PER CENT. `check_ins.adherence` is a 1-5
//    self-rating (the Rating control on the client's check-in screen), and
//    src/ui/roster.tsx carries a comment about the day that reached a coach:
//    every trainer surface renders adherence as a PERCENTAGE and
//    `atRiskClient()` flags anything under 80, so a client who rated themselves
//    4 out of 5 was shown as "4% adherence" and flagged at risk. One conversion
//    lives here now, with the scale it converts FROM named in the type, so the
//    next screen to show this number cannot get it wrong quietly.
//
// 2. AN UNANSWERED RATING IS NOT A ZERO. `rowToCI` in src/ui/checkins.tsx does
//    `Number(r.energy) || 0`, which is right for the client's own history
//    (their sliders always produce a value) and would be a lie on this side: a
//    row written before a field existed, or by any other writer, would show a
//    coach "energy 0/5" for somebody who never answered. Nothing below turns an
//    absent value into a number. Out of range is out of range and reads as
//    unknown.
//
// 3. AN EMPTY LIST UNDER 'error' IS NOT "THEY HAVE NOT CHECKED IN". This is the
//    house rule (src/ui/loadStatus.ts) and it bites hardest here, because the
//    sentence a collapse produces — "they have not checked in" — is an
//    accusation about a person, offered to the one person in a position to act
//    on it. `checkInGapLine` is the four answers kept apart.
import type { LoadStatus } from '../ui/loadStatus';

// ── Why the select list is NOT exported from here ─────────────────────────
//
// The obvious tidy-up is a `COACH_CHECKIN_COLS` constant in this file that
// every screen imports, and it would be a real regression.
// scripts/check-schema.mjs resolves a `.select(NAME)` only against constants
// declared in the SAME FILE — `sourceOf()` builds its map from that file's own
// text and `stringExpr()` returns null for anything else — so a select list
// arriving by import is a list the schema check cannot read, and a read it
// cannot read is a read it cannot verify against the live database. That check
// exists because `workouts.session_mins` was written, committed, generated into
// setup.sql and never run, and no workout saved for two days for anybody.
// app/(trainer)/client.tsx says the same thing about TRAINING_SUMMARY_COLS in
// its own words.
//
// So each screen declares its own literal, and what is shared is the READING of
// the row below. The columns a coach needs are:
//
//     id, at, weight_kg, energy, sleep, mood, adherence, note
//
/** The scale every self-rating on this row is on. Named, because the one time
 *  it was assumed to be a percentage a client was flagged at risk for rating
 *  themselves 4 out of 5. */
export const RATING_MAX = 5;

/** A row as PostgREST hands it back. Everything optional and unknown-typed
 *  because this is parsed off the wire, and a column that arrives null, absent
 *  or as a string must land on "unknown" rather than on a number. */
export interface CheckInRow {
  id?: unknown; at?: unknown; weight_kg?: unknown;
  energy?: unknown; sleep?: unknown; mood?: unknown; adherence?: unknown; note?: unknown;
}

/**
 * One client's check-in, as this app is willing to state it.
 *
 * Every rating is `number | null` and null means the client did not answer or
 * the value on the row is not a rating. There is no zero: see (2) above.
 */
export interface CoachCheckIn {
  id: string;
  at: string;
  /** Kilograms, as stored. Null when the row carries no weight — a nullable
   *  column, and a check-in with no weigh-in is an ordinary thing. */
  weightKg: number | null;
  energy: number | null;
  sleep: number | null;
  mood: number | null;
  /** The client's own 1-5 rating of how well they stuck to the plan. NOT a
   *  percentage. Use `adherencePercent` if a percentage is what is wanted. */
  adherence: number | null;
  /** What they wrote, or null when they wrote nothing. Never the empty string:
   *  an empty note and no note are the same event and rendering one of them as
   *  a blank quote block is a screen that looks broken. */
  note: string | null;
}

/**
 * A rating, or null.
 *
 * Whole numbers from 1 to `RATING_MAX` and nothing else. A 0 is not a rating on
 * a 1-5 scale — it is the shape `Number(null) || 0` produces — and a 7 is not
 * one either. Strings are accepted because PostgREST returns numerics as
 * strings on some column types and refusing them would silently blank a real
 * answer.
 */
export function rating(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n >= 1 && n <= RATING_MAX ? n : null;
}

/** "4/5", or null when there is no rating to state. A caller that interpolates
 *  this into prose must branch on the null first — see scripts/check-prose.mjs
 *  on what a dash does as the subject of a sentence. */
export function ratingLabel(v: unknown): string | null {
  const n = rating(v);
  return n == null ? null : `${n}/${RATING_MAX}`;
}

/**
 * A 1-5 self-rating as the percentage every other coach surface renders.
 *
 * The conversion src/ui/roster.tsx already does inline, lifted out so there is
 * one of it. Rounded, because 3/5 is 60 and nobody wants 60.000000000000006.
 */
export function adherencePercent(v: unknown): number | null {
  const n = rating(v);
  return n == null ? null : Math.round((n / RATING_MAX) * 100);
}

/** A weight off the row, or null. Zero is refused: `check_ins.weight_kg` is
 *  nullable, nobody weighs nothing, and a 0 here is the same coercion artefact
 *  a 0 rating is. */
export function weightOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** What the client wrote, or null when it was nothing. Trimmed, because a note
 *  of three spaces is not a note and would render as an empty quote. */
export function noteOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * The rows, newest first.
 *
 * Rows with no usable timestamp are dropped rather than sorted to one end: `at`
 * is how a coach decides whether this is about last week or about March, and a
 * check-in with no date is not a thing to put in front of them at all.
 *
 * The tie-break on id is the same reason client-goals.tsx gives about
 * `measurements`: two rows sharing an instant with a comparator returning 0
 * leaves their order to whichever sort the runtime happens to use, so the list
 * reorders itself between renders for no visible reason.
 */
export function readCoachCheckIns(rows: readonly CheckInRow[] | null | undefined): CoachCheckIn[] {
  if (!rows) return [];
  const out: CoachCheckIn[] = [];
  for (const r of rows) {
    const at = typeof r.at === 'string' ? r.at : null;
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    out.push({
      id: r.id == null ? '' : String(r.id),
      at,
      weightKg: weightOf(r.weight_kg),
      energy: rating(r.energy),
      sleep: rating(r.sleep),
      mood: rating(r.mood),
      adherence: rating(r.adherence),
      note: noteOf(r.note),
    });
  }
  return out.sort((a, b) =>
    (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Whole days between then and now, or null when the timestamp is unusable.
 *  Calendar-agnostic on purpose: a coach reading "4 days ago" does not need it
 *  to hinge on which side of midnight the row landed. */
export function daysAgo(at: string, now: number = Date.now()): number | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** "Today", "Yesterday", "4 days ago" — the age of a check-in as a coach says
 *  it. Null when the timestamp cannot be read, which is the caller's cue to
 *  print nothing rather than a dash inside a sentence. */
export function checkInAge(at: string, now: number = Date.now()): string | null {
  const d = daysAgo(at, now);
  if (d == null) return null;
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

/**
 * Why there is no check-in to show, in the coach's words — or null when there
 * IS one, which is the caller's cue that there is no sentence to print.
 *
 * The four answers, and only the last of them is about the client. This is the
 * same discipline src/lib/currencyGap.ts holds for a missing currency, and it
 * matters more here: collapsing the four produces "they have not checked in",
 * which is an accusation about a person, delivered to the one person who will
 * act on it. A coach told that about a client who checks in every Monday will
 * open a conversation that starts with them being wrong.
 *
 * `who` is a first name the caller has already established. Passing an unknown
 * name in here is the defect scripts/check-prose.mjs exists to catch.
 */
export function checkInGapLine(status: LoadStatus, count: number, who: string): string | null {
  if (count > 0) return null;
  switch (status) {
    case 'loading':
      return 'Reading their check-ins…';
    case 'error':
      return `Their check-ins could not be read, so whether ${who} has sent any is not known. That is a read that failed rather than a client who has not written — try again in a moment.`;
    case 'partial':
      // A truncated read that came back with nothing is a contradiction — the
      // cap cannot bite on an empty set — but 'partial' can also arrive from a
      // caller combining several reads, and answering it as 'ready' would state
      // a fact about the client off an incomplete answer.
      return `Only part of their history came back and none of it was a check-in, so whether ${who} has sent any is not established.`;
    case 'ready':
      return `${who} has not sent a check-in yet. The weekly form is on their app under Check In, and a nudge from you is usually what starts it.`;
  }
}

/**
 * The one-line summary of a check-in, for a row a coach scans rather than
 * reads.
 *
 * Only the ratings that were actually given. Four labels where two were
 * answered would put a dash in front of a coach twice on one line and say
 * nothing; this drops the unanswered ones and returns null when none of the
 * four was given at all, so a caller can withhold the row rather than draw an
 * empty one.
 *
 * All four Title Case, matching app/(client)/report.tsx character for
 * character. That is not a preference: this exact line shipped once as
 * "Energy 4/5 · sleep 3/5 · mood 4/5 · adherence 4/5", one row under four
 * labels that DID match, and it is the second of the two reports that
 * scripts/check-caps.mjs was written from. The client and their coach are now
 * looking at the same four words about the same row, so the two must not drift.
 */
export function ratingsLine(c: CoachCheckIn): string | null {
  const parts: string[] = [];
  const push = (label: string, v: number | null) => { if (v != null) parts.push(`${label} ${v}/${RATING_MAX}`); };
  push('Energy', c.energy);
  push('Sleep', c.sleep);
  push('Mood', c.mood);
  push('Adherence', c.adherence);
  return parts.length ? parts.join(' · ') : null;
}
