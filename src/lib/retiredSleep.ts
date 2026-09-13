// The nights a disconnected device measured, kept rather than destroyed.
//
// ── what was wrong ────────────────────────────────────────────────────────
//
// Disconnecting a watch deleted every night it had ever measured. `disconnect()`
// in src/ui/wearables.tsx runs a `delete` against `device_sleep_nights` scoped
// to the provider, and app/(client)/devices.tsx warned about it honestly —
// "reconnecting the watch does not bring the nights back" — which is the
// admission that a tap on a Devices row destroys a member's sleep history for
// good.
//
// supabase/parts/154 exists precisely because "the biggest number on the home
// screen changes for reasons the member cannot see". Deleting the nights on
// unlink reintroduces that, on the one path the member takes deliberately and
// without understanding what it costs — and unlike every other cause part 154
// was written about (a failed read, an expired token, a second handset), this
// one is not recoverable by anything.
//
// ── what this does instead ────────────────────────────────────────────────
//
// The nights are COPIED to `retired_device_sleep_nights` before the disconnect
// runs, and copied back when the device is reconnected. The delete in
// `disconnect()` is untouched and keeps doing its job: the live table still
// empties for that provider, so nothing keeps feeding readiness from a device
// the member believes they have unplugged. What changes is that the record
// survives the unplugging. supabase/parts/2650 sets out the separation in full.
//
// ── the order, which is the whole safety argument ─────────────────────────
//
// COPY FIRST, DISCONNECT SECOND, and never the other way round.
//
// The copy is non-destructive: until `disconnect()` runs, the live rows are
// still there and the shelf is a duplicate. So a copy that fails costs nothing
// and the caller can refuse to go on — which is what app/(client)/devices.tsx
// does, because disconnecting over a failed copy is the original defect with an
// extra step. A copy that succeeds and a disconnect that then fails leaves a
// shelf nobody asked for; `discardKept` clears it, and if THAT fails the worst
// case is a stale shelf that the next restore refuses to put over a live night
// anyway.
//
// Doing it the other way — disconnect, then try to save what is left — has no
// safe failure at all: by the time the copy runs there is nothing to copy.
//
// ── the rule a restore must keep ──────────────────────────────────────────
//
// A restored night NEVER replaces a live one. A night the live table holds was
// measured by some device more recently than this shelf was written, and
// putting a month-old shelved figure over it would be the disappearance this
// whole file is about, pointed the other way. `nightsToRestore` is that rule,
// it is pure, and it is asserted in retiredSleep.test.ts.
//
// Framework-agnostic in the shape src/lib/attendance.ts and
// src/lib/memberRecord.ts use: the Supabase client arrives as an argument, so
// every branch below can be exercised without a database.
import { writeFailure } from './wroteRows';

/** The bit of supabase-js this module needs. Narrow on purpose — the real
 *  client's type would drag the whole generated schema into a test. */
type Queryable = { from: (table: string) => any };

export const LIVE_TABLE = 'device_sleep_nights';
export const SHELF_TABLE = 'retired_device_sleep_nights';

/** The columns a night carries in both tables. `recorded_at` travels with the
 *  row rather than being re-stamped on the shelf: it says how old the
 *  MEASUREMENT is, which a member reads, and re-stamping it would age every
 *  restored night to the day they changed their mind. */
const NIGHT_COLUMNS = 'night, minutes_asleep, provider, source_id, source_name, family, basis, recorded_at';

/**
 * One night as both tables store it, with the owner column left off.
 *
 * `user_id` is supplied by the writer from the session rather than carried
 * through a shape, so a row read for one account cannot be written under
 * another by a caller that forgot to check.
 */
export interface KeptNight {
  /** Local calendar date, YYYY-MM-DD. */
  night: string;
  minutesAsleep: number;
  provider: string;
  sourceId: string;
  sourceName: string;
  family: string;
  basis: string;
  /** When Repple first stored it, ISO. */
  recordedAt: string;
}

/** A row either landed or it did not. Same shape as `Read` in
 *  src/lib/attendance.ts, and for the same reason: `{ ok: false }` must not be
 *  reachable as an empty list. */
