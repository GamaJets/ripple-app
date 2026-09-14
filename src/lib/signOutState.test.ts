// What sign-out clears, and what it is not allowed to. Compile with tsc, run
// with node.
//
// Three failures are guarded, and all three have a handset in them:
//
//   1. A PERSON'S ANSWERS SURVIVING THEM. The four device-local preferences the
//      app keeps off the server — notification categories, quiet hours, the
//      biometric lock, the reminders — were inherited by the next account to
//      sign in on the phone, while the preferences screen told the member they
//      were "kept on this phone".
//
//   2. THE CLEAR TAKING TOO MUCH. `AsyncStorage.clear()` would also take the
//      cached gym name, which is the ONLY thing the signed-out screens have to
//      go on, and the per-account outbox, which holds writes the member has
//      been promised will go up when they have signal. Both are asserted as
//      absent from the list rather than left to a reviewer to notice.
//
//   3. AN ACCOUNT-SCOPED KEY ON A DEVICE-SCOPED LIST. The test for membership
//      of this list is "one person's answers under a key with no account in
//      it". A key carrying a uid is already private to that account and must
//      not be swept by a sign-out that may not even be that account's.
import {
  ACCOUNT_SCOPED_PREFIXES, KEPT_ON_SIGN_OUT, PERSONAL_DEVICE_KEYS, isPersonalDeviceKey,
} from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1 · the four that go ──────────────────────────────────────────────── */

{
  ok(isPersonalDeviceKey('repple.notifyPrefs'), 'the notification categories and quiet hours are cleared');
  ok(isPersonalDeviceKey('repple.appLock.enabled'), 'so is the biometric lock, which was left armed by somebody who had gone');
  ok(isPersonalDeviceKey('repple.reminders'), 'and so are the reminders, which were scheduled on the phone itself');
  // The fourth, and the only one that is a credential rather than a preference.
  // It is the member's Spotify access and refresh tokens, held on the handset
  // and nowhere else; before this, only tapping Disconnect on Meals › Music &
  // Playlists removed them, so the next person to sign in on a shared handset
  // inherited a live connection to somebody else's Spotify account — one whose
  // granted scopes let this app rewrite their playlists and control playback on
  // their devices.
  ok(isPersonalDeviceKey('repple.spotify.token'),
    'and so is the Spotify token, which is a credential for an account outside Repple entirely');
  // Three consents, found by sweeping every AsyncStorage key in the tree for
  // the shape `repple.mealOverride` and `repple.exerciseVideos` had. A consent
  // is the clearest case this list takes: forgetting one costs a question being
  // asked, and keeping one answers a question in somebody else's voice.
  ok(isPersonalDeviceKey('repple.coachShare'),
    'and the answer to whether a coach may see this person’s health data, which the next member inherited as a yes');
  ok(isPersonalDeviceKey('repple.photoAI'),
    'and the consent to send a photograph of a machine to an AI service');
  ok(isPersonalDeviceKey('repple.photoAI.meal'),
    'and the separate one for a photograph of somebody’s dinner');
  eq(PERSONAL_DEVICE_KEYS.length, 7, 'and nothing has joined the list without a line in this file about it');
}

/* ── 1b · one that is deliberately absent ──────────────────────────────── */

{
  // `repple.motivation.armed` holds OS notification ids, exactly as
  // `repple.reminders` does. Clearing it WITHOUT cancelling those ids first
  // leaves a stranger's evening nudge firing on the next member's phone with
  // nothing left in the app that knows its id — so it may only join this list
  // together with a cancel in src/ui/signOutState.ts. Asserted rather than
  // commented, because the next person to sweep these keys will find it again
  // and the reason it is missing has to be discoverable from the failure.
  ok(!isPersonalDeviceKey('repple.motivation.armed'),
    'the armed motivation nudges are not cleared here — their OS ids must be cancelled first, as the reminders are');
}

/* ── 2 · what must not go ──────────────────────────────────────────────── */

{
  for (const k of KEPT_ON_SIGN_OUT) {
    ok(!isPersonalDeviceKey(k), `${k} survives a sign-out — it is this device's, not this person's`);
  }
  // Named specifically, because this is the one whose loss would be visible on
  // the very next screen: the sign-in page of a white-label build reading the
  // supplier's name instead of the gym's.
  ok(!PERSONAL_DEVICE_KEYS.includes('repple.appName'),
    'the gym name cached for the signed-out screens is never cleared');
}

/* ── 3 · nothing account-scoped ────────────────────────────────────────── */

{
  for (const k of PERSONAL_DEVICE_KEYS) {
    for (const p of ACCOUNT_SCOPED_PREFIXES) {
      ok(!k.startsWith(p), `${k} is device-scoped — an account-scoped key must not be swept by a sign-out`);
    }
    ok(k.startsWith('repple.'), `${k} is one of this app's own keys`);
    // A uid in the key means the key is already private to that account, which
    // is a different mechanism from this one and must not be mixed with it.
    ok(!/[0-9a-f]{8}-[0-9a-f]{4}/i.test(k), `${k} carries no account id`);
  }
  ok(new Set(PERSONAL_DEVICE_KEYS).size === PERSONAL_DEVICE_KEYS.length, 'no key is listed twice');
  ok(!isPersonalDeviceKey('outbox:v1:abc'), 'an outbox is a person’s unsent work and survives their sign-out');
}


/* ── 4 · the two keys this file NAMES and could not clear ──────────────── */
//
// The rule stated in signOutState.ts has two halves, and only one of them is a
// list. "Key it by account when it holds their WORK or their RECORD — a
// member's plan edits, a coach's clips that never reached the server, BODY-SCAN
// METRICS, a draft." Body-scan metrics were named there as the example and were
// neither on the list nor in a key, which is the shape three separate lanes have
// now found four times.
//
// These two are asserted HERE, in the file that owns the rule, rather than in a
// suite of their own, because the failure they guard against is not a bug in
// either module — it is somebody later deciding the easy fix is an entry in
// `PERSONAL_DEVICE_KEYS`, which for a record destroys the data of the person who
// is LEAVING. The assertion has to fail in the file where that edit would be
// made.

import {
  SCAN_METRICS_PREFIX, LEGACY_SCAN_METRICS_KEY, SCAN_METRIC_FIELDS,
  scanMetricsKey, isScanMetricsKey, readScanMetrics, writeScanMetrics, mergeStoredMetrics,
} from './scanMetricsStore';
import {
  COACHING_MODE_PREFIX, LEGACY_COACHING_MODE_KEY, coachingModeKey, isCoachingModeKey,
} from './coachingModeStore';
import { METRIC_DEFS, type ScanMetrics } from './inbodyMetrics';
import { readCoachingMode, type CoachingMode, type CoachedMode } from './types';
import {
  clientModesKey, isClientModesKey, readClientModes, writeClientModes,
  LEGACY_CLIENT_MODES_KEY,
} from './clientModeOverrides';
import { accountStateStep } from './accountScopedState';
import {
  LEGACY_GOAL_TARGET_KEY, LEGACY_GOAL_TARGET_MIGRATED_KEY, LEGACY_GOAL_TARGET_KEYS,
  isLegacyGoalTargetKey,
} from './legacyGoalTarget';
import {
  SETTINGS_KEY, PERSONAL_SETTING_FIELDS, stripPersonalSettings, hasPersonalSettings,
} from './personalSettings';
import { consentFromStored } from './pushConsent';
import { soundFromStored } from './restTimer';

const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

