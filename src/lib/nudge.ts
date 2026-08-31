// Coach · the nudge. Turning "this client has gone quiet" into something a
// coach can actually do, without doing it for them.
//
// ── What was already true, and what was missing ────────────────────────────
//
// src/lib/clientDrift.ts works out who is breaking their own pattern, and the
// Clients tab sorts on it. That is the whole of it: the app computes the
// answer, prints it as a band heading, and stops. A coach with forty clients
// has to notice the third row of a list they opened for another reason, on the
// day it happens to matter — and the entire justification for computing drift
// was that they will not.
//
// So this module produces a SUGGESTION and a DRAFT. Nothing here sends
// anything, and nothing here can.
//
// ── THE THREE THINGS THIS MODULE MUST NOT DO ───────────────────────────────
//
// 1. IT MUST NEVER MESSAGE A CLIENT AS THE COACH. `draftMessage` returns a
//    string. There is no send in this file, no Supabase client, and no caller
//    that can be given one — `src/ui/nudges.ts` writes the RECORD of what the
//    coach did and never the message itself, which goes through the ordinary
//    thread the coach is already looking at, from their own hand, after they
//    have read and edited it.
//
//    This is not a stylistic preference. A message that appears to come from a
//    person who did not write it is a defect this codebase has already removed
//    once: `messages.sender` was taken from the client's own request, so a
//    client could post into their thread as 'coach' and their own phone would
//    render it as words from their coach. Automating the draft would put the
//    same falsehood back with better manners — the client would be reading a
//    sentence in their coach's voice that their coach had never seen.
//
// 2. IT MUST NEVER NAG. A suggestion engine that repeats is one a coach learns
//    to scroll past, and a coach who scrolls past this list scrolls past the
//    real ones in it. Two acts are recorded and both mute the client: sending,
//    which mutes for as long as the client's OWN rhythm says an approach needs
//    to be given a chance (`paceFor` in interventions.ts), and dismissing,
//    which mutes for longer because the coach has looked and said no.
//
//    The mute window is read from the RECORD, not recomputed from today's
//    constants — see `mutedBy`. A row nobody can date does not mute at all.
//
// 3. IT MUST NOT DIAGNOSE. Drift is a fall in what the record HOLDS. It is not
//    a fall in what the person did, and it is emphatically not a reason. The
//    same shape on the chart is produced by an injury, a fortnight in Greece, a
//    change of gym, a lapsed direct debit, and somebody who has quietly
//    decided they are finished — and by somebody training four times a week
//    who stopped opening the app. Every sentence this module writes is about
//    the record ("nothing logged for eleven days"), never about the person
//    ("losing motivation"). `NEVER_SAYS` is that rule made mechanical, and
//    `refusalsIn` is checked against every draft in nudge.test.ts.
//
// ── AND THE ONE THAT DECIDES WHETHER ANY OF IT IS USEFUL ───────────────────
//
// A CLIENT WHOSE ACTIVITY COULD NOT BE READ IS NOT A DRIFTING CLIENT. This is
// the LoadStatus rule (src/ui/loadStatus.ts) in the one place it costs
// something real: a refused read, a truncated page, or a roster entry with no
// Repple account behind it all yield an empty event list, and an empty event
// list assessed by `assessDrift` comes back as "nothing recorded" — which is a
// TRUE statement about a client who is genuinely silent and a FALSE one about
// a client who trained yesterday.
//
// A coach ringing somebody who trained yesterday to ask where they have been
// does not get a neutral outcome; they look like they have not been paying
// attention, to the one person who was. So `buildNudgeBoard` takes a per-client
// READ RESULT rather than a per-client event list, refuses to assess anybody
// whose read did not come back whole, and counts them out loud in `withheld`
// so a short list is never mistaken for a calm week.
import {
  assessDrift, compareDrift, summariseDrift, localDayKey, activeDayLog, driftBounds,
  DEFAULT_WINDOWS,
  type ActivityEvent, type ActivityKind, type Drift, type DriftSummary, type DriftWindows,
} from './clientDrift';
import { paceOf, type Pace } from './interventions';
import { dateParts } from './localDate';
import { fmtPointDay } from './format';

