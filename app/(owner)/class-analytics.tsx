// Owner · Class analytics & payroll. Reads class attendance (per class × branch ×
// trainer × time) to show fill rates, and prices trainer pay from check-ins at
// the rate the gym has agreed with each coach.
//
// Every figure on this screen comes from `class_attendance_summary`; there is no
// demo fallback, so an empty range says "no classes" rather than inventing
// attendance for people who were never checked in.
//
// ── The rate used to live in a useState, and nothing was ever paid ────────
//
// This screen held ONE per-attendee rate in component state, applied it to every
// coach on the roster, and said so at the foot of the payroll section: "nothing
// is paid from this screen". Both halves of that were the problem.
//
//   · The rate was never persisted. It was retyped on every visit, it was gone
//     on every reload, and `payroll_settlements` links to `sessions` and to
//     nothing else — so a trainer who taught twelve classes and covered twenty
//     floor hours was owed nothing this product could compute, on any surface.
//   · One rate for everybody is the same defect `tenants.session_fee` had for
//     one-to-ones: a coach of fifteen years and a trainee in their first month
//     priced identically, with no way to say otherwise.
//
// The rate now lives on `gym_trainer_pay` (supabase/parts/183), per coach, with
// its own currency and its own answer to the question a single number cannot
// hold: is it a flat amount for the class, or an amount per head? "80" and "8"
// are the same digits and completely different money.
//
// And a class can now actually be PUT ON PAYROLL from here. That writes a
// `gym_class_pay` line — snapshotting the rate, the headcount and the amount, so
// a rate changed in March cannot rewrite what somebody was paid in January —
// which the next payroll run for that coach picks up and stamps. Settling is
// still not done here, and that is deliberate: money leaving the account is one
// screen's job, and it is the console's Payroll.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): eleven bordered boxes became hairline-separated sections,
// payroll became the screen's one hero figure, and the Georgia serif header and
// the 12.5/11.5px font sizes are gone.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { classSummary, summariseClassRows, type ClassSummaryRow } from '../../src/lib/classAttendance';
import { useTenant } from '../../src/ui/tenant';
import { reportError } from '../../src/lib/reportError';
import { supabase } from '../../src/lib/supabase';
// `normaliseCurrency` alongside `money` because this screen has to COUNT the
// currencies its payroll total is made of, not just format one: ' gbp ' and
// 'GBP' are one currency and a count that says two withholds a total the gym is
// entitled to. It is the same normaliser `payCurrency` and `sharedCurrency` use.
import { money, normaliseCurrency } from '../../src/lib/gymRecord';
// The inverse of the `readMinorAmount` that `parseRate` reads this screen's
// rate field back with: minor units → the major-unit string a person types,
// with the number of places taken from the currency rather than assumed to be
// two. A yen has none and a Kuwaiti dinar has three.
import { majorFromMinor } from '../../src/lib/coachMoney';
import {
  fetchTrainerPay, saveTrainerPay, fetchClassPay, addClassPay,
  classPayAmount, classPayBlocker, parseRate, payRateBlocker,
  payCurrency, CLASS_PAY_LABEL,
  type PayIndex, type TrainerPay, type ClassPayLine, type ClassPayKind,
} from '../../src/lib/gymPay';
// `tenants.timezone`, parsed, with a failed read kept apart from a gym that
// has not set one. The tenant context does not carry the zone, and this screen
// needs nothing else off the gym row.
import { fetchGymZone } from '../../src/lib/gymZone';
// The console's own month boundary, so "This month" on the phone and the
// August run on the laptop are the same period rather than two numbers under
// one label. Local midnight, not UTC's — see the header of monthEnd.ts.
import { monthWindow, monthKeyOf } from '../../src/lib/monthEnd';
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { readState, hasRows, staleNote } from '../../src/lib/staleRead';
import { BACK_ICON } from '../../src/ui/direction';

type Range = 'week' | 'month' | 'season';
const RANGES: [Range, string][] = [['week', 'This week'], ['month', 'This month'], ['season', 'Season']];

/**
 * ── "This month" is the CALENDAR month, and it did not used to be ─────────
 *
 * This was `['month', 'This month', 30]` and a rolling thirty days. The console
 * disagrees, in writing: studio-web/app/payroll/page.tsx opens "An owner pays
 * people against a period — August, not 'the last thirty days'."
 *
 * So the phone's "This month" hero and the console's August payroll run were
 * different numbers wearing the same label, on a screen titled "Classes &
 * Payroll" whose own copy tells the owner the money "still leaves the account
 * from Payroll in the console". The owner reconciles one against the other and
 * they never agree — in mid-September a rolling thirty days is most of August.
 *
 * The month is built from `monthWindow`, the same helper /accounting and
 * /close use, so the boundary is the local calendar's midnight and not UTC's:
 * the evening of the 31st does not fall into next month because Greenwich says
 * so. `to` is capped at NOW rather than the end of the month — a month still
 * running has no classes in its future, and quoting a period that has not
 * happened is how a fill rate comes to look like a collapse on the 2nd.
 *
 * `week` and `season` stay rolling on purpose. Nobody is paid against them and
 * "the last 7 days" is what an owner means by "this week" when they are asking
 * how the timetable is doing, not which Monday it started on.
 */