{
  /* the account really is in the key */
  const a = scanMetricsKey('member-a')!;
  const b = scanMetricsKey('member-b')!;
  ok(a !== b, 'two members on one handset do not share a set of body-composition breakdowns');
  ok(a.includes('member-a') && a.startsWith(SCAN_METRICS_PREFIX) && isScanMetricsKey(a),
    'the account is in it and the key is recognisable as what it is');
  ok(!isScanMetricsKey(LEGACY_SCAN_METRICS_KEY), 'the unqualified key it replaces is not one of these');

  const ca = coachingModeKey('member-a')!;
  const cb = coachingModeKey('member-b')!;
  ok(ca !== cb, 'nor a coaching mode');
  ok(ca.startsWith(COACHING_MODE_PREFIX) && isCoachingModeKey(ca), 'and that key is recognisable too');
  ok(!isCoachingModeKey(LEGACY_COACHING_MODE_KEY), 'the unqualified coaching-mode key is not one of these');

  /* no account, no store — at either end */
  for (const bad of [null, undefined, '', '   ']) {
    eq(scanMetricsKey(bad), null, `${JSON.stringify(bad)} is not an account to file a body record under`);
    eq(coachingModeKey(bad), null, `${JSON.stringify(bad)} is not an account to file a coaching mode under`);
  }
  // The literal src/ui/clientData.tsx publishes as `id` before the auth read
  // lands. Using it as an account would give every signed-out session on the
  // handset one shared store, which is the defect itself.
  eq(scanMetricsKey('unknown'), null, "'unknown' is not an account");
  eq(coachingModeKey('unknown'), null, "'unknown' is not an account here either");
  eq(scanMetricsKey('  member-a  '), scanMetricsKey('member-a'), 'whitespace is not a second member');

  /* and neither key wants a sign-out entry — THIS is the assertion that has to
     fail in this file if somebody reaches for the easy fix. */
  for (const [name, isKey, legacy] of [
    ['the body-composition breakdowns', isScanMetricsKey, LEGACY_SCAN_METRICS_KEY],
    ['the coaching mode', isCoachingModeKey, LEGACY_COACHING_MODE_KEY],
  ] as [string, (k: string) => boolean, string][]) {
    ok(!PERSONAL_DEVICE_KEYS.some(isKey),
      `${name} are account-scoped — clearing them on sign-out would destroy the record of the person LEAVING`);
    ok(!KEPT_ON_SIGN_OUT.some(isKey), `nor are ${name} on the keep list, which is for this device's own things`);
    ok(!PERSONAL_DEVICE_KEYS.includes(legacy),
      `${legacy} is REMOVED on sight by the provider, not swept by a sign-out that may not be its owner's`);
  }
}

/* ── 5 · what the reader will accept back, because these are arithmetic ── */

{
  same(readScanMetrics(null), {}, 'nothing stored is no breakdowns');
  same(readScanMetrics(''), {}, 'and so is an empty string');
  same(readScanMetrics('{'), {}, 'a blob that will not parse is no breakdowns, not a throw');
  same(readScanMetrics('[1,2]'), {}, 'an array is not a map of days');
  same(readScanMetrics('null'), {}, 'nor is null');
  same(readScanMetrics('{"2026-06-01":{"bmr":1500,"visceralFat":8}}'), { '2026-06-01': { visceralFat: 8, bmr: 1500 } },
    'a real breakdown survives the round trip');

  // The day is the WHOLE of how a breakdown is matched to a scan — the merge
  // looks up `takenAt.slice(0, 10)` — so a key that is not one can match
  // nothing and is dropped rather than carried.
  same(readScanMetrics('{"2026-6-1":{"bmr":1500}}'), {}, 'a day that is not YYYY-MM-DD is dropped');
  same(readScanMetrics('{"2026-06-01T09:00:00Z":{"bmr":1500}}'), {}, 'and so is a full timestamp');

  // These thirteen numbers go to `metricTrends`, which filters on
  // `typeof v === 'number'` and then subtracts one from another. A stored NaN
  // passes that filter; a member is then told their lean mass moved by NaN.
  same(readScanMetrics('{"2026-06-01":{"bmr":null}}'), {}, 'a null figure is dropped — null is not zero');
  same(readScanMetrics('{"2026-06-01":{"bmr":"1500"}}'), {}, 'a string figure is dropped, not coerced');
  same(readScanMetrics('{"2026-06-01":{"leanMassKg":-3}}'), {}, 'a negative mass is dropped');
  same(readScanMetrics(`{"2026-06-01":{"bmr":${JSON.stringify(1e400)}}}`), {}, 'an infinite figure is dropped');
  same(readScanMetrics('{"2026-06-01":{"leanArmLKg":0,"leanArmRKg":3.3}}'),
    { '2026-06-01': { leanArmLKg: 0, leanArmRKg: 3.3 } },
    'but an exact zero is kept — a limb the machine could not read is a reading, and inbodyMetrics.test.ts pins what the app does with one');
  same(readScanMetrics('{"2026-06-01":{"bmr":1500,"sneaky":"x"}}'), { '2026-06-01': { bmr: 1500 } },
    'a field that is not a metric is dropped and does not take the good one with it');
  same(readScanMetrics('{"2026-06-01":{}}'), {},
    'an empty breakdown is not a breakdown — the same answer scansWithMetrics gives, and the same test addScan applies before writing one');
  same(readScanMetrics('{"2026-06-01":{"bmr":1500},"2026-07-01":{"bmr":null}}'), { '2026-06-01': { bmr: 1500 } },
    'one unreadable day does not take the readable one with it');

  /* the write end cannot store anything the read end would refuse */
  const good: Record<string, ScanMetrics> = { '2026-06-01': { bmr: 1500, leanMassKg: 55.2 } };
  same(readScanMetrics(writeScanMetrics(good)), good, 'the round trip is the identity');
  same(readScanMetrics(writeScanMetrics({ '2026-06-01': { bmr: NaN } } as unknown as Record<string, ScanMetrics>)), {},
    'a NaN is not written out to be read back as a measurement');
  // Nothing the reader would refuse is ever WRITTEN, so a stored blob cannot be
  // worse than what a reader will accept back. Asserted on the stored string
  // rather than on the round trip: a round trip is clean either way, because
  // the reader cleans it on the way out — which is exactly how a writer that
  // had stopped routing through the reader would go unnoticed until something
  // else read those bytes.
  eq(
    writeScanMetrics({
      'not-a-day': { bmr: 1500 },
      '2026-06-01': { bmr: 1500, leanMassKg: -1, sneaky: 'x' },
    } as unknown as Record<string, ScanMetrics>),
    JSON.stringify({ '2026-06-01': { bmr: 1500 } }),
    'a bad day, a negative mass and a field that is not a metric never reach the store at all',
  );
  eq(writeScanMetrics(null), '{}', 'nothing to write is an empty map, not a throw');

  // A field added to ScanMetrics and not to the reader would be silently
  // dropped and go missing from a screen a year later. The `satisfies` in
  // scanMetricsStore.ts makes that a compile error; this makes it a test
  // failure too, from the other direction — the table the screens draw.
  eq(SCAN_METRIC_FIELDS.length, METRIC_DEFS.length,
    'the reader accepts exactly the fields the screens chart');
  for (const d of METRIC_DEFS) {
    ok(SCAN_METRIC_FIELDS.includes(d.key), `${d.key} is charted, so the reader must accept it back`);
  }
}

/* ── 6 · the handset, RUN rather than read ─────────────────────────────── */
//
// A fake store and the REAL functions the provider calls, in the order it calls
// them: hydrate on a key, persist behind the key-and-hydrated guard, merge into
// the scans. What is modelled here and not imported is the effect ordering
// itself — that is the glue in clientData.tsx — and it is modelled explicitly so
// that a reader can check it against the file rather than take it on trust.

