// Coach · the facts a leaderboard row was already holding and never printed.
//
// ── what was on the row, and what it said ──────────────────────────────────
//
// `useRoster` (src/ui/roster.tsx) fetches five more things about every client
// than app/(trainer)/leaderboard.tsx has ever drawn: `lastActive`, `unread`,
// `injuries` (each flagged `isNew` when it was disclosed inside a fortnight),
// `joinedAt` and the most recent scan's `metrics`. They cost nothing extra —
// they are on the row by the time the board renders — and the board was
// throwing all five away and printing one self-reported rating.
//
// That is not a cosmetic gap. The board's own header is careful to say the
// order is "what each client last said about themselves", and a coach reads it
// to decide who to ring. Sixty per cent from somebody who joined nine days ago
// is a normal first fortnight. The same sixty from somebody who has been on the
// book two years, has not been seen for a month and has an unread message
// waiting is the call to make this morning. The row had every one of those
// facts in hand and said neither sentence.
//
// ── null is not zero here, four separate times ─────────────────────────────
//
// Each rule below returns null for "nothing to say" and never a neutral-looking
// stand-in, because on this particular screen every one of the five fields has
// a real absent state that a zero would misreport:
//
//   · `unread` is `null` when `coach_unread_counts` could not be read, and 0
//     when nobody is waiting. Printing both as "0" tells a coach that nobody
//     has messaged them on the one screen that exists to say who has. The
//     unknown case prints the dash this app prints for every unmeasured figure
//     and says so out loud to a screen reader; the nobody-waiting case draws
//     nothing, because a badge saying 0 is a badge.
//   · `lastActive` is already a display string and it carries two sentinels of
//     its own — '—' when the activity pages hit their row cap (unknown), and
//     'no activity yet' when the read was whole and there genuinely is none.
//     Wrapping either in "last seen …" makes a sentence out of a non-answer,
//     so they are passed through as themselves.
//   · `joinedAt` is null for a client whose join date nothing recorded. A
//     missing tenure is not "joined today", and this returns null rather than
//     letting `daysBetween` decide something from a blank.
//   · `metrics` is undefined until the client's first scan carrying the figure.
//     No scan is not a score of zero.
//
// Framework-free and synchronous on purpose: every sentence this screen puts
// beside somebody's name is decided here and asserted in leaderboardFacts.test.ts,
// rather than being composed inline in JSX where nothing can reach it.
import type { RosterClient } from './trainerMock';
import { daysBetween } from './bodyFigures';
import { lastActiveLine } from './lastActiveLine';

/** Exactly the roster fields these rules read, taken from `RosterClient` rather
 *  than re-declared — a field that changes shape there must not go on quietly
 *  meaning something else here. */
export type RowClient = Pick<RosterClient, 'joinedAt' | 'lastActive' | 'unread' | 'injuries' | 'metrics'>;

/**
 * How long this person has been on the coach's book, for the caption.
 *
 * Through `daysBetween` in src/lib/bodyFigures.ts, which reads both sides as
 * LOCAL calendar days: `joinedAt` is a `created_at` timestamptz on one path and
 * can be a bare `YYYY-MM-DD` on another, and a bare date through `new Date()`
 * is UTC midnight — the day before, everywhere west of Greenwich. It also
 * rounds rather than floors, so a genuine week is not reported as six days on
 * the two weekends a year that are 23 or 25 hours long.
 *
 * Null when there is no join date, when it will not parse, or when it is in the
 * FUTURE. A future join date is a clock disagreeing with a server, and "−3 days
 * on your book" is not a fact about anybody; saying nothing is the honest
 * width of what we know.
 *
 * The bands coarsen as they lengthen because that is how the reader thinks
 * about them: the difference between day 3 and day 10 changes what a coach
 * does, and the difference between month 19 and month 20 does not.
 */
