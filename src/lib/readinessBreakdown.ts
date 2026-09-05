// What the readiness score is made of, and what it could not see.
//
// ── Why this exists on top of readiness.ts ─────────────────────────────────
//
// `readinessScore` already refuses to invent. It returns null over a night
// nobody recorded and null over a training log that could not be read, and it
// carries `from` and `confidence` so a screen can say which signals were in the
// scale. That covers the arithmetic. It does not cover the READ.
//
// The gap is one level up, and it is the same gap src/ui/loadStatus.ts was
// written for. Sleep reaches readiness from two places — the nights a device
// measured (src/ui/deviceSleep.tsx) and the nights the member typed
// (src/ui/wellness.tsx) — and each of those can fail on its own without
// producing an error anywhere the score can see. `readSleepFromDevices` catches
// per provider and hands back one `SleepRead` each, so a WHOOP whose token has
// expired arrives as `status: 'error'` inside a walk that otherwise SUCCEEDED,
// and `deviceSleep.status` is 'ready'. Nothing downstream is any the wiser.
//
// What that costs, concretely. A member wears a WHOOP and has Apple Health
// connected. The WHOOP token dies. Apple Health is readable and holds nothing
// for last night, because the watch was on the charger. The typed log has
// Tuesday in it. `readinessSleep` correctly declines to invent last night and
// shortens its window to Tuesday, `readinessScore` computes a perfectly
// well-formed 84 from one good night, and the home screen prints it under the
// word "Readiness" with no caveat of any kind. The Recovery screen, one tap
// away, says plainly that WHOOP could not be read. Two screens, one question,
// opposite claims — which is the shape this codebase keeps re-finding, and the
// reason the note in wearables/sleep.ts says a failure must never become an
// empty list.
//
// The score is not withheld for it, and that is deliberate. A device that could
// not be read has not removed the nights that WERE recorded, and withholding on
// every failed provider would delete readiness for anybody with a flaky link.
// What it has done is make the set incomplete, and 'partial' is precisely the
// word src/ui/loadStatus.ts reserves for a set that is real and short. So the
// score stands, `status` says 'partial', and `caveats` says which device.
//
// ── And the second half: saying what it is made of ────────────────────────
//
// `readinessMadeOf` gives one clause naming the signals in the scale. It is
// appended to the tip only when confidence is 'partial', so a member looking at
// a full-confidence 72 is told nothing at all about where it came from, and a
// member looking at either one cannot see over how many nights, from which
// device, or what was missing and why. A number nobody can take apart is a
// number nobody can act on, and this app's own history is the argument: every
// readiness bug in src/lib/readiness.test.ts rendered as a plausible figure that
// no screen could contradict.
//
// `lines` below is that breakdown — one row per signal, each saying whether it
// was scored, not tracked, unread, or genuinely absent, in the member's own
// terms. Nothing here recomputes the score. It describes the inputs that were
// handed to it, so the description cannot drift from the arithmetic the way two
// screens' copies of the same derivation drift from each other.
//
// Pure, and tested in readinessBreakdown.test.ts. No React, no providers, no
// wearable imports: the shapes below are structural on purpose, so a test can
// build a failing WHOOP out of three fields and so this file does not drag the
// device layer behind it.
import type { LoadStatus } from '../ui/loadStatus';
import { worstStatus } from '../ui/loadStatus';
import { formatSleepHours } from './sleepMerge';
import type { Readiness, ReadinessSignal, ReadinessSleep } from './readiness';

/**
 * One device's part in the sleep read, reduced to what a member needs told.
 *
 * `status` is `SleepRead['status']` and means what it means there: 'unsupported'
 * is a gap in Repple ("Health Connect does not report sleep"), which is a
 * settled fact and not a failure, while 'error' means we asked and did not get
 * an answer — so the nights it might have measured are UNKNOWN rather than
 * absent. The two must not be folded together; that folding is the bug.
 */
export interface ReadinessSource {
  /** What to call it on screen — "WHOOP", "Oura Ring", "Apple Health". */
  name: string;
  status: 'ready' | 'error' | 'unsupported';
  /** How many nights it answered with. Only "any" versus "none" is used. */
  nights: number;
}

