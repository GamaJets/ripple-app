// App settings — notification preferences + unit preferences.
//
// ── The unit preference used to be a device setting ────────────────────────
//
// Everything here lived in AsyncStorage under 'repple.settings' and nowhere
// else. For the two notification toggles that is arguable — push permission is
// a property of a handset. For units it is not: which unit a client reads in is
// a property of the client, and keeping it on the device meant a reinstall or a
// second handset silently put their weight back into kilograms. Unlike a lost
// notification toggle, that one changes what every figure on screen SAYS — a
// client who thinks in pounds opens the app on a new phone and appears to have
// lost 100 kg overnight. TF-37.
//
// So weightUnit and lengthUnit now follow the account (clients.weight_unit /
// clients.length_unit, part 61), with AsyncStorage kept as the cache that makes
// the first paint right and as the only store when there is no session or the
// backend is off. The push toggle is deliberately left device-local.
//
// ── The notification toggles used to be scenery ────────────────────────────
//
// `notifPush` and `notifEmail` were declared here, written here, rendered by
// app/(client)/settings.tsx — and read by nothing else in the app. Not one
// line. A member could turn push off, watch the switch move, relaunch and find
// it still off, and go on receiving every notification the app sends, because
// the only thing standing between them and a push was a boolean in
// AsyncStorage that no sender consulted.
//
// `notifEmail` is gone outright. Repple sends no email at all — there is no
// Resend or SendGrid key, no mail edge function, nothing that composes a
// message — so "Email Updates · Weekly summary & tips" described a product
// feature that does not exist rather than a preference that was not wired up.
// A switch cannot be connected to a system nobody has built.
//
// `notifPush` is now enforced, and enforced in the one place that reaches every
// sender at once: `push_tokens`. Every remote notification in this app goes out
// through the send-push edge function, which resolves recipients by reading
// their rows from that table — so a handset with no row there receives nothing,
// whatever the sending screen believes it is doing. That is why the gate lives
// at the token and not at each of the two dozen sendPush() call sites, none of
// which are this file's to edit and any one of which could be forgotten.
//
// ── Consent now gates REGISTRATION, not just delivery ─────────────────────
//
// Taking the row out of `push_tokens` was only half of it, and the missing half
// was the louder one. src/ui/auth.tsx called registerForPush() on every sign-in
// without reading this preference at all, so a member whose answer was no had
// the OS permission prompt raised at them and a fresh row written back — which
// is a false statement about their own privacy made by the app they went to in
// order to control it. This provider's reconciler could only ever chase that,
// and the comment on revokePushToken used to describe the chase.
//
// That call is gone from auth.tsx. Registration belongs to whoever knows the
// answer, which is this file, and the answer is now published synchronously to
// src/lib/pushConsent.ts the moment either the device cache lands or the member
// taps the switch. registerForPush() reads that latch itself and refuses unless
// it says 'yes' — so the launch-time window where nobody has read anything yet
// is a REFUSAL, not a guess. Registering one launch later costs a launch;
// prompting somebody who said no cannot be taken back.
//
// ── The push is gated on the read ──────────────────────────────────────────
//
// `synced` exists for the bug documented at length in clientData.tsx: a
// provider that pushes its state to the server before it has read the server's
// state overwrites the user's real answer with a constructed default, on every
// launch, forever. Nothing is written here until the row for this uid has come
// back — and if that read FAILS, nothing is ever written for that session,
// because a failed read is not permission to assume the server has nothing.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useAuthRevision } from './authRevision';
import { registerForPush, pushAvailable, handsetPushTokens, forgetRegisteredToken } from './pushNotifications';
import { consentFromStored, recordPushConsent } from '../lib/pushConsent';
import { assertWrote } from '../lib/wroteRows';
import type { WeightUnit, LengthUnit } from '../lib/units';
import { resolveUnits, deviceRegion, type UnitSource } from '../lib/unitPreference';

// Re-exported because every client screen has imported the weight unit from
// here since before there was a units module, and the shape of the union is
// not this provider's to own — src/lib/units.ts owns it, next to the
// conversions that depend on it.
export type { WeightUnit, LengthUnit };
export type { UnitSource };

