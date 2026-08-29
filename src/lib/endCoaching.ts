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
      title: 'Still linked',
      body: `${result.reason} Nothing was changed, so ${who} still coaches you and still sees your training.`,
    };
  }
  if (!result.ended) {
    return {
      title: 'Nothing to end',
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
