// The gym's own timezone — and the difference between a gym that has one and a
// screen that has quietly substituted the reader's.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// `tenants.timezone` exists as of supabase/parts/710. Before it, six screens in
// the web console printed the phrase "in the gym's own timezone" over figures
// bucketed by `new Date()` on whichever machine the page was open on. A gym in
// Dubai read on a laptop in London has four hours of every day filed under the
// wrong date; the same gym read on the front desk's own machine does not. Two
// readers, one database, two different Tuesdays, and nothing on either screen
// saying which one it was showing.
//
// This module is the read side, and it is the ONLY place in TypeScript where a
// zone is turned into a day. One implementation, because two implementations of
// a calendar rule is how a Sunday's takings end up in two places.
//
// ── The rule everything here obeys ────────────────────────────────────────
//
// NO ZONE MEANS NO ANSWER. Every function that needs a zone takes it as an
// argument, and every one of them returns null when it is missing. Nothing here
// falls back to UTC and nothing falls back to the reader — those are the two
// wrong answers part 710's header sets out, and a fallback buried in a helper
// is worse than either because no screen above it can say it happened.
//
// The caller's job is therefore to have a sentence ready for the null. That is
// the point: `NO_ZONE_NOTE` is that sentence, written once, and a screen that
// prints it is telling the truth about whose day it is drawing.
//
// ── Why the arithmetic is duplicated at all ───────────────────────────────
//
// Part 710 does day arithmetic in Postgres and says why: `at time zone` asks
// the server's own zone database, and a JavaScript hour is the hour where the
// JavaScript is. That remains the authority — `tenant_clock`, `tenant_day` and
// `tenant_day_bounds` are what a query should filter on.
//
// This module is not a second authority, it is a renderer. A console that has
// already fetched a list of instants and wants to write "06:00" beside one
// cannot go back to the database per row, and `Intl.DateTimeFormat` with an
// explicit `timeZone` reads the browser's own IANA database, which is the same
// data. Where the two could disagree — a bound in a query — the query wins, and
// `gymDayBounds` below says so at its own doc comment.
//
// Framework-agnostic like the rest of src/lib. The Supabase client arrives as
// an argument, so the console and the phone can both use this and neither owns
// it.

type Queryable = { from: (table: string) => any };

/**
 * The sentence a screen prints where a gym's day would go, when the gym has not
 * said what its day is.
 *
 * One wording in one place, for the reason `NO_PAY_POLICY_NOTE` in
 * src/lib/gymPolicy.ts gives: six screens wording the same silence six ways is
 * how they came to disagree about what the silence meant.
 */
export const NO_ZONE_NOTE =
  'this gym has not set its timezone, so days and hours here are your own device’s, not the gym’s';

/**
 * What the owner typed → what to write to `tenants.timezone`.
 *
 * The same three-way shape `parseTenantCurrency` and `parseBrandColor` use, and
 * for the same reason: blank CLEARS, because an owner emptying the field is
 * saying they no longer know, and the column is nullable precisely so that can
 * be said.
 *
 * The check is a real one, not a regex on slashes. `Intl.DateTimeFormat` throws
 * `RangeError` on a zone the browser's IANA database does not hold, which is
 * the browser-side equivalent of part 710's `pg_timezone_names` lookup. Doing
 * it in both places is deliberate and is part 166's arrangement: the caller is
 * told before the round trip, and the stored value is right whoever wrote it.
 * The database is still the guarantee — a browser shipped with a stale zone
 * table would refuse a zone Postgres knows, which is an annoyance, where the
 * reverse would be a stored value that makes a query raise.
 */
export type ZoneInput =
  | { kind: 'clear' }
  | { kind: 'zone'; zone: string }
  | { kind: 'bad'; reason: string };

export function parseGymZone(input: string | null | undefined): ZoneInput {
  const raw = String(input ?? '').trim();
  if (!raw) return { kind: 'clear' };
  if (!isZone(raw)) {
    return {
      kind: 'bad',
      reason:
        'A timezone is an IANA name — Europe/London, Asia/Dubai, America/Los_Angeles. ' +
        'Not an abbreviation such as GMT or PST, which are ambiguous, and not an offset such as +04:00, which stops being right when the clocks move.',
    };
  }
  return { kind: 'zone', zone: raw };
}

/** Whether this runtime's zone database holds `zone`. False for null, for an
 *  abbreviation and for an offset — see `parseGymZone` for why those are not
 *  near-misses but different kinds of answer. */
