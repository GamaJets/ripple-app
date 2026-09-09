// Cloud-API providers (WHOOP, Oura, Garmin, Fitbit) and Android Health Connect.
//
// These devices expose an OAuth-guarded REST API. connect() runs the vendor's
// OAuth in a browser (via ./oauth), a Supabase edge function stores the refresh
// token, and fetchToday() asks that function for the latest day. A provider is
// only "available" to connect once its client ID is configured (env var) — until
// then the UI shows exactly what the owner needs to register.
import { Platform } from 'react-native';
import type { WearableProvider, ProviderMeta, DailyMetrics, WorkoutSample } from './types';
import { emptyMetrics } from './types';
import type { SleepRead } from '../sleepMerge';
import { parseVendorSleep, vendorReadsSleep } from '../vendorSleep';
import { vendorFor, isConfigured } from './oauthConfig';
import { connectVendor, fetchVendorDay, disconnectVendor, fetchVendorWorkouts, fetchVendorSleep } from './oauth';
import { linkFor, noteMetric } from '../wearableLinkLedger';
import {
  fetchTrainingSleep, fetchTrainingToday, fetchTrainingWorkouts,
  requestTrainingAccess, trainingReadable, fetchTrainingHeartRateSamples,
} from './healthConnectTraining';

export function makeCloudProvider(meta: ProviderMeta): WearableProvider {
  const isHealthConnect = meta.kind === 'health-connect';
  const vendor = vendorFor(meta.id);

  /**
   * The one Health Connect sentence, so the row, the alert and the sleep list
   * cannot drift into three wordings of the same fact — which is precisely how
   * Watch & Devices and Recovery came to contradict each other about WHOOP.
   *
   * Both now end by naming what the person can actually use, because the real
   * question behind tapping this row is "how do I get my phone's health data
   * into Repple", and on Android that answer is not "nowhere": WHOOP and Oura
   * are browser OAuth and work identically there.
   */
  const healthConnectReason = (): string =>
    Platform.OS === 'android'
      ? 'This build of Repple does not contain the Health Connect reader. It is part of the app itself, so it arrives with a new version rather than in an update — WHOOP and Oura connect here today and are unaffected.'
      : 'Health Connect is Android’s health store, so there is nothing on this phone for it to read. Apple Health above is the equivalent here.';

  return {
    meta,
    isAvailable() {
      // False on EVERY platform, Android included. It used to return true on
      // Android, and that one `true` was the whole Android health story:
      //
      //   available → not `blocked` on Watch & Devices → a primary "Connect"
      //   button → `onConnect` skips the reason alert because the provider says
      //   it is available → `connect()` throws "Health Connect connects on
      //   Android via the native module — added in the Android build" → the
      //   state goes to 'error', which `describeLink` reads as 'never' → the
      //   button returns to "Connect".
      //
      // So an Android client was offered a control that could only ever produce
      // an error dialogue, and was then offered it again, with the app's own
      // sentence inviting them to try. That is the reconnect loop this file
      // family exists to prevent, wearing a different vendor's name: the app
      // asking somebody to fix something only we can fix.
      //
      // `react-native-health-connect` IS in the build now — it was added for
      // blood sugar, which src/lib/wearables/healthConnect.ts reads. This still
      // returns false, and that is not an oversight. The contract in types.ts
      // is about DAILY METRICS: steps, heart rate, calories, workouts. Nothing
      // reads any of those from Health Connect, and the glucose reader asks
      // for one record type on purpose — a permission screen listing six types
      // in order to ship one feature is a screen people stop reading, which is
      // the same argument `permissionSet` in appleHealth.ts makes.
      //
      // ── That is no longer true, and this now answers the same question with
      //    the same rigour and a different answer ─────────────────────────────
      //
      // `./healthConnectTraining.ts` reads steps, heart rate, calories,
      // workouts and sleep out of Health Connect under its own permission set,
      // so the DAILY METRICS contract this provider implements is one this
      // build can genuinely serve on Android.
      //
      // The question is still asked of the BINARY and not of a config file. All
      // this returns true on is `trainingReadable()` — Android, with the native
      // module actually compiled in — which is exactly what `isAvailable()` is
      // specified to mean. What it deliberately does NOT do is try to guess
      // whether the installed manifest declares the health permissions: that is
      // unknowable in-process, and every way of guessing it is wrong on the
      // builds it matters for (see TRAINING_MANIFEST_PERMISSIONS on why
      // Constants.expoConfig is a trap here).
      //
      // So the reconnect loop this comment was written about cannot come back,
      // and it is prevented differently: `connect()` below only ever succeeds
      // on a grant it watched arrive, and it fails with a sentence that names
      // both reasons a grant can be missing rather than blaming the member.
      if (isHealthConnect) return trainingReadable();
      // "once configured" was doing a lot of work in the old comment, and
      // nothing in the code. This returned true for EVERY cloud vendor —
      // including Fitbit and Garmin, whose client ids are empty strings in
      // app.json — so both were offered as connectable, `unavailableReason()`
      // was computed and then never consulted (the caller's guard is
      // `!isAvailable() && reason`, which cannot fire when this is true), and
      // the person was walked into an OAuth handshake that had no client id to
      // start it with. The reason text explaining exactly that was sitting one
      // function away the whole time.
      //
      // Garmin is `special: 'partnership'` — self-serve OAuth is not available
      // at any client id — so it is unavailable on a different ground, and
      // `unavailableReason()` already says which.
      return isConfigured(meta.id);
    },
    unavailableReason() {
      // Two different facts, and the old single sentence — "Health Connect is
      // Android-only — connect it from an Android device" — was the wrong one on
      // both platforms. On an iPhone it sent somebody to look for an Android
      // phone to do something that would not have worked there either. On
      // Android it never rendered at all, because the provider claimed to be
      // available and the caller's guard is `!isAvailable() && reason`.
      // Only ever consulted when `isAvailable()` is false, which for Health
      // Connect now means "not Android, or the module is not in this binary" —
      // so the sentence is about the device rather than about what Repple reads
      // from it.
      if (isHealthConnect) return healthConnectReason();
      // `clientNote`, not `note`. The owner's registration instructions — env
      // var names, our Supabase secret names — were being printed on a client
      // screen; see the field's own comment in oauthConfig.ts.
      if (vendor?.special === 'partnership') return vendor.clientNote;
      if (vendor && !isConfigured(meta.id)) return vendor.clientNote;
      return null;
    },
    async connect() {
      // Unreachable from Watch & Devices now that `isAvailable()` is false —
      // that screen shows the reason and never calls this. Kept as the backstop
      // for any caller that skips the check, and saying the SAME sentence,
      // because the previous one here ("added in the Android build") promised a
      // build that does not exist and named a module that was never added.
      if (isHealthConnect) {
        if (!trainingReadable()) throw new Error(healthConnectReason());
        // Connecting Health Connect is a PERMISSION GRANT, not an OAuth
        // handshake, so there is no token to store and nothing server-side to
        // record. What makes it a connection is that the member has said yes.
        //
        // The grant is re-read afterwards rather than inferred from the sheet
        // returning, and a PARTIAL grant counts as connected: Health Connect
        // lets somebody tick steps and leave heart rate, and refusing the
        // connection over a withheld heart rate would throw away the steps they
        // did agree to share.
        const granted = await requestTrainingAccess();
        if (!granted.length) {
          // The one sentence in this file that must not guess. See the header
          // of ./healthConnectTraining.ts: on Android an empty grant set is a
          // decline and an undeclared manifest permission wearing the same
          // clothes, and calling it a decline blames the member for a build.
          const read = await fetchTrainingToday();
          throw new Error(read.reason ?? 'Repple was not given access to Health Connect, so there is nothing to read.');
        }
        return;
      }
      await connectVendor(meta.id);
    },
    async disconnect() {
      if (isHealthConnect) return;
      await disconnectVendor(meta.id);
    },
    async fetchWorkouts(sinceDays = 14): Promise<WorkoutSample[]> {
      if (isHealthConnect) return fetchTrainingWorkouts(sinceDays);
      const raw = await fetchVendorWorkouts(meta.id, sinceDays);
      return raw.map((r: any) => ({
        id: String(r.id),
        activity: String(r.activity || 'Workout'),
        rawActivity: String(r.rawActivity || r.activity || 'Workout'),
        start: String(r.start),
        mins: Number(r.mins) || 0,
        kcal: typeof r.kcal === 'number' ? r.kcal : null,
        distanceKm: typeof r.distanceKm === 'number' ? r.distanceKm : null,
        avgHr: typeof r.avgHr === 'number' ? r.avgHr : null,
        maxHr: typeof r.maxHr === 'number' ? r.maxHr : null,
        source: meta.id,
      })).filter((x: WorkoutSample) => x.mins > 0 && !!x.start);
    },
    /**
     * Sleep from a cloud vendor.
     *
     * Three outcomes and never one. 'unsupported' says Repple has no reader for
     * this device — a fact about us, which leaves the night a plain dash.
     * 'error' says we asked and did not get an answer, which makes the night
     * UNKNOWN. And 'ready' with no readings is a real measurement of absence:
     * the vendor answered and holds no sleep for those nights. A dead token
     * throws `WearableNotConnectedError`, which `wearables/sleep.ts` turns into
     * its own 'error' sentence telling the person to reconnect — a different
     * problem with a different fix from a server that did not answer.
     *
     * The parsing lives in `src/lib/vendorSleep.ts`, on the device, because a
     * night is a LOCAL calendar day and the edge function runs in UTC.
     */
    async fetchSleep(sinceDays = 7): Promise<SleepRead> {
      // The four gaps below are all facts about REPPLE, not about the person's
      // device or their connection, so each is recorded as a metric-level
      // absence. That is what stops any of them being read one layer up as the
      // account being disconnected — and it is why the sentence they produce
      // opens by saying the device is connected and working.
      const absent = (why: string): SleepRead => {
        noteMetric(meta.id, 'sleep', { kind: 'absent', why });
        return { provider: meta.id, status: 'unsupported', readings: [], reason: why };
      };
      if (isHealthConnect) {
        // Not `absent()`. That helper records a metric-level gap in Repple and
        // returns 'unsupported' unconditionally, which was right when this
        // provider read no sleep at all and is wrong now that it reads it
        // properly: a Health Connect that could not be reached must come back
        // 'error', or a week of unknown nights renders as a week of no sleep in
        // the readiness average.
        if (!trainingReadable()) return absent(healthConnectReason());
        return fetchTrainingSleep(sinceDays);
      }
      if (vendor?.special === 'partnership') {
        return absent(`${meta.name} needs an approved partnership before Repple can read anything from it.`);
      }
      if (!isConfigured(meta.id)) {
        return absent(`${meta.name} is not set up yet, so there is nothing to read.`);
      }
      if (!vendorReadsSleep(meta.id)) {
        return absent(`${meta.name} does not publish a sleep endpoint Repple can read.`);
      }
      const res = await fetchVendorSleep(meta.id, sinceDays);
      if (!res.ok) {
        // A refusal is not a failure to reach the vendor, and must not borrow
        // that sentence. The endpoint answered — it answered "no" — because
        // this build never asked for the scope, and the only thing that changes
        // it is the person re-authorising. The wording comes from the shared
        // state machine so that this list, Watch & Devices and Recovery all say
        // the same thing about the same device.
        //
        // The status stays 'error' regardless, and deliberately: whichever of
        // the two it was, we do not know what the person slept. 'unsupported'
        // would let the night render as "no device recorded this" — which is
        // false, since WHOOP recorded it perfectly well and simply will not
        // show us.
        const reason = res.refused
          ? linkFor(meta.id, meta.name, 'connected', 'sleep').detail
          : `${meta.name} could not be read just now, so these nights are unknown rather than empty.`;
        return { provider: meta.id, status: 'error', readings: [], reason };
      }
      // meta.name rather than the vendor's own label, so the sentence on the
      // screen names the device the way the person connected it.
      return { provider: meta.id, status: 'ready', readings: parseVendorSleep(meta.id, res.records, meta.name) };
    },
    /** Android's half of the session zone rebuild. Health Connect only, and
     *  absent on a cloud vendor: WHOOP, Oura and Fitbit return day-level
     *  aggregates, so there are no per-second samples to rebuild anything
     *  from and offering the method would promise a precision they do not
     *  have. See `zonesFromSamples` for what the caller does with these. */
    ...(isHealthConnect ? {
      async fetchHeartRateSamples(startISO: string, endISO: string) {
        return fetchTrainingHeartRateSamples(startISO, endISO);
      },
    } : {}),

    async fetchToday(): Promise<DailyMetrics | null> {
      if (isHealthConnect) {
        // Null for every outcome except a read that worked — which is what the
        // contract asks for, and what stops a refused or failed read reaching a
        // screen as a day of zeroes. The REASON is not dropped on the floor: it
        // is what `connect()` above surfaces when the grant is missing, which
        // is the moment somebody is actually looking for it.
        const read = await fetchTrainingToday();
        return read.metrics;
      }
      const raw = await fetchVendorDay(meta.id);
      if (!raw) return null;
      const m = emptyMetrics(meta.id);
      m.activeKcal = typeof raw.activeKcal === 'number' ? raw.activeKcal : null;
      m.totalKcal = typeof raw.totalKcal === 'number' ? raw.totalKcal : null;
      m.steps = typeof raw.steps === 'number' ? raw.steps : null;
      m.heartRateAvg = typeof raw.heartRateAvg === 'number' ? raw.heartRateAvg : null;
      m.heartRateResting = typeof raw.heartRateResting === 'number' ? raw.heartRateResting : null;
      m.heartRateMax = typeof raw.heartRateMax === 'number' ? raw.heartRateMax : null;
      // Only accept the z1..z5 shape. An older edge-function deploy sends
      // {rest,warmup,aerobic,threshold,max}; taking that verbatim would render
      // as five empty zones rather than an obvious failure, so it is rejected.
      const rz = raw.zoneSeconds;
      const num = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
      m.zoneSeconds = rz && typeof rz === 'object' && ('z1' in rz || 'z4' in rz)
        ? { z1: num(rz.z1), z2: num(rz.z2), z3: num(rz.z3), z4: num(rz.z4), z5: num(rz.z5) }
        : null;
      m.workoutMins = typeof raw.workoutMins === 'number' ? raw.workoutMins : null;
      // ── The three the catalogue advertises and this map used to drop ──────
      //
      // registry.ts sells WHOOP on "Strain, recovery, sleep & heart rate" and
      // Oura on "Readiness, HRV & sleep". Seven fields were mapped here and the
      // rest of the payload was discarded, so Strain, Recovery and HRV appeared
      // in the device catalogue, appeared in the vendor's own app, and appeared
      // NOWHERE in Repple — the exact shape registry.ts's own header forbids: a
      // blurb promising something the provider layer refuses to hand over.
      //
      // Each stays null unless the edge function actually sent a number. An
      // undeployed wearable-day sends none of these, and a null renders as
      // unknown on every screen below rather than as a recovery of zero — which
      // on a screen whose job is to say whether to train today would be the
      // worst possible number to invent.
      const numOrNull = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
      m.hrv = numOrNull(raw.hrv);
      m.recoveryPct = numOrNull(raw.recoveryPct);
      // Derived from the provider rather than trusted from the payload: this
      // string is printed beside the figure as its attribution, and an
      // attribution taken from the same response it is meant to attribute is
      // not an attribution. Only the two vendors that publish such a score can
      // carry one, so anything else leaves it null even if a number arrived.
      m.recoverySource = m.recoveryPct != null && (meta.id === 'whoop' || meta.id === 'oura') ? meta.id : null;
      if (m.recoverySource == null) m.recoveryPct = null;
      // WHOOP's scale, so only WHOOP may fill it. See DailyMetrics.strain.
      m.strain = meta.id === 'whoop' ? numOrNull(raw.strain) : null;
      return m;
    },
  };
}