{
  type Store = Map<string, string>;
  /** One mounted provider, as it stands between renders. */
  type Session = { key: string | null; hydrated: boolean; metrics: Record<string, ScanMetrics> };
  const mount = (): Session => ({ key: null, hydrated: false, metrics: {} });

  /**
   * The key effect: what the provider does on mount and on every change of the
   * signed-in account. `storeRefuses` is the `.catch` branch — a device that
   * will not answer.
   */
  const signIn = (store: Store, s: Session, uid: string | null, storeRefuses = false) => {
    // Cleared BEFORE the read, on the SAME session object the last account
    // left behind. A flag that survived the key changing is the whole trap.
    s.hydrated = false;
    s.key = scanMetricsKey(uid);
    if (!s.key) { s.metrics = {}; return s; }
    if (storeRefuses) { s.metrics = {}; return s; }
    s.metrics = readScanMetrics(store.get(s.key) ?? null);
    s.hydrated = true;
    return s;
  };

  /** What `addScan` does with a breakdown. */
  const persist = (store: Store, s: Session, day: string, m: ScanMetrics) => {
    s.metrics = { ...s.metrics, [day]: m };
    if (s.key && s.hydrated) store.set(s.key, writeScanMetrics(s.metrics));
  };

  /** A fresh provider reading one account's key — for asserting what is on the
   *  device rather than what is in some session's memory. */
  const hydrate = (store: Store, uid: string | null) => signIn(store, mount(), uid);

  const A_METRICS: ScanMetrics = { visceralFat: 11, bmr: 1490, fatMassKg: 24.4, leanMassKg: 52.1 };
  const B_METRICS: ScanMetrics = { visceralFat: 4, bmr: 1810, fatMassKg: 11.2, leanMassKg: 66.9 };
  // The same date, which is the whole of how a breakdown finds a scan, and the
  // ordinary case at a gym whose InBody machine is on the floor.
  const DAY = '2026-06-01';
  const scanOf = (owner: string) => [{ id: `scan-${owner}`, takenAt: `${DAY}T09:00:00.000Z`, metrics: undefined as ScanMetrics | undefined }];

  /* ── the shared gym handset ─────────────────────────────────────────── */
  {
    const store: Store = new Map();
    // ONE session across all three, because that is what the app does: this
    // provider is mounted at the root and outlives every sign-out. The
    // in-memory half of this defect is only visible against a session that
    // survives, and it was the half nothing cleared — the SIGNED_OUT branch
    // blanked the scans and left the breakdowns standing.
    const live = mount();

    // Member A signs in and is scanned. Their breakdown is kept.
    signIn(store, live, 'member-a');
    persist(store, live, DAY, A_METRICS);
    same(mergeStoredMetrics(scanOf('a'), live.metrics)[0].metrics, A_METRICS,
      'A sees their own breakdown on their own scan');

    // A signs out. `clearPersonalDeviceState` touches only PERSONAL_DEVICE_KEYS,
    // and A's key is not on it — deliberately, because clearing it would destroy
    // A's record. What must go is the copy in memory.
    for (const k of PERSONAL_DEVICE_KEYS) store.delete(k);
    signIn(store, live, null);
    eq(live.key, null, 'signed out, there is no key to read or write');
    same(live.metrics, {},
      "and A's breakdown is not left in memory — the provider outlives the sign-out, and this is the half no key change could fix");
    // Both guards are asserted, not just the arming one. A session with no key
    // must write NOWHERE — not to the unqualified key, which is the whole
    // defect, and not under the last account's key either. Stated directly
    // because the two guards are independent and the arming flag alone would
    // hide a missing key check.
    const keysBefore = [...store.keys()].sort();
    persist(store, { key: null, hydrated: true, metrics: {} }, DAY, A_METRICS);
    same([...store.keys()].sort(), keysBefore,
      'with no account there is no key, and a breakdown is kept for this session only — never under a shared one');

    // Member B signs in on the same phone and is scanned the same day.
    signIn(store, live, 'member-b');
    same(live.metrics, {}, "B's handset holds no breakdown of B's, because B has not been scanned on it");
    const bScan = mergeStoredMetrics(scanOf('b'), live.metrics)[0];
    eq(bScan.metrics, undefined,
      "and B's own scan carries no breakdown — not A's visceral fat, BMR, fat mass and lean mass under B's name");

    // And A's record is still there, for A.
    persist(store, live, DAY, B_METRICS);
    const aAgain = hydrate(store, 'member-a');
    same(aAgain.metrics[DAY], A_METRICS, "A's own breakdown survived both the sign-out and B's scan");
    same(hydrate(store, 'member-b').metrics[DAY], B_METRICS, "and B's is B's");
    ok(!store.has(LEGACY_SCAN_METRICS_KEY), 'nothing was ever written back to the unqualified key');
  }

  /* ── the single-owner handset: nothing it saw has changed ───────────── */
  {
    // The claim that has to be PROVED, because twenty-plus screens read this
    // provider: for one account on one phone, the breakdown that reaches the
    // scans is the same one the old unqualified key produced.
    const store: Store = new Map();
    const one = hydrate(store, 'sole-owner');
    persist(store, one, DAY, A_METRICS);
    persist(store, one, '2026-07-01', B_METRICS);

    const relaunch = hydrate(store, 'sole-owner');
    const scans = [
      { id: 's1', takenAt: '2026-06-01T09:00:00.000Z', metrics: undefined as ScanMetrics | undefined },
      { id: 's2', takenAt: '2026-07-01T09:00:00.000Z', metrics: undefined as ScanMetrics | undefined },
    ];
    // Exactly what the old expression produced, computed the old way, from the
    // same inputs. Not a restatement of the new code: the old merge, written
    // out, against `mergeStoredMetrics`.
    const oldWay = scans.map((s) => (s.metrics ? s : (relaunch.metrics[s.takenAt.slice(0, 10)]
      ? { ...s, metrics: relaunch.metrics[s.takenAt.slice(0, 10)] } : s)));
    same(mergeStoredMetrics(scans, relaunch.metrics), oldWay,
      'a single-account handset is handed exactly what the unqualified key handed it');

    // The server's own breakdown still wins, and a scan that has one is handed
    // back BY IDENTITY, so no consumer keyed on a scan object re-runs for a
    // record nobody touched.
    const withOwn = [{ id: 's1', takenAt: '2026-06-01T09:00:00.000Z', metrics: B_METRICS }];
    const merged = mergeStoredMetrics(withOwn, relaunch.metrics);
    ok(merged[0] === withOwn[0], "the row's own metrics win, and the object is not rebuilt");
    const none = mergeStoredMetrics(scans, {});
    ok(none[0] === scans[0] && none[1] === scans[1],
      'an empty cache returns the list element for element — the state of every signed-out session');
  }

  /* ── the trap: a key change whose read then fails ───────────────────── */
  //
  // The one this lane was warned about, and the one that LOSES a measurement
  // rather than merely showing the wrong one. It needs the SAME session object
  // across the account switch, because what is being asserted is that the
  // arming flag does not survive it.
  {
    const store: Store = new Map();
    // B has been scanned on this handset before, twice.
    const setup = hydrate(store, 'member-b');
    persist(store, setup, '2026-05-01', B_METRICS);
    persist(store, setup, DAY, B_METRICS);

    // A is signed in now, and their read lands, so their session is armed.
    const live = mount();
    signIn(store, live, 'member-a');
    persist(store, live, DAY, A_METRICS);
    ok(live.hydrated, "A's read landed, so A's session may write");

    // A signs out, B signs back in — and B's read REFUSES this time.
    signIn(store, live, null);
    signIn(store, live, 'member-b', true);
    ok(!live.hydrated, 'a read that did not land leaves the write disarmed');

    // B is scanned. Nothing may be written, because an empty map is not "B has
    // no breakdowns" — it is "we could not find out".
    persist(store, live, '2026-08-01', B_METRICS);
    same(readScanMetrics(store.get(scanMetricsKey('member-b')!) ?? null),
      { '2026-05-01': B_METRICS, [DAY]: B_METRICS },
      "B's two stored breakdowns survive a refused read followed by a scan — an empty map is never written over them");
    same(hydrate(store, 'member-a').metrics[DAY], A_METRICS,
      "and A's record is untouched by any of it");
  }
}

/* ── 7 · the coaching mode, which reached the SERVER ───────────────────── */
//
// The reconciler in src/ui/clientData.tsx, replayed. It is the same three-way
// choice, over the real key builder and the real `readCoachingMode`, because
// what was wrong was never the branches — it was that `mine` came off a key that
// named nobody.

