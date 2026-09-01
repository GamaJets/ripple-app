// Leaving a coach, and the sentences said around it.
//
// The server side is supabase/parts/68-end-coaching.sql: one SECURITY DEFINER
// function, `end_coaching(p_other)`, callable by either party and by nobody
// else, which writes BOTH halves of the link — `coaching_relationships.status
// = 'ended'` and `clients.trainer_id = null` — or neither. Before it, nothing
// in this product could end a coaching relationship at all.
//
// ── WHY THE COPY IS IN HERE AND NOT IN THE SCREEN ─────────────────────────
//
// Because it is the part that can be wrong without anybody noticing. Ending a
// coaching relationship is irreversible in one specific respect (every progress
// photo the client ever sent is un-shared for good — 47-share-progress-photo.
// sql deletes the grants rather than flagging them, and re-joining does not
// bring them back) and reversible in every other. A confirmation dialog that
// says "are you sure?" tells the person nothing they can decide on, and one
// that says "you can undo this" would be a lie about the photos.
//
// So the words are built here, next to the rules they describe, and asserted on
// in endCoaching.test.ts — including the assertions that matter most, which are
// the negative ones: that nothing claims the client has left until the server
// says they have.
//
// ── supabase-js RESOLVES ON A DATABASE ERROR ──────────────────────────────
//
// `await supabase.rpc(...)` returns `{ data: null, error }` rather than
// throwing. A refused or failed call therefore looks exactly like a successful
// one that returned nothing, and "you have left your coach" said over a call
// that did nothing is the single worst sentence this file could produce: the
// client stops sending check-ins to somebody who is still reading everything.
// `error` is checked before `data` is looked at, every time.
//
// ── WHY ./supabase IS REQUIRED LAZILY ─────────────────────────────────────
//
// Same reason as photoShare.ts and progressPhotos.ts: the pure half above the
// I/O line is covered by a test that runs under plain `node`, and a top-level
// import of ./supabase drags in AsyncStorage, which throws "window is not
// defined" outside a React Native runtime.

/** What the server did. `ended: false` is a real answer, not a failure: the
 *  two were never linked, and nothing was written. */
export type EndCoachingResult =
  | { ok: true; ended: boolean }
  | { ok: false; reason: string };

/** A confirmation the reader can actually decide on. */
export interface LeavePrompt {
  title: string;
  /** Plain words about what changes. Paragraphs, in the order that matters. */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** What to say afterwards. Never assembled from a hope. */
export interface LeaveOutcome {
  title: string;
  body: string;
}

/* ── pure ─────────────────────────────────────────────────────────────────
   No I/O, no client, no React. Covered by src/lib/endCoaching.test.ts. */

/**
 * How to refer to the coach.
 *
 * A coach who has not set a name is a real state — 67-coach-name-for-client.sql
 * returns a row with a null name for exactly that case — and the fallback is a
 * role, never a placeholder that looks like a name. It must also survive a name
 * that is whitespace, which `full_name` permits.
 */
export function coachLabel(coachName: string | null | undefined): string {
  const n = (coachName || '').trim();
  return n.length ? n : 'your coach';
}

/**
 * The confirmation. Three paragraphs, in the order a person needs them:
 * what stops, what does not stop, and what it costs to change their mind.
 *
 * The photo sentence is the one that earns the dialog. Everything else here is
 * recoverable by re-joining with the coach's code — `link_coaching()` is
 * written as `on conflict … do update set status = 'active'`, so the same call
 * that linked them the first time links them again — but the photo grants were
 * DELETED, and 47 chose deletion over a revoked_at flag deliberately. Telling
 * somebody an action is reversible when one part of it is not is how people
 * end up sending a photograph twice.
 */
export function leaveCoachPrompt(coachName: string | null | undefined): LeavePrompt {
  const who = coachLabel(coachName);
  return {
    title: `Leave ${who}?`,
    body:
      `${who} stops being able to see your workouts, measurements, check-ins, habits, scans, food logs, goals and daily targets, and your message thread with them closes.\n\n` +
      `Any progress photo you sent them is un-shared straight away, and that part cannot be undone — joining them again later does not hand the photos back. Nothing of yours is deleted: your own history stays exactly as it is, and so does their record of the sessions they delivered.\n\n` +
      `Sessions you have already booked with them are not cancelled. Cancel those yourself if you no longer want them. You can join ${who} again any time with their coaching code.`,
    confirmLabel: `Leave ${who}`,
    cancelLabel: 'Stay',
  };
}

/**
 * What to say once the server has answered — and only then.
 *
 * The three branches are three different facts and none of them may be worded
 * like another. In particular a failure must not contain a sentence that reads
 * as departure even in passing, because a person skimming an alert takes the
 * shape of it and not the words.
 */
export function leaveOutcome(result: EndCoachingResult, coachName: string | null | undefined): LeaveOutcome {
  const who = coachLabel(coachName);
  if (!result.ok) {
    return {
      title: 'Still Linked',
      body: `${result.reason} Nothing was changed, so ${who} still coaches you and still sees your training.`,
    };
  }
  if (!result.ended) {
    return {
      title: 'Nothing to End',
      body: `Repple has no record of ${who} coaching you, so nothing was changed. If they still appear in your app, close it and open it again.`,
    };
  }
  return {
    title: `You have left ${who}`,
    body: `${who} can no longer see your training, your numbers or your photos, and your message thread with them is closed. Everything you logged is still yours and still here.`,
  };
}

/**
 * What to say when `end_coaching()` refuses.
 *
 * The RPC raises plain messages (68-end-coaching.sql). These are the ones a
 * person can act on; anything else keeps the server's own words rather than
 * being flattened into "something went wrong", which tells nobody anything and
 * has cost this codebase real debugging time.
 */
export function endCoachingErrorMessage(raw: string | null | undefined): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('not signed in')) return 'You are not signed in, so nothing could be changed.';
  if (m.includes('with yourself')) return 'That is your own account, so there is no coaching relationship to end.';
  if (m.includes('no one to end coaching with')) return 'We could not tell which coach you meant.';
  const t = (raw || '').trim();
  return t ? `${t}.`.replace(/\.\.$/, '.') : 'The change could not be saved.';
}

