// The arithmetic behind the monthly trend charts, with no storage in it.
//
// The sibling of src/ui/useMrrHistory.ts, which owns the reads and writes:
// AsyncStorage on the device, `metric_history` on the server (part 129). This
// file holds the part that decides WHICH months are real, and it is pure — no
// supabase, no react-native, no clock of its own — so `npm test` can run it.
//
// ── The one rule this file exists to protect ───────────────────────────────
//
// **A month with no stored snapshot is null. It is never today's figure.**
//
// The version before the hook was written carried the current value backwards
// across every unfilled month, so a fresh install drew a flat six-month line
// labelled Mar–Aug and a gym owner read five months of trading that had never
// happened. Nothing on the chart said those points were invented; a flat line
// is what a steady business looks like.
//
// That failure is not fixed once. It comes back the moment somebody writes a
// `?? current`, a `|| 0` or a `.fill(latest)` anywhere near `seriesFor`, and
// every one of those looks like a tidy-up. So the gap is produced HERE, by one
// function, under a test that puts the bug back and watches it fail.
//
// Moving the history to the server introduced a second way to make the same
// wrong picture, which is why `mergeSnapshots` is here too: a month the server
// has no row for must stay a gap, not fall back to whatever the handset last
// cached for a DIFFERENT month.
//
// ── And a second rule, arriving with the server ────────────────────────────
//
// A failed read is not an empty history. This file cannot enforce that — it
// never sees a network — so the hook carries a LoadStatus and the screens say
// "could not be read" rather than "no history yet". What this file does is
// refuse to invent the values, so that under 'error' there is genuinely nothing
// to print.
//
// ── And a third, arriving with a shared handset ────────────────────────────
//
// One string was doing two jobs. The AsyncStorage key and the server's
// `metric_key` were the SAME string — 'repple.owner.mrrHistory.GBP',
// 'repple.owner.sessionsHistory', 'repple.trainer.deliveredRevHistory' — and
// that string carries no account. See `deviceHistoryKey` below for what that
// cost. The device key and the metric key are two compositions now, and the
// second half of this file exists to keep them apart and to make the sequence
// that broke it — sign in, sign out, sign in as somebody else — runnable
// rather than reviewable.
import type { LoadStatus } from '../ui/loadStatus';

/** Month labels, index-aligned with Date#getMonth. */
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One column of the chart: the key it is stored under and the word under it. */
export interface MonthPoint { key: string; label: string }

/** A month's snapshots, keyed 'YYYY-MM'. The shape both stores agree on. */
export type Snapshots = Record<string, number>;

/**
 * The storage key for the calendar month a date falls in, in LOCAL time.
 *
 * Local and not UTC, deliberately and permanently. A coach in Auckland opening
 * the app at 9am on 1 August is in August; `toISOString()` would file that
 * snapshot under July and put it in the wrong column of their own chart. The
 * suite runs under three timezones (`test:zones`) because of this line.
 */
export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** True for a well-formed 'YYYY-MM'. The same shape the database check
 *  constraint `metric_history_month_is_ym` enforces, so a key this rejects is
 *  one the server would have rejected anyway. */
export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/**
 * The `count` months ending with the one `now` falls in, oldest first.
 *
 * `new Date(y, m - i, 1)` rather than any month arithmetic of our own: the Date
 * constructor normalises a negative month into the previous year, which is what
 * makes a window starting in the previous December come out right.
 */
export function monthWindow(now: Date, count: number): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: MONTH_LABELS[d.getMonth()] });
  }
  return out;
}

/**
 * The series to plot: one entry per month in the window, null where there is
 * no snapshot for that month.
 *
 * THE NULL IS THE POINT. Do not add a fallback to this function. A month we
 * hold no figure for is a month nobody knows about, and the chart draws it as a
 * gap so that a reader can see the difference between a quiet month and a month
 * that was never recorded. See the header.
 */