{
  const reconcile = (store: Map<string, string>, uid: string | null, row: { mode: string; trainerId: string | null }) => {
    const stored = readCoachingMode(row.mode);
    const key = coachingModeKey(uid);
    const mine = readCoachingMode(key ? store.get(key) ?? null : null);
    const agreed: CoachingMode =
      mine === 'hybrid' && stored === 'inperson' ? 'hybrid'
      : mine === 'solo' && row.trainerId == null ? 'solo'
      : stored;
    // The half that leaves the handset: `update({ mode: agreed }).eq('id', uid)`.
    return { agreed, promotedToServer: agreed !== stored ? agreed : null };
  };

  const store = new Map<string, string>();
  // Member A, on the gym handset, sets themselves to solo.
  store.set(coachingModeKey('member-a')!, 'solo');
  eq(reconcile(store, 'member-a', { mode: 'online', trainerId: null }).agreed, 'solo',
    'A still gets their own answer back, which is what this mechanism is FOR');

  // A signs out — the key is account-scoped, so a sign-out leaves it alone.
  for (const k of PERSONAL_DEVICE_KEYS) store.delete(k);

  // Member B signs in: a new member, or one between coaches, so the row says
  // online with no trainer — the exact shape that satisfied the solo branch.
  const b = reconcile(store, 'member-b', { mode: 'online', trainerId: null });
  eq(b.agreed, 'online', "B is not silently switched to solo by the previous member's answer");
  eq(b.promotedToServer, null,
    "and nothing is written to B's server row, where their coach's roster and the console read it");

  // The branch above it inherited the same way.
  store.set(coachingModeKey('member-a')!, 'hybrid');
  const b2 = reconcile(store, 'member-b', { mode: 'inperson', trainerId: null });
  eq(b2.agreed, 'inperson', "nor does A's 'hybrid' widen B's 'inperson'");
  eq(b2.promotedToServer, null, 'and that one does not reach the server either');

  // A's own answer, meanwhile, still promotes — the feature is intact.
  const a2 = reconcile(store, 'member-a', { mode: 'inperson', trainerId: null });
  eq(a2.agreed, 'hybrid', "A's fuller answer still fills in what the column could not say");
  eq(a2.promotedToServer, 'hybrid', 'and is still promoted once, to A');

  // A linked coach is the server contradicting the device, and the server wins.
  store.set(coachingModeKey('member-c')!, 'solo');
  eq(reconcile(store, 'member-c', { mode: 'online', trainerId: 'coach-1' }).agreed, 'online',
    'a linked trainer means the server is right and the device is out of date — unchanged');

  // Signed out, the device says nothing at all and the server stands.
  eq(reconcile(store, null, { mode: 'online', trainerId: null }).agreed, 'online',
    'with nobody signed in there is no device answer to read');
  eq(reconcile(store, 'unknown', { mode: 'online', trainerId: null }).agreed, 'online',
    "and 'unknown' is not an account to read one from");
}


/* ── 8 · the client-mode overrides, and how far this one actually reaches ── */
//
// `repple.clientModes` (src/ui/roster.tsx), the tail of the same class. Lane
// 101's sweep found NO server path for it and that is confirmed here rather than
// repeated: `setClientMode` writes the mode to `clients` / `coach_clients` and
// this map is only the local echo held until the server accepts one. So an
// inherited entry cannot be promoted anywhere and cannot become a figure.
//
// What it CAN do is shadow a fact on one screen, and that is what is proved
// below: the roster applies the map by client id, so an entry bites on any
// client the next coach also has — the ordinary case for two trainers sharing a
// gym's desk handset. A preference leak. Fixed the same way because the shape is
// identical; not dressed up as more than it is.

{
  const store = new Map<string, string>();

  /** What `rememberMode` / `forgetMode` do, with both guards. */
  interface Modes { key: string | null; hydrated: boolean; modes: Record<string, CoachedMode> }
  const mount = (): Modes => ({ key: null, hydrated: false, modes: {} });

  /** `hydrate`, replayed over the REAL rule — `accountStateStep`, the one the
   *  provider calls — rather than a second copy of it that could agree with the
   *  test while disagreeing with the app. The arming flag and the key are put
   *  back BEFORE the read, which is the trap. */
  const signIn = (s: Modes, uid: string | null, readRefuses = false): Modes => {
    const step = accountStateStep({ key: clientModesKey(uid), onScreenKey: s.key, onScreenSaved: s.hydrated });
    if (step.do === 'hold') return s;
    if (step.do === 'forget') { s.modes = {}; s.hydrated = false; s.key = null; return s; }
    if (step.forget) s.modes = {};
    s.hydrated = false;
    s.key = null;
    if (readRefuses) return s;
    s.modes = readClientModes(store.get(step.key) ?? null);
    s.key = step.key;
    s.hydrated = true;
    return s;
  };

  const remember = (s: Modes, id: string, mode: CoachedMode) => {
    s.modes = { ...s.modes, [id]: mode };
    if (s.key && s.hydrated) store.set(s.key, writeClientModes(s.modes));
  };

  /** The line the roster actually renders through. */
  const applied = (s: Modes, roster: { id: string; mode: CoachedMode }[]) =>
    (Object.keys(s.modes).length ? roster.map((c) => (s.modes[c.id] ? { ...c, mode: s.modes[c.id] } : c)) : roster);

  /* the account really is in the key */
  ok(clientModesKey('coach-a') !== clientModesKey('coach-b'),
    'two coaches on one handset do not share a set of classifications');
  ok(isClientModesKey(clientModesKey('coach-a')!), 'and the key is recognisable as what it is');
  ok(!isClientModesKey(LEGACY_CLIENT_MODES_KEY), 'the unqualified key it replaces is not one of these');
  for (const bad of [null, undefined, '', '   ', 'unknown']) {
    eq(clientModesKey(bad), null, `${JSON.stringify(bad)} is not an account to file a classification under`);
  }
  eq(clientModesKey('  coach-a  '), clientModesKey('coach-a'), 'whitespace is not a second coach');

  /* ── the shared desk handset, and the client both coaches have ────────── */
  {
    // ONE session across all of it: RosterProvider is mounted for the life of
    // the app, so the in-memory half is only visible against a session that
    // survives the sign-out.
    const live = mount();
    // A client BOTH coaches are linked to. This is the whole reason the leak
    // bites at all — an id only one coach has would match nothing.
    const SHARED = 'client-shared';

    signIn(live, 'coach-a');
    remember(live, SHARED, 'hybrid');
    same(applied(live, [{ id: SHARED, mode: 'online' }]), [{ id: SHARED, mode: 'hybrid' }],
      "A's own classification still wins over the column for A, which is what this echo is FOR");

    // A signs out. The key is account-scoped, so the sweep leaves it alone —
    // deliberately: it is A's, and A is entitled to it when they come back.
    for (const k of PERSONAL_DEVICE_KEYS) store.delete(k);
    signIn(live, null);
    eq(live.key, null, 'signed out, there is no key to read or write');
    same(live.modes, {},
      "and A's classifications are not left in memory — the provider outlives the sign-out");

    // Coach B signs in on the same phone and opens the same client.
    signIn(live, 'coach-b');
    same(applied(live, [{ id: SHARED, mode: 'online' }]), [{ id: SHARED, mode: 'online' }],
      "B reads the SERVER's mode for the client they share — not A's 'hybrid' under B's own name");

    // A write from a session with no account goes nowhere at all. Asserted
    // directly, because the two guards are independent and the arming flag
    // alone would hide a missing key check.
    const before = [...store.keys()].sort();
    remember({ key: null, hydrated: true, modes: {} }, SHARED, 'inperson');
    same([...store.keys()].sort(), before,
      'with no coach there is no key, and a tap is kept for this session only — never under a shared one');

    // And A's own answer survived all of it, for A.
    remember(live, SHARED, 'inperson');
    same(readClientModes(store.get(clientModesKey('coach-a')!) ?? null), { [SHARED]: 'hybrid' },
      "A's classification is still A's");
    same(readClientModes(store.get(clientModesKey('coach-b')!) ?? null), { [SHARED]: 'inperson' },
      "and B's is B's");
    ok(!store.has(LEGACY_CLIENT_MODES_KEY), 'nothing was ever written back to the unqualified key');
  }

  /* ── A straight to B, with no signed-out tick in between ───────────────── */
  //
  // The case that does NOT pass through a null session, and the one the
  // `forget` half of the rule exists for. `authRev` bumps on SIGNED_IN, so a
  // token refresh that lands as a different account — or a sign-in that beats
  // the sign-out sweep — re-runs `hydrate` with the previous coach's map still
  // in React state. `expo-router`'s Tabs keep these screens mounted, so that
  // state is not transient.
  {
    store.clear();
    const live = mount();
    signIn(live, 'coach-a');
    remember(live, 'client-shared', 'hybrid');

    // Straight to B — and B's read REFUSES, which is what makes this bite: if
    // the drop waited on the read, there would be nothing to replace A's map
    // with and it would simply stay.
    signIn(live, 'coach-b', true);
    same(live.modes, {},
      "A's classifications are dropped on the way IN, before B's read lands and whatever it decides");
    ok(!live.hydrated, 'and a read that did not land leaves the writer disarmed');
    same(readClientModes(store.get(clientModesKey('coach-a')!) ?? null), { 'client-shared': 'hybrid' },
      "while A's own copy is untouched on the device — dropped from memory is not dropped from storage");
  }

  /* ── a session that merely went quiet is not a sign-out ────────────────── */
  {
    // auth-js emits a null session whenever `getSession()` errors — an access
    // token that could not be refreshed in a basement weights room. The coach is
    // still signed in and auth-js restores them on the next tick.
    store.clear();
    const live = mount();
    signIn(live, 'coach-a');
    remember(live, 'client-1', 'hybrid');

    // The blip. Everything the coach has is already under their own key, so the
    // rule drops it from MEMORY and from nowhere else.
    signIn(live, null);
    same(readClientModes(store.get(clientModesKey('coach-a')!) ?? null), { 'client-1': 'hybrid' },
      'a quiet session never takes anything off the device — that is the departing coach’s, and they have not departed');

    // And when the session comes back it is the same account, so the read
    // refills it rather than the screen having invented an empty roster filter.
    signIn(live, 'coach-a');
    same(live.modes, { 'client-1': 'hybrid' }, 'and the coach gets their own classifications back');
  }

  /* ── the trap: a key change whose read then fails ─────────────────────── */
  {
    // A fresh handset. The block above left entries under both coaches' keys,
    // and what is being proved here is about a read that fails, not about what
    // an earlier scenario happened to store.
    store.clear();
    const solo = mount();
    signIn(solo, 'coach-b');
    remember(solo, 'client-1', 'hybrid');
    remember(solo, 'client-2', 'inperson');

    const live = mount();
    signIn(live, 'coach-a');
    ok(live.hydrated, "A's read landed, so A's session may write");

    // A signs out; B signs back in and B's read REFUSES this time.
    signIn(live, null);
    signIn(live, 'coach-b', true);
    ok(!live.hydrated, 'a read that did not land leaves the write disarmed');

    // B classifies somebody. Nothing may be written: an empty map is not "B has
    // classified nobody", it is "we could not find out".
    remember(live, 'client-3', 'online');
    same(readClientModes(store.get(clientModesKey('coach-b')!) ?? null),
      { 'client-1': 'hybrid', 'client-2': 'inperson' },
      "B's two stored classifications survive a refused read followed by a tap");
  }

  /* ── what the reader accepts back ──────────────────────────────────────── */
  same(readClientModes(null), {}, 'nothing stored is no overrides');
  same(readClientModes('not json'), {}, 'and a blob that will not parse is no overrides, not a crash');
  same(readClientModes('null'), {}, 'nor is JSON null an override map');
  same(readClientModes('[]'), {}, 'nor is an array');
  same(readClientModes('{"c1":"onlne"}'), {},
    'a misspelt mode is left OUT rather than defaulted to online — a damaged value is not somebody classifying a client');
  same(readClientModes('{"c1":3}'), {}, 'and a number is not a mode');
  same(readClientModes('{"c1":"hybrid","c2":"inperson","c3":"online"}'),
    { c1: 'hybrid', c2: 'inperson', c3: 'online' }, 'the three real modes all survive the round trip');
  same(readClientModes(writeClientModes({ c1: 'hybrid' })), { c1: 'hybrid' },
    'and the writer and the reader cannot drift');
}