export type Kept =
  | { ok: true; nights: number }
  | { ok: false; reason: string };

/**
 * A database row as a `KeptNight`, or null if it cannot be one.
 *
 * Pure, and deliberately strict: a row missing any of the three source fields
 * or carrying a duration the live table would refuse is DROPPED rather than
 * patched. The shelf exists to be restored into `device_sleep_nights`, whose
 * checks are `minutes_asleep > 0 and <= 1440` and `basis in ('asleep',
 * 'in-bed')` — a row that cannot pass those is a row that would fail on the way
 * back, and discovering that at restore time means discovering it after the
 * live copy has already been deleted.
 *
 * The same argument src/lib/deviceSleepStore.ts makes about `rowToStored`: an
 * unattributed figure is not shown, and here it is not kept either.
 */
export function rowToKept(row: unknown): KeptNight | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const night = typeof r.night === 'string' ? r.night.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const mins = Number(r.minutes_asleep);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const provider = str(r.provider);
  const sourceId = str(r.source_id);
  const sourceName = str(r.source_name);
  const family = str(r.family);
  if (!provider || !sourceId || !sourceName || !family) return null;
  // Anything that is not 'in-bed' is read as 'asleep' everywhere else in the
  // app (src/lib/deviceSleepStore.ts), and the column's check constraint is
  // what makes that safe. Normalised here so a row can never carry a third
  // value onto the shelf and fail the constraint on the way back.
  const basis = str(r.basis) === 'in-bed' ? 'in-bed' : 'asleep';
  const recordedAt = str(r.recorded_at);
  if (!recordedAt) return null;
  return { night, minutesAsleep: Math.round(mins), provider, sourceId, sourceName, family, basis, recordedAt };
}

/** A `KeptNight` as a row for either table, under a named owner. */
export function keptToRow(uid: string, n: KeptNight): Record<string, unknown> {
  return {
    user_id: uid,
    night: n.night,
    minutes_asleep: n.minutesAsleep,
    provider: n.provider,
    source_id: n.sourceId,
    source_name: n.sourceName,
    family: n.family,
    basis: n.basis,
    recorded_at: n.recordedAt,
  };
}

/**
 * Which shelved nights may be put back.
 *
 * `liveNights` is every night the live table already holds for this member,
 * from ANY provider — not just the one being reconnected. `device_sleep_nights`
 * is keyed (user_id, night), so one night has one row whoever measured it, and
 * a member who disconnected a WHOOP in March and has been wearing an Apple
 * Watch since has live nights for most of the range the shelf covers. Those
 * belong to the watch they are actually wearing.
 *
 * So a shelved night whose date is already live is SKIPPED. Not merged, not
 * preferred by duration, not decided by which device we think is better: the
 * live row is the more recent answer to the same question and there is nobody
 * left to ask about the older one. src/lib/sleepMerge.ts owns the question of
 * which of two simultaneous readings to believe, and this is deliberately not a
 * second copy of it — these two readings are not simultaneous.
 *
 * Duplicates within the shelf itself are impossible — (user_id, provider,
 * night) is its primary key — but a duplicated `night` is filtered anyway, so
 * that a malformed read cannot produce an upsert with two rows for one key,
 * which PostgREST rejects outright and which would fail the whole restore
 * rather than one row of it.
 */
export function nightsToRestore(shelved: readonly KeptNight[], liveNights: readonly string[]): KeptNight[] {
  const taken = new Set(liveNights);
  const out: KeptNight[] = [];
  for (const n of shelved) {
    if (taken.has(n.night)) continue;
    taken.add(n.night);
    out.push(n);
  }
  return out;
}

/**
 * Copy this provider's measured nights onto the shelf, before it is unlinked.
 *
 * Returns how many nights are now safe. ZERO IS A SUCCESS and is the ordinary
 * case for somebody who connected a watch this morning — part 154's own note on
 * the delete makes the same point about the same condition. It is not a
 * silence: the select's `error` is checked, so "no rows" here is an answer and
 * not a failure wearing one.
 *
 * `{ count: 'exact' }` on the upsert, and the count is what is believed. An
 * insert refused by RLS is a 201 with `error: null` and no rows touched —
 * src/lib/wroteRows.ts is the whole write-up — and a caller that read only
 * `error` would report a member's history safe and then delete it.
 */