export function isZone(zone: string | null | undefined): boolean {
  const z = String(zone ?? '').trim();
  if (!z) return false;
  // Refused before `Intl` is asked, because `Intl` ACCEPTS it. ES2024 added
  // offset time zone identifiers, so `new Intl.DateTimeFormat(undefined,
  // { timeZone: '+04:00' })` constructs happily on a current runtime — and a
  // gym stored as '+04:00' is a gym that is correct until the clocks move and
  // then silently an hour out for five months, which is the exact failure part
  // 710 refuses. An offset is not a place.
  if (/^[+\-]/.test(z)) return false;
  try {
    // The constructor is what validates; the formatter is discarded.
    new Intl.DateTimeFormat(undefined, { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone of the machine this is running on.
 *
 * Exported, and named for what it is. `deviceZone` in src/lib/quietHours.ts is
 * the same computation put to a completely different use — there it is the zone
 * to STORE, because a coach's quiet hours are a fact about where their phone
 * was when they set them. Here it is never a value to store: the reader's zone
 * is a fact about a laptop, and writing it to `tenants` would make a bookkeeper
 * in Lisbon a permanent claim about where the gym is.
 *
 * It has exactly one honest use, and it is the reason it is here: naming the
 * zone a screen is ACTUALLY drawing in, when the gym has not given one. "Days
 * here are your own device's" is better than nothing; "days here are
 * Europe/Lisbon's" is better still, and it is what makes two colleagues
 * comparing two screens work out why they disagree.
 */
export function readerZone(): string | null {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof z === 'string' && isZone(z) ? z : null;
  } catch {
    return null;
  }
}

/**
 * The calendar day an instant falls on AT THE GYM, as `YYYY-MM-DD`.
 *
 * Null for a missing zone, an unreadable instant, or a zone this runtime does
 * not know — three different nothings that a caller treats the same way and a
 * caller must not treat as a date.
 *
 * `calendar: 'gregory'` and `numberingSystem: 'latn'` are pinned rather than
 * left to the locale. No locale literal is passed — scripts/check-locale.mjs
 * forbids one in src/lib and is right to, because this is a white-label product
 * with gyms in three continents — but the device's own locale can carry a
 * non-Gregorian calendar or non-Latin digits, and either would produce a string
 * that is not a date and would be compared against ones that are.
 */
export function gymDay(at: string | number | Date | null | undefined, zone: string | null | undefined): string | null {
  if (at == null || !zone || !isZone(zone)) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const y = get('year'), m = get('month'), day = get('day');
    if (!y || !m || !day) return null;
    // Padded by hand rather than trusted from the formatter: `2-digit` is a
    // request and an era-carrying locale can still hand back a four-character
    // year with a marker on it.
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/** The hour of the day, 0–23, an instant falls in at the gym. Null for the same
 *  three nothings `gymDay` returns null for. This is the figure the door-entry
 *  histogram is built on, and it is the one `getHours()` gets wrong by however
 *  far the reader is from the gym. */
export function gymHour(at: string | number | Date | null | undefined, zone: string | null | undefined): number | null {
  if (at == null || !zone || !isZone(zone)) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const v = new Intl.DateTimeFormat(undefined, {
      timeZone: zone, numberingSystem: 'latn', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).find((p) => p.type === 'hour')?.value;
    const h = Number(v);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
  } catch {
    return null;
  }
}

/** Whether two instants land on the same day AT THE GYM. Null zone → false,
 *  never true: "we cannot tell" must not be answered "yes, the same day", which
 *  is the answer that merges two days of takings into one. */
export function sameGymDay(
  a: string | number | Date | null | undefined,
  b: string | number | Date | null | undefined,
  zone: string | null | undefined,
): boolean {
  const da = gymDay(a, zone);
  return da != null && da === gymDay(b, zone);
}

/**
 * The wall clock at the gym, as `HH:MM`.
 *
 * The proof, rather than the mechanism. An owner cannot check whether
 * 'Asia/Dubai' is the right string, and can check whether the clock beside it
 * says what the clock on their wall says — which is the only test of this
 * setting that a person can actually perform.
 */
export function gymTimeLabel(at: string | number | Date | null | undefined, zone: string | null | undefined): string | null {
  const h = gymHour(at, zone);
  if (h == null) return null;
  const d = at instanceof Date ? at : new Date(at as string | number);
  try {
    const m = new Intl.DateTimeFormat(undefined, {
      timeZone: zone as string, numberingSystem: 'latn', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).find((p) => p.type === 'minute')?.value ?? '';
    return `${String(h).padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/**
 * How far the gym's clock is from the reader's, in whole minutes, at `at`.
 *
 * Positive means the gym is ahead. Null when either zone is missing, and 0 is a
 * real answer that means the two agree — which is why this returns a number and
 * not a boolean, and why `zoneGapNote` below is a separate function: a screen
 * that only asked "do they differ" would print nothing for the London reader of
 * a Dublin gym and the same nothing for the one who could not find out.
 *
 * Computed by formatting one instant in both zones and differencing, because
 * that is the only method that survives the two Sundays a year when one zone
 * has moved and the other has not — the case a stored offset is written for and
 * gets wrong.
 */
export function gymMinutesAhead(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  reader: string | null | undefined = readerZone(),
): number | null {
  if (!zone || !reader) return null;
  const d = at == null ? new Date() : at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const asUtc = (z: string): number | null => {
    const day = gymDay(d, z);
    const time = gymTimeLabel(d, z);
    if (!day || !time) return null;
    // Read back as UTC so the two readings are compared as numbers rather than
    // re-entering a local-time parse, which would apply the reader's offset to
    // both and cancel the thing being measured.
    const t = Date.parse(`${day}T${time}:00Z`);
    return Number.isNaN(t) ? null : t;
  };
  const a = asUtc(zone), b = asUtc(reader);
  if (a == null || b == null) return null;
  return Math.round((a - b) / 60_000);
}

/**
 * The sentence a screen puts under a set of dates when the gym's clock and the
 * reader's are not the same clock.
 *
 * Null when they agree, when either is unknown, and when there is nothing to
 * say — a note that appears on every screen for every reader is a note nobody
 * reads. It appears for the bookkeeper in Lisbon looking at a Dubai gym, which
 * is the reader it was written for.
 */
export function zoneGapNote(zone: string | null | undefined, reader: string | null | undefined = readerZone()): string | null {
  if (!zone || !reader || zone === reader) return null;
  const mins = gymMinutesAhead(null, zone, reader);
  if (mins == null || mins === 0) return null;
  const ahead = mins > 0;
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = h && m ? `${h}h ${m}m` : h ? `${h} hour${h === 1 ? '' : 's'}` : `${m} minutes`;
  return `Dates and times here are ${zone}, the gym’s own. You are in ${reader}, which is ${span} ${ahead ? 'behind' : 'ahead of'} it.`;
}

/**
 * The instants a gym's calendar day spans, as a half-open `[fromISO, toISO)`.
 *
 * ── Read this before filtering a query with it ───────────────────────────
 *
 * `tenant_day_bounds` in supabase/parts/710 is the authority and should be
 * preferred wherever the bound is going into SQL: it asks Postgres's own zone
 * database in the same statement that uses the answer, and it cannot be stale.
 * This exists for the console's own filtering of rows it has already fetched,
 * and for building the range a screen is about to ask for.
 *
 * Null for a missing or unknown zone, and null for a day that is not a date.
 * A caller that skips the check gets nothing rather than a UTC day labelled as
 * the gym's — the direction of failure somebody notices.
 *
 * The end is computed from the NEXT day's midnight rather than by adding 24
 * hours, so the 23- and 25-hour days the clocks produce are the right length.
 * That is the single case this whole file exists for.
 */
export function gymDayBounds(day: string | null | undefined, zone: string | null | undefined): { fromISO: string; toISO: string } | null {
  const d = String(day ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !zone || !isZone(zone)) return null;
  const from = wallToMs(`${d}T00:00`, zone);
  const next = addDays(d, 1);
  const to = next == null ? null : wallToMs(`${next}T00:00`, zone);
  if (from == null || to == null || to <= from) return null;
  return { fromISO: new Date(from).toISOString(), toISO: new Date(to).toISOString() };
}

/* ── the write side ────────────────────────────────────────────────────────
 *
 * Everything above turns an instant into what the gym's clock said. These two
 * go the other way, and they are why the read side alone is a half-fix.
 *
 * A `<input type="datetime-local">` holds a WALL CLOCK — "2026-09-01T06:00",
 * no zone, and the browser fills it in and reads it back as its own. So a
 * console showing a Dubai gym's 06:00 shift to a reader in London shows 03:00,
 * and saving that form back writes 03:00 Dubai. The correction is not cosmetic:
 * it moves somebody's shift by three hours, and the coach it moves is the one
 * who does not open the console.
 */

/**
 * A wall clock at the gym → the instant it names, as an ISO string.
 *
 * `wall` is `YYYY-MM-DDTHH:MM` (optionally with seconds), which is exactly what
 * a `datetime-local` input produces. Null for a missing or unknown zone and for
 * anything that is not that shape — a caller must not fall back to
 * `new Date(wall)`, which is the browser's own zone and is the bug.
 *
 * The hour that does not exist. On the morning the clocks go forward, 01:30
 * never happens in London; the two-pass solve below settles on 02:30, the same
 * instant the browser's own parser would pick, and that is the least surprising
 * available answer for a form that should not have offered the hour.
 */
export function instantAtGym(wall: string | null | undefined, zone: string | null | undefined): string | null {
  const ms = wallToMs(wall, zone);
  return ms == null ? null : new Date(ms).toISOString();
}

/**
 * An instant → the wall clock at the gym, as `YYYY-MM-DDTHH:MM`.
 *
 * The value to put INTO a `datetime-local`, so the field shows the hour the
 * shift actually runs at rather than the hour it would be if it ran where the
 * reader is sitting. Null with no zone, and the caller then falls back to the
 * browser's own wall clock and says so — which is what it was doing anyway.
 */
export function gymWallValue(at: string | number | Date | null | undefined, zone: string | null | undefined): string | null {
  const day = gymDay(at, zone);
  const time = gymTimeLabel(at, zone);
  return day && time ? `${day}T${time}` : null;
}

/**
 * A wall clock in `zone` → epoch ms.
 *
 * Two passes, and the second one is not an optimisation. The offset a zone is
 * on depends on the instant, and the instant is what is being solved for — so
 * the first pass guesses with the offset in force at the same clock reading in
 * UTC, and the second re-reads the offset at the guess. On the two days a year
 * a zone changes, the first guess is an hour out and the second fixes it; on
 * every other day the second pass returns the same answer.
 */
function wallToMs(wall: string | null | undefined, zone: string | null | undefined): number | null {
  const w = String(wall ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(w);
  if (!m || !zone || !isZone(zone)) return null;
  const base = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  if (Number.isNaN(base)) return null;
  let guess = base;
  for (let pass = 0; pass < 2; pass++) {
    const off = offsetMsAt(guess, zone);
    if (off == null) return null;
    const next = base - off;
    if (next === guess) return next;
    guess = next;
  }
  return guess;
}

/** How far `zone` is from UTC at this instant, in ms. Positive east. */
function offsetMsAt(at: number, zone: string): number | null {
  const day = gymDay(at, zone);
  const time = gymTimeLabel(at, zone);
  if (!day || !time) return null;
  const asIfUtc = Date.parse(`${day}T${time}:00Z`);
  if (Number.isNaN(asIfUtc)) return null;
  // Minute resolution, which is all `gymTimeLabel` carries. Every zone in the
  // IANA database has been on a whole-minute offset since 1972, and the seconds
  // dropped here are the ones no gym opens on.
  return asIfUtc - Math.floor(at / 60_000) * 60_000;
}

/** `day` plus `n` days, as `YYYY-MM-DD`, with no zone involved at all — it is
 *  calendar arithmetic on three integers, and doing it through UTC keeps it
 *  that way. Null for anything that is not a date. */
function addDays(day: string, n: number): string | null {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + n * 86_400_000);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Every zone this runtime knows, for a picker.
 *
 * An empty array is a real answer — `Intl.supportedValuesOf` is recent enough
 * that a browser or a React Native runtime may not have it — and the caller
 * must render a plain text field rather than an empty dropdown. A picker with
 * nothing in it is a setting nobody can make.
 *
 * Deliberately NOT a curated shortlist. Every shortlist anybody writes is the
 * list of places the author has been, and this product's whole premise is that
 * it is running in gyms the author has not been to.
 */
export function zoneOptions(): string[] {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const all = anyIntl.supportedValuesOf?.('timeZone');
    return Array.isArray(all) ? all.slice() : [];
  } catch {
    return [];
  }
}

/* ── reading the gym's zone ────────────────────────────────────────────────── */

/**
 * The gym's zone, with the failed read kept apart from the unset value.
 *
 * `fetchGymProfile` in src/lib/gymPolicy.ts returns this alongside the other
 * five settings and is what a settings screen should use. This narrower read
 * exists for the screens that need nothing else — a rota, a door log, a
 * takings chart — so that adding an honest clock to one of them does not mean
 * pulling the gym's pay policy and brand colour along with it.
 *
 * Three outcomes, exactly as the rest of this codebase insists: `zone` set,
 * `zone` null with no error (the gym has not said), and `error` set (we could
 * not ask). The third must never be rendered as the second — "the gym has not
 * set a timezone" is an instruction to go and set one, and printing it over a
 * failed read sends an owner to change a setting that is already correct.
 */
export async function fetchGymZone(
  sb: Queryable, tenantId: string,
): Promise<{ zone: string | null; error: string | null }> {
  const { data, error } = await sb
    .from('tenants').select('timezone').eq('id', tenantId).single();
  if (error) {
    return { zone: null, error: (error as { message?: string }).message || 'The gym’s timezone could not be read.' };
  }
  const raw = String(((data ?? {}) as Record<string, unknown>).timezone ?? '').trim();
  // A stored value this runtime cannot resolve is NOT a zone. It is reported as
  // no zone rather than passed on, because every function above would return
  // null for it anyway and a screen holding an unusable string would say the
  // gym has a timezone while drawing the reader's.
  return { zone: raw && isZone(raw) ? raw : null, error: null };
}
