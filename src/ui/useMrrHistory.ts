// Monthly-history hooks — record a monthly snapshot of a metric so a trend
// chart becomes real history over time.
//
// Months with no stored snapshot return null, NOT today's value. The version
// before this one carried the current figure backwards, so a fresh install drew
// a flat six-month line labelled Mar–Aug and the owner read five months of
// trading that never happened. `months` reports how many points are real, and
// the forecast on revenue.tsx uses that instead of assuming six.
//
// That rule now lives in src/lib/monthlyHistory.ts, under a test that puts the
// bug back and watches it fail (`npm run mutate --file src/lib/monthlyHistory.ts`).
// It did not move because the file was crowded — it moved because "a month we
// have no figure for is a gap" is one line of code that four screens depend on
// and that any tidy-up would reintroduce a fallback into.
//
// ── The history used to live only on the handset ───────────────────────────
//
// It was AsyncStorage and nothing else. That is defensible for a cache and
// indefensible for this: the trend is the only record of the past that exists.
// Nothing recomputes March from source — March is a number a phone wrote down
// in March. So a reinstall did not degrade the chart, it permanently deleted
// several months of a business's history, and a coach's second phone drew a
// different chart from their first with no way to tell which was right.
//
// The months now go to `metric_history` (part 129), keyed by the same storage
// key so there is no translation table between what the device wrote and what
// the account holds. AsyncStorage is kept, and kept doing exactly what it did:
// it makes the first paint right, it is the whole store when the backend is off
// or nobody is signed in, and it is what a phone in a basement gym with no
// signal still records into.
//
// ── Three guards, and none of them is optional ─────────────────────────────
//
// 1. **A failed read writes nothing.** Same reasoning as src/ui/settings.tsx:
//    a provider that pushes its state to the server before it has read the
//    server's state overwrites the real answer with a constructed one. Here the
//    constructed answer would be "this account has one month of history",
//    published over an account that has nine.
//
// 2. **The server never prunes.** Only the current month and the months this
//    device has that the server has never heard of are ever sent. A handset is
//    not entitled to delete a month it has not heard of — that is the other
//    phone's record, or the record from before this shipped.
//
// 3. **`status` is carried out to the screens.** An empty series under 'error'
//    means the history could not be read, not that there is none, and a screen
//    about to write "no history yet" has to be able to tell. The existing four
//    fields are unchanged and every existing caller still means what it meant;
//    `status` is additive, and app/(owner)/dashboard.tsx and revenue.tsx
//    compile and behave exactly as before without reading it.
//
// A null `currentValue` is still not recorded, and that has become MORE
// important rather than less. A figure that is wrong because a read failed used
// to be saved to one device; it is now saved to the account, shows on every
// device, and nothing later can tell it from a month that really was that
// quiet. The caller must pass null rather than a zero it is not sure of.
//
// ── Two strings, where there used to be one ────────────────────────────────
//
// The paragraph above says the months go to the server "keyed by the same
// storage key so there is no translation table". That was the defect, and it
// is corrected here: the DEVICE key and the `metric_key` are two different
// compositions now, and only one of them carries an account.
//
//   metric_key   'repple.owner.mrrHistory.GBP'            — what the row is
//   device key   'repple.owner.mrrHistory.GBP:<uid>'      — whose phone shelf
//
// The server row is already scoped by `user_id`, so putting the account into
// `metric_key` would split one coach's history across every handset they use.
// AsyncStorage has no `user_id` at all, so leaving the account OUT of the
// device key made one shelf that everybody who ever signed in on the phone
// shared — and because `missingOnServer` is "months the server has never heard
// of" and `saveMetricHistory` resolves the uid fresh at save time, the next
// coach to sign in published the previous coach's revenue under their own
// `user_id`, permanently. src/lib/monthlyHistory.ts walks the five steps.
//
// The legacy unqualified value is REMOVED rather than migrated, and that is a
// deliberate loss. See `useMonthlyHistory` below.
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthRevision } from './authRevision';
import { useAuth } from './auth';
import type { LoadStatus } from './loadStatus';
import {
  monthKey, monthWindow, seriesFor, recordedCount, historyDelta,
  sanitiseSnapshots, moneyHistoryKey, deviceHistoryKey,
  historyPass, beginHistoryPass, applyHistoryPass, NO_HISTORY_SESSION,
  type Snapshots,
} from '../lib/monthlyHistory';
import { fetchMetricHistory, saveMetricHistory } from '../lib/metricHistoryStore';

