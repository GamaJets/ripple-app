// Coach · Your Register. The figures the coach's own ticks produced.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// A coach takes the register in app/(trainer)/class-checkin.tsx. Everything
// computed from it lands somewhere else: `class_attendance_summary` feeds the
// owner's Classes & Payroll page, `summariseClassRows` turns it into fill and
// show, and `gymPay.classPayAmount` turns the headcount into a payroll line.
// The person holding the phone at the door could see none of it.
//
// Nothing had to be granted for this. `class_attendance_summary` has admitted
// the class's own trainer since supabase/parts/25 — `gc.trainer_id = auth.uid()`
// or `is_owner_of(gc.tenant_id)`, restated in part 460 — so these rows have been
// readable by the coach all along and nothing asked for them.
//
// ── What this screen refuses to be more certain than ───────────────────────
//
// A class with bookings and nothing marked against anybody is a register that
// was not taken. src/lib/coachRegister.ts splits those out and this page counts
// them out loud, because both of the alternatives are worse: leaving them in the
// rate publishes a nought-per-cent class the coach earned by not pressing a
// button, and dropping them quietly hides how much of the term is unrecorded.
//
// Walk-ins are counted beside the rate and never inside it — classRegister.ts's
// rule, and part 460's on the server. Where the gym's database has no walk-in
// column at all, the headcount is withheld rather than reported as nought.
//
// And nothing here is money. What a gym pays a coach to teach lives in
// `gym_trainer_pay` in the gym's own currency; a headcount is what the register
// produced, and this page stops there rather than multiplying it by a rate
// nobody in this app was told.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { MIN_TARGET } from '../../src/lib/a11y';
import { num } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { classSummary, summariseClassRows, type ClassSummaryRow } from '../../src/lib/classAttendance';
import {
  rollingWindow, splitTaught, showRateOf, paidHeadcount, paidHeadcountTotal,
  classLine, gapNote, walkInsKnown, TAUGHT_SCOPE_NOTE,
} from '../../src/lib/coachRegister';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { useNow } from '../../src/ui/today';
// ── The registers a coach can still take ──────────────────────────────────
//
// `gapNote` below already tells the coach how many classes have no register
// against them, and until now that sentence was the whole of it: the classes
// themselves were flat text further down the page, and the only control was a
// Ghost that opened the entire timetable. So a coach who agreed with the
// sentence had to remember four dates and go hunting for them.
//
// `set_class_attendance` (supabase/parts/460) carries no time bound — its only
// test is whether the class is one the caller may register — so a register
// taken on Thursday for Tuesday's class is written exactly like one taken at
// the door. The coach was simply never handed the tap. See src/lib/registerGaps.ts.
import { missingRegisters, peopleWaiting, gapsHeading, gapsNote, gapLine } from '../../src/lib/registerGaps';

/** The three windows, in days. Rolling, and the labels come from the module so
 *  the heading and the query cannot disagree about which one is on screen. */
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/** A class's own start, in the coach's zone — they are the reader. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

/** A rate as a whole percentage, or a dash. Never a zero standing in for a rate
 *  that has no denominator — `showRateOf` returns null for that and this keeps
 *  it null all the way to the glyph. */
function pct(v: number | null): string {
  return v == null ? fig(null) : `${Math.round(v * 100)}%`;
}