function rangeBounds(r: Range, now: Date = new Date()): { from: string; to: string; label: string } {
  const to = now.toISOString();
  if (r === 'month') {
    const w = monthWindow(monthKeyOf(now));
    // `monthWindow` returns null only on a malformed key, and `monthKeyOf`
    // cannot build one. The fallback is the rolling month rather than a throw:
    // a payroll screen that renders nothing is worse than one whose window
    // slipped, and the label below stops saying "August" if it ever happens.
    if (!w) return { from: rollingFrom(now, 30), to, label: 'the last 30 days' };
    return { from: w.fromIso, to, label: `${w.label} so far` };
  }
  const days = r === 'week' ? 7 : 90;
  return { from: rollingFrom(now, days), to, label: `the last ${days} days` };
}

function rollingFrom(now: Date, days: number): string {
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return from.toISOString();
}

/**
 * One bar of a ranked list. 3px on a dim track, same mark as <Meter/> — `dim`
 * separates the two ranked lists without reaching for a status colour.
 */
function Bar({ t, label, note, pct, dim }: { t: Theme; label: string; note: string; pct: number; dim?: boolean }) {
  return (
    <View style={{ marginTop: sp.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.md }}>
        <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={1}>{label}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{note}</Text>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
        <View style={{ height: 3, borderRadius: 2, width: `${pct}%`, backgroundColor: t.brand, opacity: dim ? 0.45 : 1 }} />
      </View>
    </View>
  );
}

/**
 * The inline rate editor for one coach.
 *
 * Two fields and not one, because a class rate that does not say how it is
 * counted is not a rate: "80 per class" and "8 a head" are the same digits and
 * completely different money, and a gym that meant the second and stored the
 * first pays a coach twelve times what it agreed. supabase/parts/183 refuses to
 * store one without the other for the same reason.
 *
 * `readNumber` is not used here — `parseRate` in src/lib/gymPay.ts is, through
 * the save path, and it is the same rule written once: it refuses a negative, a
 * third decimal place and anything that is not a number, and it treats an empty
 * field as a CLEAR rather than as zero.
 */
function RateRow({ t, existing, busy, cur, onSave, onCancel }: {
  t: Theme;
  existing: { classRateCents: number | null; classPayKind: ClassPayKind | null; currency: string | null } | null;
  busy: boolean; cur: string;
  onSave: (amount: string, kind: ClassPayKind | '') => void;
  onCancel: () => void;
}) {
  /**
   * The stored rate is in a DIFFERENT money from the one this box is in.
   *
   * `TrainerPay.currency` is never inherited from `tenants.currency` at read
   * time — src/lib/gymPay.ts says why in writing: a gym that changes its
   * currency must not retroactively re-denominate what it agreed to pay
   * somebody. So a gym that switched from AED to GBP still holds a coach's rate
   * in AED, and this box, which is labelled `cur` and whose contents `saveRate`
   * parses and stores as `cur`, has no honest number to start from. It starts
   * empty and says so, rather than showing 600 under a "GBP" label because the
   * digits happen to be the same.
   */
  const otherMoney = !!existing?.currency && existing.currency !== cur && existing.classRateCents != null;
  const [amount, setAmount] = useState(
    // NOT `cents / 100`. The factor is a property of the currency: a yen has no
    // minor unit, so a ¥5,000 class rate is stored as 5000 and was pre-filled
    // here as "50.00" — the coach's rate rewritten to a hundredth of itself the
    // moment the owner opened the editor and pressed Save. A Kuwaiti dinar has
    // 1000 fils, so KWD 12.340 was shown as "123.40" and saved back as ten
    // times the agreed rate. `majorFromMinor` takes the places from the
    // currency and is the exact inverse of the `readMinorAmount` inside
    // `parseRate` that reads this field back. src/lib/coachMoney.ts.
    otherMoney ? '' : majorFromMinor(existing?.classRateCents, cur),
  );
  const [kind, setKind] = useState<ClassPayKind | ''>(otherMoney ? '' : (existing?.classPayKind ?? ''));

  return (
    <View style={{ marginTop: sp.md }}>
      {otherMoney ? (
        <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
          {`This coach's rate is recorded in ${existing!.currency}, and this gym now works in ${cur}. `
           + `The old amount is not shown here because it is not an amount of ${cur} — typing a new one `
           + `replaces the ${existing!.currency} rate with a ${cur} one, and leaving this alone changes nothing.`}
        </Flag>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, alignSelf: 'flex-start' }}>
        <Text style={{ ...ty.label, color: t.ink3 }}>{cur}</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          accessibilityLabel={`What the gym pays this coach to teach, in ${cur}`}
          placeholder="rate"
          placeholderTextColor={t.ink3}
          style={{ ...ty.body, ...numeric, color: t.ink, paddingVertical: 9, minWidth: 64 }}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, flexWrap: 'wrap' }}>
        {(Object.keys(CLASS_PAY_LABEL) as ClassPayKind[]).map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === k }}
            style={{
              paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.sm,
              backgroundColor: kind === k ? t.brand : t.surface2,
            }}
          >
            <Text style={{ ...ty.label, color: kind === k ? t.brandInk : t.ink3 }}>
              {k === 'per_class' ? 'Per class' : 'Per person'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, maxWidth: 380 }}>
        {CLASS_PAY_LABEL[kind || 'per_class']}. Clearing the rate means this gym does not pay this
        coach for teaching &mdash; which is a different thing from paying them nothing, and is why
        an empty field clears rather than storing a zero.
      </Text>
      <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.md }}>
        <Ghost label={busy ? 'Saving…' : 'Save Rate'} onPress={() => onSave(amount, kind)} />
        <Ghost label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

