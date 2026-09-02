// The writes behind the three member-record kinds the outbox did not have.
//
// src/lib/recordQueue.ts is the policy — which three, why they pass the
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
// So `useRecordOutboxHandlers` registers all three from one place that is
// mounted for the whole app. It belongs beside `<MessageOutboxHandler />` in
// app/_layout.tsx and it is called from `GoalTrackerProvider` instead, which
// wraps the same tree — the effect is identical, and the note is here so the
// next person moves it rather than working out why it is where it is.
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { classifyWrite, type WriteOutcome } from '../lib/offlineQueue';
import { reportError } from '../lib/reportError';
import { asDayPlanIntent, asGlucoseIntent, asGoalIntent } from '../lib/recordQueue';
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
 */
async function sendGlucose(item: OutboxItem): Promise<WriteOutcome> {
  const r = asGlucoseIntent(item.payload);
  if (!r) return 'refused';
  const uid = await myId();
  if (!uid) return 'unsent';
  try {
    const { data, error } = await supabase.from('glucose_readings').insert({
      client_id: uid, taken_at: r.at, mmol_l: r.mmol, external_id: null, source: 'manual',
    }).select('id');
    if (error) reportError('recordOutbox.glucose', error);
    return classifyWrite(error as any, data ? data.length : 0);
  } catch { return 'unsent'; }
}

/**
 * Register all three, for as long as the caller is mounted.
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
    ];
    return () => { for (const f of off) f(); };
  }, [outbox]);
}