export default function MyRegister() {
  const t = useTheme();
  const router = useRouter();

  const [range, setRange] = useState<Range>(30);
  // Null is "not known yet", NOT "no classes". The empty-state sentence on this
  // screen is a claim about a coach's own term and it is made from `[]` under
  // 'ready' and from nothing else — the same separation
  // app/(owner)/class-analytics.tsx had to be taught.
  const [rows, setRows] = useState<ClassSummaryRow[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);

  /* ── the window moves with the clock, and it did not ──────────────────
   *
   * This was `rollingWindow(new Date(), range)` memoised on `[range, tick]`.
   * An empty dependency on the date fixes both bounds at the moment of the
   * MOUNT, and this screen is registered `href: null` in
   * app/(trainer)/_layout.tsx — mounted once, never torn down, and with no
   * focus effect anywhere on it. There was nothing at all that could move the
   * window except changing the chip or pulling the list down.
   *
   * So a coach who opened Your Register on Monday and came back on Thursday
   * was reading Monday's thirty days under a chip that says "30 days". The two
   * classes they taught on Tuesday and Wednesday were outside the query, and
   * the sentence at the bottom of this screen — "No classes are recorded
   * against you in this window" — was drawn from a window that had quietly
   * stopped being the last thirty days. On a register screen, the reading a
   * coach takes from that is that the door ticks did not save.
   *
   * `useNow` (src/ui/today.ts) moves on the three moments this can go stale:
   * local midnight, the app coming back to the foreground, and the screen
   * being focused. The third is the one that matters most here — the register
   * is often written at the door on another handset, which is exactly what
   * this screen's own header says it exists to check — and it also gives the
   * screen the focus re-read it never had.
   */
  const now = useNow();
  const window = useMemo(() => rollingWindow(now, range), [now, range, tick]);

  useEffect(() => {
    let cancelled = false;
    if (!window) { setStatus('error'); return; }
    setStatus('loading');
    // Cleared first. Without it the previous window's classes stay on screen
    // under the new window's heading while the read is in flight, which reads
    // as a quarter's worth of teaching having happened in a week.
    setRows(null);
    classSummary(window.fromISO, window.toISO)
      .then((res) => {
        if (cancelled) return;
        if (res == null) {
          // `classSummary` returns null for a refusal and [] for a quiet range.
          // Those are the two answers this screen must never render alike.
          setRows(null); setStatus('error'); return;
        }
        setRows(res); setStatus('ready');
      })
      .catch(() => { if (!cancelled) { setRows(null); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [window]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  // The one read on this screen, through the nonce the effect already
  // watches. A register is written at the door by whoever taught the class,
  // often on another handset, so this is a coach asking whether their own
  // teaching has been recorded yet.
  const pull = usePullToRefresh(reload);

  const split = useMemo(() => splitTaught(rows ?? []), [rows]);
  // The rate is over the classes that HAVE a register and nothing else. This is
  // the whole point of the split — see rule 1 in src/lib/coachRegister.ts.
  const rates = useMemo(() => summariseClassRows(split.registered), [split]);
  const headcount = useMemo(() => paidHeadcountTotal(rows ?? []), [rows]);
  const walkKnown = useMemo(() => walkInsKnown(rows ?? []), [rows]);
  const gap = useMemo(() => gapNote(split, walkKnown), [split, walkKnown]);
  // Only a whole read may be counted. `classSummary` has no partial state — the
  // RPC either answers or does not — so this is 'ready' and nothing else.
  const countable = status === 'ready' && rows != null;

  // The same classes `gapNote` counts, in the order they can still be acted on.
  // Built from `rows` rather than from `split` so the module owns the whole
  // rule — two functions disagreeing about which classes are missing a register
  // is how a screen comes to say "4" in a sentence and list three.
  //
  // Only over a whole read. Under 'error' or a null read this list would be
  // empty, and an empty list here reads as "you have taken every register",
  // which is a claim about a coach's own term made from a read that did not
  // happen — the exact mistake `countable` exists on this screen to prevent.
  const gaps = useMemo(() => (countable ? missingRegisters(rows ?? [], now) : []), [countable, rows, now]);

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    minHeight: MIN_TARGET, justifyContent: 'center' as const,
    backgroundColor: on ? t.brand : t.surface2,
  });

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your classes</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Your Register</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          What the registers you took actually say. These are the same figures your gym reads off
          your check-ins, in front of the person who took them.
        </Text>

        <Section>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            {RANGES.map((d) => (
              <Pressable key={d} onPress={() => setRange(d)}
                accessibilityRole="button" accessibilityState={{ selected: range === d }}
                accessibilityLabel={`The last ${d} days`} style={chip(range === d)}>
                <Text style={{ ...ty.micro, color: range === d ? t.brandInk : t.ink2 }}>{`${d} days`}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not read" title="Your classes could not be read"
              note="Nothing is listed below because the read did not come back. This is not a term in which you taught nothing.">
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={reload} /></View>
            </Notice>
          </Section>
        ) : null}

        <Rule />

        {/* ── the figures, over the classes that can support them ─────────── */}
        <Section>
          <SectionHead title="What your register says" note={window?.label} />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your classes…</Text>
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.xl, marginTop: sp.sm }}>
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Classes</Text>
                  <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                    {countable ? num(rows.length) : fig(null)}
                  </Text>
                </View>
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Of booked, here</Text>
                  <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                    {countable ? pct(rates.show) : fig(null)}
                  </Text>
                </View>
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>People marked in</Text>
                  <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                    {countable && headcount != null ? num(headcount) : fig(null)}
                  </Text>
                </View>
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Off the waitlist</Text>
                  <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                    {countable && rates.waitlistAttended != null ? num(rates.waitlistAttended) : fig(null)}
                  </Text>
                </View>
              </View>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {countable
                  ? `“Of booked, here” is the people who held a place and were marked present, over the people who held a place — and nothing else is folded into it. Walk-ins are the column beside it, and they are in “People marked in” because that is the headcount a gym pays a per-person class on.`
                  : 'No figures while the read is incomplete. A rate over part of a term is a number about classes that may not be yours.'}
              </Text>

              {countable && gap ? (
                <View style={{ marginTop: sp.md }}>
                  <Notice tone={t.warn} kicker="Gaps" title="Some of this is not in the figures above" note={gap} />
                </View>
              ) : null}
            </>
          )}
        </Section>

        <Rule />

        {/* ── the registers that are still open, and the tap that closes one ──
          *
          * Drawn only when there is one. A coach who has taken every register
          * gets no section at all rather than an empty box congratulating them
          * — `gapsHeading` returns null for that and the absence is the message.
          *
          * Every row here opens THAT class's check-in, with its own title and
          * branch, which is the whole point: the sentence in the Gaps notice
          * above has counted these classes for as long as this screen has
          * existed and offered nothing to do about them, so the coach had to
          * hold four dates in their head and go looking for them on the
          * timetable.
          *
          * The tap is live rather than decorative. `set_class_attendance` has
          * no time bound (supabase/parts/460) and `class_attendance_summary`
          * admits a class on `gc.trainer_id = auth.uid()`, so every class that
          * can appear on this screen is one this coach may register. */}
        {countable && gaps.length ? (() => {
          // Read once. `gapsHeading` cannot be null inside this branch — the
          // branch is its own condition — and the `??` is what says so without
          // a non-null assertion.
          const heading = gapsHeading(gaps) ?? '';
          const waiting = peopleWaiting(gaps);
          return (
          <>
            <Section>
              <SectionHead title={heading} note={waiting != null ? `${num(waiting)} booked` : undefined} />
              <Text style={{ ...ty.label, color: t.ink3 }}>{gapsNote(gaps)}</Text>
              {gaps.map((g, i) => (
                <Pressable key={g.classId}
                  onPress={() => router.push({
                    pathname: '/(trainer)/class-checkin',
                    params: { id: g.classId, title: g.title, branch: g.branch },
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={`Take the register for ${g.title}, ${whenLabel(g.startsAt)}. ${gapLine(g)}`}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: sp.md,
                    paddingVertical: sp.md, minHeight: MIN_TARGET,
                    borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                  }}>
                  {/* A 6pt mark, not coloured words. The sentence beside it
                      carries the meaning on its own — a status hue as text ink
                      does not clear 4.5:1 on the light palettes. */}
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>
                      {whenLabel(g.startsAt)}{g.branch ? ` · ${g.branch}` : ''}
                    </Text>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{g.title}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{gapLine(g)}</Text>
                  </View>
                  <Text style={{ ...ty.label, color: t.brand }}>Take it</Text>
                </Pressable>
              ))}
            </Section>

            <Rule />
          </>
          );
        })() : null}

        {/* ── the classes themselves ──────────────────────────────────────── */}
        <Section>
          <SectionHead title="Class by class" note={countable && rows.length ? num(rows.length) : undefined} />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your classes…</Text>
          ) : !countable ? null : rows.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No classes are recorded against you in this window. If you taught one, it was either set
              up without your name on it or you were covering — see the note at the bottom.
            </Text>
          ) : (
            rows.map((c, i) => {
              const rate = showRateOf(c);
              const paid = paidHeadcount(c);
              const unregistered = c.attended === 0 && (c.waitlistAttended ?? 0) === 0 && c.booked > 0;
              return (
                <View key={c.classId} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View accessible accessibilityRole="text"
                    accessibilityLabel={`${whenLabel(c.startsAt)}. ${c.title}. ${classLine(c)}`}>
                    <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>
                      {whenLabel(c.startsAt)}{c.branch ? ` · ${c.branch}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: 3 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{c.title}</Text>
                      {/* A dash on an unregistered class, never a nought. The
                          rate has no numerator anybody recorded. */}
                      <Text style={{ ...ty.body, ...numeric, color: unregistered ? t.ink3 : t.ink }}>
                        {unregistered ? fig(null) : pct(rate)}
                      </Text>
                    </View>
                    {/* The colour is a 6pt MARK and the words carry the meaning
                        on their own — a status hue as text ink does not clear
                        the 4.5:1 that words need on the light palettes. */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm, marginTop: 4 }}>
                      {unregistered ? (
                        <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 5, backgroundColor: t.warn }} />
                      ) : null}
                      <Text style={{ ...ty.caption, color: unregistered ? t.ink2 : t.ink3, flex: 1 }}>
                        {classLine(c)}
                      </Text>
                    </View>
                    {paid != null ? (
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                        {`${paid} marked in altogether`}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{TAUGHT_SCOPE_NOTE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            There are no amounts on this page. What your gym pays you to teach is set on their side,
            in their currency, and a figure worked out here from a rate nobody told this app would be
            money nobody agreed.
          </Text>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Take a Register" onPress={() => router.push('/(trainer)/classes')} />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
