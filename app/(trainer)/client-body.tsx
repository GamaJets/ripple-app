// Coach · Body composition. What one client's InBody scans say, over time.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// "When a client does an InBody scan and this information is inputted into the
// client's app, the information should be pushed to the coach's app and the
// client's information is updated in the coach's app so the coach can see the
// trends."
//
// The permission was never the gap. `scans_trainer_read` has granted a coach
// SELECT on their own clients' scans since the first schema file. What was
// missing was a reader: the only coach-side query against `scans` lives in
// client-goals.tsx, and it exists to work out how far along a goal is — a start
// value, a current value, a percentage. No history, no body-fat or muscle
// series, and no sense of when anything was measured. So a client could stand
// on an InBody every month for a year and their coach could see one percentage
// off it, on a screen that is about something else.
//
// A trend is what was asked for. A single latest number is what already existed.
//
// ── Nothing here works anything out ────────────────────────────────────────
//
// Every series, sentence, date and conversion comes from src/lib/clientBody.ts,
// which is pure and tested (src/lib/clientBody.test.ts). This file reads four
// columns and a client row, decides which of four things is true, and draws it.
//
// ── The three metrics do not share a date ──────────────────────────────────
//
// `scans.skeletal_muscle_kg` is nullable — a bathroom scale gives weight and
// body fat and no muscle figure at all — and a scan that did not measure muscle
// contributes NO point to the muscle series. That was a real bug, fixed
// yesterday: read as `?? 0`, the missing figure was charted as a real point and
// differenced against the scan before it, and a dashboard showed a whole body's
// worth of muscle lost overnight.
//
// The consequence for this screen is that the newest muscle reading can be much
// older than the newest weight reading, so every metric carries its OWN date and
// its own age. A single screen-level "last scanned" over all three would report
// a four-month-old muscle figure as three days old, which is the same trap the
// tape sites hit on client-goals.tsx.
//
// ── Typed figures are not machine readings ─────────────────────────────────
//
// `clients.manual_weight_kg` and `manual_body_fat_pct` are what a client without
// an InBody types about themselves, and their own app reads them in preference
// to the newest scan while `manual_at` is the more recent of the two. A coach
// has to see them — they are what is on the client's screen, and a coach quoting
// a scan at somebody whose app says something else looks like a coach who is not
// paying attention — but they are kept out of the series above and labelled as
// typed. Bathroom scales and an InBody disagree by more than most of the changes
// anybody is training for, so a change taken across the two would be reporting
// the equipment rather than the body.
//
// ── Four states, kept apart ────────────────────────────────────────────────
//
// A read that failed, a read that came back truncated, a client who has never
// been scanned, and real readings. Collapsing any two of them tells a coach
// something false about a person they are about to ring. Nothing on this screen
// is ever a zero standing in for an absence.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, Flag, Spark, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { type LoadStatus } from '../../src/ui/loadStatus';
import { isQueryableId } from '../../src/lib/clientDrift';
import { isoToday } from '../../src/lib/dayPlan';
import { plain } from '../../src/lib/units';
import {
  readBodyHistory, bodyBoard, seriesOf, movementOf, readingLine, seriesAgeLine,
  isSeriesStale, metricUnit, metricValue, readManual, manualLine, manualFigures,
  BODY_METRICS, DIRECTION_CAVEAT,
  type BodyHistory, type BodyScanRow, type ManualRow, type ManualEntry, type MetricSeries,
} from '../../src/lib/clientBody';

// `source` rides along with the three figures because "InBody (OCR)" and
// "InBody (manual)" are different amounts of trust in a reading, and a coach
// looking at an outlier is entitled to know which one they are looking at.
const SCAN_COLS = 'taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg, source';
const MANUAL_COLS = 'manual_weight_kg, manual_body_fat_pct, manual_at';