const DAY = 86_400_000;

/* ── what the app can and cannot see ───────────────────────────────────────── */

/** Every source `fetchClientActivity` reads, in the order a coach thinks of
 *  them. Kept here as well as there so the evidence panel can say which ones
 *  were SILENT and which were never asked — two different facts that an
 *  absent row cannot tell apart on its own. */
export const ALL_SOURCES: ActivityKind[] = ['check_in', 'workout', 'session', 'visit'];

export const SOURCE_LABEL: Record<ActivityKind, string> = {
  check_in: 'check-ins',
  workout: 'logged workouts',
  session: 'completed sessions',
  visit: 'gym door scans',
};

/**
 * What the record cannot see, said in full, every time.
 *
 * This sentence is the difference between a prompt and an accusation. It is
 * exported rather than inlined in a screen because it has to be identical
 * wherever a drift figure is acted on, and because a future edit that softens
 * it should be a visible change to a named constant rather than a quiet
 * rewording of a caption.
 */
export const WHAT_IT_CANNOT_SEE =
  'This is what the app was told, not what they did. An injury, a fortnight away, '
  + 'a move to another gym, a lapsed payment or simply not opening the app all look '
  + 'exactly like this. Ask before assuming.';

/* ── the record of what the coach did ──────────────────────────────────────── */

/** The two things a coach can do with a suggestion. Both are recorded, both
 *  mute the client, and neither of them sends anything. */
export type NudgeAction = 'sent' | 'dismissed';

export const ACTION_LABEL: Record<NudgeAction, string> = {
  sent: 'Messaged',
  dismissed: 'Set aside',
};

export interface NudgeRecord {
  id: string;
  clientId: string;
  action: NudgeAction;
  /** ISO. When the coach acted. */
  at: string;
  /**
   * How long this act mutes the client for, in days, AS DECIDED AT THE TIME.
   *
   * Stored rather than recomputed on read. A client's pace comes from their own
   * baseline, and their baseline moves; recomputing would mean the promise made
   * to a coach on Monday ("you will not be asked about her again for three
   * weeks") could quietly expire on Wednesday because her rate fell further.
   * Worse, the constants in interventions.ts are ordinary code and will be
   * tuned — and tuning them downward must not retroactively un-mute a hundred
   * clients on every coach's phone at once.
   */
  mutedDays: number;
  /** What the app had observed when the coach acted, in the app's own words.
   *  Null on a row that predates it or where it could not be read. It is here
   *  so a coach reading their own history six weeks later can see what they
   *  were told, not only what they did. */
  observed: string | null;
}

export interface Muted {
  record: NudgeRecord;
  /** Epoch ms at which this client comes back into the list. */
  endsMs: number;
  /** Whole days until then, at least 1 — a mute with 0 days left has expired
   *  and is not returned at all. */
  daysLeft: number;
}

/**
 * The act, if any, currently keeping this client out of the list.
 *
 * The LATEST-ENDING live mute wins rather than the most recent record: a coach
 * who sets a client aside for thirty days and then messages them the same
 * afternoon has not shortened their own decision to thirty days.
 *
 * A record whose `at` will not parse mutes NOTHING. That is the deliberate
 * direction: an undateable row silencing a client forever is a client who
 * leaves and is never mentioned again, which is worse than one extra prompt.
 */
export function mutedBy(
  records: readonly NudgeRecord[],
  clientId: string,
  now: number = Date.now(),
): Muted | null {
  let best: Muted | null = null;
  for (const r of records) {
    if (r.clientId !== clientId) continue;
    const at = Date.parse(r.at);
    if (Number.isNaN(at)) continue;
    // A non-positive window is not a mute. Reading it as one would let a bad
    // row silence somebody on the strength of arithmetic nobody intended.
    if (!(r.mutedDays > 0)) continue;
    const endsMs = at + r.mutedDays * DAY;
    if (endsMs <= now) continue;
    if (!best || endsMs > best.endsMs) {
      best = { record: r, endsMs, daysLeft: Math.max(1, Math.ceil((endsMs - now) / DAY)) };
    }
  }
  return best;
}

