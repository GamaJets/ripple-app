// The writes behind the member-record kinds the outbox did not have.
//
// src/lib/recordQueue.ts is the policy — which kinds, why they pass the
// outbox's own admission rule, what each payload carries and why only one of
// them expires. This file is the wire: the Supabase statement for each kind and
// the registration that hands them to src/ui/outbox.tsx.
//
// ── Why they are together, and what that is NOT ───────────────────────────
//
// `src/ui/outbox.tsx` argues that handlers are REGISTERED by the provider that
// owns the rows rather than imported into the queue, so that a surface's write
// rules do not drift into a fourth place. Nothing here breaks that. Each
// function below is the only statement in the app that writes its own rows
// through the queue, and each is self-contained: the payload carries everything
// the write needs, so none of them reads a screen's state, a provider's cache or
// anything else that has to be mounted.
//
// What they share is a MOUNT, and only that. The message handler makes the case
// in its own words: it sits at the root rather than inside the chat screen
// because "a message typed in a basement and then left there — the app closed,
// the chat screen never reopened — would otherwise have no handler registered
// when the flush ran, and would sit on the phone being counted and never sent."
// A goal, a planned day and a blood sugar reading are typed on three screens a
// member visits rarely and leaves immediately, so registering from those screens
// would be that exact failure three times over: a dashboard saying "1 planned
// day saved on this phone" that only drains if the member happens to reopen the
// calendar at the moment a flush fires.
//
// So `useRecordOutboxHandlers` registers them all from one place that is
// mounted for the whole app. It belongs beside `<MessageOutboxHandler />` in
// app/_layout.tsx and it is called from `GoalTrackerProvider` instead, which
// wraps the same tree — the effect is identical, and the note is here so the
// next person moves it rather than working out why it is where it is.
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { classifyWrite, type WriteOutcome } from '../lib/offlineQueue';
import { reportError } from '../lib/reportError';
import { asCoachDocAcceptIntent, asDayPlanIntent, asGlucoseIntent, asGoalIntent, asScanIntent, asSessionRequestIntent } from '../lib/recordQueue';
import type { OutboxItem } from '../lib/outbox';
import { useOutbox } from './outbox';

/** Whose rows these are. `getSession()` and not `getUser()`: the second goes to
 *  the network to revalidate and resolves with a null user offline, which would
 *  turn "we have no signal" into "there is nobody to write for" — and a flush
 *  runs at exactly the moments that distinction is fragile. */
async function myId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch { return null; }
}

/**
 * A goal the member set with no signal.
 *
 * The intent names a KIND and not a row, so this resolves "my goal of this kind"
 * against the server at the moment it lands. That is what makes it idempotent
 * and it is also what makes it correct: the member queued this precisely because
 * nothing on the server had been reached, so an id captured on the device would
 * name a row that may not exist, may have been replaced from another handset, or
 * may be the row a second queued intent has already rewritten.
 *
 * `goal_targets` enforces one measured goal per kind with a PARTIAL unique index
 * (kind <> 'custom'), which PostgREST cannot name in an `on_conflict` — so the
 * lookup below is the upsert, exactly as `setMeasuredGoal` does it on the way in.
 */