/**
 * What is STORED. Both units are nullable, and that is the whole point of this
 * change: `clients.weight_unit` is NULL until somebody taps a unit, and until
 * this interface could say so, `useSettings()` had nowhere to put "never
 * chosen" and resolved it to 'kg' before any screen saw it. A member in the
 * United States was then shown kilograms on thirty screens, stated with exactly
 * the confidence of a real answer, and nothing on any of them admitted that
 * nobody had asked. See src/lib/unitPreference.ts.
 */
interface Settings { notifPush: boolean; weightUnit: WeightUnit | null; lengthUnit: LengthUnit | null }

/**
 * What may be WRITTEN. Narrower than `Settings` on purpose: null is a state the
 * store arrives in, never one a screen may put it into. A `set({ weightUnit:
 * null })` would have to mean "un-choose", which no control offers and which
 * would race the read that is forbidden from overwriting a device's value.
 */
type SettingsPatch = { notifPush?: boolean; weightUnit?: WeightUnit; lengthUnit?: LengthUnit };

/** What happened when somebody asked for push to be turned ON.
 *   · 'on'          — a token was obtained and this handset is registered.
 *   · 'no-build'    — expo-notifications is not in this binary, so no build of
 *                     the app on this phone can receive a push at all.
 *   · 'os-refused'  — the OS will not give us a token: notifications are off for
 *                     Repple in the phone's own settings, or this is a
 *                     simulator. The preference is still recorded, because the
 *                     member's answer is not the OS's to overrule — but nothing
 *                     will arrive until they change it there.
 *   · 'off'         — push is off and this handset is no longer registered.
 *   · 'off-pending' — the answer is stored, but the token could not be confirmed
 *                     gone. Said out loud rather than assumed: a member who has
 *                     just turned notifications off and then gets one needs to
 *                     have been warned it might happen. Retried every launch. */
export type PushResult = 'on' | 'no-build' | 'os-refused' | 'off' | 'off-pending';

/**
 * What a screen sees.
 *
 * `weightUnit` / `lengthUnit` are NOT nullable here, and that is the trade-off
 * this change makes deliberately rather than by omission — the reasoning is
 * written out in full in src/lib/unitPreference.ts. In short: an amount with no
 * currency has no true value to fall back on, so `money()` withholds it; a
 * weight has a true value in every unit at once, so withholding it would blank
 * the dashboard, the goal, the scans and two dozen more screens for anybody who
 * has not visited Settings. So an unchosen preference falls to the phone's own
 * region — the best available evidence, and right for almost everybody it is
 * applied to — and the guess is kept separable from an answer instead of being
 * laundered into one.
 *
 * `weightChosen` / `lengthChosen` are the honest values. They are what Settings
 * tints its pills from, what decides whether onboarding asks, and the only
 * thing that is ever written back to the account.
 */
interface SettingsValue {
  notifPush: boolean;
  /** The unit to render in — chosen if there is a choice, otherwise read off
   *  the handset's region. Always a real unit. */
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  /** What the member actually picked, or null because nobody has asked them. */
  weightChosen: WeightUnit | null;
  lengthChosen: LengthUnit | null;
  /** 'chosen' or 'device', per unit. A screen that is ABOUT the preference says
   *  so out loud; a screen that merely prints a weight does not, because a line
   *  of apology on thirty screens is a nag that gets no question answered. */
  weightSource: UnitSource;
  lengthSource: UnitSource;
  set: (patch: SettingsPatch) => void;
  /** Turn push on or off. Not folded into `set` because this one has to be
   *  awaited and has to be able to answer 'the OS said no' — a switch that
   *  slides across and then silently receives nothing is the bug this replaced. */
  setPushEnabled: (on: boolean) => Promise<PushResult>;
  /** True once the account's own preference has been read (or there was never
   *  going to be one — no session, backend off). Screens that want to avoid a
   *  visible flip from kg to lb on launch can wait on it; most do not need to,
   *  because the AsyncStorage cache usually already holds the right answer. */
  unitsLoaded: boolean;
}

// ── There is no default unit any more, and that is the fix ────────────────
//
// This line used to read `weightUnit: 'kg', lengthUnit: 'cm'`, with a paragraph
// above it explaining that metric is right for every market this product is
// sold into except the United States. That paragraph was true and the line was
// still the bug. `clients.weight_unit` is NULL until somebody taps a unit — the
// store was honest — and this constant resolved that NULL to 'kg' before
// `useSettings()` handed anything to a screen, so no screen in the app could
// tell a member who chose kilograms from a member nobody had ever asked. An
// American member who never opened Settings read kilograms everywhere, said
// with the confidence of their own choice, with nothing anywhere admitting it
// was the app's guess. Exactly the shape of the currency bug `money()` was
// fixed for.
//
// So the units start as null and stay null until a person answers. What to
// RENDER in the meantime is decided by `resolveUnits` from the handset's own
// region, separately, and carries a source so it can be labelled — see
// src/lib/unitPreference.ts for why that is the side of the trade-off this
// takes. The push default is unchanged: a boolean has no third state to lose.
const DEFAULTS: Settings = { notifPush: true, weightUnit: null, lengthUnit: null };

