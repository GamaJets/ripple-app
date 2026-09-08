// Client · Progress — InBody body composition: the latest scan, the metrics it
// carries, the weight trend and progress photos. The full add-scan flow
// (camera/upload + OCR + date wheel + manual entry + history) lives in a bottom
// sheet, unchanged.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: body fat is the
// screen's one hero figure, the three bordered stat boxes became a hairline
// KpiRow, six stacked cards became hairline-separated sections with a single
// card spent on the thing you can act on, and the Georgia serif header is gone.
//
// Also removed: the three fake progress-photo frames labelled "Week 1 /
// Progress / Now" that pretended to be photos the client had taken.
//
// PROGRESS PHOTOS ARE NOW REAL. They used to live in `useState` — no upload,
// no bucket, no row — so they were gone the moment this screen unmounted, and
// the header could only honestly say "N on screen". Every photo now goes to
// the private `photos` bucket under the member's own uid and gets a row in
// `progress_photos`; the list is read back oldest-first with signed URLs. See
// src/lib/progressPhotos.ts for the layout and the delete rules, and
// supabase/parts/45-progress-photos.sql for the policies behind them.
//
// The label reads "N saved" now, and it is true. The three states it can be in
// — not loaded, loaded and empty, loaded with photos — each render differently
// on purpose: a screen that shows "no photos yet" while it is still asking is
// telling somebody their history is gone.
//
// TF-37: this screen both reads and WRITES weights, and did neither in the
// client's unit. The three-box entry sheet said "Weight kg" and "Muscle kg" and
// put whatever was typed straight into the scan row, so a client transcribing a
// report in pounds recorded a body twice their own — and this row is the one the
// meal plan re-tunes from, so the error left immediately in their calorie
// target. Entry now converts, the boxes say which unit they want, the OCR fills
// them in that unit, and every figure printed back — including the "your stats
// updated" message — reads in it too. Body fat stays a percentage throughout.
//
// One table is deliberately NOT converted; see the note above the
// metric-by-metric section further down.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, Pressable, Image, TextInput, ScrollView, Modal, Alert, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import * as ImageManipulator from 'expo-image-manipulator';
// The queue a scan typed with no signal now goes into, and the sentence for a
// device that could not even keep it. See src/lib/outbox.ts for which writes
// are allowed to wait and why this one is.
import { useOutbox } from '../../src/ui/outbox';
// The id the scan's row carries, minted on the device. It used to be a private
// helper in this file; it is a rule about queued writes rather than about
// scans, and a typed blood sugar reading and a tape measurement need the same
// one, so it is in src/lib/outbox.ts beside the rest of them now.
import { newRowId } from '../../src/lib/outbox';
import { notKeptNote } from '../../src/lib/recordQueue';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
// Reading an InBody printout, INCLUDING which unit it was printed in. See the
// note above `ocrInBody` for the assumption this replaces.
import {
  parseInBodySheet, sheetMassKg, ASSUMED_METRIC_NOTE, CONVERTED_FROM_LB_NOTE, type SheetRead,
} from '../../src/lib/inbodySheet';
// And which unit the AI READER's figures are in, which its answer does not say.
// The vision model is asked for a field called `weightKg` and hands back a bare
// number off a sheet that may be printed in pounds; the OCR text of the same
// photograph carries the word. See src/lib/inbodyVision.ts.
import { reconcileInBodyUnit, visionMassKg, visionMetricsKg } from '../../src/lib/inbodyVision';
import { useTheme } from '../../src/ui/components';
import { useToast } from '../../src/ui/toast';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { fmtFullDay, monthNamesShort, numUpTo } from '../../src/lib/format';
import { MIN_TARGET } from '../../src/lib/a11y';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, weightToKg, weightDeltaIn, plain, convertedNote, readNumber } from '../../src/lib/units';
import { readBodyFromDevices, hasBodyFigure, type BodyRead } from '../../src/lib/wearables/body';
import { useWearables } from '../../src/ui/wearables';
import { macrosFor } from '../../src/lib/nutrition';
import { progressDoc, progressCsv, progressSummary, progressSpanLabel, shareDoc, shareText, shareTextFile, pdfExportAvailable, fileShareBlocker, type ProgressRow } from '../../src/lib/exportShare';
// Where each body figure came from, when it was measured, and how stale that
// makes it. This screen and app/(client)/body-trends.tsx were showing different
// numbers under the same word because one read the derived current body and the
// other re-derived its own from the scans alone; they now read the same series
// through the same module, and each figure says which instrument produced it.
// See the header of src/lib/bodyFigures.ts for the full account.
import { bodyReadings, latestBodyReading, measuredNote, stalenessNote, mixedSourceNote, readingsLabel, dayLabel as bodyDayLabel, agoLabel, todayISO, type BodyReading } from '../../src/lib/bodyFigures';
import { useRouter } from 'expo-router';
import { useBrand } from '../../src/ui/brand';
import { Rule, Section, SectionHead, Hero, KpiRow, ActionCard, Cta, Ghost, Spark, Field, fig, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { analyzePhysique, visionAvailable, lastVisionError, type PhysiqueVision } from '../../src/lib/vision';
// A picture of the printout goes to two named companies. The camera permission
// this screen asks for is about the hardware; these are about the destination.
import { readScanSheet, listScanSheetConsents, SCAN_SHEET_CONSENT_LIST_CAP, type SheetConsentRow } from '../../src/ui/scanSheets';
import {
  sheetSendLine,
  scanSheetRecipients, scanConsentWho, scanConsentRetention, scanScreenPromise,
  scanConsentSendA11y, SCAN_CONSENT_KICKER, SCAN_CONSENT_TITLE, SCAN_CONSENT_WHAT,
  SCAN_CONSENT_IF_YOU_DECLINE, SCAN_CONSENT_SEND_LABEL, SCAN_CONSENT_TYPE_LABEL,
  SCAN_CONSENT_CANCEL_LABEL, SCAN_CONSENT_TYPE_A11Y, SCAN_CONSENT_CANCEL_A11Y,
  SCAN_REFUSED_TITLE, SCAN_REFUSED_NOTE, SCAN_RECORD_FAILED_TITLE, SCAN_RECORD_FAILED_NOTE,
  type ScanSheetAnswer,
} from '../../src/lib/scanSheetConsent';
import { trendsByGroup, compositionInsights, type ScanMetrics } from '../../src/lib/inbodyMetrics';
import { deltaLabel, movementIsProgress } from '../../src/lib/deltaLabel';
import { focusToGroups, recommendedExercises } from '../../src/lib/focus';
import { listProgressPhotos, uploadProgressPhoto, deleteProgressPhoto, comparePair, photosNote, missingFileCount, type ProgressPhoto } from '../../src/lib/progressPhotos';
import { useGoalTracker } from '../../src/ui/goalTracker';
import { goalOfKind, goalOnBody } from '../../src/lib/goalOnBody';
import { fetchMyCoach, fetchMyShares, sharePhoto, unsharePhoto, shareStateOf, shareLabel, sharedNote, sendBlocker, revokeCaveat, type ShareGrant, type CoachRef } from '../../src/lib/photoShare';
// Publication is a SECOND permission and a separate table (supabase/parts/331).
// Sending a photo lets a coach look at it; this is the client agreeing it may
// go in something the coach posts in public, and nothing about the first
// implies the second. src/lib/photoPublish.ts holds the whole argument.
import {
  PUBLISH_IS_SEPARATE_NOTE, publishAskBody, publishAskTitle, publishBlocker,
  publishLabel, publishStateOf, withdrawPublishBody, type PublishGrant,
} from '../../src/lib/photoPublish';
import { allowPublish, fetchMyPublishGrants, withdrawPublish } from '../../src/ui/photoPublish';
import { spanLabel } from '../../src/lib/photoCompare';
// ── the handover document ─────────────────────────────────────────────────
// The third thing a client can do with their own record, alongside the report
// and the spreadsheet: hand it to a physiotherapist, a doctor or a new coach.
// Four separate reads feed it and any of them can fail on its own, so the
// builder takes each one's LoadStatus and prints the failure on the document
// rather than an empty table. src/lib/clientReport.ts sets out the three rules
// it keeps — no interpretation, no false claim of completeness, and no
// photograph or photo URL anywhere in a file that will be forwarded and kept.
import { clientReportDoc, reportShareBlurb, type ReportInjury } from '../../src/lib/clientReport';
import { useMeasurements, METRICS as MEASURE_METRICS } from '../../src/ui/measurements';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useNow } from '../../src/ui/today';
// The Progress tab is where a member looks for "what have I worked" — reported
// as exactly that. The full screen lives at /(client)/muscles; this is the
// picture that gets somebody to it, because a list row named "Your Muscles"
// among fourteen others is not a thing anybody finds.
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import { muscleWorkBoard, diagramShading } from '../../src/lib/muscleWork';
import { MuscleBody } from '../../src/ui/MuscleBody';
import { sessionsOf, trainingBoard } from '../../src/lib/clientTraining';
import { areaLabel } from '../../src/lib/injuries';
import { yearsAround } from '../../src/lib/scanYears';
import { END_ALIGN, FORWARD_ICON } from '../../src/ui/direction';

// The twelve month names, in the reader's own language, for the date WHEEL —
// which is the one shape a formatted string cannot take, and is what
// `monthNamesShort` exists for (src/lib/format.ts).
//
// This was a hardcoded English array, and `consentWhen` below was built from it
// under a comment saying `toLocaleDateString` "names a locale and is what
// scripts/check-locale.mjs refuses". That reads the gate backwards: it refuses a
// locale named as a STRING LITERAL in the first argument, and passing nothing —
// or `appLocale()`, which every helper in format.ts does — is precisely what it
// asks for. So a check written to stop English being hardcoded was being cited
// as the reason to hardcode English.
//
// Resolved once at module scope: `appLocale()` does not change while the app
// runs, and this is read per cell of a scrolling wheel.
const MONTHS = monthNamesShort();
const ITEM_H = 42, VISIBLE = 5;
const daysIn = (m: number, y: number) => new Date(y, m + 1, 0).getDate();

// The OCR key is NOT in the app. It used to be
//   const OCR_KEY = process.env.EXPO_PUBLIC_OCR_API_KEY || 'helloworld';
// which had two faults: the EXPO_PUBLIC_ prefix inlines a value into the JS
// bundle at build time, so the key shipped readable to anyone who unpacked the
// app; and it was never actually set, so every scan ever made used the literal
// fallback 'helloworld' — OCR.space's shared public demo key, globally rate
// limited to a handful of requests. That is why scanning failed at random.
//
// The read now goes through the `ocr-scan` edge function, which holds the key as
// a Supabase secret.
//
// The PARSING used to live here too, under a comment claiming that "an InBody
// sheet is printed in kilograms — so what it hands back is metric no matter
// what the boxes it is filling are labelled". The second half followed from the
// first and the first is not true: a machine configured for a US site prints
// Weight and SMM in pounds and says so on the sheet. It has moved to
// src/lib/inbodySheet.ts, which reads the unit off the printout, and where
// there is a test that a 180 lb sheet stops becoming 397.
/**
 * When a consent decision was made, for the record list.
 *
 * `decided_at` is an INSTANT, not a calendar day, so a local Date is the right
 * reading of it — unlike `scans.takenAt`, which is a bare `YYYY-MM-DD` and is
 * sliced rather than parsed for the reason given at `exportRows`.
 *
 * `fmtFullDay`, which is the shared "14 Aug 2026" — the reader's own language
 * and the reader's own order. It was assembled from a hardcoded English month
 * array on the grounds that check:locale refuses `toLocaleDateString`; see the
 * note on MONTHS above for why that is the gate read backwards. An unparseable
 * value renders as nothing rather than as "Invalid Date" — the guard below is
 * kept ahead of the formatter, because an empty cell in a record list and
 * `fmtFullDay`'s own dash mean different things here.
 */
function consentWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return fmtFullDay(iso);
}

/**
 * The id the scan's row will carry.
 *
 * `scans.id` is a uuid primary key, and choosing it on this side is what makes
 * a queued scan safe to replay: a row the server already holds comes back 23505
 * instead of being filed as a second weigh-in on the same day. See
 * src/lib/recordQueue.ts · ScanIntent, and src/lib/outbox.ts · `newRowId` for
 * the minting itself and for why it is not expo-crypto.
 *
 * Named locally because "the scan's id" is what this file is talking about
 * everywhere below.
 */
const newScanId = newRowId;

// ── The two invokes that used to live here ────────────────────────────────
//
// `ocrInBody` was a local helper that posted the whole photographed page to
// https://api.ocr.space/parse/image, and forty lines further down `pick` ran it
// in parallel with `analyzeInBody`, which posts the same page to
// https://api.anthropic.com. Two named companies, on every photograph, with
// nothing in front of them but `ensureMediaPermission('camera', 'add a scan')`
// — a question about the hardware.
//
// An InBody sheet carries the member's name, their age, the gym or clinic's
// letterhead, and their whole body composition line by line. Both calls have
// moved to src/ui/scanSheets.ts, behind `readScanSheet`, which takes the
// member's answer as a REQUIRED argument with no default and no 'unasked'
// member — so this screen cannot send a page it has not asked about without
// failing to compile. The consent row is written before either invoke and the
// send waits for it; see src/lib/scanSheetConsent.ts and
// supabase/parts/1140-*.sql.

/**
 * One scroll wheel of the scan-date picker.
 *
 * ── What a screen reader got out of this ─────────────────────────────────
 *
 * Nothing. It was a bare `ScrollView` with `snapToInterval` and
 * `onMomentumScrollEnd`: no role, no label, no value, and no path to `onChange`
 * that is not a FLING. Three of them are the only control that sets a scan's
 * date, and the date is what decides which scan re-tunes the member's calorie
 * target — this screen says so itself, four hundred lines down. So a VoiceOver
 * user could not date a scan at all, and with nothing set it silently takes
 * today.
 *
 * `accessibilityRole="adjustable"` is the RN role for exactly this shape: the
 * rotor's up/down (and a switch's increment) send `increment` and `decrement`,
 * which land on `onAccessibilityAction` and move the selection by one — the
 * same thing the fling does, through a path that does not need a fling.
 * `accessibilityValue` is what is read out after each step, so the wheel says
 * "March" rather than announcing a scroll position.
 *
 * The buttons beside it are the other half, and they are not only for screen
 * readers: a wheel is a poor target for anybody whose hands are cold, and this
 * app has eighty-four other places where the answer to "too small" was a
 * bigger target rather than a steadier finger.
 */