async function sendGoal(item: OutboxItem): Promise<WriteOutcome> {
  const g = asGoalIntent(item.payload);
  // A payload nothing can ever send. 'refused' takes it out rather than leaving
  // it to be retried on every reconnect for the life of the install.
  if (!g) return 'refused';
  const uid = await myId();
  // No session yet. Not a refusal — the next launch signs in and tries again,
  // and discarding somebody's goal because a token had not landed would be the
  // defect this queue exists to remove.
  if (!uid) return 'unsent';
  const cols = 'id, kind, target_value, title, target_date, achieved_at, created_at';
  try {
    if (g.kind !== 'custom') {
      const { data: found, error: findErr } = await supabase
        .from('goal_targets').select('id').eq('client_id', uid).eq('kind', g.kind).limit(1);
      if (findErr) return classifyWrite(findErr as any, 0);
      const existing = (found ?? [])[0] as { id: string } | undefined;
      if (existing) {
        const { data, error } = await supabase.from('goal_targets')
          .update({ target_value: g.value, target_date: g.targetDate, achieved_at: null, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select(cols);
        if (error) reportError('recordOutbox.goalUpdate', error);
        return classifyWrite(error as any, data ? data.length : 0);
      }
    }
    const { data, error } = await supabase.from('goal_targets').insert({
      client_id: uid,
      kind: g.kind,
      target_value: g.kind === 'custom' ? null : g.value,
      title: g.kind === 'custom' ? g.title : null,
      target_date: g.targetDate,
    }).select(cols);
    if (error) reportError('recordOutbox.goalInsert', error);
    return classifyWrite(error as any, data ? data.length : 0);
  } catch { return 'unsent'; }
}

/**
 * A day the member marked, or unmarked, with no signal.
 *
 * The intent carries an expiry of its own day (src/lib/recordQueue.ts ·
 * `planExpiry`) and `partitionLapsed` takes it out before any flush reaches it,
 * so nothing here has to re-check whether the day is still ahead. That is
 * deliberate: two places deciding whether a plan is still a plan is two places
 * that can disagree, and the one that runs first has already told the member.
 */
async function sendDayPlan(item: OutboxItem): Promise<WriteOutcome> {
  const d = asDayPlanIntent(item.payload);
  if (!d) return 'refused';
  const uid = await myId();
  if (!uid) return 'unsent';
  try {
    if (d.remove) {
      // Counted, not just error-checked. A DELETE that matches nothing is not
      // an error in PostgREST, so without the returned rows a removal RLS
      // declined would come back 'stored' and the mark would be back at the
      // next read.
      const { data, error } = await supabase.from('planned_days').delete()
        .eq('client_id', uid).eq('on_date', d.dateISO).select('on_date');
      if (error) reportError('recordOutbox.planClear', error);
      return classifyWrite(error as any, data ? data.length : 0);
    }
    // The primary key is (client_id, on_date), so a day marked twice offline
    // lands as one row saying whatever the member decided last.
    const { data, error } = await supabase.from('planned_days')
      .upsert({ client_id: uid, on_date: d.dateISO, day_type: d.type, note: d.note },
        { onConflict: 'client_id,on_date' })
      .select('on_date');
    if (error) reportError('recordOutbox.planSave', error);
    return classifyWrite(error as any, data ? data.length : 0);
  } catch { return 'unsent'; }
}

/**
 * A blood sugar reading the member typed with no signal.
 *
 * `taken_at` comes off the intent, so a reading typed on Tuesday and sent on
 * Thursday sits on Tuesday's chart beside Tuesday's lunch. `source` is 'manual'
 * and `external_id` is null, which is what keeps it clear of
 * `glucose_external_once` — the unique index the import writes against.
 *
 * ── The one refusal that is not a refusal ─────────────────────────────────
 *
 * The row carries the id the device minted, so a replay of one the server
 * already holds comes back 23505. `classifyWrite` reads that as 'refused',
 * which is right for a write that failed and wrong here: the reading is in the
 * table, and reporting a refusal would take it out of the queue while telling
 * nobody anything. A duplicate key is 'stored' — the same reading the same
 * handler already sent, offered twice because the first answer was lost. Same
 * as `sendScan` and `sendCoachDocAccept`, and nothing else in the 23 class is
 * reinterpreted: a 23514 really is a figure `mmol_l`'s CHECK will not take.
 *
 * A reading queued by a build that did not mint an id has none to send, and the
 * server fills the key in as it always did. There is nothing for a replay of
 * one of those to collide with, so it duplicates exactly as it always did — see
 * `GlucoseIntent`. The `id` field is omitted rather than sent as null, which
 * would be a null primary key rather than an absent one.
 */
async function sendGlucose(item: OutboxItem): Promise<WriteOutcome> {
  const r = asGlucoseIntent(item.payload);
  if (!r) return 'refused';
  const uid = await myId();
  if (!uid) return 'unsent';
  try {
    const { data, error } = await supabase.from('glucose_readings').insert({
      ...(r.id ? { id: r.id } : {}),
      client_id: uid, taken_at: r.at, mmol_l: r.mmol, external_id: null, source: 'manual',
    }).select('id');
    if (error) {
      if (r.id && (error as { code?: string }).code === '23505') return 'stored';
      reportError('recordOutbox.glucose', error);
    }
    return classifyWrite(error as any, data ? data.length : 0);
  } catch { return 'unsent'; }
}

/**
 * A coach's document the member accepted with no signal.
 *
 * The row is (document_id, client_id) and nothing else this end supplies:
 * `accepted_at` defaults to now() on the server, and the INSERT policy
 * (supabase/parts/135) re-checks that the document is the member's own coach's
 * and still in circulation. So a replay is checked against the world as it is
 * when it lands rather than as the phone remembered it — which is the property
 * that makes this queueable at all.
 *
 * ── The one refusal that is not a refusal ─────────────────────────────────
 *
 * The primary key is (document_id, client_id), so sending one the server
 * already holds comes back 23505. `classifyWrite` reads that as 'refused',
 * which is right for every other write in this file and wrong here: the row
 * exists, the member HAS accepted it, and reporting a refusal would leave a
 * screen saying their signature never landed when it is sitting in the table.
 * A duplicate key is 'stored' — that is what the member asked for and what is
 * now true. Nothing else in the 23 class is reinterpreted.
 */
async function sendCoachDocAccept(item: OutboxItem): Promise<WriteOutcome> {
  const d = asCoachDocAcceptIntent(item.payload);
  if (!d) return 'refused';
  const uid = await myId();
  if (!uid) return 'unsent';
  try {
    const { data, error } = await supabase.from('coach_document_acceptances')
      .insert({ document_id: d.documentId, client_id: uid })
      .select('document_id');
    if (error) {
      if ((error as { code?: string }).code === '23505') return 'stored';
      reportError('recordOutbox.coachDocAccept', error, { id: d.documentId });
    }
    return classifyWrite(error as any, data ? data.length : 0);
  } catch { return 'unsent'; }
}

/**
 * A body scan the member typed in with no signal.
 *
 * `client_id` is resolved here, at the moment it lands, rather than captured on
 * the device — the same reasoning `sendGoal` gives: the intent was queued
 * precisely because no server had been reached, so an id taken from the phone
 * names an account nothing has confirmed.
 *
 * `metrics` goes in the SAME statement as the rest of the row, unlike
 * `clientData.addScan`, which inserts and then updates. That is deliberate:
 * here there is nobody watching to be told that the scan saved and the
 * breakdown did not, and a two-statement write in a replay is two chances to
 * land half a row. One insert either happens or it does not.
 *
 * ── The one refusal that is not a refusal ─────────────────────────────────
 *
 * The row carries the id the device minted, so a replay of one the server
 * already holds comes back 23505. `classifyWrite` reads that as 'refused',
 * which is right for a write that failed and wrong here: the scan is in the
 * table, it is the member's own, and reporting a refusal would leave a screen
 * saying their body composition never landed while it is sitting in their
 * history. A duplicate key is 'stored'. Nothing else in the 23 class is
 * reinterpreted — a 23514 really is a figure the column will not take.
 */
async function sendScan(item: OutboxItem): Promise<WriteOutcome> {
  const s = asScanIntent(item.payload);
  if (!s) return 'refused';
  const uid = await myId();
  if (!uid) return 'unsent';
  try {
    const { data, error } = await supabase.from('scans').insert({
      id: s.id,
      client_id: uid,
      taken_at: s.takenAt,
      weight_kg: s.weightKg,
      body_fat_pct: s.bodyFatPct,
      skeletal_muscle_kg: s.skeletalMuscleKg,
      source: s.source,
      ...(s.metrics ? { metrics: s.metrics } : {}),
    }).select('id');
    if (error) {
      if ((error as { code?: string }).code === '23505') return 'stored';
      reportError('recordOutbox.scan', error);
    }
    return classifyWrite(error as any, data ? data.length : 0);
  } catch { return 'unsent'; }
}

/**
 * An hour the member asked their coach for with no signal.
 *
 * The one handler here that talks to an RPC rather than to a table, because
 * `session_requests` has no INSERT policy for anybody (supabase/parts/740, and
 * part 09's reasoning about booking). `request_session` decides who the coach is
 * from `clients.trainer_id` AT THE MOMENT IT RUNS, so a member who changed coach
 * while this sat on their phone asks the coach they now have.
 *
 * Three outcomes, and the middle one is the reason this is not a one-liner:
 *
 *   ok                 the question is with the coach. 'stored'.
 *   'already-asked'    the partial unique index refused a second live request
 *                      for the same hour, which means THIS request is already
 *                      there — sent from another handset, or by an earlier
 *                      flush whose answer never got back to us. 'stored', for
 *                      exactly the reason a 23505 is 'stored' for a coach
 *                      document: the row exists and the member's intent stands.
 *   any other reason   the server read it and said no — no coach on the
 *                      account, the hour has passed, too many outstanding.
 *                      Offering the same bytes again gets the same answer, so
 *                      it comes out of the queue rather than being retried for
 *                      ever. 'refused'.
 *
 * An hour that has passed cannot normally reach the third branch: the intent
 * carries `sessionRequestExpiry`, so `partitionLapsed` takes it out first and
 * the member is told it did not go. The branch is here for the flush that runs
 * in the same second the hour turns.
 */
async function sendSessionRequest(item: OutboxItem): Promise<WriteOutcome> {
  const d = asSessionRequestIntent(item.payload);
  if (!d) return 'refused';
  const uid = await myId();
  if (!uid) return 'unsent';
  try {
    const { data, error } = await supabase.rpc('request_session', {
      p_starts_at: d.startsAt, p_duration_min: d.durationMin, p_note: d.note,
    });
    if (error) {
      reportError('recordOutbox.sessionRequest', error);
      // Nobody answered, as far as this can tell. `classifyWrite` is what knows
      // the difference between a wire that dropped and a server that refused.
      return classifyWrite(error as any, 0) === 'unsent' ? 'unsent' : 'refused';
    }
    const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (o.ok === true) return 'stored';
    if (o.reason === 'already-asked') return 'stored';
    // A null answer is a database that has not taken part 740. There is nothing
    // for this to become on that server and retrying would not change it.
    return 'refused';
  } catch { return 'unsent'; }
}

/**
 * Register all of them, for as long as the caller is mounted.
 *
 * Renders nothing. Every one of these is a no-op without a backend, and without
 * an outbox above it there is nothing to register into — which `useOutbox`
 * answers with null rather than a throw, because a queue is an enhancement to a
 * write path and not a precondition for one.
 *
 * `onGoalSettled` is the one thread back out, and it exists for a specific
 * reason rather than as a general hook: the goals screen shows a waiting goal
 * under the OUTBOX's id, so something has to say when that row has stopped being
 * the truth. It fires for 'stored' and for 'refused' alike — both mean the
 * intent has left the queue, and a row left behind by a refusal would be a goal
 * on the member's list that no server has ever heard of. It does NOT fire for
 * 'unsent': that intent is still waiting and so is the row.
 */
export function useRecordOutboxHandlers(opts: { onGoalSettled?: (id: string) => void } = {}): void {
  const outbox = useOutbox();
  const { onGoalSettled } = opts;
  // Held in a ref so a caller passing an inline arrow does not re-register three
  // handlers on every render of a provider that wraps the whole app.
  const settled = useRef(onGoalSettled);
  settled.current = onGoalSettled;
  useEffect(() => {
    if (!outbox || !USE_SUPABASE) return;
    const off = [
      outbox.registerHandler('goal', async (item) => {
        const out = await sendGoal(item);
        if (out !== 'unsent') settled.current?.(item.id);
        return out;
      }),
      outbox.registerHandler('day-plan', sendDayPlan),
      outbox.registerHandler('glucose', sendGlucose),
      // Registered here rather than from app/(client)/coach-documents.tsx, and
      // for the reason the header gives about the other three, only more so:
      // paperwork is a screen a member visits once. An acceptance queued in a
      // basement studio and then left there — the app closed, that screen never
      // reopened — would have no handler at the flush and would sit on the
      // phone being counted for ever.
      outbox.registerHandler('coach-doc-accept', sendCoachDocAccept),
      // Registered here for the reason the header gives about the other four.
      // Scans is a screen somebody opens once a month, on the way out of the
      // gym, and a scan queued there and then left — the app closed, that
      // screen never reopened — would have no handler at the flush and would
      // sit on the phone being counted for ever.
      outbox.registerHandler('scan', sendScan),
      // Registered here for the reason the header gives about the other five,
      // and it is the sharpest case of it: a member types "can we do Tuesday at
      // seven" on the request screen, gets no signal, and closes the app. That
      // screen is one they visit when they want something, not one they leave
      // open — so a handler registered from it would never be mounted at the
      // flush, and the question would sit on the phone being counted for ever
      // while they waited for an answer nobody had been asked for.
      outbox.registerHandler('session-request', sendSessionRequest),
    ];
    return () => { for (const f of off) f(); };
  }, [outbox]);
}