/**
 * The handset's region, read once for the life of the process.
 *
 * Once, because it cannot change while the app is running and because a value
 * that is re-derived per render would make the resolved unit a new object every
 * time. Read at module load rather than in an effect so the FIRST paint is
 * already in the right unit: resolving on a second pass is precisely the
 * kg→lb flicker `unitsLoaded` exists to let screens avoid.
 */
const DEVICE_REGION = deviceRegion();
const Ctx = createContext<SettingsValue | null>(null);

const isWeightUnit = (v: unknown): v is WeightUnit => v === 'kg' || v === 'lb';
const isLengthUnit = (v: unknown): v is LengthUnit => v === 'cm' || v === 'in';

/**
 * Is there still a row in `push_tokens` naming any of these tokens?
 *
 * Three answers, not two. `null` is "the read failed", and it is a different
 * fact from "there is no row" — this whole module turns on not confusing the
 * two, because reporting a token gone on the strength of a read that never
 * completed is how a member who switched notifications off goes on getting them.
 */
async function tokenRowsPresent(tokens: string[]): Promise<boolean | null> {
  const { data, error } = await supabase.from('push_tokens').select('token').in('token', tokens);
  if (error) { reportError('settings.push.revoke.verify', error); return null; }
  return (data?.length ?? 0) > 0;
}

/**
 * Take this handset's push token out of `push_tokens`, and prove it is gone.
 *
 * ── Turning it off has to REVOKE, not just stop ────────────────────────────
 *
 * `push_tokens` is not a preference table. It is the list of delivery addresses
 * the send-push edge function resolves recipients from, so a row that survives
 * the switch being turned off is a phone that keeps receiving. Stopping this
 * app from registering again would not have helped the fifteen accounts that
 * already have rows.
 *
 * ── The race this used to lose, and why it is gone ─────────────────────────
 *
 * src/ui/auth.tsx used to call registerForPush() on every sign-in,
 * unconditionally. On a launch where the member's answer was 'off' there were
 * two things happening at once — this provider revoking, auth.tsx writing it
 * back — and losing that race meant a live token for a member with the switch
 * off. The old version of this function coped by REGISTERING the token itself
 * first, on the reasoning that auth.tsx was writing the same row anyway, then
 * deleting twice. That is gone in both halves: auth.tsx no longer registers at
 * all, and registerForPush() now refuses unless consent is a recorded 'yes', so
 * there is nothing left to race and nothing to justify writing a row in order
 * to delete it.
 *
 * What replaces it is handsetPushTokens(), which reads this handset's token(s)
 * without asking the OS for anything and without writing anywhere. It also
 * covers the case the old version silently got wrong: a member who turned
 * notifications off for this app in the phone's own Settings and only later
 * turned this switch off. The OS will not mint a token then, the old code read
 * that as "nothing to delete" and returned TRUE, and the row stayed in the
 * table — deliverable again the day they re-enabled the OS permission. The
 * token is remembered on the device at registration, so it is still nameable.
 *
 * The delete is scoped to the token, not to the user: `push_tokens` is keyed by
 * token and a member may be signed in on a second handset whose own answer is
 * yes. Deleting by user_id would silence a phone whose owner never asked for it.
 *
 * ── Zero rows deleted is not an error, so the count is what is checked ─────
 *
 * A PostgREST DELETE matching no rows returns 204 with `error: null`. Under
 * `pt_self` (`user_id = auth.uid()`) a stale session, an expired JWT or a token
 * belonging to another account all arrive in exactly that silence. So the row
 * is READ first: once we know a row is there, a delete that matches nothing is
 * a genuine failure and assertWrote says so. Where the read found nothing there
 * is nothing to delete, and that is success without a delete being issued at
 * all — the case assertWrote would have wrongly called a failure.
 *
 * Resolves TRUE only when nothing in `push_tokens` can reach this handset any
 * more. A failed delete and a failed verify both resolve FALSE: "we could not
 * check" is not "it is gone", and this is the switch where the difference is
 * the member getting a notification they turned off.
 */