/** How many months a chart shows. Six, as it has always been. */
const WINDOW = 6;

/**
 * How many a YEAR-ON-YEAR read needs, which is thirteen and not twelve.
 *
 * Twelve months back from August is last August, and a window of twelve holds
 * September through August — it stops one month short of the month the
 * comparison is against. Thirteen is the smallest window that contains both
 * ends of it. Written down rather than inlined because "12" is the number
 * everybody reaches for and it is wrong by exactly one column.
 */
export const YEAR_WINDOW = 13;

export interface MonthlyHistory {
  series: (number | null)[];
  labels: string[];
  delta: number;
  months: number;
  /** Whether the history above can be trusted. 'error' means the account's
   *  months could not be read and what is drawn is this device's cache — which
   *  may be all of it, some of it, or none of it. Additive: callers that
   *  ignore it behave exactly as they did before. */
  status: LoadStatus;
  /**
   * Every month this account and this device hold, keyed 'YYYY-MM' — not just
   * the ones in the window above.
   *
   * `series` is the CHART. This is the RECORD, and the two are different
   * questions: `yearOnYear` in src/lib/coachCohorts.ts needs the same month
   * last year whether or not the chart is currently drawing it, and a caller
   * forced to widen the chart to reach that month would be changing what is on
   * screen in order to compute something that is not on it.
   */
  snapshots: Snapshots;
}

/**
 * Generic: record `currentValue` under `storageKey` for this month, return the
 * six-month series.
 *
 * `storageKey` is the SERVER's `metric_key` and nothing else. What the device
 * stores under is `deviceHistoryKey(storageKey, uid)`, which the caller never
 * sees and must never be sent as a metric key. The parameter kept its name
 * because every call site passes the same string it always did; what changed is
 * that the string no longer reaches AsyncStorage.
 *
 * **A null `currentValue` is not recorded.** See the header — this hook WRITES,
 * and now writes to the account rather than to one phone.
 *
 * ── The uid is resolved here rather than taken as an argument ─────────────
 *
 * It has to be a RENDER value, not something a `getUser()` inside the effect
 * finds: the effect is keyed on the device key, and that is what makes an
 * account switch a re-read rather than a chart left standing from the previous
 * session. `useAuth()` is where src/ui/exerciseVideos.ts gets it for the same
 * reason and for the same class of defect.
 *
 * Taking it as a parameter instead would have been the same fix with one more
 * thing for a call site to get wrong — app/(trainer)/analytics.tsx passes a
 * literal key and has no uid of its own — and a hook whose account can be
 * supplied by its caller is a hook whose account can be supplied WRONG.
 */
