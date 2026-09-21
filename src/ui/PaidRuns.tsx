// "What You Have Been Paid" — the section an employed coach did not have.
//
// ── What it draws, and the three things it refuses to ─────────────────────
//
// Each `payroll_settlements` row the coach's gym has closed for them: the
// period it covered, the amount that was handed over, the currency that amount
// is in, and whether it was later taken back. Tapping one opens the lines
// behind it — the class-pay lines, the sessions the run stamped, and the
// adjustments, each labelled by kind so a reimbursement never reads as pay.
//
// It refuses, in order of how badly each would go wrong:
//
//   1. To draw an EMPTY LIST for a coach with no gym. Seven coaches are live on
//      this product and each is alone in their own tenant; no gym anywhere has
//      run a pay cycle. So the overwhelmingly common render is the one where
//      there is no employer, and an empty list under a heading about being paid
//      says, silently, "your gym has paid you nothing". `paidView` answers
//      'no_gym' from the tenant link before it looks at a single row and this
//      section prints the sentence.
//   2. To state ANYTHING over a read that did not land. A failed read gets
//      `SETTLEMENTS_UNREAD_NOTE`, which says in as many words that it is not a
//      claim about their pay. A truncated one gets `PartialRead` and its rows,
//      and no figure at all — `paidView`'s 'prefix' kind carries no totals, so
//      the mistake is unavailable rather than merely discouraged.
//   3. To ADD TWO CURRENCIES. One pot per money, `MIXED_CURRENCY_NOTE`
//      underneath when there is more than one, and never a sum across them.
//
// ── Why this is a component and not a block inside money.tsx ──────────────
//
// app/(trainer)/money.tsx is the screen that owns "what comes in and what goes
// out", and this belongs there: gym payroll is the one strand of a coach's
// income that Repple neither takes nor sees. It is a file of eleven reads and
// eleven hundred lines already, and the section has its own reads, its own four
// statuses and its own open/closed state. Keeping it here is what stops the
// screen growing a twelfth read into the same `Promise.all` and a fifth kind of
// status into the same object.
//
// Deliberately NOT folded into either of that screen's two ledgers. A
// settlement is money a gym says it handed over; the Coming In ledger is money
// Repple watched a client pay. Adding them would produce a figure that is two
// different kinds of fact, and `SETTLED_IS_NOT_RECEIVED` says on the page that
// this app has no idea whether the payroll money arrived.
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { Rule, Section, SectionHead, Flag, Ghost, PartialRead } from './kit';
import { sp, type as ty, numeric } from '../theme/scale';
import { MIN_TARGET } from '../lib/a11y';
import { num } from '../lib/format';
import { minorMoney } from '../lib/coachMoney';
import { MIXED_CURRENCY_NOTE } from '../lib/sumCurrency';
import { ADJUSTMENT_LABEL } from '../lib/gymPay';
import {
  isReversed, periodLabel, settledEmptyLine, runSplit, splitNote,
  adjustmentsFor, classLinesFor, sessionLinesFor, classLineWorking, lineTally,
  REVERSED_IS_NOT_DELETED, SNAPSHOT_IS_THE_RECORD, SETTLED_IS_NOT_RECEIVED,
  type Settlement,
} from '../lib/coachSettlements';
import type { MySettlements } from './coachSettlements';
import type { LoadStatus } from './loadStatus';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** An amount with its own currency on it, or the sentence for one that has
 *  neither. Never a bare figure: "6,300.00" beside a payroll heading is read in
 *  whatever money the reader happens to be thinking in. */
function amount(centsValue: number | null, currency: string | null): string {
  return minorMoney(centsValue, currency) ?? 'not denominated';
}

/** One label-and-figure line, which is the shape every row in this section
 *  takes. `numeric` gives tabular figures so a column of amounts lines up. */
function Line({ label, note, value, dim }: {
  label: string; note?: string | null; value: string; dim?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, paddingVertical: 3 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.label, color: dim ? t.ink3 : t.ink2 }}>{label}</Text>
        {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text> : null}
      </View>
      <Text style={{ ...ty.label, ...numeric, color: dim ? t.ink3 : t.ink2 }}>{value}</Text>
    </View>
  );
}

/**
 * What a detail read says when it did not land.
 *
 * Its own component because there are three of these and they must not be
 * collapsed into the settlement's status: a refused `gym_class_pay` read must
 * not take down the list of runs, which is the answer to the bigger question.
 * A coach who can see what they were paid but not what it was made of is far
 * better off than one who sees neither.
 */