export function tenureLabel(joinedAt: string | null | undefined, today: string): string | null {
  if (!joinedAt) return null;
  const d = daysBetween(joinedAt, today);
  if (d == null || d < 0) return null;
  if (d === 0) return 'joined today';
  if (d === 1) return 'joined yesterday';
  if (d < 14) return `${d} days on your book`;
  if (d < 61) return `${Math.round(d / 7)} weeks on your book`;
  // Held under twelve deliberately: 365 days must read as a year and not as
  // "12 months", and `Math.round(364 / 30.44)` is 12.
  if (d < 365) return `${Math.min(11, Math.round(d / 30.44))} months on your book`;
  // 365 rather than 365.25, and the difference is not pedantry: a client's
  // first anniversary is 365 days, and `Math.floor(365 / 365.25)` is 0 — the
  // row read "0 years on your book" on the exact day it should have read one.
  // The quarter-day it ignores costs a day every four years, which lands
  // inside a band that is already only accurate to the year.
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? '' : 's'} on your book`;
}

/**
 * When they were last seen, in the words the roster already decided.
 *
 * `lastActive` arrives as finished display text — "3d ago", "just added", and
 * the two non-answers described at the top of this file. Only the elapsed form
 * gets a prefix; the rest are returned untouched, because "last seen no
 * activity yet" and "last seen —" are both the screen sounding broken, which is
 * the exact failure scripts/check-prose.mjs exists to stop.
 */
export function activityLabel(lastActive: string | null | undefined): string | null {
  const s = String(lastActive ?? '').trim();
  if (!s) return null;
  // '—' is the roster saying the activity pages hit their cap: unknown, not
  // idle. It is shown, because "we do not know when they were last in" is worth
  // a coach's attention, and it is shown as the dash this app uses everywhere
  // else for a figure nobody measured.
  // dash-ok: the dash stands for a figure that could not be read, the app's unknown-not-zero sign (see fig() in src/ui/kit.tsx). Not punctuation.
  if (s === '—') return 'last seen —';
  return /\d+[mhd] ago$/.test(s) ? `last seen ${s}` : s;
}

/** The unread badge, as three distinguishable states. `null` from this function
 *  means draw nothing at all. */
export interface UnreadMark {
  /** What the badge prints, worded here rather than in JSX so the dash case is
   *  a tested string and not a ternary somebody tidies. */
  text: string;
  /** False when this is the dash. Callers colour the two differently — an
   *  unknown must not wear the same urgent badge as three real messages. */
  known: boolean;
  /** The same fact as a sentence, for the row's accessibility label. A badge
   *  reading "3" beside a name is meaningless to a screen reader, and a badge
   *  reading "—" is worse than meaningless. */
  spoken: string;
}

/**
 * Messages from this client the coach has not opened.
 *
 * Zero draws nothing. That is not the same decision as the dash: nobody waiting
 * is a real, read, complete answer, and it deserves silence rather than a badge
 * that trains a coach to ignore badges. A count that could not be read gets the
 * dash, and says so in words to anybody listening rather than looking.
 */
export function unreadMark(unread: number | null | undefined): UnreadMark | null {
  if (unread == null) {
    // dash-ok: the dash stands for a figure that could not be read, the app's unknown-not-zero sign (see fig() in src/ui/kit.tsx). Not punctuation.
    return { text: 'unread —', known: false, spoken: 'their unread message count could not be read' };
  }
  if (!Number.isFinite(unread) || unread <= 0) return null;
  const n = Math.round(unread);
  return { text: `${n} unread`, known: true, spoken: `${n} unread message${n === 1 ? '' : 's'} from them` };
}

export interface InjuryMark {
  /** The badge text. */
  text: string;
  /** True when at least one of these disclosures is recent enough that the
   *  coach has probably not seen it — `isRecent` in src/ui/roster.tsx. Drives
   *  the colour, and nothing else. */
  isNew: boolean;
  /** The badge as a sentence, for the same reason `UnreadMark.spoken` exists. */
  spoken: string;
}

/**
 * What they have disclosed, named but not described.
 *
 * The AREA only — never the note. `RosterClient.injuries` carries the client's
 * own free-text note beside each area, and this screen is a list of twenty
 * people a coach skims: a disclosure written in confidence does not belong in a
 * caption on a ranking. The coach opens the client to read it, which is where
 * the codebase has always put it.
 *
 * `pastInjuries` is deliberately not read. A recovered knee lighting a warning
 * on a leaderboard is the app being alarmed by good news.
 */
export function injuryMark(injuries: RowClient['injuries']): InjuryMark | null {
  const live = (injuries ?? []).filter((i) => i && String(i.area ?? '').trim());
  if (!live.length) return null;
  const fresh = live.filter((i) => i.isNew).length;
  if (live.length === 1) {
    const area = String(live[0].area).trim();
    return live[0].isNew
      ? { text: `New injury · ${area}`, isNew: true, spoken: `a new injury they have disclosed: ${area}` }
      : { text: `Injury · ${area}`, isNew: false, spoken: `an injury they have disclosed: ${area}` };
  }
  const text = fresh ? `${live.length} injuries · ${fresh} new` : `${live.length} injuries`;
  return {
    text,
    isNew: fresh > 0,
    spoken: fresh
      ? `${live.length} injuries they have disclosed, ${fresh} of them new`
      : `${live.length} injuries they have disclosed`,
  };
}

/**
 * One figure off their most recent scan, and always the same one.
 *
 * `ScanMetrics` carries a dozen fields and they are optional independently, so
 * "whichever of these this client happens to have" would put visceral fat on
 * one row and lean trunk mass on the next, in a column a reader would compare
 * down. The InBody score is the only one of them that is a single number about
 * the whole body, so it is that one or nothing.
 *
 * It is a fact printed beside the name and is not folded into the order — the
 * same rule the weight delta on this row has always been held to, and for the
 * reason the screen's header sets out at length.
 */
export function scanFact(metrics: RowClient['metrics']): string | null {
  const s = metrics?.inbodyScore;
  return typeof s === 'number' && Number.isFinite(s) ? `InBody score ${Math.round(s)}` : null;
}

/**
 * The caption fragments for one row, in reading order, with the empty ones
 * already gone.
 *
 * Tenure first because it is the frame every other figure on the row is read
 * inside. The caller joins these with the separator the rest of the row uses;
 * it never has to test any of them for emptiness, which is how a stray " · · "
 * gets on screen.
 */
export function rowFacts(c: RowClient, today: string): string[] {
  return [tenureLabel(c.joinedAt, today), activityLabel(c.lastActive), scanFact(c.metrics)]
    .filter((s): s is string => !!s);
}

/** A fragment as a spoken sentence. Screen-reader output is read aloud end to
 *  end, and without the stops a row runs into one breathless clause. */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
}

/**
 * Everything the row says, as sentences for a screen reader.
 *
 * Built from the same rules the row draws from rather than re-worded here, so a
 * badge and its spoken form cannot drift apart — the failure that makes an
 * accessibility label worse than none, because it is confidently wrong.
 *
 * The one exception is `lastActive`, which goes through the module that already
 * owns that sentence: `lastActiveLine` in src/lib/lastActiveLine.ts exists
 * because the field has five shapes and only one of them is a statement about
 * the client, and it writes the full-sentence form of all five. `activityLabel`
 * above is the CAPTION form of the same five — four words beside a name, where
 * "You added them by hand, so nothing has been recorded against them yet" does
 * not fit — and the two are deliberately the only two, in the two places a
 * reader meets them, rather than a third ternary in JSX.
 */
export function rowSpoken(c: RowClient, today: string): string {
  const tenure = tenureLabel(c.joinedAt, today);
  const scan = scanFact(c.metrics);
  const injury = injuryMark(c.injuries);
  const unread = unreadMark(c.unread);
  return [
    tenure,
    lastActiveLine(c.lastActive),
    scan,
    injury?.spoken,
    unread?.spoken,
  ].filter((s): s is string => !!s).map(sentence).join(' ');
}