export default function ClientBody() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  // Arrives from app/(trainer)/client.tsx, so a coach who is already looking at
  // somebody lands on that person rather than on a picker. The picker is still
  // here for the same reason the other per-client screens keep theirs — the
  // screen is reachable without a param.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  // The coach's own unit, not the client's. Every figure below is stored in
  // kilograms whichever unit it was typed in (TF-37), so this changes only what
  // is printed — but printing kilograms to a coach who reads pounds is a wrong
  // number, not a stylistic choice. Body fat is a percentage in every unit
  // system and is not touched by it.
  const wu = useSettings().weightUnit;

  const [picked, setPicked] = useState<string | null>(clientId ?? null);

  // Null is "we do not know", never "there are none". The two reads carry their
  // own status because they fail independently and mean different things when
  // they do: a refused `clients` read says nothing about the scans, and a
  // refused `scans` read must not be rendered as a client who has never stood
  // on a machine.
  const [history, setHistory] = useState<BodyHistory | null>(null);
  const [scanStatus, setScanStatus] = useState<LoadStatus>('ready');
  const [manual, setManual] = useState<ManualEntry | null>(null);
  const [manualStatus, setManualStatus] = useState<LoadStatus>('ready');
  // Fixed at the moment of the read rather than recomputed on every render, so
  // a screen left open over midnight cannot quietly age a reading under the
  // coach's eyes while they are looking at it. Same as client-goals.tsx.
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));

  // The client whose reads are allowed to reach the screen. Tapping through a
  // book of clients starts a read per tap and they do not come back in order, so
  // without this a slow answer for the person tapped first can land under the
  // name of the person tapped second — one client's body attributed to another,
  // which is worse than showing nothing at all.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    wanted.current = id;
    setScanStatus('loading'); setManualStatus('loading');
    setHistory(null); setManual(null);
    const today = isoToday(new Date());

    // A client the coach typed in by hand has a `coach_clients` row and no user
    // account, so their id is not a uuid and Postgres refuses the whole
    // statement rather than skipping the value. Nothing is asked for them.
    if (!isQueryableId(id)) {
      setScanStatus('error'); setManualStatus('error');
      return;
    }

    const [scanRes, cliRes] = await Promise.all([
      // Newest first, unlike client-goals.tsx, and deliberately. Scans are
      // append-only and this screen wants the recent ones: if the cap bites, the
      // rows that fall off the end should be the oldest and least useful rather
      // than the ones describing the body that is training now. `taken_at` is a
      // DATE and nothing stops two scans sharing one, so the id settles the
      // ties — an order with ties in it is not an order, and at the cap the
      // server may break them differently on each read.
      supabase.from('scans').select(SCAN_COLS)
        .eq('client_id', id)
        .order('taken_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      // The client's own row, for the figures they typed. RLS on `clients` is
      // what limits this to a coach's own book; the filter is about which client
      // is on screen rather than about who may be seen.
      supabase.from('clients').select(MANUAL_COLS).eq('id', id).limit(1),
    ]);
    if (wanted.current !== id) return;
    setTodayISO(today);

    if (scanRes.error) {
      reportError('clientBody.scans', scanRes.error);
      setHistory(null);
      setScanStatus('error');
    } else {
      const page = capped((scanRes.data ?? []) as unknown as BodyScanRow[]);
      setHistory(readBodyHistory(page.rows));
      setScanStatus(page.truncated ? 'partial' : 'ready');
    }

    if (cliRes.error) {
      reportError('clientBody.manual', cliRes.error);
      setManual(null);
      setManualStatus('error');
    } else {
      const rows = (cliRes.data ?? []) as unknown as ManualRow[];
      // No row is a real answer here and not a failure: a client added to the
      // book by hand has no `clients` row of their own to carry typed figures.
      setManual(readManual(rows[0] ?? null));
      setManualStatus('ready');
    }
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      // Deselecting has to disown the read in flight too, or it lands on a
      // screen that is no longer showing anybody.
      wanted.current = null;
      setHistory(null); setManual(null);
      setScanStatus('ready'); setManualStatus('ready');
      return;
    }
    void load(picked);
  }, [picked, load]);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const who = client?.name.split(' ')[0] ?? 'They';

  // 'error' hands `bodyBoard` a null, which is the only way it can answer
  // 'unreadable'. Under any other status the history is the server's own answer,
  // and an empty one under 'ready' genuinely means nobody has scanned them.
  const board = useMemo(
    () => bodyBoard(scanStatus === 'error' ? null : history),
    [scanStatus, history],
  );

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /**
   * One metric: what it says now, how it has moved, and when it was measured.
   *
   * The change gets a sign and no colour. Weight falling is what one client is
   * training for and the thing another one is trying to stop, and skeletal
   * muscle falling alongside it means something different again — the record
   * does not say which, so this screen does not paint it in. The only tone on
   * the row is on the AGE, and that is a fact about the record rather than about
   * the body: a reading from four months ago is out of date whatever it says.
   */
  const metricSection = (s: MetricSeries, i: number) => {
    const unit = metricUnit(s.key, wu);
    const stale = isSeriesStale(s, todayISO);
    const readings = s.readings;
    // Converted for display one point at a time; the CHANGE beside them is
    // converted as a span inside `readingLine`, never off these two ends.
    const vals = readings.map((p) => metricValue(p.v, s.key, wu));
    const mv = movementOf(s);
    const latest = readings[readings.length - 1] ?? null;
    const min = vals.length ? Math.min(...vals) : null;
    const max = vals.length ? Math.max(...vals) : null;
    return (
      <View key={s.key}>
        {i > 0 ? <Rule /> : null}
        <Section>
          <SectionHead
            title={s.label}
            note={readings.length === 1 ? '1 reading' : `${readings.length} readings`}
          />
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            {/* A dash, never a zero. A metric nobody has measured has no
                figure, and "0 kg" is a specific and false claim about a body. */}
            <Text style={{ ...value(26), color: t.ink }}>
              {fig(latest ? plain(metricValue(latest.v, s.key, wu)) : null)}
            </Text>
            {latest ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 3 }}>{unit}</Text>
            ) : null}
          </View>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{readingLine(s, wu)}</Text>
          {/* seriesAgeLine already says how old the reading is. warn as micro
              ink is 3.87–4.08:1 on the light palettes, so it goes in the dot. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sp.xs }}>
            {stale ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
            <Text style={{ ...ty.micro, color: stale ? t.ink2 : t.ink3, flex: 1 }}>{seriesAgeLine(s, todayISO)}</Text>
          </View>
          {/* A line needs two points. One reading is drawn as the reading it is
              — a figure and a date — rather than as a trend through a single
              point, which is the thing this screen was asked to stop doing. */}
          {mv ? (
            <View style={{ marginTop: sp.md }}>
              <Spark data={vals} labels={readings.map((p) => p.atISO)} unit={` ${unit}`} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                  {plain(vals[0])} {unit}
                </Text>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                  range {plain(min as number)}–{plain(max as number)} {unit}
                </Text>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                  {plain(vals[vals.length - 1])} {unit}
                </Text>
              </View>
            </View>
          ) : null}
        </Section>
      </View>
    );
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Body Composition</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Every InBody scan a client has recorded, as three series with the date of each reading.
          You can read these; you can&rsquo;t change them — a scan is theirs to take and theirs to
          enter.
        </Text>

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Scans belong to the client and live on the server, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have never been scanned." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
              </Section>
            ) : null}

            <Section>
              <SectionHead title="Client" />
              {r.roster.length === 0 && r.status !== 'error' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  Nobody is on your book yet, so there are no scans to look at.
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {r.roster.map((c) => (
                    <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
                      accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
                      accessibilityLabel={c.name} style={chip(picked === c.id)}>
                      <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Section>

            {picked ? (
              <View>
                <Rule />

                {/* The states, kept apart. Each is a different fact about this
                    person and each starts a different conversation. */}
                {scanStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their scans…</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their scans could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has never been scanned — that is a different fact and a different conversation. If they were added to your book by hand they have no account for scans to belong to, which reads the same way from here.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their Scans'} note="never scanned" />
                    {/* "The read came back and it was empty" is only true when
                        nothing was dropped. Rows that arrived and could not be
                        used are a different story, and the flag below tells it
                        rather than letting this sentence overstate. */}
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {who} hasn&rsquo;t recorded a usable InBody scan.
                      {history && history.skipped > 0
                        ? ' Rows did come back; none of them carried a dated figure this build can read.'
                        : ' The read came back and it was empty, so this is about them rather than about the connection — which makes it worth raising.'}
                      {' '}Their own app records a scan from a photo of the sheet.
                    </Text>
                  </Section>
                ) : (
                  <>
                    <Section>
                      <SectionHead
                        title={client?.name ?? 'Their Scans'}
                        note={board.history.scans === 1 ? '1 scan' : `${board.history.scans} scans`}
                      />
                      <Text style={{ ...ty.label, color: t.ink3 }}>{DIRECTION_CAVEAT}</Text>
                    </Section>
                    {BODY_METRICS.map((m, i) => metricSection(seriesOf(board.history, m.key), i))}
                  </>
                )}

                {/* Two things the sections above cannot say for themselves. */}
                {scanStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their scans came back at the row limit, so the newest are here and the oldest
                      are not. Every change above is measured from the earliest reading that
                      arrived, which is why each one names the date it is measured from rather than
                      calling it their first scan.
                    </Flag>
                  </Section>
                ) : null}
                {history && history.skipped > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {history.skipped === 1
                        ? 'One further row is on record carrying no date, or no figure this build can read, so it is not counted or drawn above.'
                        : `${history.skipped} further rows are on record carrying no date, or no figure this build can read, so they are not counted or drawn above.`}
                    </Flag>
                  </Section>
                ) : null}

                {/* ── what they typed ───────────────────────────────────────
                    Separate from the series above, and labelled, because a
                    figure somebody typed and a figure a machine measured are
                    not the same kind of thing — and because this is what the
                    client is looking at on their own phone. */}
                <Rule />
                {manualStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their profile…</Text></Section>
                ) : manualStatus === 'error' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their profile could not be read"
                      note={`Whether ${who} has typed a weight or body fat by hand is unknown rather than no. The scans above came from a different read and are unaffected either way.`} />
                  </Section>
                ) : manual == null ? (
                  <Section>
                    <SectionHead title="Typed by Hand" note="none" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      Nothing typed. Every figure above came off a scan sheet, so there is no
                      hand-entered number sitting under the same heading as a machine reading.
                    </Text>
                  </Section>
                ) : (
                  <Section>
                    <SectionHead title="Typed by Hand" note="not a scan" />
                    {/* Which figure the client's own app is showing them is a
                        comparison against their newest scan, so it can only be
                        made once that read has landed. Under a failed or
                        in-flight scan read the figures are still shown and the
                        comparison is withheld — saying "there is no scan on
                        record" when nobody could ask would be a claim about
                        their record made out of our connection. */}
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {scanStatus === 'error' || scanStatus === 'loading'
                        ? `${manualFigures(manual, wu, who)} Their scans could not be read just now, so which of the two their own app is showing them cannot be said from here.`
                        : manualLine(manual, history?.latestScanISO ?? null, wu, who)}
                    </Text>
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                      Deliberately not a point on any line above. A set of bathroom scales and an
                      InBody disagree by more than most of what anybody is training for, so a change
                      measured across the two would be reporting the equipment rather than the body.
                    </Text>
                  </Section>
                )}
              </View>
            ) : null}
          </>
        )}

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Body fat is a percentage and reads the same in every unit system. Weight and skeletal
          muscle are stored in kilograms and shown in the unit you set on your own Settings screen;
          every change is converted once, as a span, so the same movement cannot report two
          different figures on two different months.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