function DetailGap({ status, what, onPress }: { status: LoadStatus; what: string; onPress: () => void }) {
  if (status === 'error') {
    return (
      <Flag>
        The {what} behind this run could not be read. That is not a statement that there are none. The
        amount above is unaffected and is what your gym recorded paying you.
      </Flag>
    );
  }
  if (status === 'partial') return <PartialRead what={what} onPress={onPress} />;
  return null;
}

/** The lines behind one run: the split, the adjustments, the classes and the
 *  sessions. Nothing here recomputes the settlement — see
 *  `SNAPSHOT_IS_THE_RECORD`, which is printed at the foot of it. */
function RunDetail({ run, paid }: { run: Settlement; paid: MySettlements }) {
  const t = useTheme();
  const split = runSplit(run);
  const adj = adjustmentsFor(run.id, paid.adjustments.rows);
  const classes = classLinesFor(run.id, paid.classLines.rows);
  const sessions = sessionLinesFor(run.id, paid.sessions.rows);
  const classTally = lineTally(classes);

  return (
    <View style={{ paddingStart: sp.md, paddingBottom: sp.md, gap: sp.sm }}>
      {/* ── pay and reimbursement, which are not the same money ───────────
          Part 482 put this split on the settlement precisely so it could not be
          lost, and the coach could see neither half. A NULL is the run not
          saying and is never rendered as a reimbursement of nought. */}
      <View>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>What It Was Made Of</Text>
        {split.kind === 'stated' ? (
          <View>
            <Line label="Pay" value={amount(split.payCents, split.currency)} />
            <Line label="Reimbursement" value={amount(split.reimbursementCents, split.currency)} />
          </View>
        ) : null}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{splitNote(split)}</Text>
      </View>

      {/* ── the adjustments, each by kind and with the reason on it ───────── */}
      <View>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>Adjustments</Text>
        <DetailGap status={paid.adjustments.status} what="adjustments" onPress={paid.refresh} />
        {paid.adjustments.status === 'ready' && !adj.length ? (
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Nothing was added to or taken off this run.
          </Text>
        ) : null}
        {adj.map((a) => (
          <Line
            key={a.id}
            label={ADJUSTMENT_LABEL[a.kind]}
            /* The note is REQUIRED by the database — `btrim(note) <> ''` — for
               exactly this moment: it is what the coach reads when they want to
               know what a figure was for. */
            note={a.note}
            value={amount(a.amountCents, a.currency)}
          />
        ))}
      </View>

      {/* ── the classes that made it ──────────────────────────────────────── */}
      <View>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>Classes Taught</Text>
        <DetailGap status={paid.classLines.status} what="class pay lines" onPress={paid.refresh} />
        {paid.classLines.status === 'ready' && !classes.length ? (
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            No class teaching was paid on this run.
          </Text>
        ) : null}
        {classes.map((l) => (
          <Line
            key={l.id}
            label={l.attendees != null
              ? `${num(l.attendees)} ${plural(l.attendees, 'person', 'people')} on the register`
              : 'One class'}
            note={classLineWorking(l, minorMoney(l.rateCents, l.currency))}
            value={amount(l.amountCents, l.currency)}
          />
        ))}
        {classTally.cents != null && classes.length > 1 ? (
          <Line label="These Lines Add Up To" value={amount(classTally.cents, classTally.currency)} dim />
        ) : null}
        {classTally.currencies.length > 1 ? (
          <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>{MIXED_CURRENCY_NOTE}</Flag>
        ) : null}
        {classTally.unpriced ? (
          <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
            {num(classTally.unpriced)} {plural(classTally.unpriced, 'line carries no readable amount, so it is', 'lines carry no readable amount, so they are')} in no figure here.
          </Flag>
        ) : null}
      </View>

      {/* ── and the sessions ──────────────────────────────────────────────── */}
      <View>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>Sessions</Text>
        <DetailGap status={paid.sessions.status} what="sessions" onPress={paid.refresh} />
        {/* The COUNT comes off the run itself, never off the rows below it.
            `sessions_count` was snapshotted when the run closed; the rows are
            whatever this app can see today, and a session unstamped since is
            one the list would silently be short of. */}
        {run.sessionsCount != null ? (
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            This run recorded {num(run.sessionsCount)} {plural(run.sessionsCount, 'session', 'sessions')}.
          </Text>
        ) : null}
        {sessions.slice(0, 8).map((s) => (
          <Line
            key={s.id}
            label={s.status ? s.status : 'Outcome not recorded'}
            value={s.rateCents == null ? 'unpriced' : amount(s.rateCents, s.currency)}
          />
        ))}
        {sessions.length > 8 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
            The first {num(8)} are listed. The count above is the run’s own.
          </Text>
        ) : null}
      </View>

      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{SNAPSHOT_IS_THE_RECORD}</Text>
    </View>
  );
}

