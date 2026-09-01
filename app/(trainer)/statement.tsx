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
// ── Why there is no payout schedule on it ──────────────────────────────────
//
// Because there is no data behind one. `connect_accounts` holds four columns —
// account id, charges enabled, details submitted, updated — and the
// stripe-webhook subscribes to `customer.subscription.*`, `account.updated`,
// `checkout.session.completed` and `invoice.*`. No `payout.*` event reaches
// this app, and no column anywhere could hold a payout date, amount, fee or
// arrival. A rendered timetable would be a promise about when somebody's rent
// money lands. The Payouts section says what is actually known and says where
// the real answer is.
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
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useBrand } from '../../src/ui/brand';
import { shareDoc, shareTextFile, pdfExportAvailable, fileShareBlocker } from '../../src/lib/exportShare';
import {
  coachStatement, statementDoc, statementCsv, statementItemsCsv, statementFileStem,
  statementShareBlurb, periodSentence, calendarYear, calendarQuarter,
  STATEMENT_NOT, STATEMENT_NOT_THE_WHOLE_BOOK, STATEMENT_STRIPE_IS_THE_RECORD, PERIOD_IS_YOURS,
  type Statement, type StatementInput, type StatementPeriod,
} from '../../src/lib/coachStatement';
import { fetchStatementInput } from '../../src/ui/coachStatement';

/** Whole year, or one calendar quarter of it. Deliberately no fiscal or split
 *  year: this app does not know which one applies to the person reading it. */
type Span = 'year' | 1 | 2 | 3 | 4;

const SPANS: { key: Span; label: string }[] = [
  { key: 'year', label: 'Whole Year' },
  { key: 1, label: 'Q1' },
  { key: 2, label: 'Q2' },
  { key: 3, label: 'Q3' },
  { key: 4, label: 'Q4' },
];

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
  const [input, setInput] = useState<StatementInput | null>(null);
  const [busy, setBusy] = useState(false);

  const period: StatementPeriod = useMemo(
    () => (span === 'year' ? calendarYear(year) : calendarQuarter(year, span)),
    [year, span],
  );

  const load = useCallback(async () => {
    setInput(null);
    setInput(await fetchStatementInput(period, appName || null));
  }, [period, appName]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const statement: Statement | null = useMemo(() => (input ? coachStatement(input) : null), [input]);

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
      ? statementItemsCsv(statement, input?.invoices.rows ?? [], input?.lateCancellations.rows ?? [])
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
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