/**
 * What happened to one signal.
 *
 *   'scored'      it is in the scale, and `detail` says with what figure.
 *   'not-tracked' the member does not record it. Not a failure and not a
 *                 deduction — see readinessScore on hydration.
 *   'unread'      we tried and could not read it. THE ONE THAT MATTERS: a
 *                 signal in this state may be hiding a value that would have
 *                 moved the score, and every signal here can only ever count
 *                 against the member, so an unread one can only have flattered
 *                 them.
 *   'no-record'   read fine, and there is genuinely nothing there.
 */
export type ReadinessInputState = 'scored' | 'not-tracked' | 'unread' | 'no-record';

export interface ReadinessInputLine {
  key: ReadinessSignal;
  /** Title Case — a label beside a value, per the house rule. */
  title: string;
  state: ReadinessInputState;
  /** Sentence case, no trailing full stop. The caller punctuates. */
  detail: string;
}

export interface ReadinessBreakdownInput {
  /** The score itself, or null when there was nothing to score from. */
  readiness: Readiness | null;
  /** Exactly what was handed to `readinessScore` as sleep. */
  sleep: ReadinessSleep;
  /** How many nights back that window was allowed to reach. */
  windowNights: number;
  /** The device walk as a whole: 'error' means it never completed. */
  deviceStatus: LoadStatus;
  /** One per CONNECTED provider. Empty means no device is connected at all,
   *  which is a different sentence from every device having failed. */
  sources: readonly ReadinessSource[];
  /** The hand-typed log's read (src/ui/wellness.tsx). */
  typedStatus: LoadStatus;
  /** Whether a daily water goal exists to score against at all. */
  hydrationGoal: boolean;
  /** Today's water count's read (src/ui/habits.tsx). */
  hydrationStatus: LoadStatus;
  /** 0..1 as passed to readinessScore, or null when it was not scored. */
  hydrationPct: number | null;
  /**
   * 0..100 as passed to readinessScore, or null when no device published one.
   *
   * Optional so that the three callers this shipped alongside do not all have
   * to be edited in the same commit to keep compiling — an omitted field means
   * the same as an explicit null, which is what every caller without a device
   * would be passing anyway.
   */
  recoveryPct?: number | null;
  /**
   * What to CALL the device the score came from — "WHOOP", "Oura Ring" — or
   * null when there is nothing to name.
   *
   * The name is not decoration. WHOOP calls this figure recovery and Oura calls
   * it readiness, both on 0–100, and a member checking Repple's number against
   * the app on their other home screen needs to know which of the two they are
   * being shown. An unattributed "Recovery 62%" inside a screen that also
   * produces its own readiness score is two different numbers wearing one word.
   */
  recoveryFrom?: string | null;
  /**
   * Whether a device that COULD have published a recovery score is connected.
   *
   * This is the whole reason a null recoveryPct is not one sentence. Nobody
   * connected — nothing is missing, and saying "your recovery could not be
   * read" to somebody who owns no strap invents a fault. Connected and null —
   * either the device does not score recovery, or today's sync has not landed,
   * and the member can do something about the second.
   */
  recoveryDeviceConnected?: boolean;
  /** As passed to readinessScore: null means the training log was unreadable. */
  workoutsLast2Days: number | null;
}

export interface ReadinessBreakdown {
  /** One per signal, in scale order: sleep, recovery, hydration, recent
   *  sessions. Scale order is order of weight — see Readiness.from. */
  lines: ReadinessInputLine[];
  /**
   * How much of what the score COULD have been built from was actually read.
   *
   *   'ready'   everything that could be read was read. The score, if there is
   *             one, is over the whole picture.
   *   'partial' there is a score, and at least one source did not answer. Real
   *             figures, short set — the sense src/ui/loadStatus.ts gives it.
   *   'error'   there is no score AND the reason is a read that failed, so the
   *             absence is ours and not the member's.
   *   'loading' a source is still in flight.
   *
   * Deliberately NOT `worstStatus` over the raw reads. A typed log showing this
   * device's cached copy reports 'error', and a member training offline would
   * otherwise see their readiness described as an error on every session in a
   * basement gym — while a perfectly good score sat above it. The question this
   * answers is "how complete is the thing on screen", not "did every network
   * call succeed".
   */
  status: LoadStatus;
  /**
   * Sentences naming what was not read, worst first. Empty when nothing was.
   *
   * Sentence case, each ending in a full stop, because these are prose and are
   * printed on their own rather than appended to anything.
   */
  caveats: string[];
  /**
   * Why there is no score, when there is none — and null when there is one.
   *
   * Four absences that read identically as a dash and ask the member for four
   * different things. "Log a night of sleep" handed to somebody whose ring is
   * connected and syncing is the complaint that started this: it asks them to
   * type what the device already knows.
   */
  absence: string | null;
}

