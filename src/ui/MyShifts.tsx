// "Your Shifts" — the rota, on the phone of the person working it.
//
// ── What it draws ──────────────────────────────────────────────────────────
//
// The coach's own shifts for the next fortnight, grouped by the GYM's calendar
// day, each with the hours on the gym's clock, what they are on for, any note
// the gym left, and what the gym filed the shift as being worth.
//
// ── Four things it refuses to do ──────────────────────────────────────────
//
//   1. Draw an EMPTY LIST for a coach with no gym. Every coach live on this
//      product is alone in their own tenant, so the ordinary render is the one
//      with no employer, and a blank fortnight under a heading called "Your
//      Shifts" says "you are not on this week" to somebody nobody rosters.
//   2. State anything over a read that did not land. A coach who reads "no
//      shifts" over a timeout does not turn up.
//   3. ADD TWO CURRENCIES. `gym_shifts.rate_cents` carries its own currency and
//      part 196 snapshots it per shift precisely so a rate change cannot
//      re-price last month — which means a fortnight can honestly hold two.
//      One pot per money, and `PRICED_IS_NOT_PAID` under them.
//   4. Offer a control. `gym_shifts_owner` is the only policy granting anything
//      but SELECT, so a Cancel button here would match zero rows and
//      `assertWrote` would refuse it. `ROTA_READ_ONLY_NOTE` says where the rota
//      is changed instead of pretending it can be changed here.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { Rule, Section, SectionHead, Flag, Ghost, Notice } from './kit';
import { sp, hairline, type as ty, numeric } from '../theme/scale';
import { fmtDay, num, num1 } from '../lib/format';
import { minorMoney } from '../lib/coachMoney';
import {
  rotaHeadNote, SHIFT_ROLE_LABEL, ROTA_READ_ONLY_NOTE, PRICED_IS_NOT_PAID,
  PULLED_IS_NOT_GONE, type MyShift,
} from '../lib/coachRota';
import type { MyRota } from './coachRota';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * "06:00 – 10:00", or a sentence when the clock could not be read.
 *
 * Never half a range. `rotaTimeLabel` answers null for an instant it cannot
 * place, and "06:00 – " reads as a rendering fault rather than as missing data
 * — the failure src/lib/gymLink.ts's neighbours keep finding.
 */
function span(s: MyShift): string {
  if (!s.fromLabel || !s.toLabel) return 'The hours on this shift could not be read.';
  return `${s.fromLabel} – ${s.toLabel}`;
}

/** How long, or nothing at all. `num1` gives one decimal, so a three-and-a-half
 *  hour shift does not round to four on the screen somebody plans a day from. */
function hoursLabel(h: number | null): string | null {
  return h == null ? null : `${num1(h)} ${h === 1 ? 'hour' : 'hours'}`;
}

/** One shift. Not a touchable: there is nothing a coach may do to a rota row,
 *  and a control that cannot work is worse than none — see the header. */
function ShiftRow({ shift, first }: { shift: MyShift; first: boolean }) {
  const t = useTheme();
  const hrs = hoursLabel(shift.hours);
  const money = minorMoney(shift.rateCents, shift.currency);
  const role = SHIFT_ROLE_LABEL[shift.role];
  // Read once, as one sentence: a screen reader walking a rota should hear the
  // shift, not four fragments with a swipe between them.
  const spoken = [
    span(shift), role,
    shift.pulled ? 'Pulled by your gym' : null,
    hrs, money, shift.note,
  ].filter(Boolean).join('. ');

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={spoken}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: sp.md,
        paddingVertical: sp.md,
        borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring,
      }}>
      {/* A 6pt mark and not coloured words: a status hue as text ink does not
          clear 4.5:1 on the light palettes, and "Pulled" below says it in
          words anyway. */}
      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: shift.pulled ? t.warn : t.good }} />
      <View style={{ flex: 1 }}>
        <Text style={{
          ...ty.body, fontWeight: '500', ...numeric,
          color: shift.pulled ? t.ink3 : t.ink,
          textDecorationLine: shift.pulled ? 'line-through' : 'none',
        }}>
          {span(shift)}
        </Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {shift.pulled ? `Pulled · ${role}` : role}{hrs ? ` · ${hrs}` : ''}
        </Text>
        {shift.note ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{shift.note}</Text>
        ) : null}
      </View>
      {/* Withheld rather than dashed when the currency is unknown: an amount
          whose money nobody stated is not an amount, and `minorMoney` answers
          null for exactly that. */}
      {money && !shift.pulled ? (
        <Text style={{ ...ty.label, ...numeric, color: t.ink2 }}>{money}</Text>
      ) : null}
    </View>
  );
}

