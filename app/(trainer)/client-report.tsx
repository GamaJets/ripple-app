// Coach · Client report. The document a coach hands over at the end of a block.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// A CLIENT can produce a handover document about themselves (the Share button
// on their scans screen, src/lib/clientReport.ts). A COACH could produce
// nothing about a client at all — which is the thing a working coach actually
// sends: at twelve weeks, when somebody moves city, when a client asks "what
// did we actually do?", or when they go to another coach and that coach asks
// what has already been tried.
//
// The four screens next door (client-body, client-training, client-goals,
// client-week) let a coach READ all of this and get none of it off the phone.
// So the end of a block produced either nothing, or a message typed from
// memory — which is the worst version of this document, because it is the one
// where the figures are recalled rather than read.
//
// ── Nothing here decides what the document says ────────────────────────────
//
// src/lib/coachClientReport.ts builds it, is pure, and is asserted against
// under plain node — including a scan for judgement words. This file does five
// reads, hands each one its OWN LoadStatus, collects what the coach wants to
// write, and draws.
//
// ── FIVE READS, FIVE STATUSES, AND THAT IS THE POINT ───────────────────────
//
// Sessions, training, scans, tape measurements and the client's own row each
// fail independently. A document assembled from a failed injuries read that
// prints an empty Injuries table has told the next coach this person has
// disclosed nothing — the single most dangerous false statement this app can
// make. So each read is passed with its own status and the builder prints the
// failure where the table would have been, and again at the top.
//
// ── The coach's own words are the only opinion on the page ─────────────────
//
// And they are printed under a heading naming their author, quoted, disclaimed
// as an opinion. Everything the module writes is a figure, a date, or a
// statement about what could not be read: no rating, no percentage, no
// attendance rate, no clinical word. See the header of the builder.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { useBrand } from '../../src/ui/brand';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { isQueryableId } from '../../src/lib/clientDrift';
import { isoToday } from '../../src/lib/dayPlan';
import { worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import { rowToEntry, type WorkoutRow } from '../../src/lib/workoutRow';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { sessionsOf, trainingBoard, unitFor } from '../../src/lib/clientTraining';
import { MEASURE_SITES } from '../../src/lib/clientMeasurements';
import { areaLabel, type Injury } from '../../src/lib/injuries';
import { shareDoc, pdfExportAvailable } from '../../src/lib/exportShare';
import { fetchInvoiceIssuer } from '../../src/ui/coachInvoices';
import {
  coachClientReportDoc, coachReportShareBlurb, sessionTally,
  type CoachSessionRow, type ReportScan, type ReportMeasureEntry, type ReportInjury,
} from '../../src/lib/coachClientReport';

// Written out here rather than imported from a shared constant:
// scripts/check-schema.mjs resolves a select list that arrives as a named
// constant only within the file that names it, so a shared one is a select list
// nothing compares against the SQL or the live database. Every other screen in
// this group declares its own for the same reason.
const SESSION_COLS = 'starts_at, outcome';
const WORKOUT_COLS = 'id, performed_at, exercise, sets, feel, cardio, kcal, session_mins, logged_by, amended_at';
const SCAN_COLS = 'taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg, source';
const MEAS_COLS = 'taken_at, kind, value';
const CLIENT_COLS = 'injuries, weight_unit, length_unit';

/** A numeric column as a number, never as a zero standing in for an absence.
 *  Postgres `numeric` reaches supabase-js as a number or a string depending on
 *  the driver path, and `Number(null)` is 0 — a client with a zero-kilogram
 *  body. Same guard as clientMeasurements.ts and clientGoals.tsx. */
const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const COLS = MEASURE_SITES.map((s) => ({ key: String(s.key), label: s.label }));

interface Reads {
  sessions: { rows: CoachSessionRow[] | null; status: LoadStatus };
  training: { log: WorkoutEntry[] | null; status: LoadStatus };
  scans: { rows: ReportScan[]; status: LoadStatus };
  measures: { rows: ReportMeasureEntry[]; status: LoadStatus };
  client: { injuries: Injury[]; weightUnit: unknown; lengthUnit: unknown; status: LoadStatus };
}

const EMPTY: Reads = {
  sessions: { rows: null, status: 'loading' },
  training: { log: null, status: 'loading' },
  scans: { rows: [], status: 'loading' },
  measures: { rows: [], status: 'loading' },
  client: { injuries: [], weightUnit: null, lengthUnit: null, status: 'loading' },
};

export default function ClientReport() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const { appName } = useBrand();
  // The COACH's own units, as the fallback. Which one wins is decided by
  // `unitFor` below, not here — the document is handed between two people who
  // may read in different units, and the sentence explaining which is on it.
  const st = useSettings();
  const { clientId, name } = useLocalSearchParams<{ clientId?: string; name?: string }>();

  const [picked, setPicked] = useState<string | null>(clientId ?? null);
  const [reads, setReads] = useState<Reads>(EMPTY);
  const [issuer, setIssuer] = useState<{ name: string | null; status: LoadStatus }>({ name: null, status: 'loading' });
  const [note, setNote] = useState('');
  const [today, setToday] = useState<string>(() => isoToday(new Date()));

  // The client whose reads are allowed to reach the screen. Tapping through a
  // book starts a read per tap and they do not come back in order, so without
  // this a slow answer for the first person can land under the name of the
  // second — one client's body attributed to another, on a document that gets
  // sent. Same guard as client-body.tsx and client-training.tsx.
  const wanted = useRef<string | null>(null);

  useEffect(() => { void (async () => { setIssuer(await fetchInvoiceIssuer()); })(); }, []);

  const load = useCallback(async (id: string) => {
    wanted.current = id;
    setReads(EMPTY);
    setToday(isoToday(new Date()));

    // A client the coach typed in by hand has a `coach_clients` row and no user
    // account, so their id is not a uuid and Postgres refuses the whole
    // statement rather than skipping the value. Nothing is asked for them, and
    // every section is 'error' — which the document prints as "not read", not
    // as "nothing on record".
    if (!isQueryableId(id)) {
      setReads({
        sessions: { rows: null, status: 'error' },
        training: { log: null, status: 'error' },
        scans: { rows: [], status: 'error' },
        measures: { rows: [], status: 'error' },
        client: { injuries: [], weightUnit: null, lengthUnit: null, status: 'error' },
      });
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;

    const [sesRes, woRes, scanRes, measRes, cliRes] = await Promise.all([
      // Scoped to this coach as well as this client. RLS already narrows it,
      // and the extra predicate is about WHICH sessions belong on the document:
      // a client who has trained with two coaches in the same gym has sessions
      // that are not this coach's to report.
      supabase.from('sessions').select(SESSION_COLS)
        .eq('trainer_id', uid ?? '00000000-0000-0000-0000-000000000000')
        .eq('client_id', id)
        .order('starts_at', { ascending: false })
        .limit(capLimit()),
      supabase.from('workouts').select(WORKOUT_COLS)
        .eq('user_id', id)
        .order('performed_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      supabase.from('scans').select(SCAN_COLS)
        .eq('client_id', id)
        .order('taken_at', { ascending: false })
        .limit(capLimit()),
      supabase.from('measurements').select(MEAS_COLS)
        .eq('user_id', id)
        .order('taken_at', { ascending: false })
        .limit(capLimit()),
      supabase.from('clients').select(CLIENT_COLS).eq('id', id).limit(1),
    ]);
    if (wanted.current !== id) return;

    const next: Reads = { ...EMPTY };

    if (sesRes.error) {
      reportError('clientReport.sessions', sesRes.error);
      next.sessions = { rows: null, status: 'error' };
    } else {
      const page = capped((sesRes.data ?? []) as unknown as { starts_at: string; outcome: string | null }[]);
      next.sessions = {
        rows: page.rows.map((s) => ({ startsAt: s.starts_at, outcome: s.outcome ?? null })),
        status: page.truncated ? 'partial' : 'ready',
      };
    }

    if (woRes.error) {
      reportError('clientReport.workouts', woRes.error);
      next.training = { log: null, status: 'error' };
    } else {
      const page = capped((woRes.data ?? []) as unknown as WorkoutRow[]);
      next.training = { log: page.rows.map(rowToEntry), status: page.truncated ? 'partial' : 'ready' };
    }

    if (scanRes.error) {
      reportError('clientReport.scans', scanRes.error);
      next.scans = { rows: [], status: 'error' };
    } else {
      const page = capped((scanRes.data ?? []) as unknown as {
        taken_at: string; weight_kg: number | string | null; body_fat_pct: number | string | null;
        skeletal_muscle_kg: number | string | null; source: string | null;
      }[]);
      next.scans = {
        rows: page.rows.map((s) => ({
          takenAt: s.taken_at,
          weightKg: num(s.weight_kg),
          bodyFatPct: num(s.body_fat_pct),
          // Nullable on purpose: a bathroom scale reports weight and body fat
          // and no muscle at all, and reading it as 0 charts a whole body's
          // worth of muscle lost overnight.
          muscleKg: num(s.skeletal_muscle_kg),
          source: s.source ?? null,
        })),
        status: page.truncated ? 'partial' : 'ready',
      };
    }

    if (measRes.error) {
      reportError('clientReport.measurements', measRes.error);
      next.measures = { rows: [], status: 'error' };
    } else {
      // `measurements` is one row per site per day. The document wants one row
      // per day with a column per site, so they are pivoted here — a site not
      // measured that day is simply absent and prints as a dash, never a zero.
      const page = capped((measRes.data ?? []) as unknown as { taken_at: string; kind: string; value: number | string | null }[]);
      const byDay = new Map<string, Record<string, number | null>>();
      for (const row of page.rows) {
        const day = String(row.taken_at ?? '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const v = num(row.value);
        if (v == null) continue;
        const bucket = byDay.get(day) ?? {};
        bucket[row.kind] = v;
        byDay.set(day, bucket);
      }
      next.measures = {
        rows: [...byDay.entries()].map(([at, values]) => ({ at, values })),
        status: page.truncated ? 'partial' : 'ready',
      };
    }

    if (cliRes.error) {
      reportError('clientReport.client', cliRes.error);
      next.client = { injuries: [], weightUnit: null, lengthUnit: null, status: 'error' };
    } else {
      // No row is a real answer, not a failure: a client added by hand has no
      // `clients` row to carry a preference or a disclosure.
      const rows = (cliRes.data ?? []) as { injuries?: unknown; weight_unit?: unknown; length_unit?: unknown }[];
      const raw = rows[0]?.injuries;
      next.client = {
        injuries: Array.isArray(raw) ? (raw as Injury[]) : [],
        weightUnit: rows[0]?.weight_unit ?? null,
        lengthUnit: rows[0]?.length_unit ?? null,
        status: 'ready',
      };
    }

    setReads(next);
  }, []);

  useFocusEffect(useCallback(() => {
    if (!USE_SUPABASE || !picked) return;
    void load(picked);
  }, [picked, load]));

  useEffect(() => {
    if (!USE_SUPABASE || picked) return;
    wanted.current = null;
    setReads(EMPTY);
  }, [picked]);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const fullName = client?.name || (typeof name === 'string' ? name : '') || '';
  const who = (fullName || 'They').split(' ')[0];

  // Whose unit these figures print in, and the sentence saying so. Decided by
  // the module the coach's other screens already use, so this document and
  // those screens cannot disagree about whose pounds these are.
  const pick = useMemo(
    () => unitFor(reads.client.weightUnit, st.weightUnit, reads.client.status, who),
    [reads.client.weightUnit, reads.client.status, st.weightUnit, who],
  );
  // The tape unit follows the same rule but has no `unitFor` of its own: the
  // client's stored preference when the row was read, otherwise the coach's.
  const lengthUnit = reads.client.status === 'ready' && (reads.client.lengthUnit === 'in' || reads.client.lengthUnit === 'cm')
    ? reads.client.lengthUnit
    : st.lengthUnit;

  const board = useMemo(
    () => trainingBoard(reads.training.status === 'error' ? null : (reads.training.log ? sessionsOf(reads.training.log) : null), reads.training.status),
    [reads.training.log, reads.training.status],
  );

  const injuries: ReportInjury[] = useMemo(
    () => reads.client.injuries.map((i) => ({
      // Labelled here so the document names an area exactly as the client's own
      // Injuries screen names it.
      label: areaLabel(i.area),
      severity: i.severity,
      status: i.status,
      note: i.note ?? null,
      at: i.at,
    })),
    [reads.client.injuries],
  );

  const build = () => coachClientReportDoc({
    clientName: fullName,
    coachName: issuer.name,
    coachStatus: issuer.status,
    brand: appName,
    generatedOn: today,
    weightUnit: pick.unit,
    lengthUnit,
    unitNote: pick.note,
    sessions: { status: reads.sessions.status, items: reads.sessions.rows },
    training: {
      status: reads.training.status,
      items: {
        state: board.state,
        dayCount: board.dayCount,
        entryCount: board.entryCount,
        sets: board.sets,
        volumeKg: board.volumeKg,
        newestDay: board.newestDay,
        days: board.days,
        // Sessions whose timestamp will not parse belong to no day. Their sets
        // and load ARE in the totals and cannot be in the table, so the count
        // is passed and the document says so — otherwise the two disagree with
        // no explanation.
        undatedCount: board.undated.length,
      },
    },
    composition: { status: reads.scans.status, items: reads.scans.rows },
    measurements: { status: reads.measures.status, items: reads.measures.rows },
    measureColumns: COLS,
    // The injuries ride on the client-row read, which is what carries them.
    injuries: { status: reads.client.status, items: injuries },
    coachNote: note.trim() || null,
  });

  const send = () => {
    if (!picked) return;
    const doc = build();
    Alert.alert(
      'Send this record',
      coachReportShareBlurb(doc, fullName) + '\n\n'
      + (pdfExportAvailable()
        ? 'It goes as a PDF through your phone’s share sheet, so it can reach them, or the coach taking them on, however you choose.'
        : 'This build cannot produce a PDF, so it goes as plain text instead. Nothing is left out of it: every figure and every caveat is in the text.'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => { void shareDoc(doc.html, doc.text, 'Coaching record'); } },
      ],
    );
  };

  const overall = worstStatus(
    reads.sessions.status, reads.training.status, reads.scans.status,
    reads.measures.status, reads.client.status, issuer.status,
  );
  const tally = sessionTally(reads.sessions.rows, reads.sessions.status);
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{fullName || 'Pick a client'}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Their record</Text>
          </View>
        </View>

        <View style={{ marginTop: sp.lg }}>
          <Notice
            kicker="What this is"
            title="Everything on record, on one page"
            note="Sessions, logged training, scans, tape measurements and anything they have disclosed. It carries no rating, no percentage and no assessment — only what was entered, and by whom. Anything that could not be read says so on the page."
          />
        </View>

        {!picked ? (
          <Section>
            <SectionHead title="Who is it for?" />
            {r.status === 'error' ? (
              <Flag>Your client list could not be read, so this is not a list of everyone you coach.</Flag>
            ) : null}
            {r.roster.map((c) => (
              <Pressable key={c.id} onPress={() => setPicked(c.id)} accessibilityRole="button" accessibilityLabel={c.name}
                style={{ paddingVertical: sp.md, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                <Text style={{ ...ty.body, color: t.ink }}>{c.name}</Text>
              </Pressable>
            ))}
            {!r.roster.length && r.status === 'ready' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>You have nobody on your book yet.</Text>
            ) : null}
          </Section>
        ) : (
          <>
            <Rule />

            <Section>
              <SectionHead title="What will be on it" note={`Printed in ${pick.unit} and ${lengthUnit}`} />
              <Row t={t} label="Sessions booked with you"
                value={reads.sessions.status === 'error' ? 'not read'
                  : reads.sessions.status === 'loading' ? '…'
                  : tally.booked == null ? 'more than could be read'
                  : String(tally.booked)} />
              <Row t={t} label="Of those, with no outcome recorded"
                value={reads.sessions.status === 'error' ? 'not read'
                  : reads.sessions.status === 'loading' ? '…'
                  : tally.unrecorded == null ? '—' : String(tally.unrecorded)} />
              <Row t={t} label="Days trained"
                value={reads.training.status === 'error' ? 'not read'
                  : reads.training.status === 'loading' ? '…'
                  : board.dayCount == null ? '—' : String(board.dayCount)} />
              <Row t={t} label="Body-composition scans"
                value={reads.scans.status === 'error' ? 'not read'
                  : reads.scans.status === 'loading' ? '…' : String(reads.scans.rows.length)} />
              <Row t={t} label="Days with tape measurements"
                value={reads.measures.status === 'error' ? 'not read'
                  : reads.measures.status === 'loading' ? '…' : String(reads.measures.rows.length)} />
              <Row t={t} label="Injuries they have disclosed"
                value={reads.client.status === 'error' ? 'not read'
                  : reads.client.status === 'loading' ? '…' : String(injuries.length)} />
              {tally.unrecorded != null && tally.unrecorded > 0 ? (
                <Flag style={{ marginTop: sp.sm }}>
                  A session with no outcome recorded is one nobody marked either way. The document counts those separately and does not treat them as missed — and it states no attendance percentage, because a percentage over them would not measure anything.
                </Flag>
              ) : null}
              {overall === 'error' ? (
                <Flag style={{ marginTop: sp.sm }}>
                  Part of this could not be read. The document will say so on its own front page rather than looking complete — but you may prefer to open this again in a moment.
                </Flag>
              ) : null}
              {overall === 'partial' ? (
                <Flag style={{ marginTop: sp.sm }}>
                  There is more on record than came back in one read. What goes on the document is real; it is not all of it, and the document says so and states no totals for that section.
                </Flag>
              ) : null}
            </Section>

            <Rule />

            <Section>
              <SectionHead title="Anything you want to say" note="Optional. Printed in your own words, attributed to you." />
              <TextInput value={note} onChangeText={setNote} multiline
                placeholder={`Twelve weeks with ${who}. What you would want the next coach to know.`}
                placeholderTextColor={t.ink3}
                accessibilityLabel="Your own note for the report"
                style={[inp, { minHeight: 110, textAlignVertical: 'top' }]} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                This is the only opinion on the page. Everything else is a figure, a date, or a line saying something could not be read — the document states that outright, so nothing you write is mistaken for the app’s own verdict.
              </Text>
            </Section>

            <View style={{ marginTop: layout.section, flexDirection: 'row', gap: sp.md }}>
              <View style={{ flex: 1 }}>
                <Cta label="Someone Else" tone={t.surface2} wide onPress={() => { setPicked(null); setNote(''); }} />
              </View>
              <View style={{ flex: 1 }}>
                <Cta label="Send It" wide disabled={overall === 'loading'} onPress={send} />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One "what will be on it" line. A value that could not be read says so in
 *  words rather than showing a zero — a zero here is a claim. */
function Row({ t, label, value }: { t: ReturnType<typeof useTheme>; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 }}>
      <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{label}</Text>
      {/* "not read" says it in words; crit goes in the dot beside it. crit as
          label text is 3.03–4.05:1 on every one of the ten palettes. */}
      {value === 'not read' ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit, marginRight: 6 }} /> : null}
      <Text style={{ ...ty.label, color: value === 'not read' ? t.ink2 : t.ink }}>{value}</Text>
    </View>
  );
}
