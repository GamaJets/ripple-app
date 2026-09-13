// "Month End" — the verdict an owner could only get at a desk.
//
// ── What it draws ──────────────────────────────────────────────────────────
//
// The month that has just ended at the gym, whether it has been signed off,
// and — if it has not — the list of things in the way, in `closeBlockers`' own
// words. Nothing here is re-derived: the sentences are the ones the console's
// /close prints, computed by the same `buildClose` over the same five reads, so
// the phone and the console cannot tell an owner two different stories about
// one month.
//
// ── What it deliberately cannot do ────────────────────────────────────────
//
// Close the month. There is no button and its absence is stated rather than
// left to be discovered: `CLOSE_IS_NOT_A_PHONE_ACT` is printed under every
// state. A close writes the permanent snapshot every later drift line is
// measured against and then LOCKS the month — supabase/parts/182 refuses a
// payment, an invoice or a cost dated inside a closed month, for everybody,
// until an owner reopens it with a written reason. That is not a thing to do
// with a thumb on a train, and the console is where the whole sheet is.
//
// ── The three sentences this card must never print ────────────────────────
//
//   · "This month can be closed", off reads that have not all landed. The
//     verdict is 'unknown' there and the card says so.
//   · "This month is still open", off a `gym_month_closes` read that failed. An
//     owner who believes that closes a month that is already closed, and the
//     unique index answers with an error nobody can act on.
//   · "Nothing is outstanding", over a payroll figure priced without the
//     per-coach rates. That is a wrong number rather than a missing one, and
//     `ratesUnread` is what turns it into a sentence.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, Flag, Ghost, Notice } from './kit';
import { sp, hairline, type as ty } from '../theme/scale';
import { gymDateTimeText } from '../lib/gymWhen';
import {
  closeHeadNote, CLOSE_IS_NOT_A_PHONE_ACT, CLOSE_FIGURES_UNREAD_NOTE,
  FILING_UNKNOWN_NOTE, DRIFT_IS_NOT_AN_ERROR,
} from '../lib/ownerClose';
import type { OwnerMonthClose } from './gymMonthClose';

/** One line of prose in a hairline-separated list — a blocker, or a figure that
 *  has moved. The dot carries the tone; the words carry the meaning, so a
 *  status hue never has to clear 4.5:1 as text ink. */
function Line({ mark, text, first }: { mark: string; text: string; first: boolean }) {
  const t = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-start', gap: sp.md,
      paddingVertical: sp.md,
      borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: mark }} />
      <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{text}</Text>
    </View>
  );
}

/**
 * The month-end verdict, read-only.
 *
 * Takes the whole hook result: 'loading' and 'error' are different sentences
 * and neither of them entitles this card to describe a month.
 */
export function MonthCloseCard({ close }: { close: OwnerMonthClose }) {
  const t = useTheme();
  const { view, status, basisNote, zone, ratesUnread, policy } = close;

  if (view.kind !== 'month') {
    return (
      <Section>
        <SectionHead title="Month End" />
        {status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3 }}>Working out which month has just ended…</Text>
        ) : view.kind === 'no_gym' ? (
          <Text style={{ ...ty.label, color: t.ink3 }}>{view.note}</Text>
        ) : (
          <Notice tone={t.warn} kicker="Month end" title="Your gym could not be read" note={view.note}>
            <View style={{ marginTop: sp.md }}>
              <Ghost label="Try Again" onPress={close.refresh}
                a11yLabel="Work out whether the month can be closed again" />
            </View>
          </Notice>
        )}
      </Section>
    );
  }

  const filing = view.filing;
  const filedAt = filing.state === 'filed' ? gymDateTimeText(filing.at, zone) : null;

  return (
    <Section>
      <SectionHead title="Month End" note={closeHeadNote(view) ?? undefined} />
      <Text style={{ ...ty.body, color: t.ink, marginBottom: sp.sm }}>{view.headline}</Text>
      {/* Whose calendar cut the month. With no zone on the gym this is the
          phone's, and saying so is the bargain src/lib/gymWhen.ts asks of every
          screen that uses its text-only forms. */}
      {basisNote ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{basisNote}</Text>
      ) : null}

      {/* A part that could not be read at all, named with what the month
          therefore cannot say. Above everything else, because a figure computed
          over it is not a figure. */}
      {view.warning ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{view.warning}</Flag> : null}

      {filing.state === 'unknown' ? (
        <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{FILING_UNKNOWN_NOTE}</Flag>
      ) : null}

      {filing.state === 'filed' ? (
        <View style={{ marginBottom: sp.md }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            {filedAt
              ? (filing.by ? `Signed off ${filedAt} by ${filing.by}.` : `Signed off ${filedAt}.`)
              : (filing.by ? `Signed off by ${filing.by}.` : 'Signed off.')}
            {filing.note ? ` “${filing.note}”` : ''}
          </Text>
          {/* What it was filed OVER, verbatim. A close taken over a stated
              problem is a decision somebody made, and this is the half that
              makes it readable as one in March. */}
          {filing.blockersAtClose ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
              Filed with this outstanding: {filing.blockersAtClose}
            </Text>
          ) : null}
        </View>
      ) : null}

      {filing.state === 'filed' && filing.drift.length ? (<>
        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>MOVED SINCE IT WAS FILED</Text>
        {filing.drift.map((d, i) => <Line key={d} mark={t.warn} text={d} first={i === 0} />)}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{DRIFT_IS_NOT_AN_ERROR}</Text>
      </>) : null}

      {view.verdict === 'unknown' ? (
        <Flag tone={t.warn}>{CLOSE_FIGURES_UNREAD_NOTE}</Flag>
      ) : view.blockers.length ? (<>
        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
          {filing.state === 'filed' ? 'OUTSTANDING TODAY' : 'IN THE WAY'}
        </Text>
        {view.blockers.map((b, i) => (
          <Line key={`${b.kind}-${i}`} mark={t.warn} text={b.text} first={i === 0} />
        ))}
      </>) : null}

      {/* The two caveats that make the payroll half of the verdict honest.
          Neither stops the month reading as it reads; both change what the
          figure under it MEANS, so neither may be silent. */}
      {view.verdict !== 'unknown' && ratesUnread ? (
        <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
          Your coaches’ own pay rates could not be read, so every session in this month’s payroll is priced at
          the gym’s standard fee — smaller than the truth for anybody on a rate of their own.
        </Flag>
      ) : null}
      {/* The floor, and WHICH of the two silences put it there. A gym that has
          not decided and a gym whose row could not be read both leave this
          month counted on delivered sessions alone, and telling the second one
          it has not decided is a claim about work its owner may have done. */}
      {view.verdict !== 'unknown' && policy.kind === 'unset' ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          Your gym has not said what it pays for beyond delivered sessions, so this month was counted on
          delivered sessions alone. That is the floor rather than your decision — no-shows and late
          cancellations are not in the payroll figure. It is set on the console, and Ops shows what is stored.
        </Text>
      ) : null}
      {view.verdict !== 'unknown' && policy.kind === 'unread' ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          What your gym pays for beyond delivered sessions could not be read, so this month was counted on
          delivered sessions alone. That is not a statement that none is set — if your gym pays for no-shows or
          late cancellations, the payroll figure behind this verdict is smaller than the truth.
        </Text>
      ) : null}

      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{CLOSE_IS_NOT_A_PHONE_ACT}</Text>
      <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
        <Ghost label="Read Again" onPress={close.refresh}
          a11yLabel={`Work out the ${view.monthLabel} close again`} />
      </View>
    </Section>
  );
}
