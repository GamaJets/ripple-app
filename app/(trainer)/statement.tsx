// Coach · Statement of Record. What this app recorded in a period the coach
// picked, and a file they can hand to an accountant.
//
// ── Why it is not called a tax export ──────────────────────────────────────
//
// The roadmap line was "payout scheduling and tax export". A tax export is the
// most dangerous thing this screen could be: tax treatment turns on the coach's
// country, their registration status, where their client is and what was sold,
// none of which this app knows or asks — so any tax figure it produced would be
// invented, under somebody's name, about their own income. supabase/parts/138
// settled that principle for a coach's invoice and this holds the identical
// line. What a coach at the end of a year actually needs, and what this gives
// them, is a statement of what this app recorded, labelled as exactly that, to
// hand over beside the Stripe records.
//
// ── The payouts that DID happen, and the schedule that still cannot ────────
//
// This note used to read "no `payout.*` event reaches this app, and no column
// anywhere could hold a payout date, amount, fee or arrival". Part 194 mirrors
// `payout.paid`, `payout.failed`, `payout.updated` and `payout.canceled` into
// `coach_payouts`, so both halves of the one reconciliation an accountant
// performs — sales against bank receipts — are now in this database, and the
// document carried only the first of them. What Stripe says ARRIVED is a
// section of its own, counted on the day it reached the bank.
//
// Two things are still refused and always will be. A SCHEDULE: knowing four
// payouts happened says nothing about when the fifth will be sent, and a
// rendered timetable would be a promise about when somebody's rent money lands.
// A SUBTRACTION: a payout is a balance, not the proceeds of a sale, so "taken
// 4,800, received 4,281, fees 519" is three numbers about three different sets
// of transactions. The section says both, on the page.
//
// ── The three states of an empty screen ────────────────────────────────────
//
// Under 'ready' with nothing, the coach recorded nothing in that period, and
// that is a real and useful answer — every money table in this database is
// empty today, so it is the answer nearly every coach gets. Under 'error' the
// read failed, and telling a self-employed person they took nothing because a
// query was refused is the worst thing this screen could do. Under 'partial'
// the record is bigger than one read. All three are drawn differently and no
// figure is stated under the last two.
//
// Nothing here decides what the statement says: src/lib/coachStatement.ts is
// pure and tested, and the reads are in src/ui/coachStatement.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useBrand } from '../../src/ui/brand';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { shareDoc, shareTextFile, pdfExportAvailable, fileShareBlocker } from '../../src/lib/exportShare';
import {
  coachStatement, statementDoc, statementCsv, statementItemsCsv, statementFileStem,
  statementShareBlurb, periodSentence, fiscalYear, fiscalQuarter, customRange,
  isCalendarStart, CALENDAR_YEAR_START, YEAR_START_IS_YOURS,
  STATEMENT_NOT, STATEMENT_NOT_THE_WHOLE_BOOK, STATEMENT_STRIPE_IS_THE_RECORD, PERIOD_IS_YOURS,
  type Statement, type StatementInput, type StatementPeriod, type YearStart,
} from '../../src/lib/coachStatement';
import { fetchStatementInput } from '../../src/ui/coachStatement';

/**
 * A whole year, one quarter of it, or two dates the coach types.
 *
 * This was 'year' | 1 | 2 | 3 | 4 over CALENDAR years only, with the comment
 * "deliberately no fiscal or split year: this app does not know which one
 * applies to the person reading it". That reasoning was right about the APP
 * choosing and wrong about the COACH choosing. A UK coach's tax year starts on
 * 6 April, an Australian's on 1 July; for both of them a January-to-December
 * statement is unusable and they re-aggregate it by hand, which is the whole
 * job this screen exists to do.
 *
 * So the year still starts where the coach says it starts and NOWHERE ELSE.
 * Nothing here reads a locale, a region, a currency or a timezone to guess it —
 * every one of those is a proxy, and being wrong about somebody's tax year on a
 * document they hand to an accountant is the kind of wrong that is not noticed
 * until it matters. `YEAR_START_IS_YOURS` says so on the page.
 */
type Span = 'year' | 1 | 2 | 3 | 4 | 'custom';