/* ── I/O ──────────────────────────────────────────────────────────────────── */

type Sb = typeof import('./supabase').supabase;

function db(): Sb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('./supabase') as { supabase: Sb }).supabase;
}

function report(context: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('./reportError') as {
      reportError: (c: string, e: unknown, x?: Record<string, unknown>) => void;
    };
    m.reportError(context, err, extra);
  } catch {
    /* reporting a failure must never itself fail */
  }
}

/**
 * End the coaching relationship between the signed-in user and `otherId`.
 *
 * Either party may call it and neither may name a pair they are not in — the
 * function takes the OTHER person and pins the caller to `auth.uid()`, so there
 * is nothing to pass that would reach somebody else's relationship.
 *
 * `{ ok: true, ended: false }` means the server found no record of a link in
 * either direction and wrote nothing. That is a true answer and it is how
 * src/ui/roster.tsx tells a linked client from a manually-added `coach_clients`
 * row. It is NOT a failure and must not be reported as one.
 *
 * Returns rather than throws, because every caller has a sentence to say either
 * way and none of them may say the wrong one.
 */
export async function endCoaching(otherId: string): Promise<EndCoachingResult> {
  const id = (otherId || '').trim();
  if (!id) return { ok: false, reason: endCoachingErrorMessage('no one to end coaching with') };

  try {
    const { data, error } = await db().rpc('end_coaching', { p_other: id });
    if (error) {
      report('endCoaching.rpc', error, { otherId: id });
      return { ok: false, reason: endCoachingErrorMessage(error.message) };
    }
    // The function returns a scalar boolean, so supabase-js hands back `true`
    // or `false` — never an array and never null. Anything else means the call
    // did not reach the return statement, and reporting an unlink that may not
    // have happened is the failure this whole module is careful about.
    if (typeof data !== 'boolean') {
      report('endCoaching.rpc', new Error('end_coaching returned a non-boolean'), { otherId: id, got: typeof data });
      return { ok: false, reason: 'The change was sent but nothing came back to confirm it, so we cannot say it happened.' };
    }
    return { ok: true, ended: data };
  } catch (e: any) {
    report('endCoaching.rpc', e, { otherId: id });
    return { ok: false, reason: endCoachingErrorMessage(e?.message) };
  }
}