/**
 * What the gym has this coach down for.
 *
 * Takes the whole hook result: 'loading' and 'error' both arrive as the same
 * unread view — neither entitles anybody to say what shifts a coach has — and
 * the two want different words on screen.
 */
export function MyShifts({ rota }: { rota: MyRota }) {
  const t = useTheme();
  const { view, status } = rota;

  return (
    <Section>
      <SectionHead title="Your Shifts" note={rotaHeadNote(view) ?? undefined} />
      <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
        What your gym has you down for over the next {num(rota.windowDays)} days, from their own rota.
      </Text>

      {view.kind === 'unread' ? (
        status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3 }}>Reading your gym’s rota…</Text>
        ) : (
          <Notice tone={t.warn} kicker="Rota" title="Your shifts could not be read" note={view.note}>
            <View style={{ marginTop: sp.md }}>
              <Ghost label="Try Again" onPress={rota.refresh} a11yLabel="Read your shifts again" />
            </View>
          </Notice>
        )
      ) : null}

      {/* Not a warning. A coach who works for themselves has no gym to have a
          rota, and a red-marked banner would say something is wrong with their
          account. */}
      {view.kind === 'no_gym' || view.kind === 'none' ? (
        <Text style={{ ...ty.label, color: t.ink3 }}>{view.note}</Text>
      ) : null}

      {view.kind === 'rota' ? (
        <View>
          {view.days.map((d) => (
            <View key={d.day} style={{ marginTop: sp.md }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{fmtDay(d.day)}</Text>
              {d.shifts.map((s, i) => <ShiftRow key={s.id} shift={s} first={i === 0} />)}
            </View>
          ))}

          <Rule />

          <View style={{ marginTop: sp.md }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {num(view.live)} {plural(view.live, 'shift', 'shifts')} to work
              {/* Hours are withheld entirely when one span could not be read.
                  A total that skipped it would be smaller and would look whole
                  — see `liveHours`, which returns null rather than a subtotal. */}
              {view.hours != null ? ` · ${num1(view.hours)} ${view.hours === 1 ? 'hour' : 'hours'}` : ''}
              {view.pulled > 0 ? ` · ${num(view.pulled)} pulled` : ''}
            </Text>
            {view.hours == null ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                One of these shifts does not read as a span of time, so no hours total is offered:
                a figure that quietly left it out would be smaller than your fortnight.
              </Text>
            ) : null}
          </View>

          {/* One pot per money, and never a line adding them. */}
          {view.pots.length > 0 ? (
            <View style={{ marginTop: sp.md }}>
              {view.pots.map((p) => (
                <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.md, paddingVertical: 2 }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>
                    {num(p.shifts)} {plural(p.shifts, 'shift', 'shifts')} priced in {p.currency}
                  </Text>
                  <Text style={{ ...ty.label, ...numeric, color: t.ink2 }}>
                    {minorMoney(p.cents, p.currency) ?? p.currency}
                  </Text>
                </View>
              ))}
              {view.pots.length > 1 ? (
                <Flag tone={t.warn}>
                  These are in different currencies and are not added together. Adding two moneys would
                  need a rate this app does not hold.
                </Flag>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PRICED_IS_NOT_PAID}</Text>
            </View>
          ) : null}

          {view.unpriced > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              {num(view.unpriced)} {plural(view.unpriced, 'shift carries', 'shifts carry')} no figure. That is a shift nobody
              priced rather than a shift worth nothing. The gym fills that in on their side.
            </Text>
          ) : null}

          {view.pulled > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PULLED_IS_NOT_GONE}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Said under every view that reached a gym, including the empty one: a
          coach looking for the button should be told where the button is. */}
      {view.kind === 'rota' || view.kind === 'none' ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          {ROTA_READ_ONLY_NOTE}
          {rota.zoneKnown ? '' : ' Your gym has not set a timezone, so these days and times are read on your own clock rather than theirs.'}
        </Text>
      ) : null}
    </Section>
  );
}