const SPANS: { key: Span; label: string }[] = [
  { key: 'year', label: 'Whole Year' },
  { key: 1, label: 'Q1' },
  { key: 2, label: 'Q2' },
  { key: 3, label: 'Q3' },
  { key: 4, label: 'Q4' },
  { key: 'custom', label: 'Any Dates' },
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Where the coach's own year start is kept.
 *
 * On the DEVICE, and that is a deliberate limit rather than an oversight. It is
 * a display preference: nothing on any artefact this screen produces depends on
 * it being the same on a second phone, because every document, every CSV and
 * every filename spells the period out in full at the top. A coach who picks 6
 * April on one phone and reads the same statement on another gets a
 * January-to-December period there, clearly labelled as one, rather than a
 * document that quietly disagrees with the first.
 *
 * The alternative was a column, and a column would make it a fact about the
 * coach's tax affairs that this app stores and could be read as having
 * verified. It has not verified it and cannot.
 */
const YEAR_START_KEY = 'repple.coach.statementYearStart';

export default function StatementOfRecord() {
  const t = useTheme();
  const router = useRouter();
  const { appName } = useBrand();

  // The three most recent calendar years, from the device's own clock. A coach
  // doing last year's paperwork in January is the whole point of this screen.
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];

  const [year, setYear] = useState(thisYear);
  const [span, setSpan] = useState<Span>('year');
  const [start, setStart] = useState<YearStart>(CALENDAR_YEAR_START);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [input, setInput] = useState<StatementInput | null>(null);
  const [busy, setBusy] = useState(false);

  // Read once on mount, and a value that will not parse is ignored rather than
  // half-applied: a stored `{ month: 4 }` with no day would otherwise produce a
  // year starting on the first of April for a coach whose starts on the sixth,
  // which is a whole statement for the wrong five days at each end.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(YEAR_START_KEY);
        if (!raw || !live) return;
        const v = JSON.parse(raw) as Partial<YearStart>;
        if (Number.isFinite(v?.month) && Number.isFinite(v?.day)) {
          setStart({ month: Number(v.month), day: Number(v.day) });
        }
      } catch { /* a preference that cannot be read is the calendar year, which is stated on the page either way */ }
    })();
    return () => { live = false; };
  }, []);

  const chooseStart = useCallback((next: YearStart) => {
    setStart(next);
    // Failing to persist a display preference changes nothing about the
    // document, so it is swallowed rather than reported: the period is printed
    // in full on everything this screen produces.
    void AsyncStorage.setItem(YEAR_START_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  /**
   * The period, or the fallback when the coach has typed half a custom range.
   *
   * `customRange` returns null for anything that is not two readable dates in
   * order, and this falls back to the coach's own year rather than to an
   * invented range — a statement built over a period nobody asked for, headed
   * with dates nobody chose, has no cue on the page that would give it away.
   * `rangeProblem` below is what says so out loud.
   */
  const period: StatementPeriod = useMemo(() => {
    if (span === 'custom') return customRange(fromText.trim(), toText.trim()) ?? fiscalYear(year, start);
    return span === 'year' ? fiscalYear(year, start) : fiscalQuarter(year, span, start);
  }, [year, span, start, fromText, toText]);

  const rangeProblem = span === 'custom' && !customRange(fromText.trim(), toText.trim())
    ? 'Type both dates as YYYY-MM-DD, with the earlier one first. Until they read as a period, the figures below are for your own year and the heading says which.'
    : null;

  /* The period whose figures are allowed to land.
   *
   * `fetchStatementInput` is a dozen paged reads, so the answers do not come back
   * in the order the taps went out — and a coach comparing quarters taps
   * straight down the pill row. With `setInput` unconditional, tapping Q1 and
   * then Q2 and having Q1 resolve second put Q1's takings, sessions and
   * invoices on screen under a pill reading Q2, at full confidence, with
   * `statement.complete` true. Everything downstream of `input` is derived, so
   * the whole page agreed with itself while being about the wrong three months.
   * This is somebody's tax paperwork; there is no cue on the page that would
   * have given it away.
   *
   * A ref rather than a cleanup flag because the period is what identifies the
   * answer, and a `useFocusEffect` re-entered on focus needs the current one,
   * not one captured per run. The exports were never affected — they read the
   * same settled `statement` — so the lie was only ever on screen. */
  const wanted = useRef<string | null>(null);
  const load = useCallback(async () => {
    // Keyed on what the coach actually chose rather than on the period's label,
    // which is a display string and not the screen's identity for the period.
    // Everything that identifies the period, not just the two pills. This was
    // `${year}:${span}`, which was the whole identity when a year could only be
    // a calendar year — a coach who changed their year start, or typed a second
    // custom range while the first was still reading, would have had the older
    // answer land under the newer heading at full confidence.
    const key = `${year}:${String(span)}:${start.month}-${start.day}:${period.from}:${period.to}`;
    wanted.current = key;
    setInput(null);
    const next = await fetchStatementInput(period, appName || null);
    // The coach has moved to another quarter while this one was reading. Drop
    // it: the read for the period now selected is the one that may set state.
    if (wanted.current !== key) return;
    setInput(next);
  }, [period, appName, year, span, start]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // One read, and it is the whole statement: `fetchStatementInput` composes
  // the period in one call, which is what keeps every figure on the page from
  // the same moment. The year-start preference is not re-read — it lives on
  // this handset and this screen is the only thing that writes it, so there is
  // no other copy for a refresh to go and find.
  const pull = usePullToRefresh(load);

  const statement: Statement | null = useMemo(() => (input ? coachStatement(input) : null), [input]);

  // Only when EVERY read landed whole. A "nothing here" reassurance drawn over
  // a refused read is the one sentence this screen must never say to a
  // self-employed person about their own year.
  const nothingRecorded = !!statement && statement.complete && statement.sections.every((s) => s.count === 0);

  const share = async () => {
    if (!statement || busy) return;
    setBusy(true);
    const doc = statementDoc(statement);
    setBusy(false);
    Alert.alert(
      'Send this statement',
      statementShareBlurb(statement) + '\n\n'
      + (pdfExportAvailable()
        ? 'It goes as a PDF through your phone’s share sheet.'
        : 'This build cannot produce a PDF, so it goes as plain text instead. Nothing is left out of it: every line and every caveat is in the text.'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => { void shareDoc(doc.html, doc.text, `Statement of record — ${period.label}`); } },
      ],
    );
  };

  const shareCsv = async (items: boolean) => {
    if (!statement || busy) return;
    setBusy(true);
    const text = items
      // Every row-bearing part of the record, not two of them. The file used to
      // carry invoices and fees only, so an accountant working line by line saw
      // every document the coach issued and no refund, no chargeback and no
      // cost — the three that make the figures beside them untrue.
      ? statementItemsCsv(statement, {
        invoices: input?.invoices.rows ?? [],
        fees: input?.lateCancellations.rows ?? [],
        refunds: input?.refunds.rows ?? [],
        disputes: input?.disputes.rows ?? [],
        costs: input?.costs.rows ?? [],
      })
      : statementCsv(statement);
    const name = `${statementFileStem(statement)}${items ? '-line-items' : ''}.csv`;
    setBusy(false);
    const blocker = fileShareBlocker();
    Alert.alert(
      items ? 'Send the line items' : 'Send the summary file',
      statementShareBlurb(statement) + (blocker ? '\n\n' + blocker : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => { void shareTextFile(text, name, 'text/csv', name); } },
      ],
    );
  };

  const G = layout.gutter;
  const pill = (active: boolean) => ({
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: active ? t.brand : t.surface2,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          The padding stays at 40: the field sits well above the end of this screen, and the
          inset iOS adds already gives the focused row the room it needs to rise. Padding it
          out to a keyboard's height here would only scroll into empty space. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>For your accountant</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Statement of Record</Text>
          </View>
        </View>

        <View style={{ marginTop: sp.lg }}>
          <Notice
            kicker="What this is"
            title="What this app recorded, and only that"
            note="It calculates no tax and it is not a tax document — it says so on its own face, so nobody has to take your word for what it is. Where Stripe took the payment, Stripe's own record is the one that proves it."
          />
        </View>

        <Rule />

        {/* ── the period, which the coach chooses ───────────────────────── */}
        <Section>
          <SectionHead title="Period" note={periodSentence(period)} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.sm }}>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {years.map((y) => (
                <Pressable key={y} onPress={() => setYear(y)} accessibilityRole="button"
                  accessibilityLabel={`Show ${y}`} style={pill(y === year)}>
                  <Text style={{ ...ty.label, ...numeric, color: y === year ? '#fff' : t.ink2 }}>{y}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.sm }}>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {SPANS.map((s) => (
                <Pressable key={String(s.key)} onPress={() => setSpan(s.key)} accessibilityRole="button"
                  accessibilityLabel={`Show ${s.label}`} style={pill(s.key === span)}>
                  <Text style={{ ...ty.label, color: s.key === span ? '#fff' : t.ink2 }}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* ── where the coach's year starts ─────────────────────────────
              Two controls and no inference. Nothing here reads the phone's
              region, the gym's currency or the device timezone to guess a tax
              year: every one of those is a proxy, and the coach who has moved
              country is exactly the person it would be wrong about. */}
          {span !== 'custom' ? (
            <View style={{ marginTop: sp.lg }}>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 6 }}>
                {isCalendarStart(start)
                  ? 'Your year starts on 1 January. Change it if you file to a different one.'
                  : `Your year starts on ${start.day} ${MONTH_NAMES[Math.min(11, Math.max(0, start.month - 1))]}.`}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  {MONTH_NAMES.map((m, i) => (
                    <Pressable key={m} onPress={() => chooseStart({ month: i + 1, day: start.day })}
                      accessibilityRole="button" accessibilityLabel={`Start the year in ${m}`}
                      accessibilityState={{ selected: start.month === i + 1 }}
                      style={pill(start.month === i + 1)}>
                      <Text style={{ ...ty.label, color: start.month === i + 1 ? '#fff' : t.ink2 }}>{m}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                <Text style={{ ...ty.caption, color: t.ink3 }}>Starting on day</Text>
                <TextInput
                  value={String(start.day)}
                  onChangeText={(v) => {
                    // A whole day of a month. `keyboardType` is the number pad
                    // and not the decimal one because there is no such thing as
                    // the 6.5th of April — see scripts/check-decimals.mjs for
                    // the rule and why it runs at all.
                    const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
                    chooseStart({ month: start.month, day: Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1 });
                  }}
                  keyboardType="number-pad" maxLength={2}
                  accessibilityLabel="Day of the month your year starts on"
                  style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, minWidth: 62, textAlign: 'center' }}
                />
                {!isCalendarStart(start) ? (
                  <Pressable onPress={() => chooseStart(CALENDAR_YEAR_START)} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel="Use the calendar year">
                    <Text style={{ ...ty.label, color: t.brand }}>Use the calendar year</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{YEAR_START_IS_YOURS}</Text>
            </View>
          ) : (
            <View style={{ marginTop: sp.lg }}>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 6 }}>
                Any two dates, for a period neither a calendar year nor your own year covers.
              </Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <TextInput value={fromText} onChangeText={setFromText} autoCapitalize="none" autoCorrect={false}
                  placeholder="From YYYY-MM-DD" placeholderTextColor={t.ink3} accessibilityLabel="Period start"
                  style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, flex: 1 }} />
                <TextInput value={toText} onChangeText={setToText} autoCapitalize="none" autoCorrect={false}
                  placeholder="To YYYY-MM-DD" placeholderTextColor={t.ink3} accessibilityLabel="Period end"
                  style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, flex: 1 }} />
              </View>
              {/* Never a silently corrected range. A statement built over a
                  period the coach did not ask for looks exactly like one they
                  did, and it is already in an accountant's inbox by the time
                  anybody notices. */}
              {rangeProblem ? <Flag style={{ marginTop: sp.sm }}>{rangeProblem}</Flag> : null}
            </View>
          )}

          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PERIOD_IS_YOURS}</Text>
        </Section>

        <Rule />

        {!statement ? (
          <Section>
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your record for this period…</Text>
          </Section>
        ) : (
          <>
            {/* ── what could not be read, above every figure ────────────── */}
            {!statement.complete ? (
              <>
                <Notice tone={t.crit} kicker="Not the whole picture" title="Parts of your record could not be read"
                  note="What is missing is named below. Nothing on this screen that is blank is a statement that you recorded nothing." />
                <Section>
                  {statement.caveats.map((c, i) => (
                    <Flag key={i} style={{ marginTop: sp.sm }}>{c}</Flag>
                  ))}
                </Section>
                <Rule />
              </>
            ) : null}

            {/* ── nothing recorded, and every read landed ────────────────
                Every money table in this database is empty today, so this is
                the screen almost every coach opens on. It has to be the true
                answer and a useful one — not a wall of zeros that reads like a
                broken screen, and not a reassurance that hides a failed read,
                which is why it is drawn ONLY when every read came back whole. */}
            {nothingRecorded ? (
              <>
                <Notice
                  kicker="Nothing recorded"
                  title="This Period Has Nothing In It"
                  note="Every read came back in full, so this is your record rather than a failure. This app only holds what went through it — money a client handed you in cash, sent by transfer, or paid at a gym's front desk was never here to list. You can put those on the record yourself by issuing an invoice for them, and they will be on next year's statement."
                />
                <Rule />
              </>
            ) : null}

            {statement.sections.map((sec) => (
              <View key={sec.key}>
                <Section>
                  <SectionHead title={sec.title} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Source: {sec.source}</Text>
                  {sec.withheld ? (
                    <Flag style={{ marginTop: sp.sm }}>{sec.withheld}</Flag>
                  ) : (
                    <>
                      <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, marginTop: sp.sm }}>
                        {sec.count} {sec.countLabel}
                      </Text>
                      {sec.lines.map((l) => (
                        <View key={l.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                          <Text style={{ ...ty.label, color: t.ink2 }}>{l.label}</Text>
                          <Text style={{ ...ty.label, ...numeric, color: t.ink }}>{l.amount}</Text>
                        </View>
                      ))}
                    </>
                  )}
                  {sec.notes.map((n, i) => (
                    <Text key={i} style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{n}</Text>
                  ))}
                </Section>
                <Rule />
              </View>
            ))}

            {/* ── the one combination this statement makes ──────────────── */}
            <Section>
              <SectionHead title="Packs and Renewals Together" />
              {statement.salesTotal ? (
                <>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    These two are the only figures here that may be added, and they are added one currency at a time.
                  </Text>
                  {statement.salesTotal.lines.length ? (
                    statement.salesTotal.lines.map((l) => (
                      <View key={l.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                        <Text style={{ ...ty.label, color: t.ink2 }}>{l.label}</Text>
                        <Text style={{ ...ty.body, fontWeight: '700', ...numeric, color: t.ink }}>{l.amount}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                      Nothing was recorded in either section in this period. Both reads came back in full, so this is your record and not a failure.
                    </Text>
                  )}
                  {statement.salesTotal.notes.map((n, i) => (
                    <Text key={i} style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{n}</Text>
                  ))}
                </>
              ) : (
                <Flag style={{ marginTop: sp.sm }}>{statement.salesWithheld}</Flag>
              )}
            </Section>

            <Rule />

            {/* ── payouts: what is known, and where the answer actually is ─ */}
            <Section>
              <SectionHead title={statement.payouts.title} />
              {statement.payouts.lines.map((l, i) => (
                <Text key={i} style={{ ...ty.caption, color: i === 0 ? t.ink2 : t.ink3, marginTop: sp.sm }}>{l}</Text>
              ))}
            </Section>

            <Rule />

            {/* ── what it is not, on the screen as well as on the file ──── */}
            <Section>
              <SectionHead title="What This Is Not" />
              {[STATEMENT_NOT, STATEMENT_NOT_THE_WHOLE_BOOK, STATEMENT_STRIPE_IS_THE_RECORD].map((line, i) => (
                <Text key={i} style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{line}</Text>
              ))}
            </Section>

            <View style={{ marginTop: layout.section, gap: sp.md }}>
              <Cta label="Share the Statement" wide disabled={busy} onPress={() => { void share(); }} />
              {/* Ghost rather than a toned Cta: `Cta` paints its label
                  `brandInk` whatever the tone is, so a quieter fill would put
                  the brand's on-brand ink on a surface it was never contrasted
                  against. */}
              <Ghost label="Share the Summary as CSV" onPress={() => { void shareCsv(false); }} />
              <Ghost label="Share the Line Items as CSV" onPress={() => { void shareCsv(true); }} />
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                Every one of the three says on its own face what it is, what it is not, and the exact period it covers. If a part of your record could not be read, the file names that part and its filename says INCOMPLETE.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