export default function OwnerClassAnalytics() {
  // The gym's own currency (part 99), not the module default — this screen
  // prints a pay rate a trainer is owed, which is the last figure that should
  // be denominated in a guess.
  const { tenant } = useTenant();
  // `?? null`, not `|| GYM_CURRENCY`: the per-check-in rate below is typed by
  // the owner in their own money, and printing the payroll it produces in
  // dirhams at a gym that never chose them is a wrong figure on a screen whose
  // whole job is what people are paid.
  const cur = tenant?.currency ?? null;
  const t = useTheme();
  const router = useRouter();
  const [range, setRange] = useState<Range>('week');
  // Null until the read returns, never []. An empty array here is a claim —
  // "no classes ran in this range" — and this screen made it on first paint and
  // again on every range change, before the query it depends on had answered.
  // An owner switching to "This week" saw "No classes in this range." and could
  // reasonably conclude their timetable was empty and nobody had been checked
  // in. Null says "not known yet"; [] stays reserved for a range that really
  // held nothing.
  const [rows, setRows] = useState<ClassSummaryRow[] | null>(null);
  /** Which range the rows in hand are FOR. Without it the effect below cannot
   *  tell a refresh of the range on screen from a switch to a different one,
   *  and it has to clear for the second.
   *
   *  A ref rather than state deliberately: in the dependency array it would
   *  re-enter the effect after every successful read and fire a second query
   *  for the same range, and nothing on screen is derived from it. */
  const rowsRange = useRef<Range | null>(null);
  /** Whether the most recent attempt failed. Paired with `rows`, this is the
   *  four-state read in src/lib/staleRead.ts. */
  const [readFailed, setReadFailed] = useState(false);
  /** What the gym pays each coach to teach, from `gym_trainer_pay`. Null is a
   *  read that failed or has not returned — NOT a gym that pays nobody, which
   *  is why every figure below it goes to a dash rather than to zero. */
  const [pay, setPay] = useState<PayIndex | null>(null);
  /** Classes already on a payroll line, so one cannot be added twice. Null
   *  again means unread: the Add buttons are withheld rather than offered over
   *  a list that might already contain what is about to be added. */
  const [paid, setPaid] = useState<ClassPayLine[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);
  /** Which coach's rate is open for editing, by trainer id. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Bumped by the Refresh control. A counter, so two taps are two reads. */
  const [tick, setTick] = useState(0);
  /** When the attendance read landed, and whether one is in flight. */
  const [attendanceAt, setAttendanceAt] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  /** And when the pay rates did. The payroll column on this screen is those two
   *  reads multiplied together, so one stamp over it has to be the older. */
  const [payAt, setPayAt] = useState<number | null>(null);

  useEffect(() => {
    let on = true;
    const { from, to } = rangeBounds(range);
    // Cleared ONLY when the range changed. Without any clearing, the previous
    // range's rows stayed on screen while the new range loaded, so a payroll
    // total for the season sat under the heading "This week" — a number an
    // owner might pay against.
    //
    // Clearing unconditionally was the other half of that mistake and arrived
    // with pull-to-refresh: the gesture re-runs this effect on the SAME range,
    // so pulling down emptied a correct payroll table, and a pull that failed
    // left it empty. `rowsRange` is what separates the two.
    if (rowsRange.current !== range) { setRows(null); rowsRange.current = null; setReadFailed(false); }
    setReading(true);
    classSummary(from, to)
      // The stamp moves on a read that LANDED. A refused one leaves it where it
      // was, because what is on screen is still the earlier read's.
      //
      // ── null is a FAILED read, and it used to be filed as a blank screen ──
      //
      // `classSummary` never rejects. Read its body: the whole Supabase branch
      // sits inside a `try { … } catch { return null }`, and it returns null
      // for a PostgREST error, for a read that came back at the row cap, and
      // for a shape it did not expect. So `.catch` below was unreachable,
      // `readFailed` was never true, and every one of those three arrived here
      // as `setRows(null)` with the failure flag CLEARED — which
      // `readState(null, false)` calls 'loading'.
      //
      // The effect was that an owner whose payroll read was refused by RLS, or
      // whose gym crossed a thousand classes in the Season range, sat looking
      // at "Reading the register…" with no spinner and no further read coming.
      // The two branches this file wrote to explain both cases — "This range
      // could not be read" and `staleNote('register')` — could not be reached
      // from any state the screen could get into.
      //
      // A null therefore raises `readFailed` and does NOT touch `rows`: on a
      // first read that leaves 'failed' (nothing has ever landed, and the
      // sentence says it is not an empty range), and on a refresh over rows
      // already held it leaves 'stale' (the payroll table stays, labelled).
      // That is exactly what src/lib/staleRead.ts is for, and this screen has
      // been importing it without ever entering two of its four states.
      .then((r) => {
        if (!on) return;
        if (r == null) { setReadFailed(true); return; }
        setRows(r); rowsRange.current = range; setReadFailed(false); setAttendanceAt(Date.now());
      })
      // A bare .then left a rejection unhandled and the screen showing whatever
      // it had, silently. The rows are now kept and LABELLED instead: a refresh
      // fails for reasons that say nothing about the register, and a coach's
      // payroll table should not vanish because the phone went into a lift.
      .catch((e) => { reportError('classAnalytics.summary', e); if (on) setReadFailed(true); })
      .finally(() => { if (on) setReading(false); });
    return () => { on = false; };
  }, [range, tick]);

  // The pay rates and the lines already raised. Their own read and their own
  // failure: the attendance figures above are not money and stand perfectly
  // well without them, so a refusal here costs the payroll column and nothing
  // else. `reload` is what the write paths call to bring both back.
  const tenantId = tenant?.id ?? null;
  const [payTick, setPayTick] = useState(0);
  useEffect(() => {
    let on = true;
    if (!tenantId) { setPay(null); setPaid(null); return; }
    // Both halves have to land for the stamp to move: the payroll column needs
    // the rates AND the lines already raised, and a stamp set by whichever
    // resolved first would claim an age for the other one. Each keeps its own
    // failure — a null `pay` is what the flag below reads as "the rates could
    // not be read", and rates are the one thing on this screen that must not
    // survive a refusal, because somebody pays against them.
    Promise.all([
      fetchTrainerPay(supabase, tenantId)
        .then((p) => { if (on) setPay(p); })
        .catch((e) => { reportError('classAnalytics.trainerPay', e); if (on) setPay(null); throw e; }),
      // The gym's own clock, read first, because `fetchClassPay` DATES every
      // line it returns and cannot re-date them afterwards. Nothing on this
      // screen renders `taughtOn` — `already` dedupes by class id and `queued`
      // counts and sums — so passing the zone changes no pixel here today.
      // It is passed anyway, and the parameter is required rather than
      // optional, because the alternative is what /payroll did for as long as
      // it was optional: take the reader's clock by saying nothing, and put a
      // coach on the wrong month's run. A screen that starts printing these
      // dates should not have to discover the fallback the way that one did.
      //
      // `fetchGymZone` reports a refused read as no zone rather than throwing,
      // which is right here: a gym whose timezone could not be read still has
      // classes to queue, and the lines fall back to the reader's day exactly
      // as a gym that has set none does.
      fetchGymZone(supabase, tenantId)
        .then((z) => fetchClassPay(supabase, tenantId, z.zone))
        .then((p) => { if (on) setPaid(p); })
        .catch((e) => { reportError('classAnalytics.classPay', e); if (on) setPaid(null); throw e; }),
    ])
      .then(() => { if (on) setPayAt(Date.now()); })
      .catch(() => { /* both halves have already reported and cleared themselves */ });
    return () => { on = false; };
  }, [tenantId, payTick]);
  const reload = () => setPayTick((n) => n + 1);
  /** One line over the two reads, and it is the age of the older. */
  const fetchedAt = oldestFetch(attendanceAt, payAt);
  /** Attendance and pay, both. The Refresh button beside the stamp and the pull
   *  gesture run the same pair — a screen half-refreshed under one stamp is the
   *  thing the stamp exists to prevent. */
  const refreshAll = useCallback(() => { setTick((n) => n + 1); setPayTick((n) => n + 1); }, []);
  const pull = usePullToRefresh(refreshAll);

  // Two facts — what is held, and whether the last attempt landed — and the
  // four states they make. src/lib/staleRead.ts.
  const readSt = readState(rows, readFailed);
  const loaded = hasRows(readSt);
  const list = rows ?? [];
  /**
   * What one class is worth to the coach who taught it, in minor units, or null
   * when it cannot be priced.
   *
   * Null covers three different silences and all three are a dash: the rates
   * could not be read, this gym has not said what it pays this coach, and a
   * per-head class whose register nobody took. The last is the one worth
   * spelling out — paying a per-attendee class at nought would be the product
   * deciding a coach taught to an empty room because the paperwork is missing.
   */
  const worth = (r: ClassSummaryRow): number | null => {
    const own = pay?.get(r.trainerId);
    if (!own || own.classRateCents == null || own.classPayKind == null) return null;
    return classPayAmount(own.classPayKind, own.classRateCents, r.attended);
  };

  /**
   * What ONE coach's class money is in — their own stated rate currency, and
   * the gym's only where they have stated none.
   *
   * `gym_trainer_pay.currency` is nullable PER COACH and is never inherited
   * from `tenants.currency` at read time; src/lib/gymPay.ts states the contract
   * in writing — a gym that changes its currency must not retroactively
   * re-denominate what it agreed to pay somebody. So a coach still on an AED
   * rate at a gym that now works in GBP is owed dirhams, and `worth()` returns
   * minor units of THAT coach's money, not the gym's.
   *
   * One expression, read by the figure beside "Add To Payroll" AND by the write
   * that files the line. It was two: the label said `cur` while the insert said
   * `own.currency ?? cur`, so at exactly that gym the owner read one currency
   * and the line was filed in another — which is character for character the
   * defect scripts/check-currency.mjs opens with, the Members payment form whose
   * label was corrected and whose write was left alone. Two copies of a currency
   * rule is that bug waiting for its second outing, so there is one copy.
   */
  const coachCurrency = (own: TrainerPay | null | undefined): string | null => own?.currency ?? cur;

  const totals = useMemo(() => {
    // Both rates come from one helper, so this screen and the timetable can no
    // longer disagree about what "fill" means. Each stays null when its
    // denominator was never recorded, and renders as — rather than 0%.
    const r = summariseClassRows(list);
    let cents = 0;
    let priced = 0;
    let unpriced = 0;
    /**
     * The rates that actually CONTRIBUTED to `cents`, one entry per coach.
     *
     * Kept because the sum above is only a sum of money if they agree on which
     * money it is. `worth()` returns minor units in each coach's own currency
     * and this loop adds them together, so the set of currencies behind the
     * total is the only thing that can honestly label it. Coaches with no rate
     * contributed nothing and are not asked.
     */
    const contributors: TrainerPay[] = [];
    const seen = new Set<string>();
    for (const row of list) {
      const c = worth(row);
      if (c == null) { unpriced += 1; continue; }
      cents += c; priced += 1;
      const own = pay?.get(row.trainerId);
      if (own && !seen.has(own.trainerId)) { seen.add(own.trainerId); contributors.push(own); }
    }
    // Which currencies were actually STATED by those rates. `payCurrency` below
    // is the rule and returns one code or null; this is the same question asked
    // a second time only to say WHICH silence a null is, the way
    // app/(owner)/financials.tsx keeps its four apart. A rate that states
    // nothing does not disagree with anything — it is filed in the gym's own
    // currency by the write, which is why it is filtered out here too.
    const stated = [...new Set(
      contributors.map((p) => normaliseCurrency(p.currency)).filter((c): c is string => !!c),
    )];
    return {
      ...r,
      showPct: r.show == null ? null : Math.round(r.show * 100),
      fillPct: r.fill == null ? null : Math.round(r.fill * 100),
      // Null when NOTHING in the range could be priced, so the hero shows a dash
      // and its note says why — rather than a confident zero over a range full
      // of classes somebody taught.
      payrollCents: priced ? cents : null,
      /**
       * What that sum may be LABELLED, and null where nothing may.
       *
       * It was `cur` — `tenants.currency` — at four sites, over a figure built
       * from per-coach rates that are deliberately not denominated in it. A gym
       * that switched from AED to GBP and left one coach on the old rate had
       * its dirhams added to its pounds and the result headed GBP.
       *
       * `payCurrency` is the rule, it already existed, and this screen was the
       * half of the product that never got it: null for a mixed set, and null
       * for a single currency that is not the gym's, because that is two
       * answers and neither is the total's.
       */
      payrollCurrency: payCurrency(contributors, cur),
      /** More than one money in the sum. */
      mixedPayCurrencies: stated.length > 1,
      /** One money in the sum, and it is not the one this gym works in. */
      otherPayCurrency: stated.length === 1 && !!cur && stated[0] !== cur ? stated[0] : null,
      priced,
      unpriced,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `worth` closes over `pay`, which is the dependency that matters
  }, [list, pay, cur]);

  /**
   * Why the payroll total is not stated, when it is not — and which of the two
   * reasons it is.
   *
   * The pattern is `queued` below, in this same file: two currencies never sum,
   * the COUNT of classes is still true, so the sentence keeps what is true and
   * drops the amount. The two silences are kept apart for the reason
   * app/(owner)/financials.tsx keeps its four apart: a range whose coaches are
   * paid in two moneys and a range whose one money is not the gym's are
   * different facts, and folding either into "your gym has not set a currency"
   * sends an owner to Ops to set a field that is already set.
   *
   * Null when there is nothing to withhold — including at a gym with no
   * currency at all, where `noCurrency` is already the whole answer.
   */
  const payGap: string | null = totals.mixedPayCurrencies
    ? 'these coaches are paid in more than one currency, so there is no one total to state'
    : totals.otherPayCurrency
    ? `these class rates are recorded in ${totals.otherPayCurrency} and this gym works in ${cur}, so there is no one total to state`
    : null;

  const byGroup = (key: (r: ClassSummaryRow) => string) => {
    const m: Record<string, { attended: number; booked: number; classes: number }> = {};
    for (const r of list) { const k = key(r) || '—'; (m[k] ||= { attended: 0, booked: 0, classes: 0 }); m[k].attended += r.attended; m[k].booked += r.booked; m[k].classes += 1; }
    return Object.entries(m).sort((a, b) => b[1].attended - a[1].attended);
  };
  const byBranch = useMemo(() => byGroup((r) => r.branch), [list]);
  /**
   * Grouped by trainer ID, not by the name string.
   *
   * The name was the key, which is fine for a bar chart and wrong the moment
   * this section became something that WRITES: two coaches called Sam merge into
   * one row and the pay line goes to whichever id sorted first, and a coach who
   * changes their display name splits into two rows halfway through a month.
   */
  const byTrainer = useMemo(() => {
    const m = new Map<string, { id: string; name: string; attended: number; booked: number; classes: number; rows: ClassSummaryRow[] }>();
    for (const r of list) {
      const cur = m.get(r.trainerId) ?? { id: r.trainerId, name: r.trainerName || 'Trainer', attended: 0, booked: 0, classes: 0, rows: [] };
      cur.attended += r.attended; cur.booked += r.booked; cur.classes += 1; cur.rows.push(r);
      m.set(r.trainerId, cur);
    }
    return [...m.values()].sort((a, b) => b.attended - a.attended);
  }, [list]);
  const byKind = useMemo(() => byGroup((r) => r.kind || r.title), [list]);
  const maxBranch = Math.max(1, ...byBranch.map(([, v]) => v.attended));
  const maxKind = Math.max(1, ...byKind.map(([, v]) => v.attended));
  /** Class ids already on a payroll line, so nothing is offered twice. */
  const already = useMemo(() => new Set((paid ?? []).map((p) => p.classId)), [paid]);
  const G = layout.gutter;

  // ── pricing a class, and why the typed rate is gone ──────────────────────
  //
  // Every output of this section goes through `money()`, which returns null
  // when it is handed no currency — so at a gym that has not set
  // `tenants.currency` the hero, the section note and every per-trainer figure
  // render a dash no matter what is stored. A control whose every result is
  // withheld is a control that does nothing, so where there is no currency it is
  // replaced by the reason and the way to fix it. The check-in and class counts
  // are unaffected: they are not money and they still stand.
  //
  // WHICH currency each of those figures is handed is not one answer and used to
  // be: `cur` — the gym's — labelled all four, over amounts `worth()` returns in
  // each COACH's own money. A per-coach figure now takes `coachCurrency`, and
  // the two totals take `payCurrency`, which withholds rather than choose
  // between two moneys. See both.
  //
  // What is offered instead of the old single typed rate is a rate PER COACH,
  // saved to `gym_trainer_pay`, with the thing a single number could not say —
  // whether it is a flat amount for the class or an amount for each person who
  // turned up.
  const noCurrency = (
    <View style={{ marginBottom: sp.md }}>
      <Text style={{ ...ty.label, color: t.ink2 }}>Your gym has not set a currency.</Text>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
        A pay rate with no currency is not an amount, so payroll stays blank until you choose one.
        Check-ins and fill rates below are unaffected.
      </Text>
      <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
        <Ghost label="Set It In Operations" onPress={() => router.push('/(owner)/ops')} />
      </View>
    </View>
  );

  const saveRate = async (trainerId: string, amount: string, kind: ClassPayKind | '') => {
    if (!tenantId || !cur) return;
    const blocker = payRateBlocker('', amount, kind, cur);
    if (blocker) { setWriteErr(blocker); return; }
    // The gym's own currency, and the guard above already refused a null one.
    const parsed = parseRate(amount, cur);
    setBusy(trainerId);
    try {
      const own = pay?.get(trainerId) ?? null;
      await saveTrainerPay(supabase, tenantId, {
        trainerId,
        // The one-to-one rate is left exactly as it was. This screen is about
        // classes, and a class rate editor that silently cleared the session
        // rate beside it would halve somebody's pay from a screen that never
        // mentioned one-to-ones.
        sessionRateCents: own?.sessionRateCents ?? null,
        classRateCents: parsed.kind === 'rate' ? parsed.cents : null,
        classPayKind: parsed.kind === 'rate' ? (kind || null) : null,
        currency: cur,
        updatedBy: null,
      });
      setWriteErr(null);
      setEditing(null);
      reload();
    } catch (e: any) {
      reportError('classAnalytics.saveRate', e);
      setWriteErr(`That rate was NOT saved: ${e?.message ?? 'the write was refused'}. This coach is still on whatever they were on.`);
    } finally { setBusy(null); }
  };

  /**
   * The period this screen is reporting, in words.
   *
   * Recomputed on render rather than stored, so the label cannot drift from the
   * bounds the read used. "September 2026 so far" is a different claim from
   * "the last 30 days" and the owner is about to reconcile it against a payroll
   * run named after a month.
   */
  const periodLabel = rangeBounds(range).label;

  /**
   * Lines queued and NOT settled.
   *
   * `settlementId` is null until a payroll run in the console picks the line
   * up, so this is money an owner has decided somebody is owed and that has
   * not left the account. Queuing every class on the phone looks exactly like
   * paying everybody, and nothing on this screen said otherwise except one
   * clause at the bottom of a caption below the fold.
   */
  const queued = useMemo(() => {
    if (!paid) return null;
    const open = paid.filter((l) => l.settlementId == null);
    if (!open.length) return null;
    // Two currencies never sum. A gym that changed its currency has both in its
    // pay lines, and adding them is not a total — the count is still true, so
    // the sentence keeps the count and drops the amount.
    const cs = new Set(open.map((l) => l.currency));
    return {
      count: open.length,
      cents: cs.size === 1 ? open.reduce((a, l) => a + l.amountCents, 0) : null,
      currency: cs.size === 1 ? [...cs][0] : null,
    };
  }, [paid]);

  const putOnPayroll = async (r: ClassSummaryRow) => {
    if (!tenantId || !cur) return;
    const own = pay?.get(r.trainerId);
    const blocker = classPayBlocker(own, r.attended, already.has(r.classId));
    if (blocker) { setWriteErr(blocker); return; }
    const cents = worth(r);
    if (cents == null || !own || own.classRateCents == null || own.classPayKind == null) return;
    // The one expression, read here and by the figure printed beside the button
    // that calls this. `classPayBlocker` above already refuses a coach whose
    // rate states no currency, and `cur` is non-null by the guard at the top, so
    // this cannot be null — the check is written out anyway because a currency
    // must never be inferred at a write, least of all from a guard three
    // branches away.
    const lineCur = coachCurrency(own);
    if (!lineCur) return;
    setBusy(r.classId);
    try {
      await addClassPay(supabase, tenantId, {
        classId: r.classId,
        trainerId: r.trainerId,
        payKind: own.classPayKind,
        // Snapshotted, all four. A rate changed in March must not rewrite what
        // a coach was paid in January, and a register corrected afterwards must
        // not silently change a figure somebody has already been handed.
        rateCents: own.classRateCents,
        attendees: own.classPayKind === 'per_attendee' ? r.attended : null,
        amountCents: cents,
        currency: lineCur,
        createdBy: null,
      });
      setWriteErr(null);
      reload();
    } catch (e: any) {
      reportError('classAnalytics.addClassPay', e);
      setWriteErr(`That class was NOT put on payroll: ${e?.message ?? 'the write was refused'}. Nobody is owed anything extra and nothing has changed.`);
    } finally { setBusy(null); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Attendance drives pay</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Classes & Payroll</Text>
            {/* Attendance and payroll both. The pay reload rides along, because
                an owner pressing one control expects the whole screen to be
                current afterwards, not half of it. */}
            <Fetched at={fetchedAt} busy={reading} onRefresh={refreshAll} />
          </View>
        </View>

        {/* ── range ──────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.sm, padding: 3, marginTop: sp.lg }}>
          {RANGES.map(([k, label]) => (
            <Pressable key={k} onPress={() => setRange(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm, backgroundColor: range === k ? t.brand : 'transparent' }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: range === k ? t.brandInk : t.ink3 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {/* A failed refresh over rows that DID land no longer reaches this
            branch — those rows are kept and flagged below. What is left here is
            a range nothing has ever been read for, and the two reasons for that
            are now separate sentences rather than one that covers both. */}
        {/* One caveat for the whole screen: the hero, the fill rates and the
            payroll column are all derived from this one read. `warn`, not
            `crit` — the rows are real and complete, and only the attempt to
            confirm them failed. */}
        {readSt === 'stale' ? (
          <Flag tone={t.warn} style={{ marginTop: sp.md }}>{staleNote('register')}</Flag>
        ) : null}

        {readSt === 'failed' ? (
          <Section>
            <Text style={{ ...ty.head, color: t.ink }}>This range could not be read.</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              That is a read that did not come back, not a range with no classes. Nobody&rsquo;s
              attendance has been lost and no payroll line has changed. Pull down to try again.
            </Text>
          </Section>
        ) : !loaded ? (
          <Section>
            <Text style={{ ...ty.head, color: t.ink }}>Reading the register…</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Attendance and payroll stay blank until this range has actually been read.
            </Text>
          </Section>
        ) : list.length === 0 ? (
          <Section>
            <Text style={{ ...ty.head, color: t.ink }}>No classes in this range.</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Attendance, fill rates and trainer payroll appear here once classes run and trainers check members in.
              Nothing is estimated — payroll is check-ins × your per-attendee rate.
            </Text>
          </Section>
        ) : (<>

          {/* ── the hero: what this screen is for ────────────────────────── */}
          {/* "(AED)" is out of the label because the figure carries it now:
              every amount on this screen goes through the one formatter, so
              the currency is stated by the number rather than typed beside it
              — which is how Revenue came to say $ about the same gym. */}
          {/* The counts are always stated and the money joins them only when it
              can be written. `money()` returns null at a gym with no currency
              and React renders null as nothing, which is how a sentence loses
              its middle and reads as a broken screen rather than as a missing
              setting. */}
          <Hero
            label="Trainer Payroll"
            figure={fig(money(totals.payrollCents, totals.payrollCurrency))}
            note={[
              `${totals.attended} check-ins`,
              `${totals.classes} classes`,
              `${totals.showPct ?? '—'}% turned up`,
              !cur
                ? "set your gym's currency to value them"
                : pay === null
                ? 'the pay rates could not be read, so nothing here is priced'
                // Said before the unpriced count, because this one explains the
                // DASH where the figure is. An unpriced class makes the total
                // smaller than the range; a mixed set means there is no total.
                : payGap
                ? payGap
                : totals.unpriced > 0
                ? `${totals.unpriced} class${totals.unpriced === 1 ? '' : 'es'} priced at nothing because the coach has no class rate`
                : null,
            ].filter(Boolean).join(' · ')}
          />

          {/* Queued is not paid, said where the figure is rather than in a
              caption under the fold. `Flag` puts the tone in a 6pt dot beside
              ink-coloured text — a status colour is never text colour here. */}
          {queued ? (
            <Flag tone={t.warn}>
              {queued.cents != null && queued.currency
                ? `${queued.count} class${queued.count === 1 ? '' : 'es'} on payroll — ${money(queued.cents, queued.currency)} — and none of it has left the account. A payroll run in the console is what hands it over.`
                : `${queued.count} class${queued.count === 1 ? '' : 'es'} on payroll, in more than one currency, so there is no one total to state. None of it has left the account — a payroll run in the console is what hands it over.`}
            </Flag>
          ) : null}

          <Rule />

          <Section>
            {/* Named, not "This Range". The console pays against August; this
                screen now reads the same August, and says which. */}
            <SectionHead title="This Range" note={periodLabel} />
            <KpiRow items={[
              { label: 'Classes', value: fig(totals.classes) },
              { label: 'Check-ins', value: fig(totals.attended) },
              // Fill is booked/capacity; show is attended/booked. Both are on
              // screen now, so neither has to stand in for the other.
              { label: 'Avg Fill', value: totals.fillPct == null ? '—' : String(totals.fillPct), unit: totals.fillPct == null ? undefined : '%' },
              { label: 'Avg Show', value: totals.showPct == null ? '—' : String(totals.showPct), unit: totals.showPct == null ? undefined : '%' },
            ]} />
          </Section>

          <Rule />

          {/* ── payroll by trainer ───────────────────────────────────────── */}
          <Section>
            {/* The same figure as the hero and therefore the same currency
                rule: withheld where the rates behind it do not agree on one
                money, rather than headed in the gym's. */}
            <SectionHead title="Payroll by Trainer" note={money(totals.payrollCents, totals.payrollCurrency) ?? undefined} />
            {cur ? null : noCurrency}
            {/* And said here as well as on the hero, because this is the
                section whose per-coach lines an owner would otherwise add up
                themselves. One string, framed twice, so the two cannot drift
                into two different accounts of the same silence. */}
            {payGap ? (
              <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                {`The total for this section is not stated: ${payGap}. Each coach's line below is in that coach's own currency.`}
              </Flag>
            ) : null}
            {writeErr ? (
              <Flag tone={t.crit} style={{ marginBottom: sp.md }}>{writeErr}</Flag>
            ) : null}
            {pay === null && cur ? (
              <Flag tone={t.crit} style={{ marginBottom: sp.md }}>
                What this gym pays each coach could not be read, so every figure below is a dash
                rather than nothing owed. Reload before paying anybody against this screen.
              </Flag>
            ) : null}
            {byTrainer.map((v, i) => {
              const own = pay?.get(v.id) ?? null;
              const cents = v.rows.reduce<number | null>((acc, r) => {
                const c = worth(r);
                // One unpriced class makes the coach's whole line unknown rather
                // than short by that class. Short is the dangerous one: it is a
                // real-looking figure somebody would pay.
                return acc == null || c == null ? null : acc + c;
              }, 0);
              return (
                <View key={v.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{v.name}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                        {v.classes} classes · {v.attended} check-ins
                        {own?.classRateCents != null && own.classPayKind
                          ? ` · ${money(own.classRateCents, coachCurrency(own)) ?? '—'} ${own.classPayKind === 'per_attendee' ? 'each person' : 'the class'}`
                          : ' · no class rate set'}
                      </Text>
                    </View>
                    {/* This coach's own money, not the gym's — the same
                        expression the rate beside the name is printed in, and
                        the same one the write below files a line with. This
                        line is one coach's rows and they are all in one
                        currency, so it is stated rather than withheld. */}
                    <Text style={{ ...ty.body, fontWeight: '600', ...numeric, color: t.ink }}>{fig(money(cents, coachCurrency(own)))}</Text>
                  </View>
                  {cur ? (
                    editing === v.id
                      ? <RateRow t={t} existing={own} busy={busy === v.id} cur={cur}
                                 onSave={(amount, kind) => saveRate(v.id, amount, kind)}
                                 onCancel={() => setEditing(null)} />
                      : <View style={{ marginTop: sp.sm, alignSelf: 'flex-start' }}>
                          <Ghost label={own?.classRateCents != null ? 'Change Rate' : 'Set A Class Rate'} onPress={() => { setWriteErr(null); setEditing(v.id); }} />
                        </View>
                  ) : null}
                </View>
              );
            })}
            {/* Read "Export feeds accounting/payroll once Stripe & accounting
                are connected." There is no export control on this screen, and
                no accounting integration anywhere in the product — the same
                promise app/(owner)/financials.tsx removed a ListRow for, with
                the reasoning that a control explaining what it would do if it
                were built is worse than no control. This says what the figures
                ARE, which is what somebody about to pay against them needs. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Each coach&rsquo;s own rate, applied to the classes they actually taught, and nothing
              else. Nothing here is estimated. Adding a class to payroll below writes the line the
              next payroll run picks up &mdash; the money itself still leaves the account from
              Payroll in the console, which is the one screen that hands anything over.
            </Text>
          </Section>

          <Rule />

          {/* ── where the check-ins are ──────────────────────────────────── */}
          <Section>
            <SectionHead title="Attendance by Branch" note={`${totals.attended} of ${totals.booked} booked`} />
            {byBranch.map(([b, v]) => (
              <Bar key={b} t={t} label={b} note={`${v.attended} / ${v.booked}`} pct={Math.round((v.attended / maxBranch) * 100)} />
            ))}
          </Section>

          <Rule />

          <Section>
            <SectionHead title="Popularity by Class Type" />
            {byKind.map(([k, v]) => (
              <Bar key={k} t={t} label={k} note={`${v.attended} · ${v.classes} run`} pct={Math.round((v.attended / maxKind) * 100)} dim />
            ))}
          </Section>

          <Rule />

          {/* ── the log the numbers came from ────────────────────────────── */}
          <Section>
            <SectionHead title="Classes" note={`${list.length} in range`} />
            {list.map((r, i) => {
              const on = already.has(r.classId);
              const cents = worth(r);
              const own = pay?.get(r.trainerId);
              const blocker = classPayBlocker(own, r.attended, on);
              return (
                <View key={r.classId} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.title}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.branch} · {r.trainerName}</Text>
                    </View>
                    {r.attended >= r.booked ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.good }} /> : null}
                    <Text style={{ ...ty.body, fontWeight: '600', ...numeric, color: t.ink }}>{r.attended}/{r.booked}</Text>
                  </View>
                  {/* Withheld entirely while `paid` is null: offering "Add to
                      payroll" over a list that might already contain this class
                      is how a coach gets paid for the same Tuesday twice. The
                      unique index on (class_id, trainer_id) would refuse the
                      second one, but a refusal after the tap is a worse way to
                      learn it than not being offered. */}
                  {cur && paid !== null ? (
                    <View style={{ marginTop: sp.sm, flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      {on ? (
                        <Text style={{ ...ty.caption, color: t.ink3 }}>On payroll</Text>
                      ) : blocker ? (
                        <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{blocker}</Text>
                      ) : (
                        <>
                          <Ghost label={busy === r.classId ? 'Adding…' : 'Add To Payroll'} onPress={() => putOnPayroll(r)} />
                          {/* THE SAME EXPRESSION `putOnPayroll` files the line
                              with. It said `cur` while the insert said the
                              coach's own currency, so at a gym that had changed
                              currency the owner read one money beside this
                              button and another one was written to
                              `gym_class_pay` — a permanent record of what
                              somebody is owed. */}
                          <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{money(cents, coachCurrency(own)) ?? '—'}</Text>
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Section>
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}