/**
 * The section.
 *
 * `paid` is passed in rather than read here so app/(trainer)/money.tsx can fire
 * its refresh from the same pull-to-refresh that reloads the rest of the
 * screen. A section that quietly kept its own stale copy through a pull is
 * worse than one that cannot be refreshed at all: the gesture reports success
 * and the figures under it are from before it.
 */
export function PaidRuns({ paid }: { paid: MySettlements }) {
  const t = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const v = paid.view;

  const rows: Settlement[] = v.kind === 'paid' ? v.rows : v.kind === 'prefix' ? v.rows : [];

  return (
    <Section>
      <SectionHead title="What You Have Been Paid" note="Payroll Your Gym Has Closed for You" />

      {/* The three answers that are not a list. `settledEmptyLine` picks which
          — and the one that matters is 'no_gym', which is what nearly every
          coach on this product sees and must never be an empty list. */}
      {v.kind === 'no_gym' || v.kind === 'unread' || v.kind === 'none' ? (
        <Flag tone={v.kind === 'unread' ? t.crit : t.ink3}>{settledEmptyLine(v)}</Flag>
      ) : null}
      {v.kind === 'unread' ? (
        <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={paid.refresh} /></View>
      ) : null}

      {v.kind === 'prefix' ? <PartialRead what="payroll runs" shown={v.rows.length} onPress={paid.refresh} /> : null}

      {/* One pot per currency, and nothing anywhere that adds two of them. */}
      {v.kind === 'paid' && v.pots.length ? (
        <View style={{ marginBottom: sp.md }}>
          {v.pots.map((p) => (
            <Line
              key={p.currency}
              label={`${num(p.count)} ${plural(p.count, 'run', 'runs')} in ${p.currency}`}
              value={amount(p.minorUnits, p.currency)}
            />
          ))}
          {v.pots.length > 1 ? (
            <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>{MIXED_CURRENCY_NOTE}</Flag>
          ) : null}
        </View>
      ) : null}

      {v.kind === 'paid' && v.reversed ? (
        <Flag tone={t.ink3} style={{ marginBottom: sp.sm }}>
          {num(v.reversed)} {plural(v.reversed, 'run was', 'runs were')} taken back and {plural(v.reversed, 'is', 'are')} in no figure above. {REVERSED_IS_NOT_DELETED}
        </Flag>
      ) : null}
      {v.kind === 'paid' && v.undenominated ? (
        <Flag tone={t.ink3} style={{ marginBottom: sp.sm }}>
          {num(v.undenominated)} {plural(v.undenominated, 'run carries no readable amount or currency, so it is', 'runs carry no readable amount or currency, so they are')} in no figure above rather than counted as nothing.
        </Flag>
      ) : null}

      {rows.map((s) => {
        const period = periodLabel(s);
        const reversedRun = isReversed(s);
        const money = amount(s.amountCents, s.currency);
        const isOpen = open === s.id;
        return (
          <View key={s.id}>
            <Rule />
            <Pressable
              onPress={() => setOpen(isOpen ? null : s.id)}
              accessibilityRole="button"
              /* Spoken as one statement. A screen reader meeting a period, an
                 amount and the word "reversed" as three separate nodes has to
                 hold them together itself, and the reversal is the half that
                 changes what the amount means. */
              accessibilityLabel={[
                period ? `Payroll run, ${period}` : 'Payroll run, period not recorded',
                money,
                reversedRun ? 'Taken back by your gym' : null,
                isOpen ? 'Showing what it was made of' : 'Show what it was made of',
              ].filter(Boolean).join('. ')}
              accessibilityState={{ expanded: isOpen }}
              style={{ minHeight: MIN_TARGET, justifyContent: 'center', paddingVertical: sp.sm }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.label, color: t.ink }} numberOfLines={1}>
                    {period ? period : 'Period not recorded'}
                  </Text>
                  {reversedRun ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {/* The reason is REQUIRED by `payroll_settlements_reverse_has_why`,
                          so a reversal a coach can see always says why. */}
                      Taken back{s.reverseReason ? `: ${s.reverseReason}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={{
                  ...ty.label, ...numeric, color: reversedRun ? t.ink3 : t.ink,
                  textDecorationLine: reversedRun ? 'line-through' : 'none',
                }}>
                  {money}
                </Text>
              </View>
            </Pressable>
            {isOpen ? <RunDetail run={s} paid={paid} /> : null}
          </View>
        );
      })}

      {v.kind !== 'no_gym' ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{SETTLED_IS_NOT_RECEIVED}</Text>
      ) : null}
    </Section>
  );
}