/**
 * The trust owed to the DEVICE half of the sleep read.
 *
 * `deviceSleep.status` describes the walk, not the devices: it is 'ready' the
 * moment every provider has been asked, whatever each of them answered. This is
 * the missing half — the per-provider outcome folded back into one word.
 *
 *   · No connected provider at all is 'ready'. Nothing was asked and nothing is
 *     missing; a member with no watch is not a member with a broken watch.
 *   · Every provider failing is 'error'. We know nothing about their devices.
 *   · Some failing while others answered is 'partial': the nights we have are
 *     real, and there may be nights we do not have.
 *   · 'unsupported' is never a failure. Health Connect not reporting sleep is a
 *     settled fact about this build, not a gap in what we know about tonight.
 */
export function deviceSleepTrust(walk: LoadStatus, sources: readonly ReadinessSource[]): LoadStatus {
  if (walk === 'loading') return 'loading';
  if (walk === 'error') return 'error';
  const asked = sources.filter((s) => s.status !== 'unsupported');
  if (!asked.length) return 'ready';
  const failed = asked.filter((s) => s.status === 'error');
  if (!failed.length) return walk;
  return failed.length === asked.length ? 'error' : 'partial';
}

/** "WHOOP", "WHOOP and Oura Ring", "WHOOP, Oura Ring and Apple Health". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Where the nights in the window came from, as a clause. */
function sleepProvenance(s: ReadinessSleep): string {
  if (s.fromDevice && s.fromTyped) {
    return `${s.fromDevice} measured by a device, ${s.fromTyped} from the nights you logged`;
  }
  if (s.fromDevice) return s.fromDevice === 1 ? 'measured by a device' : 'all measured by a device';
  return s.fromTyped === 1 ? 'from a night you logged' : 'all from the nights you logged';
}

function sleepLine(i: ReadinessBreakdownInput, trust: LoadStatus): ReadinessInputLine {
  const title = 'Sleep';
  const avg = i.sleep.avgHours;
  const used = i.sleep.nights.length;
  if (avg != null && Number.isFinite(avg) && avg > 0 && used > 0) {
    // "across 2 of the last 3 nights" rather than a bare average. A mean over
    // one night and a mean over three are different claims and the figure
    // cannot tell them apart, which is the whole reason this line exists.
    const span = used >= i.windowNights
      ? `over the last ${i.windowNights} nights`
      : `over ${used} of the last ${i.windowNights} nights`;
    return {
      key: 'sleep', title, state: 'scored',
      detail: `${formatSleepHours(avg * 60)} a night ${span}, ${sleepProvenance(i.sleep)}`,
    };
  }
  // No hours. Which of the four absences it is decides what the member does
  // next, so they are never collapsed into one sentence.
  if (trust === 'loading' || i.typedStatus === 'loading') {
    return { key: 'sleep', title, state: 'unread', detail: 'still being read' };
  }
  if (trust === 'error') {
    return {
      key: 'sleep', title, state: 'unread',
      detail: 'we could not read your devices, so a night one of them measured may be missing',
    };
  }
  if (i.typedStatus === 'error') {
    return {
      key: 'sleep', title, state: 'unread',
      detail: 'we could not read your sleep log, so we do not know what you have logged',
    };
  }
  return {
    key: 'sleep', title, state: 'no-record',
    detail: `nothing recorded for the last ${i.windowNights} nights`,
  };
}