export async function keepNightsBeforeDisconnect(sb: Queryable, uid: string, provider: string): Promise<Kept> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  if (!provider) return { ok: false, reason: 'No device named.' };
  try {
    const { data, error } = await sb.from(LIVE_TABLE)
      .select(NIGHT_COLUMNS)
      .eq('user_id', uid)
      .eq('provider', provider);
    if (error) return { ok: false, reason: (error as any)?.message || 'The nights could not be read.' };

    const nights = ((data as unknown[]) ?? []).map(rowToKept).filter((n): n is KeptNight => n != null);
    if (!nights.length) return { ok: true, nights: 0 };

    const res = await sb.from(SHELF_TABLE)
      .upsert(nights.map((n) => keptToRow(uid, n)), { onConflict: 'user_id,provider,night', count: 'exact' });
    const why = writeFailure('The nights this device measured', res);
    if (why) return { ok: false, reason: why };
    // The count, not `nights.length`. They agree in every ordinary case; where
    // they do not, the server's figure is the one that is true, and reporting
    // ours would be reporting an intention as an outcome.
    return { ok: true, nights: Number((res as any).count) };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'The nights could not be kept.' };
  }
}

/**
 * Throw away a shelf we made and no longer need.
 *
 * Called when the disconnect that the copy was made for did not happen. Not
 * load bearing — a shelf left behind is refused by `nightsToRestore` on every
 * night the live table still holds, which after a failed disconnect is all of
 * them — so its failure is reported and never surfaced. It exists so that the
 * ordinary case leaves nothing lying around.
 */
export async function discardKept(sb: Queryable, uid: string, provider: string): Promise<Kept> {
  if (!uid || !provider) return { ok: false, reason: 'Nothing named to discard.' };
  try {
    const res = await sb.from(SHELF_TABLE).delete({ count: 'exact' })
      .eq('user_id', uid).eq('provider', provider);
    if ((res as any).error) return { ok: false, reason: 'The kept nights could not be cleared.' };
    return { ok: true, nights: Number((res as any).count ?? 0) };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'The kept nights could not be cleared.' };
  }
}

/**
 * Put a reconnected device's nights back.
 *
 * Three steps and each one can refuse: read the shelf, read which nights are
 * already live, write back only the ones that are not. The shelf is cleared for
 * that provider only after the write is confirmed — including the nights that
 * were SKIPPED, because a night the live table now holds has been answered by a
 * newer measurement and keeping the older one shelved only means offering it
 * again at the next reconnect.
 *
 * Returns the number of nights actually restored, which is what the member is
 * told. It is routinely smaller than the shelf and that is correct, not a
 * shortfall: see `nightsToRestore`.
 */