function Wheel({ items, index, onChange, t, label }: { items: string[]; index: number; onChange: (i: number) => void; t: Theme; label: string }) {
  const step = (by: number) => onChange(Math.max(0, Math.min(items.length - 1, index + by)));
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ ...ty.micro, color: t.ink3, textAlign: 'center', marginBottom: 2 }}>{label}</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: items[index] ?? '' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') step(1);
          else if (e.nativeEvent.actionName === 'decrement') step(-1);
        }}
        style={{ height: ITEM_H * VISIBLE }}>
        <ScrollView showsVerticalScrollIndicator={false} snapToInterval={ITEM_H} decelerationRate="fast" contentOffset={{ x: 0, y: index * ITEM_H }}
          onMomentumScrollEnd={(e) => onChange(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H))))}
          contentContainerStyle={{ paddingVertical: ITEM_H * 2 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {items.map((it, i) => (<View key={i} style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}><Text style={i === index ? { ...value(20), color: t.ink } : { ...ty.body, ...numeric, color: t.ink3 }}>{it}</Text></View>))}
        </ScrollView>
      </View>
      {/* Two full-size targets per wheel, for the same reason the heatmap on
          Consistency grew a stepper: a control nobody can hit is a control. */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.sm, marginTop: sp.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${label.toLowerCase()}`}
          onPress={() => step(-1)}
          style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: t.surface2 }}>
          <Icon name="minus" size={14} color={t.ink2} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Next ${label.toLowerCase()}`}
          onPress={() => step(1)}
          style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: t.surface2 }}>
          <Icon name="plus" size={14} color={t.ink2} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The coach's name for use INSIDE a sentence, or "Your coach" when it could
 * not be read.
 *
 * `fig()` is right for a figure slot, where a dash means "not measured" and
 * sits alone under a label. It is wrong as the subject of a sentence: with an
 * unreadable name this screen rendered
 *
 *     "— cannot see any of your photos."
 *
 * which reads as a line that lost its first word. "Your coach" is a
 * description rather than a name, so unlike the heading in `my-coach.tsx` —
 * which deliberately refuses this substitution, because there it would look
 * like somebody actually called that — it states only what is true.
 */
function coachSubject(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n || 'Your coach';
}