/**
 * The device's own verdict, or the reason there isn't one.
 *
 * Five outcomes and they are not interchangeable, which is the same discipline
 * `sleepLine` applies one function up. The two that matter most are the last:
 * a member with a WHOOP whose sync has not landed is told their device did not
 * report today, because that is something they can go and fix in the WHOOP app
 * — and the member with no device at all is told nothing of the kind, because
 * for them nothing is wrong.
 *
 * ── the fourth silence, added here ─────────────────────────────────────────
 *
 * `trust` is the one this function used to be written without. It took `i`
 * alone, so every connected-and-null case fell to "your device has not reported
 * a recovery score today" — a statement about what the DEVICE did, made when
 * the device walk had failed and we had not managed to ask it anything. It is
 * the same substitution `sleepLine` and `absenceFor` refuse three functions
 * away, and it sends a member into the WHOOP app to look for a sync that is
 * probably sitting there fine.
 *
 * `readinessBreakdown` already computed `trust` and handed it to `sleepLine`
 * and `caveatsFor` and not to this. Nothing kept it out; it was simply not
 * passed.
 *
 * Any status but 'ready' takes the new arm, 'partial' included: a walk that
 * came back short may be short of exactly the provider that scores recovery,
 * `ReadinessSource` carries a display name and no id, so there is no way to
 * tell which — and a maybe is not a basis for telling somebody their strap
 * stayed quiet.
 */
function recoveryLine(i: ReadinessBreakdownInput, trust: LoadStatus): ReadinessInputLine {
  // Title Case, and "Device Recovery" rather than "Recovery": this screen is
  // reached from a hero labelled Readiness and sits on a screen called
  // Recovery, so a bare "Recovery" row would be the third use of the word on
  // one screen for the third different thing.
  const title = 'Device Recovery';
  const pct = i.recoveryPct;
  if (pct != null && Number.isFinite(pct)) {
    const who = i.recoveryFrom ? `${i.recoveryFrom}'s ` : '';
    // The vendor's own word for its own figure. Oura ships this as readiness
    // and WHOOP as recovery, and printing one vendor's word over the other's
    // number is how a member concludes the app is showing them something else.
    const word = i.recoveryFrom === 'Oura Ring' ? 'readiness score' : 'recovery score';
    return { key: 'recovery', title, state: 'scored', detail: `${who}${word}, ${Math.round(pct)} out of 100` };
  }
  if (!i.recoveryDeviceConnected) {
    return {
      key: 'recovery', title, state: 'not-tracked',
      detail: 'not in the scale — no connected device scores recovery',
    };
  }
  if (trust !== 'ready') {
    return {
      key: 'recovery', title, state: 'unread',
      detail: trust === 'loading'
        ? 'not in the scale — still reading your devices'
        : 'not in the scale — we could not read your devices, so we cannot say whether one scored your recovery today',
    };
  }
  return {
    key: 'recovery', title, state: 'unread',
    detail: 'not in the scale — your device has not reported a recovery score today',
  };
}

function hydrationLine(i: ReadinessBreakdownInput): ReadinessInputLine {
  const title = 'Hydration';
  const pct = i.hydrationPct;
  if (pct != null && Number.isFinite(pct)) {
    return { key: 'hydration', title, state: 'scored', detail: `${Math.round(pct * 100)}% of today's goal` };
  }
  // Untracked and unread land in the same null and are NOT the same sentence.
  // Neither is a deduction — readinessScore rescales rather than docking the
  // score — so both say so, because a member who reads "no hydration figure"
  // under a lower number will assume they were marked down for it.
  if (!i.hydrationGoal) {
    return { key: 'hydration', title, state: 'not-tracked', detail: 'not in the scale — you have not set a daily water goal' };
  }
  if (i.hydrationStatus !== 'ready') {
    return { key: 'hydration', title, state: 'unread', detail: "not in the scale — today's count could not be read" };
  }
  return { key: 'hydration', title, state: 'not-tracked', detail: 'not in the scale — nothing was scored against it' };
}

function loadLine(i: ReadinessBreakdownInput): ReadinessInputLine {
  // Title Case, and the member's words rather than ours: "load" is a coach's
  // term and this row is read by everybody.
  const title = 'Recent Sessions';
  const n = i.workoutsLast2Days;
  if (n == null || !Number.isFinite(n)) {
    return { key: 'load', title, state: 'unread', detail: 'we could not read your training log' };
  }
  return {
    key: 'load', title, state: 'scored',
    detail: n === 0 ? 'no sessions in the last two days' : `${n} session${n === 1 ? '' : 's'} in the last two days`,
  };
}