/* ── why it ended ──────────────────────────────────────────────────────────
 *
 * Nothing was captured. `end_coaching(p_other)` took one argument, wrote two
 * rows and recorded no reason at all, and the coach's whole account of it was
 * the notification "A client has ended their coaching". Churn is the one thing
 * a coach most needs to understand about their business, the moment it happens
 * is the only moment the answer exists, and the app was throwing it away at
 * exactly that moment.
 *
 * ── THE RULE THIS SECTION EXISTS TO HOLD ─────────────────────────────────
 *
 * A REASON IS ATTRIBUTED TO WHOEVER SAID IT, ALWAYS.
 *
 * There are two very different facts here and they arrive in the same column.
 * A client who ends the coaching and picks "the cost" has TOLD their coach
 * something. A coach who ends it, or who fills the reason in afterwards about a
 * client who said nothing, has recorded a BELIEF. Both are worth keeping and
 * they are not the same evidence — and a screen that renders them identically
 * would let a coach read their own guess back to themselves six months later as
 * something the client said.
 *
 * So `end_reason_by` is written by the server from auth.uid() and is not
 * optional, `recordedByMe` is on every read, and `reasonAttribution` below is
 * the sentence that keeps the two apart. This is the same distinction
 * `WHY_NO_RATE` in src/lib/interventions.ts makes about contact outcomes: log
 * what happened, never claim what it means.
 *
 * ── And why 'unsaid' is a value rather than a null ───────────────────────
 *
 * A null reason is "nobody recorded one". `'unsaid'` is "they were asked and
 * would rather not say". Collapsing those would make a coach's churn list count
 * every unanswered ending as a refusal to answer, and the difference decides
 * whether the coach's next move is to ask better questions or to stop asking.
 */

/** Why a coaching relationship ended. A closed set, mirroring the CHECK. */
export type EndReason =
  | 'cost' | 'schedule' | 'moved' | 'results' | 'goal-reached'
  | 'health' | 'coach-ended' | 'unsaid' | 'other';

/** In the order a coach meets them, commonest first. */
export const END_REASONS: EndReason[] = [
  'cost', 'schedule', 'moved', 'results', 'goal-reached', 'health', 'coach-ended', 'unsaid', 'other',
];

/** Title Case: these render as the labels on the picker. */
export const END_REASON_LABEL: Record<EndReason, string> = {
  cost: 'The Cost',
  schedule: 'Could Not Make the Times',
  moved: 'Moved or Changed Gym',
  results: 'Not Getting What They Wanted',
  'goal-reached': 'Got What They Came For',
  health: 'Injury or Health',
  'coach-ended': 'My Decision',
  unsaid: 'They Did Not Say',
  other: 'Something Else',
};

/** Sentence case: the line under the label, for the ones a coach could
 *  reasonably read two ways. */
export const END_REASON_NOTE: Record<EndReason, string> = {
  cost: 'they could not or would not keep paying for it.',
  schedule: 'the times on offer stopped working for them.',
  moved: 'they are training somewhere else now, or nowhere near you.',
  results: 'they did not feel it was working. This is the one worth a note.',
  'goal-reached': 'a finished block rather than a lost client. Worth telling apart from the rest.',
  health: 'an injury, an illness, a pregnancy. Nothing about what it was.',
  'coach-ended': 'you ended it, for your own reasons.',
  unsaid: 'they were asked and did not want to say. Different from nobody having asked.',
  other: 'none of the above. The note is the whole of the record.',
};

/** Longest note the server stores against an ending. */
export const MAX_END_NOTE = 500;

/** Whether a value is one of the reasons. Narrow, so a string written by a
 *  later build with a reason this one does not know renders as unknown rather
 *  than as an index nothing can label. */
export function isEndReason(v: unknown): v is EndReason {
  return typeof v === 'string' && (END_REASONS as string[]).includes(v);
}

/** What is known about how one relationship ended. */
export interface EndRecord {
  /** Null when nobody recorded one — which is NOT 'unsaid'. */
  reason: EndReason | null;
  note: string | null;
  /** True when the signed-in user is the one who recorded it. Decides whether
   *  the reason is evidence or a belief, and the screen must say which. */
  recordedByMe: boolean | null;
  /** Which party ended the relationship, when that is known. */
  endedByMe: boolean | null;
  /** ISO. Null on an ending written before part 68 added the column — which
   *  means the date is unknown, not that it happened at the epoch. */
  endedAt: string | null;
}