export async function restoreRetiredNights(sb: Queryable, uid: string, provider: string): Promise<Kept> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  if (!provider) return { ok: false, reason: 'No device named.' };
  try {
    const shelfRes = await sb.from(SHELF_TABLE)
      .select(NIGHT_COLUMNS)
      .eq('user_id', uid)
      .eq('provider', provider);
    if (shelfRes.error) return { ok: false, reason: (shelfRes.error as any)?.message || 'The kept nights could not be read.' };
    const shelved = ((shelfRes.data as unknown[]) ?? []).map(rowToKept).filter((n): n is KeptNight => n != null);
    // Nothing shelved is the ordinary answer for a first connection. It is a
    // true answer because the read above was checked, not because the list
    // came back empty.
    if (!shelved.length) return { ok: true, nights: 0 };

    // Every night the live table holds, from any provider — the reason is on
    // `nightsToRestore`. Scoped to the nights we are actually asking about, so
    // this does not grow with the member's whole history.
    const liveRes = await sb.from(LIVE_TABLE)
      .select('night')
      .eq('user_id', uid)
      .in('night', shelved.map((n) => n.night));
    if (liveRes.error) {
      // Refused rather than assumed empty. Treating a failed read as "no live
      // nights" would restore over the top of measurements we simply could not
      // see, which is the one thing a restore may never do.
      return { ok: false, reason: (liveRes.error as any)?.message || 'We could not check which nights are already there.' };
    }
    const live = ((liveRes.data as any[]) ?? [])
      .map((r) => (typeof r?.night === 'string' ? r.night : ''))
      .filter(Boolean);

    const put = nightsToRestore(shelved, live);
    if (put.length) {
      const res = await sb.from(LIVE_TABLE).upsert(
        put.map((n) => keptToRow(uid, n)),
        // `ignoreDuplicates` as well as the filter above, and not instead of
        // it. The filter is the rule and is testable; this is the race — a
        // device syncing while the reconnect runs can write the same night
        // between the two reads — and without it that night would be
        // overwritten by the shelved figure.
        { onConflict: 'user_id,night', ignoreDuplicates: true, count: 'exact' },
      );
      const why = writeFailure('Your kept nights', res);
      if (why) return { ok: false, reason: why };
    }

    // Cleared only now. A shelf dropped before the write is confirmed is the
    // same permanent loss this file exists to prevent, one step further along.
    const cleared = await discardKept(sb, uid, provider);
    if (!cleared.ok) {
      // The nights are BACK. Failing the whole call here would tell the member
      // their history was not restored when it was; the leftover shelf is
      // harmless because every night on it is now live and `nightsToRestore`
      // skips them.
      return { ok: true, nights: put.length };
    }
    return { ok: true, nights: put.length };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'The kept nights could not be restored.' };
  }
}

/* ── what the member is told ──────────────────────────────────────────────── */
//
// The three sentences live here rather than in app/(client)/devices.tsx for the
// reason the screen's own comment gives about the alert it replaces: it is
// "deliberately specific about the two different things that happen", and a
// sentence that specific has to change in step with what actually happens. The
// old one did not — it promised a destruction the code no longer performs.

/**
 * The confirmation, before the device is unlinked.
 *
 * What it replaces said the nights "are removed from your record here" and that
 * "reconnecting starts a fresh record rather than bringing these nights back".
 * Both were true of the old behaviour. An alert that still said either would be
 * its own defect: it is the sentence that talks somebody out of unplugging a
 * watch they have every right to unplug, and it would be false.
 *
 * No count in it. The count is not known until the copy runs, and reading the
 * shelf to fill in a number before the question is asked would put a network
 * round trip — and a way for the question to fail to appear at all — in front
 * of a confirmation dialog.
 */
export function disconnectNightsLine(brandLabel: string, deviceName: string): string {
  return `${brandLabel} will stop reading from ${deviceName}, and the nights it has already measured come out of your sleep week while it is disconnected. They are not deleted: reconnect ${deviceName} and they go back. Nothing is deleted in the ${deviceName} app itself.`;
}

/**
 * The refusal, when the nights could not be put somewhere safe.
 *
 * Said instead of disconnecting, never alongside it. The copy is the only thing
 * standing between a tap and a permanently destroyed history, so a copy that
 * did not happen means the disconnect does not happen either — and the member
 * is told which of the two it was, because "try again in a moment" is only
 * honest advice if the thing that failed was the transient one.
 */
export function keepFailedLine(deviceName: string): string {
  return `${deviceName} is still connected. We could not put the nights it measured somewhere safe first, and disconnecting without doing that would destroy them, so nothing was changed. Try again in a moment.`;
}

/**
 * What was put back, after a reconnect.
 *
 * Only said when something actually was. `nights` is the server's count of rows
 * restored, which is routinely smaller than the shelf — a night measured by
 * another device in the meantime is not overwritten (see `nightsToRestore`) —
 * and a member who reconnects a watch they only wore for a day gets no sentence
 * at all rather than "0 nights restored", which reads as a loss where there is
 * nothing to lose.
 */
export function restoredNightsLine(nights: number, deviceName: string): string | null {
  if (!Number.isFinite(nights) || nights <= 0) return null;
  const n = Math.round(nights);
  return n === 1
    ? `The night ${deviceName} measured before you disconnected it is back in your sleep week.`
    : `The ${n} nights ${deviceName} measured before you disconnected it are back in your sleep week.`;
}