export function useMonthlyHistory(storageKey: string, currentValue: number | null, window: number = WINDOW): MonthlyHistory {
  const rev = useAuthRevision();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id ?? null;
  // The two strings. `storageKey` goes to the server; `deviceKey` goes to the
  // phone. Null means nobody is signed in, and a null device key means DO NOT
  // PERSIST — not "fall back to the bare key", which is the defect itself.
  const deviceKey = deviceHistoryKey(storageKey, uid);

  // Everything the provider holds, and whose it is. One object rather than two
  // pieces of state and two refs, because the thing that has to be true is that
  // they are cleared TOGETHER when the account changes — see `beginHistoryPass`
  // in src/lib/monthlyHistory.ts, which is where that is stated and tested.
  const [session, setSession] = useState(NO_HISTORY_SESSION);
  // A mirror the async pass can read without a stale closure. It is written
  // beside every setSession and never on its own.
  const live = useRef(session);
  const put = (next: typeof session) => { live.current = next; setSession(next); };

  // Cleared BEFORE the read, not left at whatever the last key's pass set it
  // to. A provider mounted at the root outlives a sign-out — nothing unmounts
  // it — so without this the departing coach's months stay on screen under the
  // next coach's name, and the `hydrated` flag stays armed for a write over the
  // new account's stored bytes.
  useEffect(() => { put(beginHistoryPass(live.current, deviceKey)); }, [deviceKey]);

  // The unqualified key this replaces, removed unread.
  //
  // NOT migrated into the signed-in account, and that is a deliberate loss of
  // whatever is in it. The blob carries no account: nothing on the device
  // distinguishes a single-owner handset's own old months from a shared
  // handset's previous coach's, so a migration is a guess whose wrong answer is
  // one coach's revenue permanently attributed to another — the exact outcome
  // this change exists to end, performed once, on purpose, by the code that
  // fixes it. Losing a few months of a chart is recoverable by waiting; a
  // figure filed under the wrong person is not recoverable at all. Lane 4 made
  // this call for `repple.mealOverride` and src/lib/handsetClips.ts made it for
  // the coach's clips; this is the third and it is the same call.
  useEffect(() => { AsyncStorage.removeItem(storageKey).catch(() => {}); }, [storageKey]);

  useEffect(() => {
    // No account is no store. The months are not read, not kept, and — this is
    // the half that matters — nothing is published, because there is nobody to
    // publish them as.
    if (!deviceKey) return;
    let cancelled = false;
    (async () => {
      // ── the device shelf: what makes the first paint right ───────────────
      //
      // `hydrated` is the arming flag, and it is armed by a read of THIS key
      // and by nothing else. Armed, the months already in hand are the shelf —
      // this pass wrote them there itself — and the store is not read again for
      // a `currentValue` that has merely landed. Unarmed, the shelf is read.
      //
      // Which is why `beginHistoryPass` clears it before the key changes hands.
      // A flag left standing from the PREVIOUS account's read makes the line
      // below hand the departing coach's months to this pass as though they
      // were this coach's own — to be written under their device key and
      // offered to their server row as a backfill. That is the whole defect,
      // reachable through a boolean.
      //
      // `null` means the read FAILED, and it is not the same answer as `{}`. A
      // shelf we could not read is one whose contents we do not know, and
      // `historyPass` refuses to write over it. The version before this treated
      // an unreadable store as an empty one and wrote its own idea of the
      // history straight back on top.
      const held = live.current;
      let cached: Snapshots | null = null;
      if (held.key === deviceKey && held.hydrated) {
        cached = held.hist;
      } else {
        try {
          const raw = await AsyncStorage.getItem(deviceKey);
          cached = raw ? sanitiseSnapshots(JSON.parse(raw)) : {};
        } catch { cached = null; }
        if (cancelled) return;
      }

      // ── the account's own months ─────────────────────────────────────────
      //
      // Cached against the DEVICE key, which carries the account. Cached
      // against the metric key alone — as it was — it hands coach B the rows
      // read for coach A whenever the auth revision happens not to have moved.
      let read: { snapshots: Snapshots; status: LoadStatus };
      if (held.key === deviceKey && held.server) {
        read = { snapshots: held.server, status: 'ready' };
      } else {
        read = await fetchMetricHistory(uid, storageKey);
        if (cancelled) return;
      }

      const pass = historyPass({ cached, server: read, currentValue, thisMonth: monthKey(new Date()) });

      // The shelf is written whatever the server said — it is the store that
      // works with no signal, and a month recorded offline is uploaded by the
      // backfill on the next launch that can reach the server. But only when
      // the read of it came back: see `writeCache`.
      if (pass.writeCache) {
        try { await AsyncStorage.setItem(deviceKey, JSON.stringify(pass.merged)); } catch { /* best-effort */ }
        if (cancelled) return;
      }

      // ── the upload ───────────────────────────────────────────────────────
      //
      // `historyPass` has already decided what may be sent: nothing at all
      // unless the server read succeeded, and otherwise this month plus only
      // the months the server has never heard of. Those months are now this
      // account's own by construction — the shelf they came off has the account
      // in its key — which is the whole of the fix.
      let server: Snapshots | null = read.status === 'ready' ? read.snapshots : null;
      let sent = held.key === deviceKey ? held.sent : '';
      const months = Object.keys(pass.upload).sort().join(',');
      const stamp = `${deviceKey}|${rev}|${currentValue}|${months}`;
      if (months && stamp !== sent) {
        const written = await saveMetricHistory(uid, storageKey, pass.upload);
        if (cancelled) return;
        // Only remembered as sent when the server confirmed rows. A refused
        // write retried next render is the behaviour we want; a refused write
        // recorded as done is how a month goes missing quietly.
        if (written > 0) {
          sent = stamp;
          // Fold the uploaded months into the cached server view so the next
          // pass does not offer them again.
          if (server) server = { ...server, ...pass.upload };
        }
      }

      // Discarded outright if the account changed while any of the above was in
      // flight. `cancelled` catches the ordinary case; the key check catches a
      // pass whose cleanup has not run yet, and costs one comparison.
      put(applyHistoryPass(live.current, deviceKey, pass, server, read.status, sent));
    })();
    return () => { cancelled = true; };
  }, [deviceKey, storageKey, currentValue, rev]);

  const cols = monthWindow(new Date(), window);
  const series = seriesFor(cols, session.hist);
  return {
    series,
    labels: cols.map((m) => m.label),
    // No previous month recorded, or nothing to compare it against.
    delta: historyDelta(series, currentValue),
    months: recordedCount(series),
    // Signed out is 'ready' with nothing — there is genuinely no history for
    // nobody, and no absent server being misreported. Still RESTORING a session
    // is 'loading', because at that moment we do not yet know whose phone this
    // is, and a screen that said "no history yet" there would be asserting
    // something it cannot know. src/ui/loadStatus.ts states the distinction.
    status: deviceKey ? session.status : (authLoading ? 'loading' : 'ready'),
    // The whole map, not the window. A year-on-year read needs a month that
    // may sit outside whatever window the chart happens to be drawing, and a
    // caller that had to widen the chart to reach it would be changing what is
    // on screen in order to compute something that is not. Additive: every
    // existing caller ignores it and behaves exactly as before.
    snapshots: session.hist,
  };
}