export default function Scans() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  // Both units, because this screen now builds a document that carries tape
  // measurements as well as body weights. NULL on `clients.weight_unit` /
  // `length_unit` means nobody has chosen — the settings provider resolves that
  // to the metric default and is the only place that decision is made, so
  // nothing here second-guesses it.
  const { weightUnit: wu, lengthUnit: lu } = useSettings();
  // Null when there is no outbox above this screen — signed out, or a build
  // with no backend. `enqueue` is then simply not offered and the refusal below
  // says nothing was kept, which is true.
  const outbox = useOutbox();
  const { appName } = useBrand();
  // ── sharing and exporting this record ──────────────────────────────────
  //
  // TF-21 asked of the button in the header: "what gets sent and in what
  // format?" It was an unlabelled share icon that produced a PDF, or produced
  // plain text instead without saying so on a build with no expo-print, and
  // there was no way to find out which except by sending it to somebody. The
  // format is now named before anything leaves the phone, and only formats
  // this build can actually produce are offered — a button reading "PDF" on a
  // device that cannot make one is the same lie in a smaller place.
  //
  // TF-25 and TF-33 asked for Instagram, WhatsApp, TikTok and the rest. Every
  // option below ends at the OS share sheet, which lists all of them plus the
  // client's coach in Messages or Mail, and stays correct as those apps change.
  const exportRows = (): ProgressRow[] => [...cd.scans]
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
    .map((sc) => ({
      // The stored calendar day, not `new Date(...).toLocaleDateString()`,
      // which resolved a bare `YYYY-MM-DD` to UTC midnight and dated every
      // scan a day early for anyone west of Greenwich. Formatting for display
      // happens inside the export, timezone-safely.
      date: String(sc.takenAt).slice(0, 10),
      weightKg: Number.isFinite(sc.weightKg) ? sc.weightKg : null,
      bodyFatPct: Number.isFinite(sc.bodyFatPct) ? sc.bodyFatPct : null,
      muscleKg: sc.skeletalMuscleKg,
    }));

  // The report and the summary are read by a person, so they go out in the
  // client's own unit (TF-37) — a pounds reader was sending a coach, or a
  // story, a metric document about their own body. The CSV is parsed by a
  // machine and deliberately stays in kilograms; src/lib/progressExport.ts
  // argues that at PROGRESS_CSV_HEADER, and the dialog below says so before
  // anybody sends one.
  const sendPdf = async () => { const rows = exportRows(); const { html, text } = progressDoc(cd.name, rows, appName, t.brand, wu); await shareDoc(html, text, 'My progress'); };
  const sendCsv = async () => { await shareTextFile(progressCsv(exportRows()), 'my-progress.csv', 'text/csv', 'My progress'); };
  const sendSummary = async () => { await shareText(progressSummary(cd.name, exportRows(), appName, wu), 'My progress'); };

  // ── the handover document ────────────────────────────────────────────────
  //
  // "PDF report — not in this version of the app. It arrives with the next
  // release." That sentence shipped twice and the release never came, because
  // expo-print and expo-sharing were not dependencies of this app at all (see
  // the post-mortem at the top of src/lib/exportShare.ts). They are now, they
  // are in ios/Podfile.lock, and `check:native` counts them among the 29
  // modules in the binary — so `pdfExportAvailable()` finally answers true and
  // the branch below that apologises for its absence is a fallback rather than
  // the only path.
  //
  // The document itself is a different thing from the progress report beside
  // it. That one is the scans; this one is the whole record a professional
  // would ask for — body composition over time, tape measurements, logged
  // training and any injuries the client has disclosed — in the units they read
  // in, with every section's read status printed on the page.
  //
  // FOUR reads feed it and each can fail alone, so each is passed with its own
  // status. A section that could not be read says so where its table would
  // have been. That matters most for the injuries: an empty injury table handed
  // to a physiotherapist reads as "nothing disclosed", which is the most
  // dangerous false statement this app is capable of making, and it is exactly
  // what a swallowed RLS refusal would have produced.
  const measures = useMeasurements();
  const wlog = useWorkoutLog();
  // Seven days, front view only. A fortnight would be a better measure of
  // training and a worse advertisement for the screen this opens: the point
  // here is recognition, and the full screen offers 7/30/90 for the question.
  const muscleCat = useExerciseCatalogue();
  // `useNow()` rather than Date.now(), and it is IN the dependency list below.
  // check:frozen-hook caught the first version of this: a clock read inside a
  // memo body is a window that stops moving. This tab is one somebody leaves
  // open, and a "last 7 days" that silently means "the 7 days ending whenever
  // this screen mounted" is wrong in the direction nobody checks.
  const muscleNow = useNow();
  const muscleBoard7 = useMemo(
    () => muscleWorkBoard(wlog.log, muscleCat.rows, {
      sinceMs: muscleNow.getTime() - 7 * 24 * 60 * 60 * 1000,
      nowMs: muscleNow.getTime(),
      logStatus: wlog.status,
      // A signed-out catalogue returns zero rows with no error, and a whole
      // read of an empty catalogue would light nothing while claiming to have
      // looked. Carried as an error so the body is not drawn at all.
      catalogueStatus: muscleCat.signedOut ? 'error' : muscleCat.status,
    }),
    [wlog.log, wlog.status, muscleCat.rows, muscleCat.status, muscleCat.signedOut, muscleNow],
  );
  const muscleShading7 = useMemo(() => diagramShading(muscleBoard7), [muscleBoard7]);

  const buildReport = () => {
    // `cd.weightSeries` is passed, and it is the difference between a document
    // that says a calisthenics member did almost no work and one that states
    // what they actually moved: without a weigh-in history every pull-up, dip
    // and press-up prices at nothing. This figure is read by a clinician
    // deciding what this person may load.
    const board = trainingBoard(sessionsOf(wlog.log, cd.weightSeries), wlog.status);
    const injuries: ReportInjury[] = cd.injuries.map((i) => ({
      // Labelled here rather than in the builder so the document names an area
      // exactly as the client's own Injuries screen names it.
      label: areaLabel(i.area),
      severity: i.severity,
      status: i.status,
      note: i.note ?? null,
      at: i.at,
    }));
    return clientReportDoc({
      name: cd.name,
      brand: appName,
      generatedOn: todayISO(),
      weightUnit: wu,
      lengthUnit: lu,
      composition: {
        status: cd.scansStatus,
        items: cd.scans.map((sc) => ({
          takenAt: sc.takenAt,
          weightKg: Number.isFinite(sc.weightKg) ? sc.weightKg : null,
          bodyFatPct: Number.isFinite(sc.bodyFatPct) ? sc.bodyFatPct : null,
          muscleKg: sc.skeletalMuscleKg,
          source: sc.source,
        })),
      },
      measurements: {
        status: measures.status,
        // `values` is the entry itself minus its id and date. The columns come
        // from the measurements screen's own METRICS, so a part added there
        // appears here without this file being touched.
        items: measures.entries.map((e) => ({ at: e.at, values: e as unknown as Record<string, number | null | undefined> })),
      },
      measureColumns: MEASURE_METRICS.map((m) => ({ key: String(m.key), label: m.label })),
      training: {
        status: wlog.status,
        items: {
          state: board.state,
          dayCount: board.dayCount,
          entryCount: board.entryCount,
          sets: board.sets,
          volumeKg: board.volumeKg,
          newestDay: board.newestDay,
          days: board.days,
          // Sessions whose timestamp would not parse belong to no day. Their
          // sets and load ARE in the totals above and they cannot be in the
          // table, so the count is passed and the document says so — otherwise
          // the table and the totals disagree with no explanation.
          undatedCount: board.undated.length,
        },
      },
      // The injuries ride on the PROFILE read, which is what carries them.
      injuries: { status: cd.profileStatus, items: injuries },
    });
  };

  const shareForProfessional = () => {
    const doc = buildReport();
    Alert.alert(
      'Summary for a health professional',
      reportShareBlurb(doc) + '\n\n'
      + (pdfExportAvailable()
        ? 'It goes as a PDF through your phone\u2019s share sheet, so it can reach a physio, a doctor, a new coach — anyone you choose.'
        : 'This build cannot produce a PDF, so it goes as plain text instead. Nothing is left out of it: every figure and every caveat is in the text.'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => { void shareDoc(doc.html, doc.text, 'Health & training summary'); } },
      ],
    );
  };

  const shareProgress = () => {
    const rows = exportRows();
    // An empty export is a claim, not an absence: a PDF with no rows tells a
    // coach this client has recorded nothing rather than that the app had
    // nothing to send. Nothing goes out until there is something in it.
    if (!rows.length) {
      Alert.alert(
        cd.scansStatus === 'error' ? 'Your scans could not be read' : 'Nothing to send yet',
        cd.scansStatus === 'error'
          ? 'Sending now would show your coach an empty record, which is not the same as an empty history. Try again once the screen has loaded your scans.'
          : 'Add a body scan first, and your report, spreadsheet and summary will all have something in them.',
      );
      return;
    }
    const pdf = pdfExportAvailable();
    // A pounds reader is told which of the three is not in pounds, and told it
    // here rather than left to spot it in a column of numbers after the fact.
    // The columns are named `weight_kg` inside the file for the same reason.
    const csvUnit = wu === 'lb' ? ' Figures in kg, as the column names say — a spreadsheet is read by another app, so the columns stay in one fixed unit.' : '';
    // TF build 35, "Why can't it share it?": this line used to end
    // "(this build cannot attach a file)", which named no cause and gave the
    // client nothing to do about it. `fileShareBlocker()` returns the actual
    // reason and the actual remedy — the file share is missing a native module
    // that only a new release can carry, and saying "update the app" is a
    // sentence somebody can act on where a parenthetical apology is not.
    const blocker = fileShareBlocker();
    const csvLine = (blocker
      ? 'Spreadsheet — the same rows, sent as text you can paste into a spreadsheet. ' + blocker
      : 'Spreadsheet — a .csv file, one row per scan, for a coach or another app to import.') + csvUnit;
    const options: { text: string; onPress?: () => void; style?: 'cancel' }[] = [];
    if (pdf) options.push({ text: 'PDF report', onPress: () => { void sendPdf(); } });
    options.push({ text: 'Spreadsheet (CSV)', onPress: () => { void sendCsv(); } });
    options.push({ text: 'Short summary', onPress: () => { void sendSummary(); } });
    // Android's dialog has three button slots and React Native keeps only the
    // first three, so a fourth row does not fail loudly — it disappears. The
    // one that would disappear is this Cancel. The dialog is dismissable there
    // by tapping away or pressing back, so it is left off deliberately rather
    // than shipped as a button that exists on one platform and not the other.
    if (Platform.OS !== 'android' || options.length < 3) options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(
      'Share your progress',
      `${progressSpanLabel(rows)}.\n\n`
      // The PDF is not offered on a build that cannot make one, and until now
      // it was not MENTIONED either — so a client who had been told the app
      // exports a report found two options where three were promised and no
      // word about the third. Silence about a missing feature reads as the
      // feature having been taken away. Said once, and only while it is true.
      + (pdf
        ? 'PDF report — a one-page document with every scan and the change since your first.\n'
        : 'PDF report — the copy of the app on this phone can\u2019t make one. Update to the latest version and it will; the two below work either way.\n')
      + csvLine + '\n'
      + 'Short summary — a few lines of text for a message, a story or a post.\n\n'
      + `Whichever you pick opens your phone's share sheet, so it can go to your coach, Instagram, WhatsApp, anywhere. ${appName} posts nothing on its own.`,
      options,
    );
  };
  const scans = cd.scans;
  // The export path already reads `cd.scansStatus` (it refuses to build a
  // report from a failed read, and says which state it is in). The RENDER did
  // not, so the same failed read that stops a report being sent still printed
  // "No scans yet", "Scans 0" and "No weight history yet" as statements about
  // the member's own body record. Same provider, same status, same rule.
  const scansWhole = isWhole(cd.scansStatus);
  const scansReading = cd.scansStatus === 'loading';
  const [img, setImg] = useState<string | null>(null);
  const [wt, setWt] = useState(''); const [bf, setBf] = useState(''); const [sm, setSm] = useState('');
  // A figure that arrived in kilograms — from the vision reader, from the OCR
  // text, from anywhere — put into a box that is labelled in the client's unit.
  // Without this the reader would fill "Weight lb" with a kilogram and the
  // client would either save it or "correct" it to something else again.
  const fieldFromKg = (kg: number | null | undefined) => {
    const v = weightIn(kg, wu);
    return v == null ? '' : plain(v);
  };
  // Said under the entry boxes when the client reads in pounds: their InBody
  // sheet prints kilograms, and without a word about it the two look like a
  // disagreement rather than one reading said twice. Null in metric.
  const weightNote = convertedNote(wu);
  // `null` is "not asked yet, or the ask failed" — never "you have none".
  // `[]` is "asked, and there are none". They render differently below.
  const toast = useToast();
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(null);
  const [photosErr, setPhotosErr] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // ── who can see these ──────────────────────────────────────────────────
  // `shares === null` is "we have not been told", and it stays null when the
  // read FAILS as well as before it starts. It must never fall to [] on an
  // error: [] means "your coach can see none of these", which is the one
  // reassurance this screen is not allowed to invent. Every badge below reads
  // this through shareStateOf(), which renders unknown as an em-dash.
  const [shares, setShares] = useState<ShareGrant[] | null>(null);
  const [coach, setCoach] = useState<CoachRef | null>(null);
  const [sharesErr, setSharesErr] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  /** What this client has agreed may be PUBLISHED, kept apart from `shares` on
   *  purpose. Null is "not known" and is never rendered as "you have agreed to
   *  none" — a permission read that failed is not a permission, and it is not a
   *  refusal either. Its own error string too, because either read can fail
   *  alone and they mean different things. */
  const [pubs, setPubs] = useState<PublishGrant[] | null>(null);
  const [pubsErr, setPubsErr] = useState<string | null>(null);
  const [pubBusy, setPubBusy] = useState(false);
  const [phys, setPhys] = useState<PhysiqueVision | null>(null);
  const [physBusy, setPhysBusy] = useState(false);
  const [physOpen, setPhysOpen] = useState(false);
  // Selection is by photo id, not list index: the list is re-read from the
  // server after every save and delete, and an index would quietly come to
  // mean a different photo.
  const [cmp, setCmp] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);
  /**
   * How the last attempt at reading a sheet ended.
   *
   * Four outcomes and not a boolean, because they are four different facts and
   * a member acts on them differently:
   *
   *   'read'           something came back and the boxes are filled
   *   'unread'         it was sent and nothing usable came back
   *   'refused'        the member said no. NOT an error, and not drawn as one
   *   'record-failed'  they said yes, the agreement would not write, and
   *                    therefore NOTHING WAS SENT. Our failure, not theirs
   *
   * Merging the last two into "could not read your scan" is how a decision gets
   * reported to somebody as a fault.
   */
  const [sheetOutcome, setSheetOutcome] = useState<'read' | 'unread' | 'refused' | 'record-failed' | null>(null);
  // Holds ONLY which button was pressed, while the question is on screen.
  // Nothing has been photographed and nothing sent at that point, so every way
  // out of the sheet is a real answer and dismissing it is a cancel.
  const [askSheet, setAskSheet] = useState<{ fromCamera: boolean } | null>(null);
  // Who is actually going to receive the page in THIS build — OCR.space always,
  // Anthropic only where the vision reader is on. The question names them and
  // the recorded row lists the same ones.
  const sheetRecipients = scanSheetRecipients(visionAvailable());
  // The member's own record of what has been sent. 'loading' and 'error' are
  // separate from an empty list, because an empty list under a failed read
  // would tell somebody they had never been asked.
  const [consentRows, setConsentRows] = useState<SheetConsentRow[]>([]);
  // Four states, not three. 'partial' arrived with the row cap on
  // `listScanSheetConsents`: the read is newest-first, so a member with more
  // decisions than it returns loses the OLDEST — and the sentence this screen
  // puts under a missing decision is that the sheet was sent unasked. On a
  // record whose whole purpose is that the member can check it, a prefix must
  // not be shown as the record.
  const [consentStatus, setConsentStatus] = useState<LoadStatus>('loading');

  // What the client's own watch already holds for their weight.
  //
  // Offered, never applied. It fills the weight box when they tap it and says
  // where the number came from — the same shape the scan reader uses, for the
  // same reason: a figure that arrives in a field without being asked for is
  // one nobody notices is wrong. It also cannot save on its own, because a scan
  // row needs a body-fat percentage and WHOOP does not measure one.
  const _wear = useWearables();
  const [devBody, setDevBody] = useState<BodyRead[] | null>(null);
  const _connectedKey = Object.keys(_wear.states).filter((k) => _wear.states[k] === 'connected').sort().join(',');
  useEffect(() => {
    let cancelled = false;
    if (!_connectedKey) { setDevBody(null); return; }
    (async () => {
      try {
        const reads = await readBodyFromDevices(_wear.states);
        if (!cancelled) setDevBody(reads);
      } catch {
        // Left null: nothing is offered. An empty offer is correct here — the
        // client can always type the number, and a failed read must not put a
        // weight of zero in front of them.
        if (!cancelled) setDevBody(null);
      }
    })();
    return () => { cancelled = true; };
  }, [_connectedKey]);
  // The first connected device that actually answered with a weight.
  const devWeight = (devBody ?? []).find((r) => hasBodyFigure(r) && r.weightKg != null) ?? null;

  const [mxOpen, setMxOpen] = useState<string | null>(null);
  const [scanMx, setScanMx] = useState<ScanMetrics | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // The record, read when the sheet that can add to it opens, and again after
  // every decision so the row a member has just made is on screen where they
  // made it. Back to 'loading' first: leaving the previous rows up under a read
  // in flight would show a stale record as a current one.
  useEffect(() => {
    if (!showAdd) return;
    let alive = true;
    setConsentStatus('loading');
    void listScanSheetConsents().then((r) => {
      if (!alive) return;
      setConsentStatus(r.status);
      setConsentRows(r.rows);
    });
    return () => { alive = false; };
  }, [showAdd, sheetOutcome]);
  // The targets the member set on the Goals screen. Read here so the screen
  // called Progress can say what progress is toward.
  const { goals, status: goalStatus, reload: reloadGoals } = useGoalTracker();
  // Four reads sit on this screen: the scan history itself, the tape
  // measurements charted with it, the training log the progress notes are
  // written against, and the targets the whole thing is measured toward.
  const pull = usePullToRefresh(useCallback(() => {
    cd.reload(); measures.reload(); wlog.reload(); reloadGoals();
  }, [cd.reload, measures.reload, wlog.reload, reloadGoals]));
  // ── Correcting a scan ──────────────────────────────────────────────────
  //
  // The scan that is highest-dated decides `weightKg`, `bodyFatPct` and
  // `muscleKg` for the whole app, which is to say it decides the client's
  // calorie and protein targets, every body chart and the figures on the report
  // their coach reads. Until now there was no way to change one and no way to
  // remove one, so a mistyped 187 kg re-tuned the meal plan and stayed there
  // for good.
  //
  // Held as the scan's id rather than a copy of the scan, so the sheet cannot
  // go on editing a row that has been deleted underneath it — `editing` below
  // resolves through `cd.scans` on every render and is null the moment the row
  // is gone.
  const [editId, setEditId] = useState<string | null>(null);
  const [eWt, setEWt] = useState(''); const [eBf, setEBf] = useState(''); const [eSm, setESm] = useState('');
  const [eBusy, setEBusy] = useState(false);
  const now = new Date();
  const [dD, setDD] = useState(now.getDate() - 1);
  const [dM, setDM] = useState(now.getMonth());
  // State rather than a module constant, because opening a scan from a year
  // outside the ordinary window widens it rather than being refused.
  const [years, setYears] = useState<number[]>(() => yearsAround(now));
  const [dY, setDY] = useState(() => {
    // `yearsAround` always contains today, so this index exists. The old
    // `Math.max(0, ...)` is gone deliberately: it turned "not in the list" into
    // "the first year in the list", which is how a scan came to be dated 2019.
    const ys = yearsAround(now);
    return Math.max(0, ys.indexOf(now.getFullYear()));
  });
  const [showDate, setShowDate] = useState(false);

  // Never `years[dY]` bare: a widen can move the index, and an undefined year
  // reaches `daysIn` as NaN and renders "NaN" where a date should be.
  const pickedYear = years[dY] ?? now.getFullYear();

  const scanDateISO = () => { const y = pickedYear; const maxd = daysIn(dM, y); const dd = Math.min(dD, maxd - 1) + 1; return `${y}-${String(dM + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; };
  const scanDateLabel = () => fmtFullDay(scanDateISO());

  /**
   * The question, put BEFORE the camera opens.
   *
   * A picture of the sheet used to go to Anthropic and to OCR.space on every
   * photograph, with nothing but a camera permission in front of it. That page
   * has the member's name, their age, the gym or clinic's letterhead and their
   * whole body composition on it. See src/lib/scanSheetConsent.ts for the
   * argument, and for why this one is asked PER SHEET and recorded, where a
   * meal photograph is asked once and remembered.
   *
   * Before the shutter, not after: a member who has already photographed the
   * printout has already photographed it, and putting the question afterwards
   * makes agreeing the way to stop having wasted the gesture.
   */
  const pick = async (fromCamera: boolean) => { setAskSheet({ fromCamera }); };

  /**
   * Photograph the sheet, and send it only on 'granted'.
   *
   * `consent` is passed straight through to `readScanSheet`, which requires it
   * and will not invoke anything without it. Nothing on this path decides for
   * the member: this function knows what they answered and does that.
   */
  const runSheetRead = async (fromCamera: boolean, consent: ScanSheetAnswer) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a scan'))) return;
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
    if (!res.canceled && res.assets && res.assets[0]) {
      const asset = res.assets[0]; const uri = asset.uri; setImg(uri); setOcrMsg(null); setScanMx(null); setSheetOutcome(null);
      // Only while something is actually being read. On a refusal there is
      // nothing in flight, and "Reading your scan…" over a photo that is going
      // nowhere would be the screen describing a send that is not happening.
      if (consent === 'granted') setReading(true);
      let b64 = asset.base64 || undefined;
      try { const mm = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) b64 = mm.base64; } catch { /* fall back to original */ }
      // One door, and it takes the answer. Both readers run inside it against
      // the same image — two calls in parallel cost no more wall time than the
      // vision call alone did — and the text read is what carries the WORD the
      // sheet printed next to the figure. Without it the vision path filed a
      // US-configured printout's 180.4 lb as 180 kg: the exact defect
      // src/lib/inbodySheet.ts was written to close. The OCR read is still the
      // fallback when vision says nothing.
      const read = await readScanSheet(b64, consent);
      const v = read.vision;
      const sheet = read.sheet;
      setReading(false);
      // The member said no. Not an error and not drawn as one: their sheet went
      // nowhere, which is what they asked for, and the three numbers are on the
      // page in their hand. SCAN_REFUSED_NOTE says exactly that.
      if (consent === 'refused') { setSheetOutcome('refused'); return; }
      // They agreed and the agreement could not be written down, so nothing was
      // sent. This one IS a failure and is drawn as one — but as OUR failure,
      // not as a refusal they made.
      if (!read.recorded) { setSheetOutcome('record-failed'); return; }
      if (v && (v.weightKg != null || v.bodyFatPct != null || v.skeletalMuscleKg != null)) {
        setSheetOutcome('read');
        // What unit the model's masses are in, decided from the printed words
        // and from whether the model's number matches the printed figure or
        // the converted one. Unknown is a real answer and is said out loud
        // rather than resolved by a guess.
        //
        // Reached BEFORE the composition breakdown is kept, which it was not.
        // `setScanMx(v.metrics)` stood above this line and stored the model's
        // fat mass, lean mass, protein, minerals, body water and five
        // segmental figures exactly as they arrived — so a pounds-configured
        // InBody had its weight and its skeletal muscle converted and the
        // other ten masses filed as kilograms, 2.2× too large, in the jsonb
        // column the coach's roster reads too. See `visionMetricsKg`.
        const verdict = reconcileInBodyUnit({
          visionWeight: v.weightKg, sheetWeight: sheet.weight, sheetUnit: sheet.unit,
        });
        setScanMx(visionMetricsKg(v.metrics, verdict) ?? null);
        const vwKg = visionMassKg(v.weightKg, verdict);
        const vmKg = visionMassKg(v.skeletalMuscleKg, verdict);
        if (vwKg != null) setWt(fieldFromKg(vwKg));
        // Body fat comes back a percentage and goes in as one.
        if (v.bodyFatPct != null) setBf(String(v.bodyFatPct));
        if (vmKg != null) setSm(fieldFromKg(vmKg));
        if (v.takenAt) { const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.takenAt); if (dm) { const yr = parseInt(dm[1], 10); /* Widen FIRST, then index into the widened list: a stored date the wheel cannot show is a date the app would silently rewrite. */ const ys = yearsAround(now, yr); const yi = ys.indexOf(yr); const mo = parseInt(dm[2], 10) - 1; const dd = parseInt(dm[3], 10) - 1; if (yi >= 0 && mo >= 0 && mo <= 11 && dd >= 0) { setYears(ys); setDY(yi); setDM(mo); setDD(dd); } } }
        setOcrMsg('Read from your scan: ' + [vwKg != null ? 'weight ' + weightLabel(vwKg, wu) : '', v.bodyFatPct != null ? 'body fat ' + v.bodyFatPct + '%' : '', vmKg != null ? 'muscle ' + weightLabel(vmKg, wu) : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.' + (verdict.note ? ' ' + verdict.note : ''));
        return;
      }
      const r = sheet;
      setSheetOutcome(r.ok ? 'read' : 'unread');
      // The masses come off the sheet in the sheet's OWN unit, and it is read
      // off the printout rather than assumed. A US-configured InBody prints
      // pounds — 180.4 where a metric one prints 81.8 — and both figures sit
      // inside the band the weight matcher accepts, so nothing rejected it and
      // `fieldFromKg(180)` filled the box with 397 lb. See src/lib/inbodySheet.
      if (r.ok) {
        const wkg = sheetMassKg(r.weight, r.unit);
        const mkg = sheetMassKg(r.muscle, r.unit);
        const rw = wkg != null ? fieldFromKg(wkg) : '';
        const rm = mkg != null ? fieldFromKg(mkg) : '';
        const rbf = r.bodyFatPct != null ? String(r.bodyFatPct) : '';
        if (rw) setWt(rw); if (rbf) setBf(rbf); if (rm) setSm(rm);
        // The unit the sheet was in is part of what was read, and the member is
        // the only one who can settle an ambiguous one — they are standing in
        // front of the printout. Silence would leave a converted figure looking
        // like a misread and an assumed one looking like a certainty.
        const unitNote = r.unit === 'lb' ? ' ' + CONVERTED_FROM_LB_NOTE : r.unit == null ? ' ' + ASSUMED_METRIC_NOTE : '';
        setOcrMsg('Read from your scan: ' + [rw ? 'weight ' + rw + ' ' + wu : '', rbf ? 'body fat ' + rbf + '%' : '', rm ? 'muscle ' + rm + ' ' + wu : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.' + unitNote);
      } else {
        // `read.error` first: it is the door's own sentence about why nothing
        // was read — no signed-in user, no image — and it is more specific than
        // the reader's silence. The old wording is the fallback it always was.
        setOcrMsg(read.error
          || ((r.error || 'Could not read automatically' + (lastVisionError ? ' — ' + lastVisionError : '')) + ' Please type the numbers in.'));
      }
    }
  };
  const saveScan = async () => {
    // The two weights come back as the kilograms the scan row stores, whatever
    // unit they were typed in. This is the write that used to file a client's
    // 180 lb as 180 kg — and because the newest scan re-tunes the meal plan,
    // the wrong body was in their calorie target before they left the sheet.
    // Body fat is read as typed: it is a percentage in every unit system.
    // Body fat through `readNumber` for the same reason the two weights go
    // through `weightToKg`: the box is a decimal pad and a decimal comma is a
    // decimal point. 16,2% read by `parseFloat` is 16%, which is a different
    // body and a different calorie target.
    const w = weightToKg(wt, wu) ?? 0, f = readNumber(bf) ?? 0;
    // Blank means the report did not give one, NOT zero. `parseFloat(sm) || 0`
    // wrote a 0 kg muscle reading for every client who filled in only the two
    // figures the form insists on.
    const mNum = weightToKg(sm, wu);
    const m = sm.trim() && mNum != null && mNum > 0 ? mNum : null;
    if (!w || !f) { Alert.alert('Add the numbers', 'Enter at least weight and body-fat % from your InBody report.'); return; }
    const newISO = scanDateISO();
    // The meal plan follows your MOST RECENT-dated scan only. A back-dated scan is
    // stored for history/graphs but must not re-tune the plan.
    const curLatestISO = cd.scans.length ? cd.scans[cd.scans.length - 1].takenAt.slice(0, 10) : '';
    // ── what the OTHER scans say, and whether we heard them ──────────────
    //
    // The render path on this screen asks `scansWhole` in nine places and the
    // write path asked it nowhere. Under a failed scans read `cd.scans` is
    // empty and `cd.weightKg` is null, which is indistinguishable from never
    // having been measured — so `curLatestISO` was '', `isNewest` was
    // unconditionally true, `before` was null, and a member with two years of
    // scans was congratulated on their first measurements while a back-dated
    // scan was announced as having re-tuned a plan it had not touched.
    //
    // Neither claim is available without the history, so neither is made.
    const historyKnown = scansWhole;
    const isNewest = !curLatestISO || newISO >= curLatestISO;
    // Only meaningful when there was a previous body to compare against — and
    // only when the read that would have shown one actually answered.
    const before = (historyKnown && cd.weightKg != null && cd.bodyFatPct != null)
      ? macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet })
      : null;
    const after = macrosFor({ weightKg: w, bodyFatPct: f, activity: cd.activity, goal: cd.goal, diet: cd.diet });
    const pw = cd.weightKg, pf = cd.bodyFatPct;
    // Awaited, and the answer read. `addScan` returns Promise<boolean> for
    // exactly this reason and the call used to discard it, so every branch
    // below announced "Scan saved" — and, worse, recited the new calorie and
    // protein targets — over an insert the server may have refused. The client
    // then closed the sheet believing a body composition was on record, and
    // would find out weeks later when the graph had a hole in it.
    //
    // Nothing is cleared and no verdict is given until the row exists.
    // The row's id is minted here, as a real uuid, and it is the id the LOCAL
    // entry carries as well as the one the queue would write. `scans.id` is a
    // uuid primary key, so choosing it on the device is what makes a queued
    // replay idempotent: a scan the server already holds comes back 23505
    // rather than being filed twice. See src/lib/recordQueue.ts · ScanIntent.
    const scanId = newScanId();
    const source = scanMx ? 'InBody (OCR)' : 'InBody (manual)';
    const saved = await cd.addScan({ id: scanId, takenAt: newISO, weightKg: w, bodyFatPct: f, skeletalMuscleKg: m, source, image: img || undefined, metrics: scanMx ?? undefined });
    if (!saved) {
      // Not lost, and no longer typed again.
      //
      // This branch used to be the whole answer: "try again in a moment", over
      // four figures somebody had just copied off an InBody printout, in the
      // corner of a gym where there is no signal — while measurements, glucose,
      // check-ins and the workout log all had a queue behind them. The member's
      // choices were to stand somewhere else holding a sheet of paper, or to
      // find that sheet again later.
      //
      // A scan qualifies for the queue on every clause src/lib/outbox.ts sets:
      // nothing is scarce, no money moves, it carries no file (the photograph
      // of the printout never leaves the phone — `scans.image_path` is not
      // written by this app), and a scan dated by `takenAt` says the same thing
      // whenever it lands.
      const q = outbox ? await outbox.enqueue('scan', {
        id: scanId, takenAt: newISO, weightKg: w, bodyFatPct: f,
        skeletalMuscleKg: m, source, metrics: scanMx ?? null,
      }) : { result: 'unavailable' as const, id: null };
      if (q.result !== 'queued') {
        // Nothing was kept. The sheet stays open with the numbers still in it:
        // the person typed them off a printout they may no longer be holding,
        // and clearing the form here would make them find it again.
        Alert.alert('Not saved', notKeptNote('scan', q.result === 'full' ? 'full' : 'unavailable'));
        return;
      }
      // Kept. The form clears, because there is nothing left to retype.
      //
      // Deliberately NOT `keptOnPhoneNote`, whose promise ends "it won't show
      // up here until it has" — true of a goal or a planned day, false of this
      // one. `addScan` has already put the scan in the list and the figures
      // behind the meal plan have moved with it, on this phone. Saying the
      // shared sentence would leave a member looking at a scan the app had just
      // told them was not there.
      setImg(null); setWt(''); setBf(''); setSm(''); setScanMx(null); setShowAdd(false);
      Alert.alert(
        'Saved on this phone',
        'Your scan is saved on this phone and has not reached your record yet — it goes up on its own next time you have signal. It is in your list and your targets here have moved with it in the meantime, and nobody else can see it until it sends.',
      );
      return;
    }
    setImg(null); setWt(''); setBf(''); setSm(''); setScanMx(null); setShowAdd(false);
    // The history could not be read, so this screen does not know whether this
    // scan is the newest, the first, or one of two hundred. It says the one
    // thing it does know: the scan is on the record.
    if (!historyKnown) {
      Alert.alert(
        'Scan saved',
        'Your scan is on your record. Your other scans could not be read just now, so this screen cannot say whether it is your most recent one or what it changed about your targets — pull down on Progress once you have signal and it will.',
      );
      return;
    }
    if (!isNewest) {
      Alert.alert('Scan saved to history', 'This scan is dated ' + fmt(newISO) + ', earlier than your most recent scan (' + fmt(curLatestISO) + '). It\'s added to your progress tracking and graphs — but your meal plan stays on your most recent scan. Only a newer scan re-tunes your plan.');
      return;
    }
    if (!before) {
      Alert.alert('Scan saved', 'Your first measurements are in — daily targets are now ' + after.kcal + ' kcal / ' + after.protein + 'g protein, and your meal plan is built from them.');
      return;
    }
    const dK = after.kcal - before.kcal, dP = after.protein - before.protein;
    const sign = (x: number) => (x > 0 ? '+' + x : String(x));
    const changed = Math.abs(dK) >= 5 || Math.abs(dP) >= 2;
    Alert.alert(changed ? 'Scan saved — plan auto-tuned' : 'Scan saved', changed
      // Both weights are read out in the client's unit — each is a reading in
      // its own right, so each converts as a value rather than the pair being
      // treated as one span.
      //
      // rtl-ok: the two arrows are "was, then became" — time, not layout — and
      // this is an English sentence assembled in code. When the catalogue is
      // translated the whole sentence moves with it and the separator becomes
      // the translator's, which is the right owner for it.
      ? 'Your stats updated (weight ' + weightIn(pw, wu) + '→' + weightIn(w, wu) + wu + ', body fat ' + pf + '%→' + f + '%), so your daily targets adjusted: ' + sign(dK) + ' kcal (now ' + after.kcal + '), protein ' + sign(dP) + 'g (now ' + after.protein + 'g). Your meal plan regenerated to match.'
      : 'Added to your history and charts. Targets are essentially unchanged (' + after.kcal + ' kcal / ' + after.protein + 'g protein).');
  };
  // ── progress photos ────────────────────────────────────────────────────
  // A failed read leaves `photos` at null, NOT at []. Showing "no photos yet"
  // to somebody whose photos merely failed to load is telling them their
  // history is gone, and that is the one wrong answer this section can give.
  const loadPhotos = useCallback(async () => {
    try {
      const list = await listProgressPhotos();
      setPhotos(list);
      setPhotosErr(null);
    } catch (e) {
      reportError('scans.photos.load', e);
      setPhotos(null);
      setPhotosErr('Could not load your photos just now.');
    }
  }, []);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  /** Who your coach is, and exactly which photos they can open. Both together,
   *  because the send control needs both and a half-answer would offer a Send
   *  button the database then refuses. A failure leaves `shares` at null and
   *  puts a sentence on screen — it never resolves to "none shared". */
  const loadShares = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([fetchMyCoach(), fetchMyShares()]);
      setCoach(c);
      setShares(g);
      setSharesErr(null);
    } catch (e) {
      reportError('scans.photos.shares', e);
      setShares(null);
      setSharesErr('Could not check what your coach can see just now.');
    }
  }, []);
  useEffect(() => { loadShares(); }, [loadShares]);

  /** The publication permissions, read separately from the send grants. One
   *  read rather than folded into `loadShares` because a failure of either has
   *  to be reportable on its own: "we could not check what your coach can see"
   *  and "we could not check what you agreed could be posted" are different
   *  sentences about different promises. */
  const loadPubs = useCallback(async () => {
    try {
      const g = await fetchMyPublishGrants();
      setPubs(g);
      setPubsErr(null);
    } catch (e) {
      reportError('scans.photos.publishGrants', e);
      setPubs(null);
      setPubsErr('Could not check what you have agreed can be published.');
    }
  }, []);
  useEffect(() => { loadPubs(); }, [loadPubs]);

  /** Agree that ONE photo may be used in something the coach publishes.
   *
   *  The question spells out what public means before it is answered, and the
   *  destructive-looking button is the one that says yes: this is the only
   *  place in the app where a tap puts a picture of somebody's body in reach of
   *  a public post, and it should not look like a preference. */
  const allowPublishing = (p: ProgressPhoto) => {
    const blocked = publishBlocker(p.id, coach, shares);
    if (blocked) { Alert.alert('Nothing changed', blocked); return; }
    const c = coach!;
    Alert.alert(publishAskTitle(c.name), publishAskBody(c.name), [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, they can', onPress: async () => {
        setPubBusy(true);
        try {
          // The row comes back FROM the server. Nothing here records an
          // agreement on the strength of a request that was never confirmed.
          const g = await allowPublish(p.id, c.id);
          setPubs((x) => (x === null ? [g] : [g, ...x.filter((y) => y.photoId !== g.photoId)]));
          setPubsErr(null);
        } catch (e) {
          reportError('scans.photos.allowPublish', e);
          Alert.alert('Nothing changed', 'That was not saved, so this photo still cannot be published. Try again in a moment.');
          await loadPubs();
        } finally { setPubBusy(false); }
      } },
    ]);
  };

  /** Take that permission back. It does NOT unshare the photo: the coach may
   *  still open it, because that is a separate thing that was separately
   *  agreed, and quietly undoing it would be the app deciding something nobody
   *  asked it to decide. */
  const stopPublishing = (p: ProgressPhoto) => {
    const c = coach;
    if (!c) return;
    Alert.alert('Take this permission back?', withdrawPublishBody(c.name), [
      { text: 'Leave it', style: 'cancel' },
      { text: 'Take it back', style: 'destructive', onPress: async () => {
        setPubBusy(true);
        try {
          await withdrawPublish(p.id, c.id);
          setPubs((x) => (x === null ? null : x.filter((y) => y.photoId !== p.id)));
        } catch (e) {
          reportError('scans.photos.withdrawPublish', e);
          Alert.alert('Still allowed', 'That was not withdrawn, so this photo can still be published. Try again in a moment.');
          await loadPubs();
        } finally { setPubBusy(false); }
      } },
    ]);
  };

  /** Upload + record. Re-reads the list rather than guessing at it, so the
   *  screen only ever shows photos the server has confirmed it holds. */
  const savePhoto = async (uri: string, takenAt?: string | null): Promise<boolean> => {
    setPhotoBusy(true);
    try {
      // Normalise to JPEG before it goes up. The library can hand back HEIC or
      // PNG, and the object is stored as image/jpeg with a .jpg key — calling a
      // HEIC a JPEG is the kind of small lie that surfaces months later as a
      // photo that will not render. Resizing also keeps the upload sane on a
      // phone connection. If the conversion fails we send the original rather
      // than lose the photo.
      let out = uri;
      try {
        const mm = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
        if (mm.uri) out = mm.uri;
      } catch (e) { reportError('scans.photos.convert', e); }
      // ── The three arguments this call has always accepted and never been
      //    given ──────────────────────────────────────────────────────────
      //
      // `uploadProgressPhoto` takes takenAt, weightKg and bodyFatPct, and its
      // only caller passed none of them — so every progress photo in the
      // database is dated the moment it was uploaded and carries two nulls.
      // src/lib/photoCompare.ts already notes that the row's own `weight_kg`
      // "is always null" and re-derives the figure from the nearest scan
      // instead, which is a workaround for exactly this.
      //
      // The date is the photo's OWN date where the picker could tell us one —
      // a photo chosen from the camera roll was taken on the day it was taken,
      // and filing a March picture under today puts it at the wrong end of a
      // comparison that is entirely about time. Null falls through to the
      // upload's own default of now, which is right for a photo just taken.
      //
      // The body figures are the ones the app currently holds, and they are
      // passed only when the read they came from was WHOLE: `cd.scansStatus`
      // under 'error' leaves weightKg null, and a null written into the row is
      // indistinguishable afterwards from a member who had never been weighed.
      // Better to leave it null than to record a figure that was never read.
      const bodyKnown = isWhole(cd.scansStatus);
      await uploadProgressPhoto(out, {
        takenAt: takenAt ?? undefined,
        weightKg: bodyKnown ? cd.weightKg : null,
        bodyFatPct: bodyKnown ? cd.bodyFatPct : null,
      });
      setCmp([]);
      await loadPhotos();
      return true;
    } catch (e) {
      reportError('scans.photos.upload', e);
      Alert.alert('Not saved', 'That photo could not be saved, so it is not in your progress yet. The original in your camera roll is untouched — try again in a moment.');
      return false;
    } finally { setPhotoBusy(false); }
  };

  /**
   * ── The question that was never asked ───────────────────────────────────
   *
   * One tap on a button labelled "AI Check" did two separate things to a
   * full-body photograph of the member, and named neither: it filed the picture
   * permanently as a progress photo in their account, and it sent a copy off
   * the handset to a language model. Nothing on the button, nothing in the
   * section copy above it, and nothing in between.
   *
   * Both are now said, in the order they happen, before either does — and
   * saving is separated from reading, because they are genuinely different
   * decisions and the app was making both on one tap. src/lib/coachShare.ts is
   * this app's own argument for asking about exactly this kind of thing.
   */
  const physiqueCheck = async (fromCamera: boolean) => {
    const keep = await new Promise<'save' | 'read-only' | null>((resolve) => {
      Alert.alert(
        'Have a photo read?',
        'Two things can happen here and they are separate.\n\n'
        // Named, like every other door in the app. "An AI" is a category; a
        // member deciding whether to send a full-body photograph of themselves
        // somewhere is entitled to know which company, and can then go and read
        // that company's terms. Same rule as PHOTO_DESTINATION in
        // src/lib/photoAI.ts and scanConsentWho in src/lib/scanSheetConsent.ts.
        + '· A copy of the photo leaves this phone and goes to Anthropic, who run the model that reads it. It estimates body fat and picks out areas to work on. It is a guess from a picture, not a measurement, it is not part of your gym, and it is not sent to your coach.\n\n'
        + '· The photo can also be saved to your account as a progress photo. That is what puts it in the strip below and lets you compare it later. Only you can see it until you send it to your coach yourself.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Read Only', onPress: () => resolve('read-only') },
          { text: 'Save and Read', onPress: () => resolve('save') },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    });
    if (!keep) return;
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a scan'))) return;
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const asset = res.assets[0];
    // The photo is saved only if they said so. It is told the same truth about
    // whether that worked as any other progress photo.
    if (keep === 'save') await savePhoto(asset.uri);
    if (!visionAvailable() || !asset.base64) { Alert.alert('AI not on yet', 'Physique analysis turns on with the AI backend.'); return; }
    setPhys(null); setPhysOpen(true); setPhysBusy(true);
    let pb = asset.base64;
    try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) pb = mm.base64; } catch {}
    const r = await analyzePhysique(pb, 'image/jpeg');
    setPhysBusy(false);
    if (r) setPhys(r); else { setPhysOpen(false); Alert.alert('Could not analyze', 'Try a clearer, well-lit full-body photo.'); }
  };

  /**
   * When a picked photo was actually taken, from its own EXIF, or null.
   *
   * A progress photo's whole value is its position in time, and a picture
   * chosen out of the camera roll in September may have been taken in March.
   * Filing it under today puts it at the wrong end of every comparison the
   * screen offers — the "before" shot lands after the "after" one.
   *
   * `DateTimeOriginal` is EXIF's own field and its format is not ISO: it is
   * "2026:03:14 08:31:02", with colons in the date, which `Date.parse` refuses.
   * The colons are swapped for dashes and the space for a T before parsing, and
   * anything that still does not parse returns null rather than a guess — a
   * wrong date is worse here than no date, because no date falls through to the
   * upload's honest default of now.
   *
   * A future date is refused too. Camera clocks are wrong more often than
   * anybody expects, and a photo dated next year sorts last forever.
   */
  const exifTakenAt = (asset: { exif?: Record<string, any> | null }): string | null => {
    const raw = asset.exif?.DateTimeOriginal ?? asset.exif?.DateTime;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const iso = raw.trim().replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/, '$1-$2-$3T');
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    // A minute of tolerance, because a phone taking a photo one second into the
    // future by clock skew is not a broken date.
    if (ms > Date.now() + 60_000) return null;
    return new Date(ms).toISOString();
  };

  const addPhoto = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a scan'))) return;
    // `exif: true` only on the library path. A photo taken through the camera
    // right now is dated now by definition, and asking for EXIF there would be
    // reading a field to learn something we already know.
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, exif: true });
    if (!res.canceled && res.assets && res.assets[0]) {
      const asset = res.assets[0];
      await savePhoto(asset.uri, fromCamera ? null : exifTakenAt(asset));
    }
  };

  /**
   * Delete a progress photo, with six seconds to change your mind.
   *
   * This used to be a modal whose own copy said "this cannot be undone", and
   * it was telling the truth: the moment Delete was tapped the file came off
   * storage and the row went with it. The dialog was the only thing standing
   * between a mis-tap and a picture nobody can get back, and a dialog people
   * have learned to tap through is not a thing standing anywhere.
   *
   * The photo leaves the grid immediately and the WRITE is held for six
   * seconds behind an Undo, so the sentence in that dialog is no longer true —
   * see src/lib/undoable.ts for why holding the write is what makes the undo
   * reliable rather than best-effort.
   *
   * One thing the bar says that the dialog said and this must keep saying: a
   * photo the coach was sent comes back from them too. And one thing it does
   * not claim — while the six seconds are running the photo is still on the
   * server and the coach can still open it. It is a delete that has not
   * happened yet, not a delete that has happened invisibly.
   */
  const removePhoto = (p: ProgressPhoto) => {
    const sentToCoach = shareStateOf(p.id, shares) === 'sent';
    setPhotos((ps) => (ps ? ps.filter((x) => x.id !== p.id) : ps));
    setCmp((c) => c.filter((x) => x !== p.id));
    toast.remove({
      id: p.id,
      text: sentToCoach
        ? 'Photo deleted, and taken back from your coach.'
        : 'Photo deleted. Your camera roll is untouched.',
      // Re-read rather than splice the row back in at a remembered index. The
      // photo was never deleted, so the server is the shortest true answer to
      // what the grid should now contain.
      onUndo: () => { void loadPhotos(); },
      onCommit: async () => {
        setPhotoBusy(true);
        try {
          await deleteProgressPhoto(p);
          await loadPhotos();
          // The grant is removed by the database (the row cascades with the
          // photo), but this screen must not go on drawing a "Sent to coach"
          // badge for a photo that no longer exists. Re-read rather than
          // assume what the cascade did.
          await loadShares();
        } catch (e) {
          reportError('scans.photos.delete', e);
          // The file comes off storage BEFORE the row, so a failure here means
          // nothing was removed. Still an alert, and deliberately: the grid is
          // about to put the photo back and the member has to know why. Say
          // exactly what happened rather than "something went wrong" — the
          // difference is whether the photo is still there.
          await loadPhotos();
          Alert.alert('Still there', 'That photo could not be deleted, so nothing was removed. Try again in a moment.');
        } finally { setPhotoBusy(false); }
      },
    });
  };

  /** Send ONE photo. The confirmation says "this one photo, and only this one"
   *  because that is the whole promise of the feature, and it is a promise the
   *  database keeps: a later photo has no grant row and nothing writes one. */
  const sendToCoach = (p: ProgressPhoto) => {
    const blocked = sendBlocker(p, coach, shares);
    if (blocked) { Alert.alert('Not sent', blocked); return; }
    const c = coach!;
    const who = c.name || 'your coach';
    Alert.alert(`Send this photo to ${who}?`,
      `They will be able to open this one photo, and only this one. Photos you add later are not sent. You can take it back whenever you like.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setShareBusy(true);
        try {
          // The grant comes back FROM the server. Nothing here says "sent"
          // on the strength of a request that was never confirmed.
          const g = await sharePhoto(p.id, c.id);
          setShares((s) => (s === null ? [g] : [g, ...s.filter((x) => x.photoId !== g.photoId)]));
          toast.say(`Sent. ${who} can now open this photo until you take it back.`);
        } catch (e) {
          reportError('scans.photos.share', e);
          Alert.alert('Not sent', `That photo was not sent, so ${who} still cannot see it. Nothing about your photos has changed. Try again in a moment.`);
          await loadShares();
        } finally { setShareBusy(false); }
      } },
    ]);
  };

  /** Take one back. Deleting the grant closes the row and the file together —
   *  revokeCaveat() is the one thing it cannot reach, said out loud. */
  const takeBackFromCoach = (p: ProgressPhoto) => {
    const c = coach;
    if (!c) return;
    const who = c.name || 'your coach';
    Alert.alert('Take this photo back?', `${who} will no longer be able to open it. ${revokeCaveat()}`, [
      { text: 'Leave it', style: 'cancel' },
      { text: 'Take it back', style: 'destructive', onPress: async () => {
        setShareBusy(true);
        try {
          await unsharePhoto(p.id, c.id);
          setShares((s) => (s === null ? null : s.filter((x) => x.photoId !== p.id)));
        } catch (e) {
          reportError('scans.photos.unshare', e);
          Alert.alert('Still shared', `That photo was not withdrawn, so ${who} can still see it. Try again in a moment.`);
          await loadShares();
        } finally { setShareBusy(false); }
      } },
    ]);
  };

  /** Long press on a photo. One sheet, so "who can see this", "who can post
   *  this" and "delete this" are the same gesture and none can be missed.
   *
   *  Publication is only offered for a photo that has already been sent, and
   *  never when either read is unknown: an action that depends on knowing must
   *  not be offered when nothing is known. */
  const photoActions = (p: ProgressPhoto) => {
    const state = shareStateOf(p.id, shares);
    const pubState = publishStateOf(p.id, pubs);
    const when = fmtFullDay(p.takenAt);
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (state === 'sent') buttons.push({ text: 'Take back from coach', onPress: () => takeBackFromCoach(p) });
    else if (state === 'private') buttons.push({ text: 'Send to coach', onPress: () => sendToCoach(p) });
    if (state === 'sent' && pubState === 'allowed') buttons.push({ text: 'Stop them publishing it', onPress: () => stopPublishing(p) });
    else if (state === 'sent' && pubState === 'not-allowed') buttons.push({ text: 'Let them publish it', onPress: () => allowPublishing(p) });
    buttons.push({ text: 'Delete photo', style: 'destructive', onPress: () => removePhoto(p) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    // Two sentences, because there are two separate promises about this photo
    // and collapsing them is exactly the confusion this feature exists inside.
    const seeing = state === 'sent' ? 'Your coach can open this one.'
      : state === 'private' ? 'Only you can see this one.'
      : 'We could not check whether your coach can see this one, so nothing is offered that depends on knowing.';
    const posting = state !== 'sent' ? ''
      : pubState === 'allowed' ? ' You have agreed they can use it in something they publish.'
      : pubState === 'not-allowed' ? ' They cannot put it in anything they publish.'
      : ' We could not check whether they may publish it, so nothing is offered about that.';
    Alert.alert(`Photo from ${when}`, seeing + posting, buttons);
  };

  const toggleCmp = (id: string) => setCmp((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 2 ? [c[1], id] : [...c, id]));

  const chrono = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const latest = chrono[chrono.length - 1];
  const wsv = cd.weightSeries.map((x) => x.v);
  const mInsights = compositionInsights(cd.scans);
  // The same four headings, in the same order, as app/(trainer)/client-body.tsx
  // now draws for the coach — assembled once in src/lib/inbodyMetrics.ts rather
  // than filtered into shape here and again there.
  const mByGroup = trendsByGroup(cd.scans);
  const wDelta = wsv.length > 1 ? +(wsv[wsv.length - 1] - wsv[0]).toFixed(1) : null;
  const wDeltaShown = weightDeltaIn(wDelta, wu);
  // `scans.taken_at` is a bare postgres DATE, and this used to be
  // `new Date(iso)` — UTC midnight, which is the previous day for every client
  // west of Greenwich, so a scan taken on the 1st was captioned "31/7" in New
  // York and dated correctly in Dubai. Read through localDate instead, which is
  // what the rest of the app already does with this column.
  const fmt = bodyDayLabel;

  /** The scan being corrected, resolved fresh so a deleted row closes the sheet. */
  const editing = editId ? cd.scans.find((x) => x.id === editId) ?? null : null;

  const openEdit = (sc: { id: string; weightKg: number; bodyFatPct: number; skeletalMuscleKg: number | null }) => {
    // Pre-filled in the client's OWN unit, through the same converter the Add
    // sheet fills from a device reading. A pounds reader shown the stored
    // kilograms would "correct" a figure that was never wrong and store the
    // pounds as kilograms — which is the exact bug the note on saveScan says
    // this screen has already shipped once.
    setEWt(fieldFromKg(sc.weightKg));
    setEBf(String(sc.bodyFatPct));
    setESm(sc.skeletalMuscleKg != null ? fieldFromKg(sc.skeletalMuscleKg) : '');
    setEditId(sc.id);
  };

  const saveEdit = async () => {
    if (!editing || eBusy) return;
    const w = weightToKg(eWt, wu);
    const f = readNumber(eBf);
    if (w == null || !(w > 0) || f == null || !(f > 0)) {
      Alert.alert('Check the numbers', 'A scan needs a weight and a body-fat percentage. Clearing one is not the same as correcting it — delete the scan instead if it should not be there.');
      return;
    }
    // Blank muscle means the report gave none, and clearing the box has to be
    // able to SAY that — so an empty string sends null rather than being
    // skipped, which is the difference between removing a wrong figure and
    // leaving it in place forever.
    const mNum = weightToKg(eSm, wu);
    const m = eSm.trim() ? (mNum != null && mNum > 0 ? mNum : null) : null;
    setEBusy(true);
    const ok = await cd.updateScan(editing.id, { weightKg: w, bodyFatPct: f, skeletalMuscleKg: m });
    setEBusy(false);
    if (!ok) {
      // The sheet stays open with the corrected numbers in it. Closing it would
      // leave a corrected figure on screen that is not on the server, which is
      // the state this whole screen's read-status handling exists to avoid.
      Alert.alert('Not saved', 'That correction could not be saved, so the scan on your record is unchanged and so are your targets. Your numbers are still here — try again in a moment.');
      return;
    }
    setEditId(null);
  };

  const removeScan = () => {
    if (!editing || eBusy) return;
    const sc = editing;
    // The consequence is stated before it happens, and it is not "this row will
    // disappear": deleting the newest scan hands the whole app back to the one
    // before it, which moves the client's calorie and protein targets. Somebody
    // deleting a duplicate has a right to know that.
    const isNewest = cd.scans.length > 0 && cd.scans[cd.scans.length - 1].id === sc.id;
    Alert.alert(
      'Delete this scan?',
      // Same rule as the row's label: the weight is omitted rather than
      // dashed, because this line is prose in a confirmation somebody is about
      // to act on irreversibly.
      [fmt(sc.takenAt), weightLabel(sc.weightKg, wu), `${sc.bodyFatPct}% body fat`].filter(Boolean).join(' · ') + '.'
      + (isNewest
        ? ' This is your most recent scan, so your weight, body fat and daily targets will go back to the scan before it.'
        : ' Your charts and your total change since starting are recalculated without it.')
      + ' This cannot be undone.',
      [
        { text: 'Keep It', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setEBusy(true);
            const ok = await cd.deleteScan(sc.id);
            setEBusy(false);
            if (!ok) {
              Alert.alert('Not deleted', 'That scan could not be removed, so it is still on your record and still visible to your coach. Nothing has been changed — try again in a moment.');
              return;
            }
            setEditId(null);
          },
        },
      ],
    );
  };
  const today = todayISO();

  // ── where each figure came from, and when ────────────────────────────────
  //
  // TF build 35: "Progress numbers say something different than the numbers on
  // the body page this needs to be synced." They did. This screen showed
  // `cd.weightKg`, which is the most recent of {a weigh-in logged on the
  // check-in screen, the newest InBody scan}; body-trends.tsx re-derived its
  // own figure from `cd.scans` alone and so always showed the scan. Both now
  // read the same published series through the same module, so the current
  // figure is the same value by construction — and each one says which
  // instrument measured it, which is the half that stops the remaining, real
  // differences of DATE from reading as a contradiction.
  const scanCount = cd.scans.length;
  const wReads = bodyReadings(cd.weightSeries, scanCount);
  const bfReads = bodyReadings(cd.bodyFatSeries, scanCount);
  const mReads = bodyReadings(cd.muscleSeries, scanCount);
  // Each metric is compared against its OWN previous reading. This screen used
  // to compare everything against the second-newest SCAN — including figures
  // that were not scans, and including muscle, whose previous reading is often
  // several scans back because not every scan records it.
  const priorOf = (r: BodyReading[]) => (r.length > 1 ? r[r.length - 2] : null);
  const wNow = latestBodyReading(cd.weightSeries, scanCount);
  const bfNow = latestBodyReading(cd.bodyFatSeries, scanCount);
  // Deliberately the newest scan that RECORDED muscle, rather than
  // `cd.muscleKg`, which is the newest scan's muscle and therefore null
  // whenever that one scan happened not to report it. A gym scale reports
  // weight and body fat and no skeletal muscle at all, so that null is common —
  // and a dash where a real, dated reading exists is as much a wrong answer as
  // a zero. It is only safe to reach back like this because the figure now
  // carries its own date; without one it would be last month's muscle presented
  // as today's.
  const mNow = latestBodyReading(cd.muscleSeries, scanCount);
  const wWas = priorOf(wReads), bfWas = priorOf(bfReads), mWas = priorOf(mReads);
  // The same weight series in the client's unit, converted point by point
  // because each point is a reading rather than a change. Taken from `wReads`
  // rather than from the raw series so the chart and the date labels beside it
  // are the same list — a point dropped from one and not the other would put
  // every date on the wrong reading.
  const wsvShown = wReads.map((r) => weightIn(r.value, wu)).filter((v): v is number => v != null);
  // Said once above the row rather than three times inside it, and only when
  // the figures genuinely have different dates or different instruments behind
  // them — a client whose every number came off one scan is told nothing.
  const bodyMixNote = mixedSourceNote([wNow, bfNow, mNow]);
  // A change between two stored weights, in the client's unit. The subtraction
  // happens in kilograms and `weightDeltaIn` converts the span once: rounding
  // each of the two readings into whole pounds first and subtracting those
  // would let half a pound of rounding at each end report a real 0.4 kg change
  // as nothing, or as two pounds. The arrow is taken from the stored change so
  // a loss too small to move a whole pound still points down rather than
  // arguing with itself.
  const dlt = (cur: number, was: number | undefined) => {
    if (was == null) return null;
    const d = +(cur - was).toFixed(1);
    const shown = weightDeltaIn(d, wu);
    // Unreachable from two real readings. A dash if it ever is reachable —
    // this figure is printed under a unit label, and falling back to the
    // stored kilograms would put the wrong unit on a real number.
    if (shown == null) return null;
    return `${d < 0 ? '▼' : d > 0 ? '▲' : ''} ${Math.abs(shown)} ${wu}`.trim();
  };
  // The hero's movement line, measured between the two most recent body-fat
  // READINGS rather than between the current figure and the second-newest scan.
  // The old line subtracted `prev.bodyFatPct` — a scan two steps back — from
  // whatever `cd.bodyFatPct` currently was, and then captioned the result
  // "since your previous scan". When the current figure came from a logged
  // weigh-in that sentence named the wrong instrument, the wrong two readings
  // and the wrong interval, all at once.
  const bfMove = (bfNow && bfWas) ? +(bfNow.value - bfWas.value).toFixed(1) : null;
  // How long ago the newest SCAN was — used only where the subject really is
  // the scan itself. Every figure below carries its own date instead.
  const ago = latest ? (agoLabel(latest.takenAt, today) ?? 'on an unreadable date') : null;

  // Both target lines are computed from the same published series the figures
  // above them are, rather than from `cd.scans` a second time — a target
  // measured against a different series from the number it sits under is the
  // "two screens, one body, two answers" this screen family has already shipped
  // once.
  const wtTarget = isWhole(goalStatus)
    ? goalOnBody(goalOfKind(goals, 'weight'), cd.weightSeries.map((p) => ({ t: p.t, v: p.v })), { weight: true, unit: 'kg', wu })
    : null;
  const bfTarget = isWhole(goalStatus)
    ? goalOnBody(goalOfKind(goals, 'bodyfat'), cd.bodyFatSeries.map((p) => ({ t: p.t, v: p.v })), { weight: false, unit: '%', wu })
    : null;

  const input = { flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>InBody · body composition</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Progress</Text>
          </View>
          {/* Labelled, not a bare icon: TF-21 was written by somebody who
              could not tell what the icon would do until they had done it. */}
          <Ghost icon="share" label="Share" onPress={shareProgress} />
        </View>

        {/* ── the hero: one number leads the screen ───────────────────────── */}
        <ScreenHelp screen="progress" />

        <Hero
          label="Body Fat"
          figure={bfNow ? String(bfNow.value) : '—'}
          unit={bfNow ? '%' : undefined}
          // The date is not an ornament under the hero: this is the figure the
          // whole screen leads with, and until build 35 it carried a caption
          // that said "scanned N days ago" whatever had actually measured it.
          // `measuredNote` names the instrument, the day and the age, in that
          // order, and the movement clause names the day it is measured FROM
          // rather than saying "your previous scan" and hoping.
          note={bfNow
            // Zero is its own case. `bfMove <= 0` put a minus sign in front of
            // it, so a reading that had not moved at all rendered as "−0%
            // since Aug 25" — which reads as a small drop, and is the kind of
            // small drop somebody is pleased about. There is no such thing as
            // negative nothing.
            ? (bfMove !== null && bfWas
                ? (bfMove === 0
                    ? `No change since ${bodyDayLabel(bfWas.at)} · `
                    : `${bfMove < 0 ? '−' : '+'}${Math.abs(bfMove)}% since ${bodyDayLabel(bfWas.at)} · `)
                : 'First reading · ') + measuredNote(bfNow, today)
            : scansReading ? 'Reading your scans…'
            : !scansWhole ? 'Your scans could not be read in full — this is not a body with nothing measured on it.'
            : 'No scans yet — add your InBody report to start tracking.'}
          onPress={() => router.push('/(client)/body-trends')}
        />
        {/* ── What they are aiming at ─────────────────────────────────────
            Two targets, on the two figures this screen leads with. The Goals
            screen has stored these for months and no body screen has ever read
            one, so a member set a target weight and then came here — the screen
            called Progress — and found no mention of it anywhere.

            Absent under a failed goal read rather than reported as "no target":
            an empty `goals` list under 'error' means the targets could not be
            read, and printing "no target set" off a dropped connection tells
            somebody their goal is gone. */}
        {bfTarget || wtTarget ? (
          <View style={{ marginBottom: sp.md, gap: 3 }}>
            {bfTarget ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View accessibilityElementsHidden importantForAccessibility="no"
                  style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: bfTarget.reached ? t.brand : t.ink3 }} />
                <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>Body fat · {bfTarget.note}</Text>
              </View>
            ) : null}
            {wtTarget ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View accessibilityElementsHidden importantForAccessibility="no"
                  style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: wtTarget.reached ? t.brand : t.ink3 }} />
                <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>Weight · {wtTarget.note}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Where a figure is stale, how stale — said under the figure itself,
            because the client is the only person who can judge whether a scan
            from eleven weeks ago still describes them, and they can only judge
            it if they are given the eleven weeks. */}
        {stalenessNote(bfNow, today) ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{stalenessNote(bfNow, today)}</Text>
        ) : null}

        <Rule />

        {/* ── the one card: the scan you can act on ───────────────────────── */}
        <Section>
          <ActionCard
            title={latest ? 'Latest InBody Scan' : 'Add your first InBody scan'}
            // The scan's OWN figures and the scan's OWN date. This card is the
            // one place on the screen whose subject really is the scan, so it
            // may differ from the Weight tile below — and it now says the date
            // out loud so that difference reads as two measurements on two days
            // rather than as the app contradicting itself.
            note={latest
              ? `${fig(weightLabel(latest.weightKg, wu))} · ${latest.bodyFatPct}% BF · ${bodyDayLabel(latest.takenAt)}${ago ? ` · ${ago}` : ''}`
              : 'Snap or upload your report — the numbers are read for you.'}
            cta={latest ? 'Add Scan' : 'Start'}
            onPress={() => setShowAdd(true)}
          />
        </Section>

        <Rule />

        {/* ── body ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Body" note="Measurements" onPress={() => router.push('/(client)/measurements')} />
          <KpiRow
            onPress={(k) => { if (k.route) router.push(k.route as any); }}
            items={[
              // `good` is the accent dot, and it used to be `wNow <= wWas` for
              // everybody — the same fixed-direction verdict `body-trends.tsx`
              // replaced when a member training to Build Muscle saw the accent
              // dot for losing the weight they are working to put on. Their own
              // goal decides it here too, and `undefined` where the goal has no
              // opinion paints the neutral mark rather than a verdict.
              //
              // `!wWas ||` was the other half of it: with nothing to compare
              // against, a first-ever reading was congratulated unconditionally.
              // There is no delta then, so there is nothing to be on track with.
              { label: 'Weight', value: fig(weightIn(wNow?.value, wu)), unit: wNow ? wu : undefined, route: '/(client)/body-trends', good: wNow && wWas ? movementIsProgress(wNow.value - wWas.value, cd.goal, 'weight') : undefined, delta: (wNow && wWas ? dlt(wNow.value, wWas.value) : null) ?? undefined },
              { label: 'Muscle', value: fig(weightIn(mNow?.value, wu)), unit: mNow ? wu : undefined, route: '/(client)/body-trends', good: mNow && mWas ? movementIsProgress(mNow.value - mWas.value, cd.goal, 'muscle') : undefined, delta: (mNow && mWas ? dlt(mNow.value, mWas.value) : null) ?? undefined },
              // A count over a read that is not whole is the size of what came
              // back, and `fig(0)` prints "0" rather than a dash.
              { label: 'Scans', value: scansWhole ? fig(scans.length) : fig(null), delta: (scansWhole ? ago : 'not read') ?? undefined },
            ]}
          />
          {/* "Need to see the dates the weight was measured as well." Here they
              are, one line per figure, naming the instrument as well as the day
              — because the two can be different instruments, and that is the
              whole of why this screen and the composition screen looked as
              though they disagreed. */}
          <View style={{ marginTop: sp.md }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>Weight · {measuredNote(wNow, today)}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Muscle · {mNow ? measuredNote(mNow, today) : 'No scan has recorded skeletal muscle yet.'}</Text>
            {bodyMixNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{bodyMixNote}</Text> : null}
            {stalenessNote(wNow, today) ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{stalenessNote(wNow, today)}</Text> : null}
          </View>
        </Section>

        <Rule />

        {/* ── weight trend ───────────────────────────────────────────────── */}
        <Section>
          {wsv.length > 1 ? (<>
            {/* "N check-ins" was wrong in both directions — most of these points
                are InBody scans, and the ones that are not are weigh-ins.
                `readingsLabel` counts each kind and names it.

                And it is only named at all when the scan read was whole. This
                screen asks `scansWhole` in nine places — the Scans KPI two
                sections up is `scansWhole ? fig(scans.length) : fig(null)`, and
                the scan-history line at the foot of the screen is
                `scansWhole ? "N scans" : "not all read"` — and this
                heading was the one count that did not ask. Under 'partial'
                (cd.scansStatus, from a read that came back at PostgREST's
                ceiling) it printed "1,000 scans" over a chart of the most recent
                thousand, which is a count over an unknown fraction stated as a
                total. The caption under the chart says so rather than leaving
                the heading quietly shorter. */}
            <SectionHead title={scansWhole ? `Weight · ${readingsLabel(wReads)}` : 'Weight'}
              note={wDeltaShown !== null ? `${wDeltaShown > 0 ? '+' : wDeltaShown < 0 ? '−' : ''}${Math.abs(wDeltaShown)} ${wu}` : undefined}
              onPress={() => router.push('/(client)/body-trends')} />
            {/* `labels` is what puts a DATE on the readout when the client
                touches the line. Without it the chart answered "what did I
                weigh" and refused to answer "when", which is exactly what the
                third report asked for. Spark reads a bare date safely. */}
            <Spark data={wsvShown} unit={` ${wu}`} labels={wReads.map((r) => r.at)} />
            {/* "First 3 Mar" is a claim about the member's whole record and was
                made from the first point in the ARRAY. The scan read is ordered
                `taken_at desc` and capped, so under 'partial' the earliest point
                on this chart is the earliest of the most recent thousand — not
                the member's first reading, and there is no way to tell from
                inside the page. So the sentence says what the chart actually
                starts at instead of calling it a first. */}
            {scansWhole ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                First {bodyDayLabel(wReads[0].at)} · latest {measuredNote(wNow, today)}
              </Text>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {cd.scansStatus === 'partial'
                  ? `You have more readings on record than we can read at once, so they aren’t counted above. This chart starts at ${bodyDayLabel(wReads[0].at)}, which isn’t necessarily your first — latest ${measuredNote(wNow, today)}`
                  : `Not all of your readings could be read, so they aren’t counted above. This chart starts at ${bodyDayLabel(wReads[0].at)}, which isn’t necessarily your first — latest ${measuredNote(wNow, today)}`}
              </Text>
            )}
          </>) : (<>
            <SectionHead title="Weight" note="Measurements" onPress={() => router.push('/(client)/measurements')} />
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {scansReading ? 'Reading your weight history…'
                : !scansWhole ? 'Your weight history could not be read, so there is nothing to chart. It is not gone.'
                : 'No weight history yet — the trend charts from your second check-in.'}
            </Text>
          </>)}
        </Section>

        <Rule />

        {/* ── progress photos ────────────────────────────────────────────── */}
        <Section>
          {/* "N saved" is now the truth: every one of these is a file in the
              private `photos` bucket and a row in `progress_photos`. The note
              is deliberately absent while the list is still loading and while
              it is genuinely empty — in both of those the body below says
              which, and a note reading "0 saved" would collapse them into one. */}
          <SectionHead title="Progress Photos" note={photosNote(photos) ?? undefined} />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
            <View style={{ flex: 1 }}><Ghost label="Upload" onPress={() => { if (!photoBusy) addPhoto(false); }} /></View>
            <View style={{ flex: 1 }}><Ghost label="Photo" onPress={() => { if (!photoBusy) addPhoto(true); }} /></View>
            <View style={{ flex: 1 }}><Cta label="AI Check" wide disabled={photoBusy} onPress={() => physiqueCheck(false)} /></View>
          </View>
          {photoBusy ? <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, marginBottom: sp.md }}>Saving to your account…</Text> : null}
          {shareBusy ? <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, marginBottom: sp.md }}>Updating what your coach can see…</Text> : null}

          {/* ── who can see these ───────────────────────────────────────────
              The standing answer, always on screen, never inferred. Four
              distinct renders and not one of them is a guess:
                · the read failed        — say so, and offer to try again
                · the read has not landed — say that instead of "none"
                · no coach linked        — there is nobody it could be shared with
                · N sent                 — and exactly which ones, by date
              "Could not check" and "none shared" look nothing alike on purpose:
              one is reassurance, the other is the absence of it. */}
          <View style={{ backgroundColor: t.surface2, borderRadius: radius.md, padding: sp.md, marginBottom: sp.lg }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>Your coach can see{sharedNote(shares) ? ' · ' + sharedNote(shares) : ''}</Text>
            {sharesErr ? (
              <View>
                <Flag tone={t.warn}>
                  {sharesErr} Nothing has changed either way — this screen just could not read the list, so it will not tell you these are private.
                </Flag>
                <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}><Ghost label="Try Again" onPress={loadShares} /></View>
              </View>
            ) : shares === null ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>Checking what your coach can see…</Text>
            ) : !coach ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                You have no coach linked, so none of these has been sent to anybody and there is nobody to send one to.
              </Text>
            ) : shares.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                {coachSubject(coach.name)} cannot see any of your photos. Press and hold one to send it — one photo at a time, and only the one you pick.
              </Text>
            ) : (
              <View>
                <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.sm }}>
                  {coachSubject(coach.name)} can open {shares.length === 1 ? 'this one' : `these ${shares.length}`}, and nothing else:
                </Text>
                {shares.map((g) => {
                  const p = photos?.find((x) => x.id === g.photoId) ?? null;
                  return (
                    <View key={g.photoId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 }}>
                      {/* A grant whose photo is not in the loaded list is not
                          silently dropped: the coach can still see it, so it is
                          named by the date it was sent. */}
                      <Text style={{ ...ty.label, color: t.ink }}>
                        {p ? fmtFullDay(p.takenAt) : 'A photo not in the list above'}
                      </Text>
                      <Pressable onPress={() => { if (p && !shareBusy) takeBackFromCoach(p); }} hitSlop={8} disabled={!p || shareBusy}>
                        <Text style={{ ...ty.caption, fontWeight: '600', color: p ? t.brand : t.ink3 }}>Take back</Text>
                      </Pressable>
                    </View>
                  );
                })}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{revokeCaveat()}</Text>
              </View>
            )}
          </View>

          {/* ── who can PUBLISH these ───────────────────────────────────────
              A second panel rather than a badge on the first, because it is a
              second promise about the same photos and a badge would read as a
              detail of the one above it. The four renders are the four the
              panel above has, for the same reasons: a failed read says so, an
              unlanded read says so, no coach means there is nobody to agree
              with, and a real empty list is a real answer. */}
          <View style={{ backgroundColor: t.surface2, borderRadius: radius.md, padding: sp.md, marginBottom: sp.lg }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>Your coach can publish</Text>
            {pubsErr ? (
              <View>
                <Flag tone={t.warn}>
                  {pubsErr} Nothing has changed either way, and this screen will not tell you none of them can be published when it could not read the list.
                </Flag>
                <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}><Ghost label="Try Again" onPress={loadPubs} /></View>
              </View>
            ) : pubs === null ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>Checking what you have agreed can be published…</Text>
            ) : !coach ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                You have no coach linked, so there is nobody who could publish any of these.
              </Text>
            ) : pubs.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                None of your photos can be put in anything your coach posts in public. Press and hold a photo you have already sent to agree to one.
              </Text>
            ) : (
              <View>
                <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.sm }}>
                  {coachSubject(coach.name)} may use {pubs.length === 1 ? 'this one' : `these ${pubs.length}`} in something they post publicly:
                </Text>
                {pubs.map((g) => {
                  const p = photos?.find((x) => x.id === g.photoId) ?? null;
                  return (
                    <View key={g.photoId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 }}>
                      <Text style={{ ...ty.label, color: t.ink }}>
                        {p ? fmtFullDay(p.takenAt) : 'A photo not in the list above'}
                      </Text>
                      <Pressable onPress={() => { if (p && !pubBusy) stopPublishing(p); }} hitSlop={8} disabled={!p || pubBusy}>
                        <Text style={{ ...ty.caption, fontWeight: '600', color: p ? t.brand : t.ink3 }}>Take back</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PUBLISH_IS_SEPARATE_NOTE}</Text>
          </View>

          {photos === null ? (
            photosErr ? (
              <View>
                <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                  {photosErr} Nothing has been deleted — this screen only failed to read the list, so it cannot tell you what is there.
                </Text>
                <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try Again" onPress={loadPhotos} /></View>
              </View>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3 }}>Loading your photos…</Text>
            )
          ) : photos.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No photos yet — add one from your camera or library. They are saved privately to your account,
              so they are here on any device you sign in to. Your coach cannot see any of them: the only way
              they ever see one is if you send that one photo, and you can take it back afterwards.
              {/* rtl-ok: "before → after" is time inside an English sentence.
                  See the note on the Alert above. */}
              Tap two to compare before → after; press and hold one for the options.
            </Text>
          ) : (
            <View>
              {/* ── the way into the comparison ────────────────────────────
                  The side-by-side panel used to be rendered right here, inside
                  this screen, which meant it could not be linked to, returned
                  to or shared: it was a region of a scroll view rather than a
                  place. It is app/(client)/compare.tsx now, and the pair
                  travels in the URL as two photo ids — never as a signed URL,
                  which expires in an hour and would sit in a navigation
                  history long after it stopped working.

                  Selecting still happens here, on the strip below, because
                  this is where the photos are and where the long-press actions
                  live. What changed is where the answer is shown. */}
              {(() => {
                const sel = comparePair(photos, cmp);
                if (!sel) return (
                  // rtl-ok: time inside an English sentence, as above.
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                    Tap two photos to compare before → after. Press and hold one to send it to your coach, or delete it.
                  </Text>
                );
                return (
                  <View style={{ marginBottom: sp.lg }}>
                    {/* rtl-ok: the earlier date, then the later one. Mirroring
                        this would say the comparison runs the other way, which
                        is the one thing the line exists to state. */}
                    <Text style={{ ...ty.label, color: t.ink2 }}>
                      {fmtFullDay(sel.before.takenAt)} → {fmtFullDay(sel.after.takenAt)} · {spanLabel(sel.days)}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      Open them side by side, with the scan figures recorded on each of those two days.
                    </Text>
                    <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                      <Cta label="Compare These Two" onPress={() => router.push({ pathname: '/(client)/compare', params: { before: sel.before.id, after: sel.after.id } } as any)} />
                    </View>
                  </View>
                );
              })()}
              {/* Oldest first, left to right — the strip reads as time passing,
                  which is the whole point of keeping them. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.md }}>
                {photos.map((p) => {
                  const selIdx = cmp.indexOf(p.id);
                  const shState = shareStateOf(p.id, shares);
                  // Announced only for a photo that has been sent. For one that
                  // has not, "not for publishing" is true and says nothing:
                  // nobody can open it in the first place.
                  const pubState = publishStateOf(p.id, pubs);
                  const pubSaid = shState === 'sent' ? `, ${publishLabel(pubState).toLowerCase()}` : '';
                  return (
                    <Pressable key={p.id} onPress={() => toggleCmp(p.id)} onLongPress={() => photoActions(p)} delayLongPress={400}
                      accessibilityRole="button"
                      accessibilityLabel={`Progress photo from ${fmtFullDay(p.takenAt)} · ${shState === 'sent' ? 'sent to your coach' : shState === 'private' ? 'only you can see it' : 'not known whether your coach can see it'}${pubSaid}`}
                      accessibilityHint="Tap to compare, press and hold to send it to your coach or delete it">
                      <View style={{ borderRadius: radius.md, borderWidth: selIdx >= 0 ? 2 : 0, borderColor: t.brand, overflow: 'hidden' }}>
                        {p.url ? (
                          <Image source={{ uri: p.url }} style={{ width: 110, height: 150, backgroundColor: t.surface2 }} />
                        ) : (
                          // The row is here and the file is not. Show the gap
                          // rather than a blank frame that looks like a photo
                          // still loading, or nothing at all.
                          <View style={{ width: 110, height: 150, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.sm }}>
                            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Picture{'\n'}unavailable</Text>
                          </View>
                        )}
                        {selIdx >= 0 ? <View style={{ position: 'absolute', top: 6, end: 6, width: 20, height: 20, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ ...ty.caption, fontWeight: '600', color: t.brandInk }}>{selIdx + 1}</Text></View> : null}
                        {/* Every photo carries its own answer to "can my coach
                            see this?" — including the honest non-answer. The
                            badge is on the picture, not in a list somewhere
                            else, so the question is never open while you look
                            at one. */}
                        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                          <Text style={{ ...ty.caption, fontWeight: '500', textAlign: 'center', color: shState === 'sent' ? t.brand : '#fff' }}>{shareLabel(shState)}</Text>
                        </View>
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, textAlign: 'center' }}>{fmtFullDay(p.takenAt)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {(missingFileCount(photos) ?? 0) > 0 ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                  {missingFileCount(photos) === 1 ? 'One of these has no picture behind it any more.' : `${missingFileCount(photos)} of these have no picture behind them any more.`} Press and hold to clear it.
                </Flag>
              ) : null}
            </View>
          )}
        </Section>

        {/* ── body composition, metric by metric ──────────────────────────── */}
        {mByGroup.length > 0 && (<>
          <Rule />
          <Section>
            {/* Deliberately left in the units the InBody sheet itself printed.
                This table is a transcription of a report the client is holding,
                and it mixes kilograms with litres, kcal, points and a visceral
                fat "level" — and its segmental lean masses are carried to two
                decimals, a grain of 0.01 kg that whole pounds (the honest grain
                for a body weight, see src/lib/units.ts) cannot represent at all.
                Converting these would need a second, finer rule for pounds than
                the rest of the app uses, and two rules for the same unit is how
                a client ends up seeing the same reading two ways. */}
            <SectionHead title="Body Composition" note="Latest vs previous" />
            {(mInsights.improving.length > 0 || mInsights.watch.length > 0 || mInsights.balance.length > 0) && (
              <View style={{ marginBottom: sp.lg }}>
                {mInsights.improving.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand, marginTop: 6 }} />
                    <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}><Text style={{ fontWeight: '500', color: t.ink }}>Improving  </Text>{mInsights.improving.join('  ·  ')}</Text>
                  </View>
                ) : null}
                {mInsights.watch.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, marginTop: 6 }} />
                    <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}><Text style={{ fontWeight: '500', color: t.ink }}>Watch  </Text>{mInsights.watch.join('  ·  ')}</Text>
                  </View>
                ) : null}
                {mInsights.balance.map((b, i) => <Text key={i} style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{b}</Text>)}
              </View>
            )}
            {mByGroup.map((grp) => (
              <View key={grp.group} style={{ marginBottom: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{grp.group}</Text>
                {grp.items.map((it) => (
                  <View key={String(it.def.key)}>
                    <Pressable onPress={() => { if (it.series.length >= 2) setMxOpen(mxOpen === String(it.def.key) ? null : String(it.def.key)); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                      <Text style={{ ...ty.label, color: t.ink2 }}>{it.def.label}{it.series.length >= 2 ? (mxOpen === String(it.def.key) ? '  ▴' : '  ▾') : ''}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                        {/* Through `numUpTo`, not interpolated. BMR is the one
                            metric on this table that passes a thousand, and
                            `{it.latest}` printed it as 1750 with no separator —
                            beside a "1,204.5 kg lifted" from `num1` on another
                            screen of the same app. It also puts the decimal
                            separator in the reader's own language, which a bare
                            interpolation cannot: a German handset showed 3.42 kg
                            of left arm where 3,42 is what that reader parses.
                            `decimals` is the metric's own grain, so a whole
                            figure still looks whole. */}
                        <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink }}>{numUpTo(it.latest, it.def.decimals ?? 0)} {it.def.unit}</Text>
                        {it.delta != null && it.delta !== 0 ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 52, justifyContent: 'flex-end' }}>
                            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: it.good == null ? t.ink3 : it.good ? t.brand : t.warn }} />
                            {/* Through `deltaLabel` rather than interpolating
                                the number. A positive got a '+' written here
                                and a negative got whatever JS renders, which is
                                an ASCII hyphen — so this column showed "-1"
                                while the summary line six rows above it, which
                                already goes through the helper, showed "−1"
                                with the real minus. Two different characters
                                for the same idea, in one screenful. */}
                            <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>
                              {deltaLabel(it.delta, { since: null, decimals: it.def.decimals ?? 0 })}
                            </Text>
                          </View>
                        ) : (
                          <Text style={{ ...ty.caption, color: t.ink3, minWidth: 52, textAlign: END_ALIGN }}>—</Text>
                        )}
                      </View>
                    </Pressable>
                    {mxOpen === String(it.def.key) && it.series.length >= 2 ? (
                      <View style={{ paddingVertical: sp.sm }}><Spark data={it.series} h={54} /></View>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
          </Section>
        </>)}

        <Rule />

        <Rule />

        {/* ── handing your own record to somebody who treats bodies ──────────
            A client sitting in front of a physiotherapist had nothing to show
            them. The GDPR export exists and is 400 kB of JSON; the progress
            report exists and is the scans alone. This is the whole record in
            one document — composition, tape measurements, training and any
            injury they have disclosed — and the point of it is that they own
            it and hand it over themselves.

            Its own section rather than a fourth row in the Share dialog: that
            dialog is an Alert, Android keeps only three of its buttons, and the
            one that would silently disappear is Cancel. A thing this
            consequential also should not be the option below "Short summary".
        */}
        <Section>
          <SectionHead title="Share With a Professional" />
          <Text style={{ ...ty.label, color: t.ink2 }}>
            A summary a physio, a doctor or a new coach can read: your body composition over time, your tape
            measurements, the training you have logged, and any injuries you have recorded.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            It carries no assessment and no advice of any kind — only what has been recorded, and when. Your
            progress photos are not in it, and neither is any injury document you have uploaded. If part of your
            record cannot be read when you make it, the document says so on its own front page rather than
            looking complete.
          </Text>
          <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
            <Cta label="Make the Summary" onPress={shareForProfessional} />
          </View>
        </Section>

        {/* ── what the training actually worked ───────────────────────────── */}
        <Rule />
        <Section>
          <SectionHead title="Muscles Worked" note="last 7 days" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your Muscles. Opens the body diagram, recovery map and muscle rankings."
            onPress={() => router.push('/(client)/muscles')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}
          >
            <MuscleBody
              side="front"
              intensity={muscleShading7.byLayer}
              status={muscleBoard7.status}
              height={150}
              surface={t.surface2}
            />
            <View style={{ flex: 1, gap: 6 }}>
              {/* Three states, three sentences. A body with nothing lit is the
                  same picture whether the read failed, the member is new, or
                  they genuinely rested — and those are not the same fact. */}
              <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>
                {muscleBoard7.status === 'loading' ? 'Reading your week\u2026'
                  : muscleBoard7.status === 'error' ? 'Could not read this'
                  : muscleShading7.hasWork ? 'See it on the body'
                  : 'Nothing logged in seven days'}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink2 }}>
                {muscleBoard7.status === 'error'
                  ? 'Your training is not affected — this panel could not read it.'
                  : 'The body diagram, how long each muscle has rested, and what you train most and least.'}
              </Text>
            </View>
          </Pressable>
        </Section>

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <SectionHead title="Go Deeper" />
          {/* Wrapped, not scrolled sideways — the same fix the Train tab's row
              needed. Seven destinations in a horizontal strip put three of
              them past the right edge with nothing to say they were there.

              Ordered by the question being asked, rather than by when each
              screen was built:

                the summary      Report
                the body         Composition · Measurements
                what you lift    Records · Standards
                habit and aim    Consistency · Goal */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            {([
              ['chart', 'Report', '/(client)/report'],
              ['camera', 'Compare', '/(client)/compare'],
              ['trending', 'Composition', '/(client)/body-trends'],
              ['ruler', 'Measurements', '/(client)/measurements'],
              ['dumbbell', 'Muscles', '/(client)/muscles'],
              ['trophy', 'Records', '/(client)/records'],
              ['chart', 'Standards', '/(client)/standards'],
              ['flame', 'Consistency', '/(client)/consistency'],
              ['target', 'Goal', '/(client)/goal'],
            ] as const).map(([ic, label, route]) => (
              <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                <Icon name={ic} size={14} color={t.ink2} /><Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>
      </ScrollView>

      {/* Add / view scans sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowAdd(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.xs }}>
              <Text style={{ ...ty.title, color: t.ink }}>Add an InBody Scan</Text>
              <Ghost label="Close" onPress={() => setShowAdd(false)} />
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>Snap or upload your report, pick the scan date, enter the numbers.</Text>
            {/* The standing sentence, replacing the silence. It does not promise
                a sheet is never sent — for a member who says yes that would be
                the same omission in a longer sentence — it says what is true of
                every sheet, that reading one means sending it, and that the
                question is put every time. See src/lib/scanSheetConsent.ts. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{scanScreenPromise(sheetRecipients)}</Text>
            <View style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
              <Pressable accessibilityLabel="Take a progress photo" accessibilityRole="button" onPress={() => pick(true)} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.md, paddingVertical: sp.lg, alignItems: 'center', gap: 5 }}><Icon name="camera" size={22} color={t.ink} /><Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Take Photo</Text></Pressable>
              <Pressable accessibilityLabel="Add photo from library" accessibilityRole="button" onPress={() => pick(false)} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.md, paddingVertical: sp.lg, alignItems: 'center', gap: 5 }}><Icon name="plus" size={22} color={t.ink} /><Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Upload scan</Text></Pressable>
            </View>
            {img && (
              <View style={{ marginBottom: sp.md }}>
                <Image source={{ uri: img }} accessible accessibilityLabel="The scan you attached"
                  style={{ width: '100%', height: 180, borderRadius: radius.md, backgroundColor: t.surface2 }} resizeMode="cover" />
                {/* Four outcomes, four sentences. The refusal is deliberately
                    NOT in the warning tone: it is the feature doing what the
                    member asked, and drawing it as a fault teaches somebody
                    that saying no broke something. The record failure IS a
                    fault, and it is ours — so it says plainly that nothing was
                    sent, which is the whole point of writing the row first. */}
                {reading ? (
                  <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, marginTop: 6 }}>Reading your scan…</Text>
                ) : sheetOutcome === 'refused' ? (
                  <View style={{ marginTop: 6 }}>
                    <Text style={{ ...ty.caption, fontWeight: '600', color: t.ink }}>{SCAN_REFUSED_TITLE}</Text>
                    <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{SCAN_REFUSED_NOTE}</Text>
                  </View>
                ) : sheetOutcome === 'record-failed' ? (
                  /* A Flag, so the tone is a mark and the words stay in ink.
                     The sentence already says it — colour is never the only
                     channel, and warn as text ink does not clear 4.5:1. */
                  <View style={{ marginTop: 6 }}>
                    <Flag tone={t.warn}>{SCAN_RECORD_FAILED_TITLE}. {SCAN_RECORD_FAILED_NOTE}</Flag>
                  </View>
                ) : (
                  <Text style={{ ...ty.caption, color: ocrMsg && ocrMsg.startsWith('Read') ? t.ink2 : t.ink3, marginTop: 6 }}>{ocrMsg || 'Scan attached — reading the numbers…'}</Text>
                )}
              </View>
            )}
            <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Scan date</Text>
            <Pressable onPress={() => setShowDate(true)} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{scanDateLabel()}</Text><Icon name="calendar" size={15} color={t.ink3} />
            </Pressable>
            {devWeight?.weightKg != null && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Use the weight from your ${devWeight.providerName}, ${weightLabel(devWeight.weightKg, wu)}`}
                onPress={() => { setWt(fieldFromKg(devWeight.weightKg)); setOcrMsg(null); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.md }}
              >
                <Icon name="scale" size={15} color={t.ink2} />
                <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
                  {devWeight.providerName} has you at {weightLabel(devWeight.weightKg, wu)} — tap to use it
                </Text>
              </Pressable>
            )}
            {/* The OCR fills all three of these, and the "use my scale's figure"
                row above fills the first — so on the ordinary path these boxes
                arrive with numbers in them and every placeholder that named
                what they were had already gone. Weight and muscle share a unit
                and body fat does not, which is exactly the row where three bare
                numerals cannot be told apart. */}
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg, alignItems: 'flex-end' }}>
              <Field label="Weight" hint={wu} a11y={wu === 'kg' ? 'Weight in kilograms' : 'Weight in pounds'}>
                <TextInput value={wt} onChangeText={setWt} keyboardType="decimal-pad" style={input} />
              </Field>
              <Field label="Body fat" hint="%" a11y="Body fat percentage">
                <TextInput value={bf} onChangeText={setBf} keyboardType="decimal-pad" style={input} />
              </Field>
              <Field label="Muscle" hint={wu} a11y={wu === 'kg' ? 'Skeletal muscle in kilograms' : 'Skeletal muscle in pounds'}>
                <TextInput value={sm} onChangeText={setSm} keyboardType="decimal-pad" style={input} />
              </Field>
            </View>
            {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: -sp.md, marginBottom: sp.lg }}>{weightNote}</Text> : null}
            <Cta label="Save Scan & Update Profile" wide onPress={saveScan} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: sp.xl, marginBottom: sp.sm }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Scan history</Text><Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{scansWhole ? `${scans.length} scans` : 'not all read'}</Text>
            </View>
            {scans.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                {scansReading ? 'Reading…' : scansWhole ? 'No scans yet.' : 'Your scans could not be read — this list is empty for that reason, not because there are none.'}
              </Text>
            ) : null}
            {/* Each row is now a control. It was a flat list with no way in, so
                a mistyped scan was permanent — and this list is the only place
                in the app that shows the individual scans at all. */}
            {[...chrono].reverse().map((s, i, arr) => (
              <Pressable key={s.id} onPress={() => openEdit(s)}
                accessibilityRole="button"
                // The weight is dropped from the sentence rather than dashed
                // when it cannot be converted. `fig` gives a dash, and a dash
                // read aloud inside a sentence is a word that has gone missing
                // — "Scan from 14 March, dash, 22 percent body fat" reads as a
                // broken row rather than as an unconverted figure. The date and
                // the body fat still identify the row, which is what this
                // label is for.
                accessibilityLabel={[
                  `Scan from ${fmt(s.takenAt)}`,
                  weightLabel(s.weightKg, wu),
                  `${s.bodyFatPct} percent body fat`,
                ].filter(Boolean).join(', ') + '. Correct or delete it.'}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderBottomWidth: i < arr.length - 1 ? hairline : 0, borderBottomColor: t.ring }}>
                {s.image ? <Image source={{ uri: s.image }} style={{ width: 40, height: 40, borderRadius: radius.sm }} /> : <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={16} color={t.ink3} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{fig(weightLabel(s.weightKg, wu))} · {s.bodyFatPct}% BF</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{fmt(s.takenAt)} · {s.source}</Text>
                </View>
                <Icon name={FORWARD_ICON} size={14} color={t.ink3} />
              </Pressable>
            ))}

            {/* ── what has actually been sent, and to whom ─────────────────
                The point of writing the answer down is that the member can go
                and LOOK at it. A consent somebody has to take the app's word
                for is one they cannot check, and this app's word on this exact
                subject was nothing at all until the question existed.

                Three states and three sentences. An empty list under a FAILED
                read is not "you have never been asked" — that would be a new
                false statement about the same subject — and an empty list under
                a good read is not "nothing was ever sent" either: every sheet
                photographed before this existed went to both companies unasked
                and has no row. See sheetSendLine's 'no-record'. */}
            <View style={{ marginTop: sp.xl }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Sheets you have been asked about</Text>
              {consentStatus === 'loading' ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>Checking…</Text>
              ) : consentStatus === 'error' ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                  We could not read your record just now, so this is not a list of nothing — it is a list we could not read.
                </Text>
              ) : consentRows.length === 0 ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                  Nothing on file yet. Any sheet read before this question existed was sent without being asked about, and there is no record of it either way.
                </Text>
              ) : consentRows.map((r) => (
                <View key={r.readId} style={{ marginTop: sp.sm }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{sheetSendLine(r.decision, r.vendors)}</Text>
                  <Text style={{ ...ty.micro, color: t.ink3, marginTop: 1 }}>{consentWhen(r.decidedAt)}</Text>
                </View>
              ))}
              {/* The read is newest-first and it has a ceiling, so what a cut
                  list drops is the OLDEST decisions — and a decision missing
                  from this list is one the sentence above reads as never having
                  been asked about. Saying the list is a prefix is the whole
                  difference between a record and a page of one. */}
              {consentStatus === 'partial' ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Only your {SCAN_SHEET_CONSENT_LIST_CAP} most recent decisions are listed here, so this is not all of them. An older sheet missing from this list may have been asked about rather than sent unasked.
                </Text>
              ) : null}
            </View>
          </ScrollView>
        </View>
              </KeyboardAvoidingView>

      {/* ── Why the date wheel lives in here ─────────────────────────────────
          "Scan date" above is the only way to open it, and that row is inside
          this sheet. While this sheet was a sibling of the date `<Modal>`, iOS
          presented the wheel in a window BENEATH the one already on screen, so
          tapping the date did nothing a person could see: the Add sheet just
          sat there and the scan kept whatever date it had. A `<Modal>` nested
          in the element tree of the modal it is opened from presents above it
          on both platforms, which is the whole fix. */}
      <Modal visible={showDate} transparent animationType="slide" onRequestClose={() => setShowDate(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowDate(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}> </Text>
            <Text style={{ ...ty.head, color: t.ink }}>Scan date</Text>
            <Pressable onPress={() => setShowDate(false)} hitSlop={8}><Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>Done</Text></Pressable>
          </View>
          <View style={{ position: 'relative' }}>
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ITEM_H * 2, height: ITEM_H, borderRadius: radius.sm, backgroundColor: t.surface2 }} />
            <View style={{ flexDirection: 'row' }}>
              <Wheel label="Day" items={Array.from({ length: daysIn(dM, pickedYear) }, (_, i) => String(i + 1))} index={Math.min(dD, daysIn(dM, pickedYear) - 1)} onChange={setDD} t={t} />
              <Wheel label="Month" items={MONTHS} index={dM} onChange={setDM} t={t} />
              <Wheel label="Year" items={years.map(String)} index={dY} onChange={setDY} t={t} />
            </View>
          </View>
        </View>
      </Modal>
      {/* ── end of the Add sheet, which the date wheel above sits inside ── */}
      </Modal>

      {/* ── the question, asked before the camera opens ────────────────────
          Nothing has been photographed and nothing has been sent at the moment
          this is on screen. `askSheet` holds which button was pressed and no
          more, so every way out of it is a real answer:

            Send It to Be Read     photograph it, record the agreement, send
            I'll Type the Numbers  record the refusal, send nothing
            Cancel / back          nothing at all happens

          Dismissing it — the Android back button, a tap on the backdrop — is
          Cancel and not a quiet yes, which is the whole difference between a
          consent question and a notification.

          Four paragraphs, in the order somebody decides in: who it goes to,
          what actually goes, what we cannot promise once it has gone, and what
          happens if the answer is no. The last is not a consolation at the
          bottom — it is the half of the question that makes "no" an answer
          somebody can afford to give.

          Rendered after the Add sheet so it draws above it, and rendered from
          src/lib/scanSheetConsent.ts rather than typed here, so what somebody
          agrees to cannot drift from what is sent. */}
      <Modal visible={askSheet != null} transparent animationType="slide"
        onRequestClose={() => setAskSheet(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
          accessibilityRole="button" accessibilityLabel={SCAN_CONSENT_CANCEL_A11Y}
          onPress={() => setAskSheet(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: hairline, borderColor: t.ring, padding: 20, paddingBottom: 30, maxHeight: '88%' }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{SCAN_CONSENT_KICKER}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>{SCAN_CONSENT_TITLE}</Text>
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>{scanConsentWho(sheetRecipients)}</Text>
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{SCAN_CONSENT_WHAT}</Text>
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{scanConsentRetention(sheetRecipients)}</Text>
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{SCAN_CONSENT_IF_YOU_DECLINE}</Text>
            <View style={{ marginTop: sp.xl, gap: sp.sm }}>
              <Cta label={SCAN_CONSENT_SEND_LABEL} a11yLabel={scanConsentSendA11y(sheetRecipients)} wide
                onPress={() => { const a = askSheet; if (!a) return; setAskSheet(null); void runSheetRead(a.fromCamera, 'granted'); }} />
              <Ghost label={SCAN_CONSENT_TYPE_LABEL} a11yLabel={SCAN_CONSENT_TYPE_A11Y}
                onPress={() => { const a = askSheet; if (!a) return; setAskSheet(null); void runSheetRead(a.fromCamera, 'refused'); }} />
              <Ghost label={SCAN_CONSENT_CANCEL_LABEL} a11yLabel={SCAN_CONSENT_CANCEL_A11Y}
                onPress={() => setAskSheet(null)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Correcting or removing one scan ────────────────────────────────
          A separate sheet from Add rather than a mode on it. Add is a long
          flow — photograph the printout, read it, check three boxes, pick a
          date, and it announces what your new targets are afterwards — and
          none of that applies to fixing a digit. More to the point, Add's Save
          would INSERT: reusing it would have made every correction a second
          scan on the same day, which `sorted` folds by day so the wrong one
          would simply have won again. */}
      <Modal visible={editing != null} transparent animationType="slide" onRequestClose={() => setEditId(null)}>
        {/* The keyboard covered all three fields, and nothing here could move.
            This sheet is anchored to the bottom of the screen and had neither a
            KeyboardAvoidingView nor a scroller, so a decimal-pad keyboard came up
            over Weight, Body fat and Muscle and the member was typing into boxes
            they could not see — on the sheet whose entire purpose is checking a
            digit. The Add sheet above got this right; this one was written as a
            plain View and never revisited.

            scripts/check-keyboard.mjs did not catch it, and says why in its own
            header: it walks to the scroller CONTAINING the field, so a short
            sheet with no scroller in it is invisible to the rule. That is a
            deliberate narrowing, not an oversight, and this is the case it names.

            Same mechanism as the Add sheet at the top of this file: `padding`
            needs something above the sheet for it to compress, and the scrim
            Pressable below is that flex:1 sibling. Without a sibling to eat the
            padding the wrapper is inert — which is the exact dead-KeyboardAvoidingView
            bug that check-keyboard.mjs was written for. */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setEditId(null)} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{editing ? fmt(editing.takenAt) : ''}</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Correct This Scan</Text>
            </View>
            <Ghost label="Close" onPress={() => setEditId(null)} />
          </View>

          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg, alignItems: 'flex-end' }}>
            <Field label="Weight" hint={wu} a11y={wu === 'kg' ? 'Weight in kilograms' : 'Weight in pounds'}>
              <TextInput value={eWt} onChangeText={setEWt} keyboardType="decimal-pad" style={input} />
            </Field>
            <Field label="Body fat" hint="%" a11y="Body fat percentage">
              <TextInput value={eBf} onChangeText={setEBf} keyboardType="decimal-pad" style={input} />
            </Field>
            <Field label="Muscle" hint={wu} a11y={wu === 'kg' ? 'Skeletal muscle in kilograms' : 'Skeletal muscle in pounds'}>
              <TextInput value={eSm} onChangeText={setESm} keyboardType="decimal-pad" style={input} />
            </Field>
          </View>

          {/* The date is deliberately not editable here. A scan's date is what
              decides whether it is the one the meal plan follows, and moving it
              is a different act from fixing a digit — one that can silently
              hand the client's targets to a different reading. Deleting and
              re-adding says out loud what changing the date would do quietly. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>
            {editing && cd.scans.length > 0 && cd.scans[cd.scans.length - 1].id === editing.id
              ? 'This is your most recent scan, so correcting it moves your daily calorie and protein targets with it.'
              : 'Correcting an older scan changes your charts and your total change since starting, not your daily targets.'}
            {' '}To change the date, delete this scan and add it again.
          </Text>

          <Cta label={eBusy ? 'Saving…' : 'Save Correction'} wide disabled={eBusy} onPress={saveEdit} />
          <View style={{ marginTop: sp.md, alignItems: 'center' }}>
            <Ghost label="Delete This Scan" onPress={removeScan} />
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={physOpen} transparent animationType="slide" onRequestClose={() => setPhysOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setPhysOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
            <Text style={{ ...ty.title, color: t.ink }}>{physBusy ? 'Analyzing…' : 'AI physique read'}</Text>
            <Ghost label="Close" onPress={() => setPhysOpen(false)} />
          </View>
          {physBusy ? (
            <Text style={{ ...ty.body, color: t.ink3, paddingVertical: sp.lg }}>Reading your photo for body composition and focus areas…</Text>
          ) : phys ? (
            <View>
              {phys.bodyFatPct != null ? (
                <View style={{ marginBottom: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Estimated body fat</Text>
                  <Text style={{ ...value(30), color: t.ink, marginTop: 2 }}>{phys.bodyFatPct}%</Text>
                </View>
              ) : null}
              {phys.notes ? <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{phys.notes}</Text> : null}
              {phys.focusAreas.length > 0 ? (
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Focus next on</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {phys.focusAreas.map((a) => (<View key={a} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: sp.sm }}><Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{a}</Text></View>))}
                  </View>
                  {recommendedExercises(focusToGroups(phys.focusAreas)).length > 0 ? (
                    <View style={{ marginTop: sp.lg }}>
                      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Recommended moves · tap to watch form</Text>
                      {recommendedExercises(focusToGroups(phys.focusAreas)).map((ex) => (
                        <Pressable key={ex.name} onPress={() => Linking.openURL('https://www.youtube.com/results?search_query=' + encodeURIComponent('how to ' + ex.name + ' proper form'))} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                          <View style={{ flex: 1 }}><Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{ex.name}</Text><Text style={{ ...ty.caption, color: t.ink3 }}>{ex.group}</Text></View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="play" size={14} color={t.brand} /><Text style={{ ...ty.label, color: t.ink2 }}>Watch demo</Text></View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {focusToGroups(phys.focusAreas).length > 0 ? (
                    <View style={{ marginTop: sp.lg }}>
                      <Cta label="Emphasise These in My Plan" wide onPress={() => { cd.setFocusAreas(focusToGroups(phys.focusAreas)); setPhysOpen(false); Alert.alert('Plan updated', 'Your Train tab now emphasises ' + focusToGroups(phys.focusAreas).join(', ') + ' — those exercises are tagged and prioritised until your next photo.'); }} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>AI estimate for training guidance only — not medical advice.</Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