/** A set-aside lasts at least a month. A coach who has looked at somebody and
 *  said "not this one" has made a decision, and asking again next Monday is the
 *  behaviour this whole module exists to avoid. */
export const DISMISS_FLOOR_DAYS = 30;

/**
 * How long an act mutes a client for.
 *
 * Sending paces off the client's own rhythm — `paceOf` gives two of their
 * ordinary gaps between visits, floored at a week and capped at a month — so a
 * client who trained daily is not left for four weeks and a client who trained
 * fortnightly is not chased mid-gap. Dismissing takes the longer of that and a
 * month, because it is a decision rather than an attempt.
 *
 * Neither is permanent. A client set aside in January who is still silent in
 * March comes back, and that is right: the coach's "no" was about the situation
 * they were shown, and by then it is a different one.
 */
export function mutedDaysFor(action: NudgeAction, drift: Drift | null): number {
  const p = paceOf(drift);
  return action === 'sent' ? p.cooldownDays : Math.max(DISMISS_FLOOR_DAYS, p.cooldownDays);
}

/* ── what a draft is not allowed to say ────────────────────────────────────── */

export interface Refusal {
  pattern: RegExp;
  /** The claim the phrase would be making. Printed by the test that fails. */
  claim: string;
}

/**
 * Phrases that must not appear in a message drafted for a coach to send.
 *
 * Two kinds, and both are claims the record cannot support:
 *
 *   · A VERDICT ON THE PERSON — motivation, commitment, giving up. The app has
 *     a fall in a row count. It does not have a state of mind, and putting one
 *     in a coach's mouth is how a client who was in hospital receives a message
 *     about their commitment.
 *
 *   · A CAUSE. Injury, holiday, money. Naming one asserts it: "I know you've
 *     been away" to somebody who has not been, or worse, "I noticed your
 *     payment" in a draft a coach sends without rereading. The coach-facing
 *     caveat (`WHAT_IT_CANNOT_SEE`) names all three ON PURPOSE — that is the
 *     honest statement of what the signal is not — but it is written to the
 *     coach, and it stays there.
 *
 * `\b` boundaries throughout, deliberately: a substring list had `ill` in it,
 * which matches "will", and the first draft this module produced was refused
 * for saying somebody was sick when it had said "I will".
 */
export const NEVER_SAYS: readonly Refusal[] = [
  { pattern: /\bmotivat/i, claim: 'a state of mind' },
  { pattern: /\bcommit(ment|ted)?\b/i, claim: 'a state of mind' },
  { pattern: /\blaz(y|iness)\b/i, claim: 'a verdict on the person' },
  { pattern: /\bexcuses?\b/i, claim: 'a verdict on the person' },
  { pattern: /\bslack(ing|ed|er)?\b/i, claim: 'a verdict on the person' },
  { pattern: /\bdisappoint/i, claim: 'a verdict on the person' },
  { pattern: /\b(giv(en|ing)|gave) up\b/i, claim: 'that they have stopped' },
  { pattern: /\bquit(ting)?\b/i, claim: 'that they have stopped' },
  { pattern: /\b(fallen|falling|dropped|dropping) off\b/i, claim: 'that they have stopped' },
  { pattern: /\byou('ve| have)? stopped\b/i, claim: 'that they have stopped' },
  { pattern: /\b(haven't|have not|has not|hasn't) been training\b/i, claim: 'that they did not train' },
  { pattern: /\bnot been training\b/i, claim: 'that they did not train' },
  { pattern: /\bdrift(ing)?\b/i, claim: 'the internal band name, as a verdict about them' },
  { pattern: /\bat risk\b/i, claim: 'the internal band name, as a verdict about them' },
  { pattern: /\bchurn/i, claim: 'the internal band name, as a verdict about them' },
  { pattern: /\binjur(y|ies|ed)\b/i, claim: 'a cause the record cannot see' },
  { pattern: /\bholidays?\b/i, claim: 'a cause the record cannot see' },
  { pattern: /\bvacations?\b/i, claim: 'a cause the record cannot see' },
  { pattern: /\b(sick|ill|unwell)\b/i, claim: 'a cause the record cannot see' },
  { pattern: /\b(payments?|invoices?|billing|unpaid|overdue|subscription)\b/i, claim: 'a cause the record cannot see' },
  { pattern: /\byou (should|must|need to)\b/i, claim: 'an instruction, which is the nagging this exists to avoid' },
];

/** Every claim a piece of text would be making that the record cannot support.
 *  Empty means it says only what was observed. */
export function refusalsIn(text: string): string[] {
  const out: string[] = [];
  for (const r of NEVER_SAYS) if (r.pattern.test(text)) out.push(r.claim);
  return [...new Set(out)];
}

/* ── the copy ──────────────────────────────────────────────────────────────── */

/**
 * The one factual sentence about the record.
 *
 * This is `drift.reason` verbatim, and that is the point rather than laziness.
 * clientDrift already writes its verdicts in the register this module needs —
 * "Nothing for 19 days — was 3.5 days a week", "Nothing recorded in 63 days on
 * your book" — and a second set of sentences here would be a second vocabulary,
 * free to disagree with the band heading three rows above it on the same
 * screen. Where the wording needs to change it changes there, once.
 */
export function observedLine(d: Drift): string {
  return d.reason;
}

/**
 * The client's given name, for a greeting, or null.
 *
 * First word only, and never a fragment of an email address or a bare uuid: a
 * draft opening "Hi 7f3a9c21" is worse than one opening with no name at all,
 * and a coach skimming a list of ready-to-send messages is exactly who would
 * miss it.
 */
export function greetingName(name: string | null | undefined): string | null {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first) return null;
  if (first.includes('@')) return null;
  if (/^[0-9a-f-]{8,}$/i.test(first)) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(first)) return null;
  return first;
}