export function seriesFor(window: MonthPoint[], snapshots: Snapshots): (number | null)[] {
  return window.map((m) => {
    const v = snapshots[m.key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
}

/** How many points on the chart are real. The forecast on the owner's revenue
 *  screen divides by this rather than by the window length, which is how a
 *  two-month-old install stops being extrapolated as six months of trading. */
export const recordedCount = (series: (number | null)[]): number =>
  series.filter((v): v is number => v != null).length;

/**
 * Month-on-month change: this month's figure against last month's.
 *
 * 0 when either end is missing — and 0 here means "no comparison", which the
 * screens render as no delta rather than as "unchanged". Preserved exactly as
 * it was before the move to the server: `series[length - 2]` is the previous
 * month's column, and a null at either end produces no claim.
 */
export function historyDelta(series: (number | null)[], currentValue: number | null): number {
  const prev = series[series.length - 2];
  if (prev == null || currentValue == null) return 0;
  return currentValue - prev;
}

/**
 * Anything that came out of a store, reduced to snapshots that can be plotted.
 *
 * Both sources need this. AsyncStorage holds whatever an older build wrote and
 * survives every upgrade; the server holds numeric columns that arrive from
 * PostgREST as strings often enough to matter (`numeric` is not a JS number).
 * A NaN reaching `seriesFor` would be typeof 'number' and would plot as a hole
 * in the line with no explanation, so it is filtered here rather than there.
 *
 * A key that is not 'YYYY-MM' is dropped rather than kept: it can never match a
 * window month, so keeping it would only carry corruption forward on the next
 * write-back.
 */
export function sanitiseSnapshots(raw: unknown): Snapshots {
  const out: Snapshots = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMonthKey(k)) continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/**
 * The device's cache and the account's history, combined.
 *
 * The server wins where both hold a month, because the server is the account's
 * record and the cache is one handset's memory of it — a coach who corrected a
 * figure on their other phone should see the correction here.
 *
 * The cache is NOT discarded for the months the server has never heard of. Two
 * cases produce those and both matter: a month recorded offline that has not
 * been uploaded yet, and every month recorded by every coach before part 129
 * existed. Dropping them would mean this change ships as an erasure of exactly
 * the history it was written to preserve.
 */
export function mergeSnapshots(local: Snapshots, server: Snapshots): Snapshots {
  return { ...local, ...server };
}

/**
 * The cached months the server does not have — the backfill.
 *
 * Only the ones it has never heard of. A month the server holds is left alone
 * even where the cache disagrees, so a stale handset cannot overwrite the
 * account's record on the strength of being opened.
 */
export function missingOnServer(local: Snapshots, server: Snapshots): Snapshots {
  const out: Snapshots = {};
  for (const [k, v] of Object.entries(local)) {
    if (!(k in server)) out[k] = v;
  }
  return out;
}

/**
 * The storage key for a history of MONEY, which is not the same thing as a
 * history of a count.
 *
 * ── Why a money series needs the currency in its key ──────────────────────
 *
 * Everything this module stores is a bare number per month. That is fine for
 * sessions delivered, and it is not fine for revenue: Repple is white-label
 * and `tenants.currency` is a setting the owner can change. A gym that billed
 * in GBP until March and in EUR after it would, under one key, have a single
 * line whose first three points are pounds and whose last three are euros —
 * drawn continuously, with a delta computed ACROSS the change, and nothing on
 * screen saying so. That is the house rule this codebase repeats more than any
 * other: never add two currencies together, and never let one be mistaken for
 * the other.
 *
 * Scoping the key means a currency change starts a fresh series instead. The
 * old months are not destroyed — they stay under their own key and come back
 * if the gym switches back — and the new line is short and honestly short,
 * which the screen reports as "tracking started" rather than as a collapse in
 * revenue.
 *
 * A null currency gets no key at all. A figure whose unit is unknown must not
 * be written down, because nothing later can recover what it meant: see
 * `wholeFromMinor` in src/lib/wholeUnits.ts for the same argument about the
 * decimal point.
 *
 * @param base the unscoped key, e.g. 'repple.owner.mrrHistory'.
 * @param currency an ISO code, or null when the gym has not set one.
 * @returns the key to store under, or null when there is nothing safe to store.
 */
export function moneyHistoryKey(base: string, currency: string | null | undefined): string | null {
  if (!base) return null;
  const code = (currency ?? '').trim().toUpperCase();
  // Exactly three letters. A currency column holding '' or 'gbp ' or a stray
  // symbol must not quietly become part of a key, because two spellings of one
  // currency are two separate histories and the split is invisible.
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return `${base}.${code}`;
}

// ───────────────────────────────────────────────────────────────────────────
// WHOSE MONTHS THESE ARE
// ───────────────────────────────────────────────────────────────────────────
//
// ── The defect ────────────────────────────────────────────────────────────
//
// `useMonthlyHistory` read and wrote AsyncStorage under the very string it
// sent to the server as `metric_key`:
//
//   const raw = await AsyncStorage.getItem(storageKey);      // the DEVICE
//   …
//   await saveMetricHistory(storageKey, upload);             // the ACCOUNT
//
// One string, two jobs, and only one of them may carry an account. The metric
// key must NOT — it names the quantity ("this gym's recurring revenue in GBP")
// and the row is already scoped by `user_id`. The device key must, because a
// handset has no `user_id` and AsyncStorage is one shelf shared by everybody
// who ever signs in on the phone.
//
// What the collision did, step by step, on a gym's front-desk handset:
//
//   1. Coach A signs in. Their revenue months accumulate under the bare key.
//   2. Coach A signs out. Nothing removes the key — it is not in
//      PERSONAL_DEVICE_KEYS (src/lib/signOutState.ts), and it must not be:
//      those months are a RECORD, and clearing a record at sign-out destroys
//      it for the person who is leaving. The other answer is the one this
//      file takes — put the account in the key.
//   3. Coach B signs in on the same handset. The provider reads the bare key
//      and gets A's months.
//   4. `missingOnServer` is by construction "months the server has never heard
//      of", and B's row has never heard of A's months. So every one of them is
//      offered for upload.
//   5. `saveMetricHistory` resolves the uid FRESH, at save time, and it is now
//      B's. A's revenue figures are upserted under B's `user_id`, permanently,
//      into the record B's own console reads back.
//
// There is no later read that can tell those rows from B's own. Nothing
// recomputes March from source — March is a number a phone wrote down in March
// — so this is not a stale cache, it is one coach's takings attributed to
// another with no way back.

/**
 * Between a metric key and the account that recorded it.
 *
 * A colon, and not the dot the metric keys themselves use, so that the account
 * half of a device key is unmistakable by eye in a storage dump and cannot be
 * read as another level of the metric's own name. The same shape
 * `outbox:v1:<uid>` and `repple.mealSwaps:<uid>` already use.
 */
export const DEVICE_SCOPE_SEP = ':';

/**
 * Where THIS ACCOUNT's copy of a metric's months lives on THIS handset.
 *
 * `metricKey` goes to the server unchanged — the return value of this function
 * must never be sent as `metric_key`, or a coach's history is split across one
 * row per handset they have ever used and `missingOnServer` offers the lot to
 * every one of them.
 *
 * Null when there is no account to scope to, and a null means DO NOT PERSIST.
 * The months are still on screen for the session; they are simply not kept,
 * which is the honest outcome for a figure nobody is signed in to own. Falling
 * back to the bare key is the defect itself.
 *
 * @param metricKey the server's `metric_key`, e.g. 'repple.owner.mrrHistory.GBP'.
 * @param uid the signed-in account id, or null while nobody is.
 */
export function deviceHistoryKey(metricKey: string, uid: string | null | undefined): string | null {
  if (!metricKey) return null;
  const id = typeof uid === 'string' ? uid.trim() : '';
  // 'unknown' is the literal src/ui/clientData.tsx settles on before the auth
  // read lands. It is not an account and must never be used as one: every
  // signed-out session on a handset would share it, which is the bare key
  // again under a longer name.
  if (!id || id === 'unknown') return null;
  // A separator inside the id would make two different (metric, account) pairs
  // able to spell one key. No Supabase uuid contains one; an id that does is
  // not one we are willing to guess about.
  if (id.includes(DEVICE_SCOPE_SEP)) return null;
  return `${metricKey}${DEVICE_SCOPE_SEP}${id}`;
}

/**
 * Whether a stored key carries an account.
 *
 * For the assertion, not for a caller: what has to be checkable is that the
 * string handed to the device store and the string handed to the server are
 * never the same string.
 */
export const isDeviceHistoryKey = (k: string): boolean =>
  typeof k === 'string' && k.includes(DEVICE_SCOPE_SEP);

/** What one pass of the provider was handed. */
export interface HistoryPassInput {
  /**
   * The device store's answer for this account's key, already sanitised — or
   * NULL when the read failed or there was no key to read.
   *
   * Null is not `{}`, and the difference is the whole of `writeCache` below. A
   * store we could not read is a store whose contents we do not know, and
   * writing our idea of the history over bytes we never saw is how a member
   * loses months that were on the phone the entire time.
   */
  cached: Snapshots | null;
  /** The account's own months, and whether they could be read at all. */
  server: { snapshots: Snapshots; status: LoadStatus };
  /** This month's figure, or null when it is not known. Null is not zero. */
  currentValue: number | null;
  /** The month `currentValue` belongs to, 'YYYY-MM' in LOCAL time. */
  thisMonth: string;
}

/** What the pass decided. */
export interface HistoryPass {
  /** The months to show, and the months to write back to the device. */
  merged: Snapshots;
  /** Whether `merged` may be written to the device store at all. */
  writeCache: boolean;
  /** The months that may be sent to the server. Empty means send nothing. */
  upload: Snapshots;
}

/**
 * One pass: what to show, what to keep, and what may be published.
 *
 * Three guards, unchanged in substance from the hook they were lifted out of,
 * and none of them optional:
 *
 *  1. A FAILED DEVICE READ WRITES NOTHING BACK. `cached: null` leaves
 *     `writeCache` false. This is the arming flag the sibling fix in
 *     src/ui/exerciseVideos.ts calls `hydrated`, and the trap it names is
 *     exactly the one here: a flag left standing from the PREVIOUS account's
 *     read lets a switch whose own read then fails publish an empty history
 *     over the new account's stored months.
 *  2. A FAILED SERVER READ PUBLISHES NOTHING. Under any status but 'ready' the
 *     account's months are unknown, the merge is skipped so the cache stands
 *     alone, and `upload` is empty. A read that failed is not permission to
 *     assume the server is empty.
 *  3. THE SERVER IS NEVER PRUNED. Only this month and the months the server has
 *     never heard of are offered. A handset that has been in a drawer does not
 *     get to publish its stale figure over the account's record.
 *
 * Pure, and that is the point: the sequence that broke this — sign in, sign
 * out, sign in as somebody else — is a sequence of calls to this function with
 * a different key, and it runs in the test rather than on a gym's handset.
 */
export function historyPass(input: HistoryPassInput): HistoryPass {
  const cacheRead = input.cached != null;
  const local: Snapshots = input.cached ?? {};
  const ready = input.server.status === 'ready';
  const merged: Snapshots = ready ? mergeSnapshots(local, input.server.snapshots) : { ...local };

  // A month key the server's own CHECK constraint would refuse is not recorded
  // here either, so a clock far enough out to produce one cannot put a figure
  // somewhere nothing will ever look for it again.
  const recordable = input.currentValue != null
    && Number.isFinite(input.currentValue)
    && isMonthKey(input.thisMonth);
  if (recordable) merged[input.thisMonth] = input.currentValue as number;

  const upload: Snapshots = {};
  if (ready) {
    Object.assign(upload, missingOnServer(local, input.server.snapshots));
    if (recordable) upload[input.thisMonth] = input.currentValue as number;
  }
  return { merged, writeCache: cacheRead, upload };
}

/**
 * Everything the provider is holding, and whose it is.
 *
 * `key` is the first field because it is the one that makes the rest readable:
 * every other field is an answer ABOUT that key, and the moment the key changes
 * all of them are somebody else's. A provider mounted at the root outlives a
 * sign-out — nothing unmounts it — so "somebody else's" is the ordinary case
 * on a shared handset, not an edge one.
 */
export interface HistorySession {
  /** The DEVICE key the fields below were read under. Null means no account. */
  key: string | null;
  /** The months on screen. */
  hist: Snapshots;
  /** True once a read of THIS key has come back.
   *
   *  It arms the device write, and it also stands in FOR the shelf: armed, the
   *  months in `hist` are what the shelf holds, because the pass that armed it
   *  wrote them there. So a flag that outlived a key change would not merely
   *  permit a write — it would supply the previous account's months as the
   *  contents of the new account's shelf. See `beginHistoryPass`. */
  hydrated: boolean;
  /** Whether `hist` can be trusted. */
  status: LoadStatus;
  /** The account's months as last read under this key, or null for unknown.
   *  Cached so a change to `currentValue` — which happens on every screen, as
   *  the reads it is derived from land — does not re-query the whole history. */
  server: Snapshots | null;
  /** The upload last confirmed written, so an unchanged figure arriving again
   *  does not re-upsert the same row on every render. */
  sent: string;
}

/** Nobody signed in, nothing read. The state a provider mounts in. */
export const NO_HISTORY_SESSION: HistorySession = {
  key: null, hist: {}, hydrated: false, status: 'loading', server: null, sent: '',
};

/**
 * The state to hold while the read for `key` is outstanding.
 *
 * **Every field goes when the key changes, and that is the function.** Lane
 * 101 found a store correctly keyed and the React state still holding the
 * departing member's data, because the SIGNED_OUT branch cleared four other
 * things and not this one and the read effect had `[]` deps so it never ran
 * again. Four separate fields here each reproduce that on their own:
 *
 *   · `hist` — the previous coach's months, left on screen under the next
 *     coach's name until a read that may never succeed replaces them.
 *   · `hydrated` — the trap above. A flag that survives the key change arms a
 *     write of this session's idea of the history over the NEW account's
 *     stored bytes, which is the one way to LOSE months rather than merely
 *     show the wrong ones.
 *   · `server` — the previous account's row, cached. Kept across the change it
 *     makes `missingOnServer` compute against somebody else's record, which is
 *     the upload defect wearing a different hat.
 *   · `sent` — the previous account's confirmed upload. Kept across the change
 *     it suppresses the new account's identical first upload as already done,
 *     and the month goes missing quietly.
 *
 * An unchanged key returns the SAME object, so a pass triggered by a new
 * `currentValue` does not blank a chart it is only refreshing.
 */
export function beginHistoryPass(prev: HistorySession, key: string | null): HistorySession {
  if (prev.key === key) return prev;
  return { key, hist: {}, hydrated: false, status: 'loading', server: null, sent: '' };
}

/**
 * Fold a finished pass into the session — unless the account changed under it.
 *
 * An async read started for coach A can land after coach B has signed in. The
 * key it was started FOR is passed back in, and a mismatch discards the result
 * rather than painting it: the alternative is A's months arriving on B's
 * screen through the one door the key change was supposed to close.
 */
export function applyHistoryPass(
  prev: HistorySession,
  key: string | null,
  pass: HistoryPass,
  server: Snapshots | null,
  status: LoadStatus,
  sent: string,
): HistorySession {
  if (prev.key !== key) return prev;
  return { key, hist: pass.merged, hydrated: pass.writeCache, status, server, sent };
}