async function revokePushToken(cancelled: () => boolean): Promise<boolean> {
  const tokens = await handsetPushTokens();
  // This handset has never registered and the OS will not name a token for it,
  // so there is no row that could be ours. Nothing to delete is not a failure.
  if (!tokens.length) return true;
  if (cancelled()) return false;
  // ── Without a session, "no row" is not an answer ──────────────────────────
  //
  // `pt_self` is `user_id = auth.uid()` for ALL commands, so an expired or
  // missing JWT does not produce an error on either half of this: the SELECT
  // comes back as an empty array and the DELETE comes back 204 with
  // `Content-Range: */0`. Verified on the live database by issuing exactly
  // those two requests with the anon key against a row that was, and stayed,
  // present. Both are indistinguishable from the row being gone — which would
  // have this function report a handset revoked while it goes on receiving.
  //
  // So identity is established before any of it is believed. No session means
  // this cannot be done now, not that it is done: the caller turns that into
  // 'off-pending', which says so out loud, and the reconciler retries on the
  // next launch.
  const { data: auth, error: whoErr } = await supabase.auth.getUser();
  if (whoErr || !auth?.user?.id) { reportError('settings.push.revoke', whoErr ?? new Error('no session to revoke a push token under')); return false; }
  if (cancelled()) return false;
  // Two attempts, each verified. One would do now that nothing else registers
  // concurrently; the second covers a reconciler run from a previous auth
  // revision that has not yet noticed it was cancelled putting the row back
  // between the delete and the check — cheap to survive, expensive to be wrong
  // about.
  for (let attempt = 0; attempt < 2; attempt++) {
    const present = await tokenRowsPresent(tokens);
    if (present === null) return false;              // could not check ≠ gone
    if (!present) { await forgetRegisteredToken(); return true; }
    if (cancelled()) return false;
    const res = await supabase.from('push_tokens').delete({ count: 'exact' }).in('token', tokens);
    try {
      // Named in the member's words: this sentence can reach reportError and,
      // through 'off-pending', the alert on the settings screen.
      assertWrote('This phone’s notification registration', res);
    } catch (e) {
      reportError('settings.push.revoke', e);
      return false;
    }
    if (cancelled()) return false;
  }
  const stillThere = await tokenRowsPresent(tokens);
  if (stillThere === null) return false;
  if (!stillThere) { await forgetRegisteredToken(); return true; }
  reportError('settings.push.revoke', new Error('push token was re-registered after two deletes'));
  return false;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const rev = useAuthRevision();
  const [unitsLoaded, setUnitsLoaded] = useState(!USE_SUPABASE);
  // Which uid this provider may write to, and only once its row has been read.
  // A ref rather than state because `set` is called from an event handler that
  // must see the current value, not the one from the render it was created in.
  const writable = useRef<string | null>(null);
  /** Which table this account's units live in. `clients` for a client;
   *  `profiles` for a coach or owner, who has no clients row. Set by the read
   *  so the write cannot go somewhere the read never looked. */
  const unitHome = useRef<'clients' | 'profiles'>('clients');
  const latest = useRef<Settings>(s);
  latest.current = s;

  // The device cache: what makes the first paint right rather than making
  // everybody watch their weight change units a second after launch.
  //
  // `cacheLoaded` gates the push reconciler below, and it is not optional. Until
  // this read lands, `s.notifPush` is still the DEFAULTS value — true — so a
  // reconciler that ran before it would register a push token for the one member
  // whose stored answer is that they do not want one, on every single launch.
  const [cacheLoaded, setCacheLoaded] = useState(false);
  useEffect(() => { (async () => {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem('repple.settings');
      if (raw) {
        // Read key by key rather than spreading the parsed object over state.
        // Every phone that ran an older build still has `notifEmail` in this
        // blob, and a blind spread would carry a setting the app no longer has
        // back into state and then straight back into storage, for good.
        const c = JSON.parse(raw) as Record<string, unknown>;
        const patch: Partial<Settings> = {};
        if (typeof c.notifPush === 'boolean') patch.notifPush = c.notifPush;
        if (isWeightUnit(c.weightUnit)) patch.weightUnit = c.weightUnit;
        if (isLengthUnit(c.lengthUnit)) patch.lengthUnit = c.lengthUnit;
        if (Object.keys(patch).length) setS((prev) => ({ ...prev, ...patch }));
      }
    } catch { raw = null; }
    finally {
      // Publish the answer before anything is allowed to act on it. Until this
      // line runs, src/lib/pushConsent.ts says 'unknown' and registerForPush()
      // refuses outright — which is what stops a sign-in that beat this read
      // from putting the OS permission prompt in front of somebody whose stored
      // answer is no. consentFromStored applies the same default this state
      // does (`DEFAULTS.notifPush`, on), including for a blob that failed to
      // parse, so the switch on the settings screen and the token store cannot
      // disagree about what an unreadable device is assumed to have said.
      recordPushConsent(consentFromStored(raw));
      setCacheLoaded(true);
    }
  })(); }, []);

  // The account's answer, which wins over the cache when there is one. Keyed on
  // the auth revision, not on mount: providers that read on mount alone ran
  // before anybody had signed in and were never asked again — see authRevision.tsx.
  useEffect(() => {
    if (!USE_SUPABASE) { setUnitsLoaded(true); return; }
    let cancelled = false;
    writable.current = null;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        // Signed out: the device cache is the whole story, and there is nothing
        // to push to. Not an error state.
        if (!uid) { if (!cancelled) setUnitsLoaded(true); return; }
        const { data, error } = await supabase
          .from('clients').select('weight_unit, length_unit').eq('id', uid).maybeSingle();
        if (cancelled) return;
        if (error) {
          // The read failed. Leave `writable` null so nothing is pushed for the
          // rest of this session: the client may well have chosen pounds on
          // another device, and publishing this device's default over it is
          // precisely the failure this guard exists for.
          reportError('settings.units.read', error);
          setUnitsLoaded(true);
          return;
        }
        // maybeSingle rather than single: a trainer or owner signed into the
        // same build has no `clients` row, and that is an absence, not a fault
        // to report.
        //
        // It used to mean they kept a DEVICE-LOCAL preference — which survived
        // a relaunch, not a reinstall, and never followed them to a second
        // phone. In practice every coach was pinned to kilograms. profiles
        // carries the same two columns now (part 82) precisely because it is
        // the one table an account has whatever its role, so the fallback is a
        // real account-level answer rather than a handset's.
        let row: { weight_unit?: unknown; length_unit?: unknown } | null = data ?? null;
        let home: 'clients' | 'profiles' = 'clients';
        if (!row) {
          const { data: prof, error: profErr } = await supabase
            .from('profiles').select('weight_unit, length_unit').eq('id', uid).maybeSingle();
          if (cancelled) return;
          if (profErr) {
            // Same reasoning as the clients read above: a failed read leaves
            // `writable` null so this device publishes nothing over a choice
            // made elsewhere.
            reportError('settings.units.read', profErr);
            setUnitsLoaded(true);
            return;
          }
          row = prof ?? null;
          home = 'profiles';
        }
        unitHome.current = home;
        if (row) {
          const patch: Partial<Settings> = {};
          if (isWeightUnit(row.weight_unit)) patch.weightUnit = row.weight_unit;
          if (isLengthUnit(row.length_unit)) patch.lengthUnit = row.length_unit;
          // NULL columns mean "never chosen" and deliberately do NOT overwrite
          // what this device already had — a client who set pounds before this
          // shipped keeps pounds, and the next tap writes it to their account.
          if (Object.keys(patch).length) setS((prev) => ({ ...prev, ...patch }));
        }
        writable.current = uid;
        setUnitsLoaded(true);
      } catch (e) {
        if (cancelled) return;
        reportError('settings.units.read', e);
        setUnitsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [rev]);

  // ── The push preference, applied to the token store ───────────────────────
  //
  // Once per sign-in, and once the device cache has been read. Not on every
  // change of `s.notifPush`: `setPushEnabled` below already does the work for a
  // deliberate tap and has to be able to report what happened, and two appliers
  // firing on the same flip would race each other for no gain.
  //
  // What this run is FOR is the case a tap cannot cover — a token that exists
  // when it should not. Every member on the current build has one: auth.tsx
  // registered unconditionally, since long before this preference meant
  // anything, so somebody who turned push off a month ago has a live row in
  // `push_tokens` right now and no idea. Twenty such rows across fifteen
  // accounts on the live database, counted. This is the launch that removes it.
  //
  // It is also, now that auth.tsx registers nothing, the ONLY thing that
  // registers a handset on a sign-in — which is the point: one applier that has
  // read the answer, in place of two that raced, one of which never asked.
  //
  // `latest.current` rather than a dependency, for the reason above: the effect
  // must SEE the current answer without being re-run by it.
  useEffect(() => {
    if (!USE_SUPABASE || !cacheLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        // Signed out. Nothing is registered against anybody, and asking the OS
        // for a token now would put a permission prompt in front of the welcome
        // screen.
        if (!uid || cancelled) return;
        if (latest.current.notifPush) {
          // Idempotent, and deliberately still done here even though auth.tsx
          // registers too: this is what re-registers the handset of somebody
          // who turned push off and then back on again in a previous session.
          await registerForPush();
          return;
        }
        await revokePushToken(() => cancelled);
      } catch (e) { reportError('settings.push.apply', e); }
    })();
    return () => { cancelled = true; };
  }, [rev, cacheLoaded]);

  const set = (patch: SettingsPatch) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setS(next);
    // Published SYNCHRONOUSLY, before the storage write is even issued. The
    // storage write is what a later launch reads, but `setPushEnabled` calls
    // registerForPush() in the very next statement — and a gate that read the
    // answer back out of AsyncStorage would race an un-awaited write and refuse
    // to register the member who just asked for it. The latch is the answer;
    // storage is only where it survives a relaunch.
    if (patch.notifPush !== undefined) recordPushConsent(patch.notifPush ? 'yes' : 'no');
    AsyncStorage.setItem('repple.settings', JSON.stringify(next)).catch(() => {});
    // Only the unit columns go up. The notification preference now reaches the server: it is applied to `push_tokens`, so a handset that opted out receives nothing whatever a sending screen believes
    // because push permission genuinely is a property of this handset.
    const uid = writable.current;
    if (!uid || (patch.weightUnit === undefined && patch.lengthUnit === undefined)) return;
    // Read off the PATCH, not off `next`. `next.weightUnit` is null for anybody
    // who has never chosen, and writing that null back would be this provider
    // publishing "not chosen" over an answer given on another handset — the
    // mirror image of the read guard below, and the reason `SettingsPatch`
    // cannot express a null in the first place. Only a unit somebody just
    // tapped goes up.
    const row: Record<string, string> = {};
    if (patch.weightUnit !== undefined) row.weight_unit = patch.weightUnit;
    if (patch.lengthUnit !== undefined) row.length_unit = patch.lengthUnit;
    // Written back to whichever table the read found the account in, so a
    // coach's choice lands somewhere durable and a client's keeps landing
    // where every other screen already reads it from.
    supabase.from(unitHome.current).update(row).eq('id', uid)
      .then(({ error }) => { if (error) reportError('settings.units.write', error); },
            (e: unknown) => reportError('settings.units.write', e));
  };

  const setPushEnabled = async (on: boolean): Promise<PushResult> => {
    // The answer is recorded FIRST and unconditionally. It belongs to the
    // member, not to the OS and not to the network, and it has to survive both
    // being unavailable — the reconciler above applies it again on every launch,
    // so a revoke that cannot complete tonight completes tomorrow.
    set({ notifPush: on });
    if (!on) return (await revokePushToken(() => false)) ? 'off' : 'off-pending';
    // Two different "no" answers, and telling them apart is the whole point of
    // this return value. One is fixable by the member in the phone's own
    // settings; the other is not fixable by anybody until this app is rebuilt,
    // and sending somebody to iOS Settings to fix that would waste their time
    // and teach them the app lies.
    if (!pushAvailable()) return 'no-build';
    return (await registerForPush()) ? 'on' : 'os-refused';
  };

  // The one place the guess is made, and the one place it is kept apart from
  // an answer. Screens get a unit they can always render; the `*Chosen` and
  // `*Source` fields beside it are what stop that unit being mistaken for
  // something the member said.
  const units = resolveUnits(s.weightUnit, s.lengthUnit, DEVICE_REGION);
  return (
    <Ctx.Provider value={{ notifPush: s.notifPush, ...units, set, setPushEnabled, unitsLoaded }}>
      {children}
    </Ctx.Provider>
  );
}
export function useSettings(): SettingsValue { const v = useContext(Ctx); if (!v) throw new Error('useSettings must be used inside <SettingsProvider>'); return v; }