/** A day key as a coach reads it: "12 Aug 2026". Local, via `dateParts`, so a
 *  bare date is not pulled a day backwards west of Greenwich. */
export function readableDay(dayKey: string): string {
  const p = dateParts(dayKey);
  return p ? fmtPointDay(p[0], p[1], p[2]) : dayKey;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * The draft. A starting point for a coach, not a message.
 *
 * Written to three rules:
 *
 *   · it states what the APP has, and attributes it to the app — "I've not had
 *     anything logged from you", never "you haven't trained". The distinction
 *     survives being wrong: a client who trained six times without opening the
 *     app reads it and says so, and nobody has been accused of anything.
 *   · it offers the client the first word about why. It does not offer them a
 *     reason to agree with, which is what naming one would be.
 *   · it asks one open question and stops. No plan, no offer, no guilt. Those
 *     are the coach's to add, in the box, before they send.
 *
 * The last line is the one most likely to be edited away, and that is fine —
 * the whole design assumes the coach rewrites this. What matters is that the
 * version they start from cannot be sent unread and be wrong.
 */
export function draftMessage(name: string | null | undefined, d: Drift): string {
  const who = greetingName(name);
  const hi = who ? `Hi ${who} — ` : '';

  // Silent for a countable stretch: say the number and the date, because a
  // client who has been logging elsewhere can correct both.
  if (d.quietDays != null && d.quietDays >= 1) {
    return `${hi}I've not had anything come through in the app from you for ${plural(d.quietDays, 'day')}. `
      + `That might just be the app rather than you. How have you been getting on?`;
  }

  // Nothing at all on record, ever. The only honest opening is that we have
  // nothing, not that they have done nothing.
  if (d.quietDays == null) {
    const span = d.observedDays != null && d.observedDays > 0
      ? ` since you joined ${plural(d.observedDays, 'day')} ago`
      : '';
    return `${hi}I've not had anything come through in the app from you${span}. `
      + `That might just be the app rather than you. How have you been getting on?`;
  }

  // Something today or yesterday, but well down on their own rate. Nothing is
  // missing, so there is nothing to ask about having missed.
  const rate = d.baselinePerWeek != null && d.recentPerWeek != null
    ? ` It's been ${d.recentPerWeek} a week lately where it used to be ${d.baselinePerWeek}.`
    : '';
  return `${hi}Just checking in on how training's fitting in at the moment.${rate} `
    + `Anything you'd want to change about the plan?`;
}

/* ── showing the working ───────────────────────────────────────────────────── */

export interface EvidenceDay {
  /** Local day key, `YYYY-MM-DD`. */
  day: string;
  kinds: ActivityKind[];
}

export interface Evidence {
  /** The most recent thing on record, or null when there is nothing. */
  lastSeen: { day: string; kind: ActivityKind } | null;
  /** Days with activity inside the near window, oldest first. */
  recentDays: EvidenceDay[];
  /** …and inside the baseline window before it. */
  baselineDays: EvidenceDay[];
  /** The edges that were measured against, as local day keys. */
  window: { recentFrom: string; historyFrom: string; today: string };
  /** Sources that produced at least one row. */
  seen: ActivityKind[];
  /** Sources that were read and produced nothing. */
  silent: ActivityKind[];
  /** Sources that were not read at all — a different fact from silence, and the
   *  one an absent row cannot express. */
  notRead: ActivityKind[];
  /** The same thing in sentences, for a screen that wants to print it. */
  lines: string[];
}

export interface EvidenceInput {
  drift: Drift;
  /** The events the verdict was reached on. The SAME array — an evidence panel
   *  built from a second, later read would explain a figure that is no longer
   *  the one on screen. */
  events: ActivityEvent[];
  /**
   * Whether the gym door log was among the sources. It is tenant-scoped and is
   * not read at all for a coach with no gym (see `fetchClientActivity`), so for
   * most independent coaches "no door scans" means nobody looked.
   */
  doorLogRead?: boolean;
}

/**
 * The dates behind the number.
 *
 * A coach asked to act on "-72%" cannot check it. A coach shown "six days in
 * July, nothing since the 12th, and the door log was not read because this
 * account has no gym" can, and will spot the case the arithmetic gets wrong —
 * which is the case this whole feature is most dangerous in.
 */
export function explainDrift(
  input: EvidenceInput,
  now: number = Date.now(),
  windows: DriftWindows = DEFAULT_WINDOWS,
): Evidence {
  const { drift: d, events } = input;
  const { recentStart, historyStart } = driftBounds(now, windows);

  const recentDays = activeDayLog(events, recentStart, now + 1);
  const baselineDays = activeDayLog(events, historyStart, recentStart);

  // The newest event, taken from the log rather than re-scanned, so the day it
  // is filed under is the same day the count used.
  const newest = recentDays.length ? recentDays[recentDays.length - 1]
    : baselineDays.length ? baselineDays[baselineDays.length - 1]
    : null;
  const lastSeen = newest ? { day: newest.day, kind: newest.kinds[0] } : null;

  const read = input.doorLogRead ? ALL_SOURCES : ALL_SOURCES.filter((k) => k !== 'visit');
  const seen = ALL_SOURCES.filter((k) => d.kinds.includes(k));
  const silent = read.filter((k) => !d.kinds.includes(k));
  const notRead = ALL_SOURCES.filter((k) => !read.includes(k));

  const window = {
    recentFrom: localDayKey(recentStart),
    historyFrom: localDayKey(historyStart),
    today: localDayKey(now),
  };

  const lines: string[] = [];
  lines.push(
    lastSeen
      ? `Last thing on record: ${SOURCE_LABEL[lastSeen.kind].replace(/s$/, '')} on ${readableDay(lastSeen.day)}`
        + (d.quietDays != null ? ` — ${plural(d.quietDays, 'day')} ago.` : '.')
      : `Nothing on record at all, from any source.`,
  );
  lines.push(
    `${readableDay(window.recentFrom)} to ${readableDay(window.today)}: `
    + (recentDays.length ? `${plural(recentDays.length, 'active day')} — ${recentDays.map((r) => readableDay(r.day)).join(', ')}.`
      : 'no active days.'),
  );
  lines.push(
    `${readableDay(window.historyFrom)} to ${readableDay(window.recentFrom)}: `
    + (d.baselineSpanDays == null
      ? 'not on your book yet, so there is no baseline to compare against.'
      : baselineDays.length
        ? `${plural(baselineDays.length, 'active day')} over ${d.baselineSpanDays} days`
          + (d.baselinePerWeek != null ? ` — ${d.baselinePerWeek} a week.` : ', which is too few to call a pattern.')
        : 'no active days, so there is no pattern to have broken.'),
  );
  lines.push(
    `Read: ${read.map((k) => SOURCE_LABEL[k]).join(', ')}.`
    + (notRead.length ? ` Not read: ${notRead.map((k) => SOURCE_LABEL[k]).join(', ')}.` : ''),
  );
  lines.push(WHAT_IT_CANNOT_SEE);

  return { lastSeen, recentDays, baselineDays, window, seen, silent, notRead, lines };
}

/* ── the board ─────────────────────────────────────────────────────────────── */

/** Why a client was not assessed. Every one of these produces an empty event
 *  list, and every one of them means something different from "silent". */
export type WithheldWhy = 'no-account' | 'read-failed' | 'read-partial';

export const WITHHELD_NOTE: Record<WithheldWhy, string> = {
  'no-account':
    'Added by hand, with no Repple account — there is nothing to read and no thread to write in.',
  'read-failed':
    'Their training record could not be read, so nothing can be said about it. Not the same as quiet.',
  'read-partial':
    'Only part of their record came back. A gap in it would look exactly like silence.',
};

/**
 * One client's activity as the READ left it, not as an array.
 *
 * The whole point of the discriminator: `{ read: false }` and `{ read: true,
 * events: [] }` are different facts, and every version of this feature that
 * takes a bare `ActivityEvent[]` has already thrown the difference away by the
 * time it gets here.
 */
export type ActivityRead =
  | { read: true; events: ActivityEvent[] }
  | { read: false; why: WithheldWhy };

export interface NudgeCandidate {
  clientId: string;
  /** As the coach knows them. Null when the roster has no name. */
  name: string | null;
  activity: ActivityRead;
  /** When they joined the coach's book, ISO, or null. Clamps the baseline so a
   *  client added on Tuesday is not told they have been quiet for eight weeks. */
  since?: string | null;
}

export interface Nudge {
  clientId: string;
  name: string | null;
  drift: Drift;
  /** The observed fact, in the app's own words. */
  observed: string;
  /** What the observation is not. Always present, never conditional. */
  caveat: string;
  /** A starting point for the coach. NOT a message — nothing sends this. */
  draft: string;
  pace: Pace;
  /** What sending would mute this client for, so the button can say so before
   *  it is pressed rather than after. */
  mutedDaysIfSent: number;
  mutedDaysIfDismissed: number;
}

export interface MutedRow {
  clientId: string;
  name: string | null;
  /** Null when the read did not come back — a client can be muted and
   *  unassessable at once, and the mute is the reason they are not being asked
   *  about either way. */
  drift: Drift | null;
  muted: Muted;
}

export interface WithheldRow {
  clientId: string;
  name: string | null;
  why: WithheldWhy;
  note: string;
}

export interface NudgeBoard {
  /** The suggestions, worst first. Never includes a muted client and never
   *  includes one whose record could not be read. */
  nudges: Nudge[];
  /** Acted on recently. Not suggestions, not counted as such, and not hidden:
   *  the screen shows the number and lets a coach open it, which is a coach
   *  asking rather than the app telling. */
  muted: MutedRow[];
  /** Not assessed, with the reason. A short list of nudges is only good news if
   *  this is empty, and a screen that does not say so is claiming a calm week
   *  it has not checked. */
  withheld: WithheldRow[];
  /** Bands over the clients that WERE assessed. Null when none were — which is
   *  not "nobody is drifting". */
  summary: DriftSummary | null;
  /** How many clients were assessed at all. `withheld.length + assessed` is the
   *  whole book. */
  assessed: number;
}

export interface NudgeOptions {
  now?: number;
  windows?: DriftWindows;
  /** Passed through to the evidence panel and to nothing else. */
  doorLogRead?: boolean;
}

/**
 * The statuses that earn a suggestion, and the two that do not.
 *
 * `at_risk` — well down on their own rate — and `idle` — nothing to judge them
 * on at all — are the two the coach has something to do about. clientDrift's
 * header makes the case for the second and it is the one worth restating: a
 * client the record knows nothing about is the one most likely to have already
 * gone, and burying them under the measurable cases is the bug.
 *
 * `watch` is deliberately NOT here. It is a client who is down and not far
 * down, which describes a busy fortnight as often as it describes anything, and
 * a suggestion per busy fortnight per client is precisely the nagging that
 * makes a coach stop reading. They are still on the Clients tab, in their own
 * band, where a coach who wants to look can look.
 */
export function earnsNudge(d: Drift): boolean {
  return d.status === 'at_risk' || d.status === 'idle';
}

/**
 * The whole board, from what was read and what the coach has already done.
 *
 * The order of the three refusals matters and is the order below:
 *
 *   1. an unread client is withheld — BEFORE any drift is computed for them,
 *      so there is no verdict lying around for a later edit to start using;
 *   2. a muted client is set aside — assessed, so the bands are still true, but
 *      never surfaced as a suggestion;
 *   3. everybody else is assessed, and the ones the record has something to say
 *      about are drafted for.
 */
export function buildNudgeBoard(
  candidates: readonly NudgeCandidate[],
  records: readonly NudgeRecord[],
  opts: NudgeOptions = {},
): NudgeBoard {
  const now = opts.now ?? Date.now();
  const windows = opts.windows ?? DEFAULT_WINDOWS;

  const nudges: Nudge[] = [];
  const muted: MutedRow[] = [];
  const withheld: WithheldRow[] = [];
  const assessedDrifts: Drift[] = [];

  for (const c of candidates) {
    // 1 · not read. No drift is computed at all, not even privately.
    if (!c.activity.read) {
      const why = c.activity.why;
      withheld.push({ clientId: c.clientId, name: c.name, why, note: WITHHELD_NOTE[why] });
      continue;
    }

    const d = assessDrift(
      { clientId: c.clientId, events: c.activity.events, since: c.since ?? null },
      now,
      windows,
    );
    assessedDrifts.push(d);

    // 2 · already acted on. Set aside whether or not they earn a nudge, so a
    // client who recovers inside their own mute window does not pop back up as
    // a suggestion and then vanish again.
    const m = mutedBy(records, c.clientId, now);
    if (m) {
      muted.push({ clientId: c.clientId, name: c.name, drift: d, muted: m });
      continue;
    }

    if (!earnsNudge(d)) continue;

    nudges.push({
      clientId: c.clientId,
      name: c.name,
      drift: d,
      observed: observedLine(d),
      caveat: WHAT_IT_CANNOT_SEE,
      draft: draftMessage(c.name, d),
      pace: paceOf(d),
      mutedDaysIfSent: mutedDaysFor('sent', d),
      mutedDaysIfDismissed: mutedDaysFor('dismissed', d),
    });
  }

  nudges.sort((a, b) => compareDrift(a.drift, b.drift));
  // Soonest back first: the coach's next question about this list is which of
  // them they will be asked about again, not which was set aside longest ago.
  muted.sort((a, b) => a.muted.endsMs - b.muted.endsMs || a.clientId.localeCompare(b.clientId));

  return {
    nudges,
    muted,
    withheld,
    summary: assessedDrifts.length ? summariseDrift(assessedDrifts) : null,
    assessed: assessedDrifts.length,
  };
}

/**
 * The line under the heading, which has to be true in all four states.
 *
 * Null in means null out, the same rule `summariseDrift` follows: before the
 * read lands there is no number of clients to nudge, and printing "0 to
 * contact" while it is in flight tells a coach their week is clear.
 */
export function boardNote(b: NudgeBoard | null): string {
  if (b == null) return 'Reading who has gone quiet…';
  const parts: string[] = [];
  parts.push(b.nudges.length
    ? `${plural(b.nudges.length, 'client')} worth a message.`
    : b.assessed
      ? 'Nobody to chase — everybody assessed is holding their pattern or has been contacted.'
      : 'Nobody could be assessed.');
  if (b.muted.length) parts.push(`${b.muted.length} set aside.`);
  if (b.withheld.length) {
    parts.push(`${plural(b.withheld.length, 'client')} could not be assessed, so this list is not the whole book.`);
  }
  return parts.join(' ');
}