/**
 * The gym's recurring membership revenue, month by month.
 *
 * ── Two things were wrong with this hook while nothing called it ──────────
 *
 * **It took a `number`, not a `number | null`.** The generic above states its
 * own contract in bold: a null `currentValue` is not recorded, and "the caller
 * must pass null rather than a zero it is not sure of". A signature that
 * cannot express null forces every caller with an unread figure to pass 0 —
 * and since this hook now writes to the ACCOUNT rather than to one phone, that
 * zero becomes a permanent month of "this gym took nothing", visible on every
 * device, indistinguishable from a month that really was that quiet. The
 * sibling `useSessionsHistory` has always taken `number | null`. This is that
 * same signature, and it is the reason this could not safely be wired up as it
 * stood.
 *
 * **It had no currency.** Every month stored here is a bare number, and Repple
 * is white-label: `tenants.currency` is a setting an owner can change. Under
 * one key a gym that billed in GBP until March and EUR after it gets a single
 * continuous line of two different moneys, with a month-on-month delta
 * computed across the change. `moneyHistoryKey` scopes the key to the currency
 * so a change starts a fresh, honestly short series instead, and the old
 * months survive under their own key if the gym switches back.
 *
 * With no currency there is no key, and with no key nothing is read or
 * written: the hook returns an empty history under 'ready', because "this gym
 * has not set a currency" is a known answer and not a failed read. The screen
 * has its own sentence for that case and must not be handed an 'error' that
 * would make it say the months could not be read.
 *
 * @param currentMrr whole units of `currency` — null when it is not known,
 *   which includes the case where the gym's memberships name more than one
 *   currency and there is therefore no single figure to record.
 * @param currency the gym's ISO code, or null when it has not set one.
 */
export function useMrrHistory(currentMrr: number | null, currency: string | null): MonthlyHistory {
  const key = moneyHistoryKey('repple.owner.mrrHistory', currency);
  // Hooks cannot be called conditionally, so the no-currency case goes THROUGH
  // the generic with a key that reads and writes nothing rather than around it.
  const hist = useMonthlyHistory(key ?? NO_CURRENCY_KEY, key ? currentMrr : null);
  return key ? hist : { series: [], labels: [], delta: 0, months: 0, status: 'ready', snapshots: {} };
}

/**
 * The key used when there is no currency to scope by.
 *
 * It is a real key so the generic hook's rules are unchanged, and nothing is
 * ever written under it because the value passed alongside it is always null.
 * Named rather than inlined so that a row appearing under it in
 * `metric_history` is immediately legible as this case rather than as a gym
 * whose currency code is missing.
 */
const NO_CURRENCY_KEY = 'repple.owner.mrrHistory.no-currency';

/**
 * Sessions delivered per month for the gym owner. Deliberately a different key
 * from the MRR history: that one holds dollars from when the owner portal was a
 * SaaS console, and feeding session counts into it would draw one line out of
 * two different units without saying so.
 */
export function useSessionsHistory(currentSessions: number | null): MonthlyHistory {
  return useMonthlyHistory('repple.owner.sessionsHistory', currentSessions);
}