/* ── 9 · the target weight, which reached the SERVER ───────────────────── */
//
// The one item in this class that was not an inheritance of a preference. The
// migration in src/ui/goalTracker.tsx read a device-global blob and INSERTED it
// into `goal_targets` under a freshly-resolved uid, so a shared handset published
// one member's target weight as another's — and a target weight is the
// denominator `progressOf` divides by, so the coach read a correct percentage of
// a goal their client never set.
//
// There is no key builder to assert here, and that absence is the point: the
// blob has had no writer since goals moved to the server, so account-scoping it
// would leave a key that can never be filled. What is assertable is that both
// keys are dropped and that neither has been quietly reintroduced by either of
// the two lists.

{
  same([...LEGACY_GOAL_TARGET_KEYS], ['repple.goalTarget', 'repple.goalTarget.migrated'],
    'both keys go: the blob, and the device-global flag that said the migration had already run');
  ok(isLegacyGoalTargetKey(LEGACY_GOAL_TARGET_KEY) && isLegacyGoalTargetKey(LEGACY_GOAL_TARGET_MIGRATED_KEY),
    'and both are recognisable as keys that are dropped rather than kept');
  ok(!isLegacyGoalTargetKey('repple.goalTargets'), 'a near-miss is not one of them');

  for (const k of LEGACY_GOAL_TARGET_KEYS) {
    ok(!PERSONAL_DEVICE_KEYS.includes(k),
      `${k} is removed UNREAD by the provider, not swept by a sign-out — a sign-out is not the only moment it must not be read at`);
    ok(!KEPT_ON_SIGN_OUT.includes(k), `${k} is not kept either — nothing writes it and nothing may read it`);
  }

  // The guard flag was device-global too, which is the half that is easy to
  // miss: whoever signed in first spent the migration for everybody on the
  // handset. Dropping the blob without it would leave a flag claiming a
  // migration had run for an account that never had one.
  ok(LEGACY_GOAL_TARGET_KEYS.includes(LEGACY_GOAL_TARGET_MIGRATED_KEY),
    'the guard flag goes with the blob it guarded, not after it');
}

/* ── 10 · the push consent, and which way that list runs ───────────────── */
//
// Lane 101's item: `notifPush` is a CONSENT filed as a preference, and it belongs
// on `PERSONAL_DEVICE_KEYS`.
//
// THE DIRECTION WAS CHECKED BEFORE ANYTHING MOVED, because the two readings are
// opposites. `PERSONAL_DEVICE_KEYS` is the CLEARED list — src/ui/signOutState.ts
// does `multiRemove([...PERSONAL_DEVICE_KEYS])` — and `KEPT_ON_SIGN_OUT` is the
// preserved one. So the prescription points the right way, and that is asserted
// here rather than believed.
//
// Its GRANULARITY was wrong, though, and that is the part that needed changing.
// The list is consumed by `multiRemove`, so an entry is all-or-nothing about a
// whole key — and 'repple.settings' holds two of this person's answers beside the
// cache of an account-scoped one. Putting the key on the list would clear the
// leaver's units, which is the record-destroying half of this file's own rule.