/**
 * Why there is no score. Ordered by what the member should do about it, which
 * is not the order the signals are scored in.
 *
 * The training log comes first because it is the only absence that is never the
 * member's: `workoutsLast2Days` is null for exactly one reason, a failed read,
 * and telling somebody to log a night of sleep when the real problem is our
 * read sends them to do work that will not help.
 */
function absenceFor(i: ReadinessBreakdownInput, trust: LoadStatus): string {
  if (i.workoutsLast2Days == null || !Number.isFinite(i.workoutsLast2Days)) {
    return 'We could not read your training log, so there is no readiness to show — it does not mean you are rested.';
  }
  if (trust === 'loading') return 'Reading last night from your devices…';
  if (i.typedStatus === 'loading') return 'Reading the nights you have logged…';
  if (trust === 'error') {
    return 'We could not read your devices just now, so there is no readiness to show — it does not mean you slept badly.';
  }
  if (i.typedStatus === 'error') {
    // Live until now: an unreadable sleep log with an empty cache reached the
    // home screen as "log a night of sleep", which is a statement about what
    // the member has done, made out of a read that failed.
    return 'We could not read your sleep log just now, so there is no readiness to show — it does not mean you have not logged a night.';
  }
  if (i.sources.some((s) => s.status !== 'unsupported')) {
    return `No sleep on record for the last ${i.windowNights} nights yet.`;
  }
  return 'Log a night of sleep, or connect a watch, to see your readiness.';
}

function caveatsFor(i: ReadinessBreakdownInput, trust: LoadStatus): string[] {
  const out: string[] = [];
  const failed = i.sources.filter((s) => s.status === 'error').map((s) => s.name);
  if (failed.length) {
    const one = failed.length === 1;
    out.push(`${nameList(failed)} could not be read, so a night ${one ? 'it' : 'they'} measured may be missing from this.`);
  } else if (trust === 'error') {
    // The walk itself failed, so there are no per-provider rows to name — the
    // same hole the Recovery screen had to grow its own sentence for.
    out.push('We could not reach your devices just now, so a night one of them measured may be missing from this.');
  }
  if (i.typedStatus === 'error') {
    out.push('Your sleep log could not be checked against your account, so a night logged on another device may be missing from this.');
  }
  if (i.hydrationGoal && i.hydrationStatus !== 'ready' && i.hydrationStatus !== 'loading') {
    out.push("Today's water count could not be read, so hydration is not in the scale.");
  }
  return out;
}

/**
 * The account of one readiness score: what went in, what did not, and how much
 * of what could have been read was.
 *
 * Describes; never recomputes. Everything it says about the scale it says from
 * the same values the caller handed `readinessScore`, so the breakdown and the
 * number cannot disagree — which is the failure mode of every second copy of a
 * derivation in this codebase.
 */
export function readinessBreakdown(i: ReadinessBreakdownInput): ReadinessBreakdown {
  const trust = deviceSleepTrust(i.deviceStatus, i.sources);
  const lines = [sleepLine(i, trust), recoveryLine(i, trust), hydrationLine(i), loadLine(i)];
  const caveats = caveatsFor(i, trust);

  // With no score, the status is about the READ that failed to produce one —
  // and 'ready' when the absence is genuine, because "you have not logged a
  // night" is a complete answer rather than a broken one.
  if (i.readiness == null) {
    const stalled = worstStatus(
      trust === 'partial' ? 'ready' : trust,
      i.typedStatus === 'partial' ? 'ready' : i.typedStatus,
      i.workoutsLast2Days == null || !Number.isFinite(i.workoutsLast2Days) ? 'error' : 'ready',
    );
    return { lines, status: stalled, caveats, absence: absenceFor(i, trust) };
  }

  // With a score, the only question left is whether anything went unread. A
  // signal that is merely absent — no water goal, two nights instead of three —
  // is not a short read, and calling it one would train the member to ignore
  // the word on the many days it means nothing.
  const short = caveats.length > 0 || lines.some((l) => l.state === 'unread');
  return { lines, status: short ? 'partial' : 'ready', caveats, absence: null };
}