/**
 * The sentence that keeps a client's words apart from a coach's guess.
 *
 * Returned for the COACH's screen. `recordedByMe` true means the coach typed
 * it; false means the other party did. Null means we could not tell, and the
 * honest reading of that is the weaker of the two — a reason whose author is
 * unknown must never be presented as the client's own account.
 */
export function reasonAttribution(rec: EndRecord): string | null {
  if (rec.reason == null) return null;
  if (rec.recordedByMe === false) {
    return 'They chose this themselves when they ended it.';
  }
  return 'You recorded this. It is your account of why they left, not theirs.';
}

/**
 * What to say where a reason could be recorded and is not.
 *
 * Three states and they are not interchangeable. The middle one is the point:
 * an ending nobody explained is an answer the coach can still go and get, and
 * telling them that is the whole value of the feature.
 */
export function endReasonPrompt(rec: EndRecord | null): string {
  if (rec == null) {
    return 'How this ended could not be read, so this is not "nothing was recorded".';
  }
  if (rec.reason == null) {
    return 'Nothing was recorded about why this ended. It is the cheapest thing you will ever learn about your own business, and this is the only moment it exists — write down what you know, even if all you know is that they did not say.';
  }
  return END_REASON_NOTE[rec.reason];
}


/* ── the I/O half of the reason ────────────────────────────────────────────
 *
 * Kept below the pure line and under the same lazy-require discipline as
 * `endCoaching` above, for the same reason: everything above this comment runs
 * under plain `node` in endCoaching.test.ts and a top-level ./supabase import
 * drags in AsyncStorage.
 */

/**
 * True when the error is the migration not being applied rather than a refusal.
 *
 * Copied in spirit from `isMissingFunction` in src/lib/coachCurrency.ts and NOT
 * imported from it: that module is about currency and importing it here to
 * borrow one predicate would make an unrelated screen's failure mode this
 * module's problem. The distinction it draws is what matters — PostgREST
 * answers a call to a function it cannot find with PGRST202 and Postgres with
 * 42883, both of which are the server answering, and a coach must not be told
 * their reason was refused when the truth is that part 168 has not been run.
 */
function functionMissing(e: { code?: unknown; message?: unknown } | null | undefined): boolean {
  const code = typeof e?.code === 'string' ? e.code.trim() : '';
  if (code === 'PGRST202' || code === '42883') return true;
  const msg = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('could not find the function') || msg.includes('schema cache');
}

/** What happened to a reason the coach tried to record. `ok: true, stored:
 *  false` is the honest answer on a build whose database has not had part 168
 *  applied: the ENDING happened and the reason did not, and a caller that
 *  flattened those two would tell a coach their note was kept. */
export type EndReasonResult =
  | { ok: true; stored: boolean }
  | { ok: false; reason: string };

/**
 * End the coaching relationship AND record why, in one call.
 *
 * One server call rather than two, deliberately. Two calls have a state between
 * them where the relationship is ended and the reason is not written, and that
 * state is reached by every dropped connection — leaving the coach looking at a
 * client who has gone with a "why?" prompt that will never be answerable,
 * because the ending is the only moment the question makes sense.
 *
 * Where the three-argument function does not exist yet, this falls back to the
 * one-argument one so the ending still happens, and says so: `reasonStored`
 * false with `ended` true is "they are unlinked and nothing was recorded about
 * it". The alternative — refusing to end the relationship because a column is
 * missing — would make a schema lag into a coach who cannot remove a client.
 */
export async function endCoachingWithReason(
  otherId: string,
  reason: EndReason,
  note: string | null,
): Promise<EndCoachingResult & { reasonStored?: boolean }> {
  const id = (otherId || '').trim();
  if (!id) return { ok: false, reason: endCoachingErrorMessage('no one to end coaching with') };
  const body = (note || '').trim().slice(0, MAX_END_NOTE) || null;

  try {
    const { data, error } = await db().rpc('end_coaching_with_reason', {
      p_other: id, p_reason: reason, p_note: body,
    });
    if (error) {
      if (functionMissing(error)) {
        // The ending still has to happen. Reported honestly by the flag rather
        // than by a sentence claiming the note was kept.
        const fallback = await endCoaching(id);
        return fallback.ok ? { ...fallback, reasonStored: false } : fallback;
      }
      report('endCoaching.withReason', error, { otherId: id });
      return { ok: false, reason: endCoachingErrorMessage(error.message) };
    }
    if (typeof data !== 'boolean') {
      report('endCoaching.withReason', new Error('end_coaching_with_reason returned a non-boolean'), { otherId: id, got: typeof data });
      return { ok: false, reason: 'The change was sent but nothing came back to confirm it, so we cannot say it happened.' };
    }
    return { ok: true, ended: data, reasonStored: data };
  } catch (e: any) {
    report('endCoaching.withReason', e, { otherId: id });
    return { ok: false, reason: endCoachingErrorMessage(e?.message) };
  }
}