{
  // The direction, stated as a property. Every key on the cleared list is absent
  // from the kept list and vice versa; there is no key that is both, so no
  // reading of either list can be a preservation and a removal at once.
  for (const k of PERSONAL_DEVICE_KEYS) {
    ok(!KEPT_ON_SIGN_OUT.includes(k), `${k} is on the CLEARED list, so it cannot also be on the kept one`);
  }
  // The settled cases, named. A consent on PERSONAL_DEVICE_KEYS is removed from
  // the handset — that is what those three entries already mean, and it is what
  // `notifPush` was asked to join.
  ok(isPersonalDeviceKey('repple.coachShare') && isPersonalDeviceKey('repple.photoAI'),
    'the consents already on the list are there to be CLEARED, which is the direction the push consent needed');
  ok(KEPT_ON_SIGN_OUT.includes('repple.appName'),
    'and the list that PRESERVES is the other one — putting a consent on it would achieve the reverse');

  // The key itself stays off the flat list, and the reason is asserted where the
  // edit would be made.
  ok(!PERSONAL_DEVICE_KEYS.includes(SETTINGS_KEY),
    'repple.settings is not swept whole — it holds the leaver’s unit cache, and multiRemove cannot take only part of a key');
  ok(!KEPT_ON_SIGN_OUT.includes(SETTINGS_KEY),
    'nor is it simply kept, which is what left one person’s push answer for the next');
  same([...PERSONAL_SETTING_FIELDS], ['notifPush', 'restSound'],
    'the consents are named as fields, and the units are deliberately not among them');
  for (const f of PERSONAL_SETTING_FIELDS) {
    ok(f !== 'weightUnit' && f !== 'lengthUnit',
      `${f} — a unit is the cache of an ACCOUNT setting; stripping it would destroy a pre-migration choice`);
  }

  /* ── the shared handset, one blob ──────────────────────────────────────── */
  {
    // A answers no to push and no to the rest chime, and has chosen pounds.
    const stored = JSON.stringify({ notifPush: false, restSound: false, weightUnit: 'lb', lengthUnit: 'in' });
    eq(consentFromStored(stored), 'no', "A's answer is read as A's answer — the case this whole gate is about");

    // A signs out.
    const left = stripPersonalSettings(stored);
    ok(left != null, 'something survives, because A’s units are in the same blob');
    const after = JSON.parse(left!) as Record<string, unknown>;
    eq(after.notifPush, undefined, "A's push answer is off the handset");
    eq(after.restSound, undefined, 'and so is their answer about the chime');
    eq(after.weightUnit, 'lb', "A's unit is untouched — it is the only copy of a choice made before the column existed");
    eq(after.lengthUnit, 'in', 'both of them');

    // B signs in and reads the same blob.
    eq(consentFromStored(left), 'yes',
      "B is returned to the product default, which is the TRUE state: B has not been asked");
    eq(soundFromStored(left), 'yes', 'and the same for the rest chime');
    ok(!hasPersonalSettings(left), 'nothing of A’s answers is left in the blob to be inherited');
  }

  /* ── the blob that is nothing but consents ─────────────────────────────── */
  eq(stripPersonalSettings(JSON.stringify({ notifPush: false })), null,
    'a blob holding only this person’s answers leaves nothing worth keeping, so the key goes');
  eq(stripPersonalSettings(null), null, 'nothing stored is nothing to strip');
  eq(stripPersonalSettings('not json'), null,
    'and damage is removed rather than preserved — it holds no readable unit either, and both readers treat it as a fresh install');
  eq(stripPersonalSettings('[]'), null, 'an array is not a settings blob');
  eq(stripPersonalSettings('null'), null, 'nor is JSON null');

  /* ── an untouched blob is not rewritten ────────────────────────────────── */
  {
    const units = JSON.stringify({ weightUnit: 'kg' });
    ok(!hasPersonalSettings(units), 'a blob with no consents in it has nothing of anybody’s to take out');
    same(JSON.parse(stripPersonalSettings(units)!), { weightUnit: 'kg' },
      'and it comes back with its units intact');
  }

  /* ── the field list is the whole rule ──────────────────────────────────── */
  {
    // A field nobody has thought about yet is KEPT. That is the conservative
    // direction: keeping one costs an inheritance that is already happening,
    // stripping one nobody considered could destroy a record.
    const withNew = JSON.stringify({ notifPush: true, somethingNew: 7 });
    same(JSON.parse(stripPersonalSettings(withNew)!), { somethingNew: 7 },
      'an unrecognised field is kept — only the named ones are this person’s to take');
  }
}


/* ── 8 · the three exits, driven over ONE handset ──────────────────────── */
//
// A session in this app ends in three places and only one of them used to sweep
// anything. This is that handset: one long-lived store, one long-lived sweep
// log, driven through a deliberate sign-out, a white-label mismatch and a
// session ended somewhere else, asserting after EACH that the seven keys are
// off the device.
//
// ── What is real here and what is modelled ────────────────────────────────
//
// The decisions are real: `sessionIsLiveAt`, `pushDisposition`, `keysToClear`,
// `remindersKeyMayGo`, `tokenLeftBehind`, `makeSweepLog`, the key list itself
// and `savedFromStored` are the functions src/ui/signOutState.ts calls. What is
// modelled is the DEVICE — AsyncStorage, the OS notification scheduler and the
// `push_tokens` row — because none of the three exists under node. The model is
// written out so that a reader can check it against the file rather than take
// it on trust, and section 9 below asserts the call sites separately, against
// the source, so that a sweep removed from an exit fails here rather than on a
// shared gym handset.

import {
  SWEEP_CAUSES, keysToClear, makeSweepLog, pushDisposition, pushLine, remindersKeyMayGo,
  sessionIsLiveAt, sweepLine, sweptClean, tokenLeftBehind,
  type PushDisposition, type ReminderDisposition, type SweepCause, type SweepLog, type SweepRecord,
} from './signOutSweep';
import { savedFromStored } from './reminderPlan';

// src/ui/reminderSync.tsx owns it; written out because that module cannot be
// imported under node, and asserted against the list so a rename fails here.
const REMINDERS_KEY = 'repple.reminders';
const SPOTIFY_KEY = 'repple.spotify.token';

{
  ok(PERSONAL_DEVICE_KEYS.includes(REMINDERS_KEY),
    'the reminders key named in this file is the one on the list — a rename must fail here, not on a phone');
  ok(PERSONAL_DEVICE_KEYS.includes(SPOTIFY_KEY), 'and so is the Spotify credential');
}

