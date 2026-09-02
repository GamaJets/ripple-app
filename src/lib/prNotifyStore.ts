// The impure half of the personal-best notification: the device's memory of
// what it has already said, and the send itself.
//
// The sibling of src/lib/prNotify.ts, which holds every rule and every word.
// This half touches AsyncStorage and the push door and so is deliberately not
// under `npm test` — the split is the one src/lib/coachPrefs.ts and
// src/lib/coachPrefsStore.ts already use.
//
// ── Nothing here may cost somebody a set ───────────────────────────────────
//
// `announcePersonalBest` is called from inside `logSet` in
// app/(client)/workouts.tsx, which is the most important function in this
// product: it is what a person is doing while standing over a barbell. So it is
// `void`-called, never awaited, and every path in it swallows. A storage read
// that fails, a send that fails, an edge function that is not deployed — all of
// them end with the set logged and the coach not told, which is the correct
// trade in every direction. `sendPush` is already best-effort by contract and
// is used here rather than `sendPushChecked` for exactly that reason: nothing
// on this screen is going to tell anybody the message arrived.
//
// ── Why the write happens after the send is attempted ──────────────────────
//
// The day is spent by ATTEMPTING, not by succeeding. `sendPush` cannot report
// either outcome, so "retry until it lands" is not a thing this call site can
// implement; what it can avoid is a refusal at the door quietly costing the day
// its one message — which is why the guards in `prDecision` run first and the
// record is written only once a send has actually been issued.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendPush } from '../ui/pushNotifications';
import { announcedRecord, prDecision, prNotification, prRoute, type PrAnnounced, type PrSet } from './prNotify';

const KEY = 'repple.prNotify.v1';

/** In-memory copy, so the second personal best of a session does not wait on a
 *  disk read to be refused. Undefined means "not read yet"; null means "read,
 *  and this device has never sent one". */
let cache: PrAnnounced | null | undefined;

/** What this device last told the coach about, or null if it never has.
 *
 *  A failed or unparseable read is null, which ANNOUNCES. See `prDecision`:
 *  failing that direction costs one extra notification, and failing the other
 *  costs a coach every notification from a handset whose storage hiccuped once. */
async function lastAnnounced(): Promise<PrAnnounced | null> {
  if (cache !== undefined) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = parsed && typeof parsed.day === 'string' && typeof parsed.movement === 'string'
      ? { day: parsed.day, movement: parsed.movement }
      : null;
  } catch { cache = null; }
  return cache;
}

async function remember(rec: PrAnnounced): Promise<void> {
  cache = rec;
  try { await AsyncStorage.setItem(KEY, JSON.stringify(rec)); } catch { /* one extra push tomorrow, at worst */ }
}

/**
 * Tell the coach, if this is the record they should hear about today.
 *
 * Call it from inside the branch that has ALREADY established a personal best.
 * It re-derives nothing about what a record is and cannot: `set` is the set the
 * branch just accepted.
 *
 * `coachId` null is a member with no coach, which is most of them, and is the
 * cheapest of the refusals here. The relationship is re-checked server-side
 * anyway — `notify_users()` in supabase/parts/122 will not write a row for a
 * stranger however this is called — so this check is about not making a
 * pointless request, never about permission.
 *
 * Resolves to what happened, for the benefit of a future caller that wants to
 * log it. The workouts screen ignores it on purpose.
 */
export async function announcePersonalBest(
  coachId: string | null | undefined,
  clientId: string | null | undefined,
  set: PrSet,
  clientName: string | null,
  atMs: number = Date.now(),
): Promise<'sent' | 'no-coach' | 'held' | 'nothing-to-say'> {
  const coach = (coachId ?? '').trim();
  if (!coach) return 'no-coach';
  const decision = prDecision(await lastAnnounced(), set, atMs);
  if (!decision.announce) return 'held';
  const message = prNotification(set, clientName);
  if (!message) return 'nothing-to-say';
  const route = prRoute(clientId);
  try {
    // 'clients' — this is news about a client, and the coach's own switch for
    // that category (src/lib/coachNotify.ts) is applied inside send-push where
    // the recipients are resolved. A muted coach still gets the inbox row.
    await sendPush([coach], message.title, message.body, route ? { route } : {}, 'clients');
  } catch { /* best-effort, like everything else on this path */ }
  await remember(announcedRecord(set, atMs));
  return 'sent';
}