/**
 * Record why an ALREADY-ENDED relationship ended.
 *
 * The other half, and the one that catches the case the coach cares about most:
 * the client left of their own accord, the coach found out from a notification,
 * and the answer to "why" exists only in the coach's head. The server writes
 * `end_reason_by = auth.uid()` so that answer is filed as the coach's account
 * and never as the client's — see `reasonAttribution`.
 */
export async function recordEndReason(
  otherId: string,
  reason: EndReason,
  note: string | null,
): Promise<EndReasonResult> {
  const id = (otherId || '').trim();
  if (!id) return { ok: false, reason: endCoachingErrorMessage('no one to end coaching with') };
  const body = (note || '').trim().slice(0, MAX_END_NOTE) || null;
  try {
    const { data, error } = await db().rpc('record_end_reason', {
      p_other: id, p_reason: reason, p_note: body,
    });
    if (error) {
      if (functionMissing(error)) {
        return { ok: false, reason: 'This build\u2019s database cannot store a reason yet, so nothing was recorded.' };
      }
      report('endCoaching.recordReason', error, { otherId: id });
      return { ok: false, reason: endCoachingErrorMessage(error.message) };
    }
    // False is a real answer and not a failure: there is no ended relationship
    // to attach a reason to, or somebody else has already recorded one. Saying
    // "saved" over it would leave a coach believing their note is on a record
    // that has nothing on it.
    if (typeof data !== 'boolean') {
      report('endCoaching.recordReason', new Error('record_end_reason returned a non-boolean'), { otherId: id, got: typeof data });
      return { ok: false, reason: 'The note was sent but nothing came back to confirm it, so we cannot say it was kept.' };
    }
    return { ok: true, stored: data };
  } catch (e: any) {
    report('endCoaching.recordReason', e, { otherId: id });
    return { ok: false, reason: endCoachingErrorMessage(e?.message) };
  }
}

/**
 * How one relationship ended, or null when it could not be read.
 *
 * Null and not an empty record. `cr_self` admits both parties, so a refused
 * read here is a wire failure rather than a policy one — and an empty record
 * would render as "nothing was recorded about why they left", which is the one
 * sentence that would make a coach type over an answer the client gave.
 */
export async function fetchEndRecord(otherId: string, meId: string): Promise<EndRecord | null> {
  const id = (otherId || '').trim();
  if (!id || !meId) return null;
  try {
    const { data, error } = await db()
      .from('coaching_relationships')
      .select('status, ended_at, ended_by, end_reason, end_note, end_reason_by')
      .or(`and(coach_id.eq.${meId},client_id.eq.${id}),and(coach_id.eq.${id},client_id.eq.${meId})`)
      .eq('status', 'ended')
      .maybeSingle();
    if (error) {
      // A build whose database has no `end_reason` column answers 42703 here.
      // Reported and then treated as unreadable, which is the honest reading:
      // this app cannot say what was recorded.
      report('endCoaching.readReason', error, { otherId: id });
      return null;
    }
    const row = (data ?? null) as {
      ended_at?: unknown; ended_by?: unknown;
      end_reason?: unknown; end_note?: unknown; end_reason_by?: unknown;
    } | null;
    if (!row) return null;
    const by = typeof row.end_reason_by === 'string' ? row.end_reason_by : null;
    const endedBy = typeof row.ended_by === 'string' ? row.ended_by : null;
    return {
      reason: isEndReason(row.end_reason) ? row.end_reason : null,
      note: typeof row.end_note === 'string' && row.end_note.trim() ? row.end_note : null,
      // Null rather than false when nobody is named: "we cannot tell who said
      // this" must not read as "the client said it".
      recordedByMe: by == null ? null : by === meId,
      endedByMe: endedBy == null ? null : endedBy === meId,
      endedAt: typeof row.ended_at === 'string' ? row.ended_at : null,
    };
  } catch (e) {
    report('endCoaching.readReason', e, { otherId: id });
    return null;
  }
}