{
  /** One handset, as the sweep can see it. */
  interface Handset {
    store: Map<string, string>;
    /** The OS notification ids this phone is actually holding. */
    scheduled: Set<string>;
    /** Whether a row for this handset is still in `push_tokens`. */
    registered: boolean;
    /** What `revokePushToken` answers. `false` is its own answer for a delete
     *  it could not PROVE — see its header — and 'throws' is the call blowing
     *  up before it answers at all. */
    revoke: boolean | 'throws';
    /** Whether this build has an OS scheduler (`pushAvailable`). */
    scheduler: boolean;
    /** Whether the device will answer a read of the reminders key. */
    remindersReadable: boolean;
    /** Whether the device will answer the read-back after the clear. */
    readBack: boolean;
  }

  const handset = (): Handset => ({
    store: new Map(), scheduled: new Set(), registered: false,
    revoke: true, scheduler: true, remindersReadable: true, readBack: true,
  });

  /** A member signs in on this phone and uses it: all seven keys written, a
   *  weekly reminder scheduled by the OS, a push row on the server. */
  const signIn = (h: Handset, who: string) => {
    for (const k of PERSONAL_DEVICE_KEYS) h.store.set(k, `${who}:${k}`);
    h.store.set(REMINDERS_KEY, JSON.stringify({ hydration: true, ids: [`notif-${who}-6am`] }));
    h.store.set(SPOTIFY_KEY, JSON.stringify({ access: `spotify-access-${who}`, refresh: `spotify-refresh-${who}` }));
    h.scheduled.add(`notif-${who}-6am`);
    h.registered = true;
    return h;
  };

  /**
   * `clearPersonalDeviceState`, modelled over the real decisions.
   *
   * The steps and their order are src/ui/signOutState.ts: the push half first
   * while there is a session, the reminders cancelled BY ID before the key they
   * are listed in can go, then the clear, then the read-back.
   */
  const sweep = (h: Handset, log: SweepLog, cause: SweepCause, uid: string | null, at: number): SweepRecord => {
    /* 1 — the push half, and only where there is a session to do it under */
    let push: PushDisposition;
    if (!sessionIsLiveAt(cause)) {
      push = pushDisposition({ cause, priorRevoked: log.pushProvenGoneFor(uid) });
    } else {
      push = pushDisposition({ cause, proven: h.revoke === 'throws' ? null : h.revoke });
      // Only a delete that was PROVEN takes the row off. `revokePushToken`
      // answering false may mean the delete was refused or that the verify
      // could not be made, and neither is a row that is gone.
      if (push === 'revoked') h.registered = false;
    }

    /* 2 — the reminders, cancelled by id off the key about to be cleared */
    let reminders: ReminderDisposition;
    if (!h.scheduler) reminders = 'no-scheduler';
    else if (!h.remindersReadable) reminders = 'ids-unknown';
    else {
      const raw = h.store.get(REMINDERS_KEY) ?? null;
      if (raw == null) reminders = 'none-stored';
      else { for (const id of savedFromStored(raw).ids) h.scheduled.delete(id); reminders = 'cancelled'; }
    }

    /* 3 — the clear, then the read-back */
    for (const k of keysToClear(PERSONAL_DEVICE_KEYS, reminders, REMINDERS_KEY)) h.store.delete(k);
    const left = h.readBack ? PERSONAL_DEVICE_KEYS.filter((k) => h.store.has(k)) : null;

    return log.record({ cause, uid, at, push, reminders, left });
  };

  /** What is still on the phone of the seven. The assertion every path gets. */
  const onDevice = (h: Handset) => PERSONAL_DEVICE_KEYS.filter((k) => h.store.has(k));

  /* ── the shared gym handset, through all three exits ─────────────────── */
  {
    const h = handset();
    const log = makeSweepLog();
    let clock = 1_000;

    /* ── exit one: the member taps Sign Out ───────────────────────────── */
    signIn(h, 'member-a');
    same(onDevice(h), [...PERSONAL_DEVICE_KEYS], 'A has used this phone and all seven keys are on it');

    const a = sweep(h, log, 'deliberate', 'member-a', clock++);
    same(onDevice(h), [], 'after a deliberate sign-out nothing of A’s is left on the handset');
    eq(a.push, 'revoked', 'the session was alive, so the push row could be deleted and read back as gone');
    ok(!h.registered, 'and this phone is off A’s notification list');
    eq(a.reminders, 'cancelled', 'A’s 6am reminder was cancelled by id');
    ok(!h.scheduled.has('notif-member-a-6am'), 'so the OS is no longer holding it');
    eq(sweptClean(a), true, 'and the device was read back rather than assumed');
    ok(!tokenLeftBehind(a.push), 'nothing about this handset is left pointing at A');

    /* ── and the second pass that sign-out itself causes ───────────────── */
    //
    // `signOut` sweeps and THEN calls `sbSignOut()`, and ending a session is
    // exactly what fires `onAuthStateChange` with no session. So this runs on
    // every ordinary sign-out, over keys that are already gone, and it must be
    // harmless AND must not file a false alarm about a registration nobody left.
    const a2 = sweep(h, log, 'remote', 'member-a', clock++);
    same(onDevice(h), [], 'the second pass finds nothing and removes nothing');
    eq(a2.push, 'already-revoked',
      'and it does not report a token left behind — the pass a moment earlier proved that row gone');
    ok(!tokenLeftBehind(a2.push), 'so the double sweep raises no alarm of its own');
    eq(a2.reminders, 'none-stored', 'nor does it claim to have cancelled reminders that were already cancelled');
    eq(sweptClean(a2), true, 'and it is still true that nothing is left');
    // Append-only: the first record is not amended by the second.
    eq(log.all().length, 2, 'both passes are recorded');
    eq(log.all()[0].push, 'revoked', 'and the first one still says what it did — a correction is a second fact, not an erasure');

    /* ── exit two: a white-label mismatch ─────────────────────────────── */
    //
    // This branch ended the session and swept NOTHING, so all seven keys stayed
    // — including a live Spotify access and refresh token for an account
    // outside Repple entirely.
    signIn(h, 'member-b');
    ok(h.store.has(SPOTIFY_KEY), 'B has connected Spotify on this phone');
    const b = sweep(h, log, 'brand-mismatch', 'member-b', clock++);
    same(onDevice(h), [], 'a brand mismatch takes B’s things off the handset too');
    ok(!h.store.has(SPOTIFY_KEY),
      'and specifically the Spotify tokens — a credential for an account this app does not own');
    eq(b.push, 'revoked',
      'the guard runs while the session is still alive, so the push row can be deleted there and proven gone');
    ok(!h.registered, 'and this phone is off B’s notification list as well');
    ok(!h.scheduled.has('notif-member-b-6am'), 'B’s reminder is cancelled, not orphaned');

    /* ── exit three: the handset is LOST and signed out from a laptop ─── */
    //
    // The path that matters most and can do least. No session, so the local half
    // is all there is — and the half that was not done is recorded rather than
    // left to be inferred from nothing having thrown.
    signIn(h, 'member-c');
    const c = sweep(h, log, 'remote', 'member-c', clock++);
    same(onDevice(h), [], 'a session ended remotely still takes all seven keys off the handset');
    ok(!h.store.has(SPOTIFY_KEY), 'including the Spotify credential, on the path a lost phone actually takes');
    ok(!h.scheduled.has('notif-member-c-6am'), 'and the reminders are cancelled by id before their key goes');
    eq(c.reminders, 'cancelled', 'the local half is done in full');
    eq(sweptClean(c), true, 'and proven, by reading the device back');

    // The half it could NOT do.
    eq(c.push, 'no-session', 'the push row could not be deleted, because there was no session to delete it under');
    ok(tokenLeftBehind(c.push), 'so this handset is still on C’s notification list and the record says so');
    ok(h.registered, 'which is the truth: the row is still there');
    ok(!pushLine('no-session').includes('failed'),
      'and it is not described as a failure — nothing failed, the call could not be made');
    ok(pushLine('no-session').includes('settings.tsx'),
      'the reconciler that will remove the row is named, so a reader is not left thinking it is lost forever');
    ok(sweepLine(c).includes('still on the server'),
      'and the one-line summary never states the local half without the server half beside it');
  }

  /* ── a lost handset is not excused by somebody else's revoke ─────────── */
  {
    // A signs out properly; B's session then ends remotely on the same phone.
    // B's token is NOT covered by A's revoke, and a log keyed loosely would say
    // it was.
    const h = handset();
    const log = makeSweepLog();
    signIn(h, 'member-a');
    sweep(h, log, 'deliberate', 'member-a', 1);
    signIn(h, 'member-b');
    const b = sweep(h, log, 'remote', 'member-b', 2);
    eq(b.push, 'no-session', 'A’s revoke says nothing about B’s row');
    ok(tokenLeftBehind(b.push), 'so B’s handset is reported as still registered');

    // And a remote end for which nobody ever read a user id gets the
    // conservative answer rather than the convenient one.
    const anon = sweep(h, log, 'remote', null, 3);
    eq(anon.push, 'no-session', 'not knowing whose session ended is not permission to assume it was covered');
  }

  /* ── the reminders key whose ids could not be read ───────────────────── */
  {
    // The ordering hazard, from the other end. If the ids cannot be READ, the
    // key is the only thing that could ever produce them again — so it stays,
    // the sweep says it stayed, and the OS notification is not made permanent.
    const h = handset();
    h.remindersReadable = false;
    const log = makeSweepLog();
    signIn(h, 'member-d');
    const d = sweep(h, log, 'deliberate', 'member-d', 1);

    eq(d.reminders, 'ids-unknown', 'a read that did not land is not an empty list of ids');
    ok(!remindersKeyMayGo('ids-unknown'), 'so the key it would have listed them in may not be cleared');
    same(onDevice(h), [REMINDERS_KEY],
      'the reminders key survives — it is the only handle left on a notification the OS is still holding');
    ok(h.scheduled.has('notif-member-d-6am'),
      'and that notification is still cancellable, which is the whole reason the key was kept');
    eq(sweptClean(d), false, 'the sweep does not claim to have taken everything');
    ok(sweepLine(d).includes(REMINDERS_KEY), 'and it names what is still there');

    // Everything else still went.
    ok(!h.store.has(SPOTIFY_KEY), 'the other six are gone — one unreadable key does not hold up the rest');
    ok(!h.store.has('repple.coachShare'), 'including the consent about somebody’s health data');
  }

  /* ── a revoke that could not be PROVEN is not a revoke ───────────────── */
  {
    const h = handset();
    h.revoke = false;               // `revokePushToken`'s own answer for "could not establish"
    const log = makeSweepLog();
    signIn(h, 'member-e');
    const e = sweep(h, log, 'deliberate', 'member-e', 1);
    eq(e.push, 'not-proven', 'a delete that came back unproven is not reported as done');
    ok(tokenLeftBehind(e.push), 'the row may still be there, and that is what a caller can act on');
    ok(h.registered, 'because it is still there');
    // The one that would have been invisible: an unproven revoke followed by
    // the remote pass must not be laundered into 'already-revoked'.
    const e2 = sweep(h, log, 'remote', 'member-e', 2);
    eq(e2.push, 'no-session', 'and the pass that follows it does not inherit a success nobody had');
    ok(tokenLeftBehind(e2.push), 'so the alarm is still raised on the second pass');

    // A throw is its own answer and is also not a success.
    const h2 = handset();
    h2.revoke = 'throws';
    const l2 = makeSweepLog();
    signIn(h2, 'member-f');
    const f = sweep(h2, l2, 'deliberate', 'member-f', 1);
    eq(f.push, 'threw', 'a revoke that blew up before answering is its own disposition');
    ok(tokenLeftBehind(f.push), 'and it too leaves the handset reported as registered');
    ok(!l2.pushProvenGoneFor('member-f'), 'nothing about it may excuse a later pass');
  }

  /* ── a device that will not answer the read-back ─────────────────────── */
  {
    // `multiRemove` resolving is not evidence. With the read-back refused, the
    // sweep must say it does not know rather than say it is clean.
    const h = handset();
    h.readBack = false;
    const log = makeSweepLog();
    signIn(h, 'member-g');
    const g = sweep(h, log, 'deliberate', 'member-g', 1);
    eq(g.left, null, 'a read-back that could not be made is null, not an empty list');
    eq(sweptClean(g), null, 'so whether the handset is clean is UNKNOWN — which is neither true nor false');
    ok(sweepLine(g).includes('not known'), 'and the summary says so in those words');
  }

  /* ── a build with no scheduler ───────────────────────────────────────── */
  {
    const h = handset();
    h.scheduler = false;
    const log = makeSweepLog();
    signIn(h, 'member-h');
    const s8 = sweep(h, log, 'deliberate', 'member-h', 1);
    eq(s8.reminders, 'no-scheduler', 'with no OS scheduler there is nothing holding a notification');
    ok(remindersKeyMayGo('no-scheduler'), 'so the key is only data and may go with the rest');
    same(onDevice(h), [], 'and it does');
  }

  /* ── the causes, stated as a set ─────────────────────────────────────── */
  {
    eq(SWEEP_CAUSES.length, 3, 'three exits, and a fourth may not be added without a line here');
    eq(SWEEP_CAUSES.filter(sessionIsLiveAt).length, 2,
      'two of them run while the session is alive; the third is an event about it having ended');
    ok(!sessionIsLiveAt('remote'), 'and that third one is the remote end, which is the whole distinction');
    for (const cause of SWEEP_CAUSES) {
      // No cause may produce a disposition that quietly reads as done.
      const d = pushDisposition({ cause, proven: false });
      ok(tokenLeftBehind(d) || d === 'already-revoked',
        `${cause}: a revoke that could not be proven never comes back as 'revoked'`);
    }
  }
}

/* ── 9 · the call sites, asserted against the SOURCE ───────────────────── */
//
// Sections 1 to 8 hold the decisions. This one holds the wiring, and it has to:
// the three defects this suite was extended for were not wrong decisions, they
// were a correct sweep that two of the three exits never called. A model cannot
// catch that. Reading the file can.
//
// The filesystem is reached through a locally-declared `require` for the reason
// consoleRoutes.test.ts sets out: two TypeScript configurations compile this
// file and only one of them has node types.

declare const require: (id: string) => any;
const { readFileSync: readSrc, existsSync: srcExists } = require('node:fs') as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};

const AUTH_FILE = 'src/ui/auth.tsx';
const FLOOR_FILE = 'src/ui/floorQueue.ts';

if (!srcExists(AUTH_FILE) || !srcExists(FLOOR_FILE)) {
  // Loud rather than a section that silently asserts nothing and prints "ok".
  console.error('signOutState.test.ts — src/ui not found; run from the repository root.');
  process.exit(1);
}

const countOf = (hay: string, needle: string): number => hay.split(needle).length - 1;

{
  const auth = readSrc(AUTH_FILE, 'utf8');

  /* every exit sweeps, and names which exit it is */
  for (const cause of SWEEP_CAUSES) {
    eq(countOf(auth, `clearPersonalDeviceState({ cause: '${cause}'`), 1,
      `${AUTH_FILE} sweeps the handset on the '${cause}' exit, exactly once`);
  }

  /* and it sweeps BEFORE the session is ended, which is the whole ordering */
  //
  // The push-token delete is `user_id = auth.uid()` and can only be made from
  // inside the session being ended, so a sweep moved below `sbSignOut()` would
  // still compile, still run, and still leave the row. Positional rather than
  // presence-only for exactly that reason.
  {
    const ends: number[] = [];
    let from = 0;
    for (;;) {
      const at = auth.indexOf('await sbSignOut()', from);
      if (at < 0) break;
      ends.push(at);
      from = at + 1;
    }
    eq(ends.length, 2, 'there are two places this app ends a live session, and both are known to this test');
    for (const at of ends) {
      const before = auth.slice(0, at);
      const swept = before.lastIndexOf('clearPersonalDeviceState({ cause:');
      ok(swept >= 0, 'a session is never ended without the handset having been swept first');
      ok(swept >= 0 && countOf(before.slice(swept), '\n') <= 6,
        'and the sweep is immediately above it — a revoke after the session ends is a revoke that cannot succeed');
    }
  }

  /* the path with no session does the local half, and only from that branch */
  {
    const branch = auth.indexOf('if (!session) {');
    ok(branch >= 0, 'the remote end has a branch of its own rather than a one-line setUser(null)');
    const rest = auth.slice(branch);
    const remote = rest.indexOf("clearPersonalDeviceState({ cause: 'remote'");
    const elseAt = rest.indexOf('} else refreshFromSession()');
    ok(remote >= 0 && elseAt >= 0 && remote < elseAt,
      'a session ended remotely sweeps the device inside that branch — the case a member on a LOST handset takes');
  }
}

{
  const floor = readSrc(FLOOR_FILE, 'utf8');

  /* nothing is left floating without a `.catch`, at either call site */
  eq(countOf(floor, 'void loadFloorQueue('), 0,
    'no load is left floating — a rejection there is silent AND the flush behind it never runs again');
  eq(countOf(floor, 'await loadFloorQueue(uid);'), 2,
    'both callers await the load, so a rejection has somewhere to be caught');
  eq(countOf(floor, 'catch (e) { loadFailed(uid, e); return; }'), 2,
    'and both say what a failed load MEANS rather than swallowing it');
  eq(countOf(floor, 'void flushAll(uid);'), 0, 'nor is the flush left floating');
  eq(countOf(floor, "catch (e) { reportError('floorQueue.flush', e); }"), 2,
    'a flush that rejected is reported, and is not mistaken for a load that failed');

  /* and a failed load is not an empty queue */
  //
  // The state `loadFailed` latches is the point of the fix, not the `.catch`.
  // `readable = false` is what stops `persist` writing over a device nobody
  // could read and what makes the three screens say "could not be read" instead
  // of "nothing waiting"; `loaded = true` is what stops the module's flush
  // registration waiting forever on a read that is never coming.
  const body = floor.slice(floor.indexOf('function loadFailed('), floor.indexOf('/* ── the three senders'));
  ok(body.includes('readable = false;'),
    'a queue that could not be read is not written over, and is never reported as empty');
  ok(body.includes('loaded = true;'),
    'and the attempt is over, so the app’s flush registry stops skipping this queue forever');
  ok(body.includes('if (owner !== uid) return;'),
    'a failure belonging to an account that has since been replaced does not latch the new one’s state');
}


if (errors.length) {
  console.error(`signOutState: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('signOutState: ok');
