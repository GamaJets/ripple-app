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
// the first paint right and as the store that carries a choice through a
// refused update or a dead gym network. The push toggle is deliberately left
// device-local.
//
// That cache is keyed by ACCOUNT — `repple.units:<uid>`, src/lib/unitCache.ts —
// and this sentence used to end "and as the only store when there is no session
// or the backend is off". It no longer does, and the change is deliberate
// rather than an oversight: with nobody signed in there is no account to scope
// a key to, so nothing is written at all. A unit tapped before anybody signs in
// is on screen for that session and is not kept. The alternative is the
// unqualified key this repair exists to end, where what is kept is inherited by
// whoever signs in next.
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useAuthRevision } from './authRevision';
import { readMyProfileRow, readMyClientRow, forgetMyRows } from './myProfile';
import { registerForPush, pushAvailable, handsetPushTokens, forgetRegisteredToken } from './pushNotifications';
import { consentFromStored, recordPushConsent, forgetPushConsent } from '../lib/pushConsent';
import { soundFromStored, recordRestSoundConsent, forgetRestSoundConsent } from '../lib/restTimer';
import { assertWrote, writeFailure } from '../lib/wroteRows';
// `getUser()` resolves rather than rejecting when the auth host cannot be
// reached, so `!auth?.user?.id` meant "signed out, or we could not ask, and
// this file cannot tell which". `revokePushToken` above already reads its
// `error` for exactly that reason; these two are the sites that did not.
import { signedInUid } from '../lib/signedInUid';

import type { WeightUnit, LengthUnit } from '../lib/units';
import { resolveUnits, deviceRegion, type UnitSource } from '../lib/unitPreference';
import { SETTINGS_KEY } from '../lib/personalSettings';
import { cacheHydrated, mayWriteCache, type DeviceCache } from '../lib/deviceAccountCache';
import {
  unitCache, parseCachedUnits, cachedUnitsBlob, chooseUnit, mayRefreshCache,
  deviceSettingsBlob, legacyUnitRemnant, isWeightUnit, isLengthUnit,
  NO_CACHED_UNITS, type CachedUnits, type ColumnRead,
} from '../lib/unitCache';

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
interface Settings { notifPush: boolean; restSound: boolean; weightUnit: WeightUnit | null; lengthUnit: LengthUnit | null }

/**
 * What may be WRITTEN. Narrower than `Settings` on purpose: null is a state the
 * store arrives in, never one a screen may put it into. A `set({ weightUnit:
 * null })` would have to mean "un-choose", which no control offers and which
 * would race the read that is forbidden from overwriting a device's value.
 */
type SettingsPatch = { notifPush?: boolean; restSound?: boolean; weightUnit?: WeightUnit; lengthUnit?: LengthUnit };

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
  /**
   * Whether the rest timer between sets may make a noise.
   *
   * Device-local, like `notifPush` and unlike the units: which handset is
   * allowed to make a sound in a room is a property of the handset and of the
   * room it is in, not of the account. The same member's phone at 6am in a
   * shared flat and their phone in a gym at lunchtime are entitled to different
   * answers, and syncing this to the account would take that away.
   *
   * READ BY src/lib/restTimer.ts's latch, not by the screens. `set` publishes
   * it synchronously to `recordRestSoundConsent`, and src/ui/sounds.ts refuses
   * to play anything the latch has not said yes to — so there is no call site
   * that can forget to check it. This field is what the SWITCH renders from;
   * the latch is what the speaker obeys, and they are written in the same
   * statement so they cannot drift apart.
   */
  restSound: boolean;
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
// `restSound` defaults ON because the owner asked for the noise — "should be
// have a noise with it" — and because a boolean has no third state to lose, the
// same reasoning the push default already carries. src/lib/restTimer.ts's
// soundFromStored applies the identical default to an absent or unreadable
// blob, so the switch on the settings screen and the speaker cannot disagree
// about what a fresh install said.
const DEFAULTS: Settings = { notifPush: true, restSound: true, weightUnit: null, lengthUnit: null };

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

/**
 * Is there still a row in `push_tokens` naming any of these tokens?
 *
 * Three answers, not two. `null` is "the read failed", and it is a different
 * fact from "there is no row" — this whole module turns on not confusing the
 * two, because reporting a token gone on the strength of a read that never
 * completed is how a member who switched notifications off goes on getting them.
 */
async function tokenRowsPresent(tokens: string[]): Promise<boolean | null> {
  // Not chunked. `handsetPushTokens()` returns at most two: the one this app
  // remembered in AsyncStorage and the one the OS will name right now, deduped
  // against each other. It is THIS handset's addresses, not a list read out of
  // a table, so no gym and no account can make it longer.
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
 * Exported for ONE other caller: src/ui/signOutState.ts, which runs it while
 * the session is still alive so that ending a session also ends this handset's
 * registration. It is not exported for general use and there is no second copy
 * of this logic anywhere — the two attempts, the identity check and the verify
 * are the parts that are easy to get wrong, and a sign-out is the moment they
 * matter most.
 *
 * Resolves TRUE only when nothing in `push_tokens` can reach this handset any
 * more. A failed delete and a failed verify both resolve FALSE: "we could not
 * check" is not "it is gone", and this is the switch where the difference is
 * the member getting a notification they turned off.
 */
export async function revokePushToken(cancelled: () => boolean): Promise<boolean> {
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
  /**
   * The account-scoped device cache for the units: which account's key this
   * provider is reading and writing, and whether a read of THAT key has come
   * back. Built by `unitCache(uid)`, which hands it back un-hydrated — there is
   * no way to construct one with the flag already true, which is the trap in
   * src/lib/deviceAccountCache.ts closed by construction rather than by
   * remembering to clear it.
   */
  const unitStore = useRef<DeviceCache>(unitCache(null));
  /**
   * The unit fields the device-global blob was carrying when this launch read
   * it, carried back into every write of that blob.
   *
   * They are NEVER read into state — see src/lib/unitCache.ts for why adopting
   * an unqualified unit into the signed-in account is a guess whose wrong
   * answer is a stranger's figures in the wrong unit. They are preserved so
   * that a member flipping a notification switch does not silently delete
   * somebody's pre-migration choice on the way past.
   */
  const legacyUnits = useRef<Record<string, string>>({});
  /** Whether a read of the device-global blob COMPLETED this launch. Arms the
   *  write of it, exactly as `DeviceCache.hydrated` arms the unit cache's. */
  const blobRead = useRef(false);
  const latest = useRef<Settings>(s);
  latest.current = s;

  // The device cache: what makes the first paint right rather than making
  // everybody watch their weight change units a second after launch.
  //
  // `cacheLoaded` gates the push reconciler below, and it is not optional. Until
  // this read lands, `s.notifPush` is still the DEFAULTS value — true — so a
  // reconciler that ran before it would register a push token for the one member
  // whose stored answer is that they do not want one, on every single launch.
  //
  // ── Why this is keyed on `rev` and not on mount ───────────────────────────
  //
  // It used to be `[]`. This provider is mounted at the root of app/_layout.tsx
  // and outlives every sign-out, so one read on mount meant the answer belonged
  // for ever to whoever was signed in when the app launched. On a shared gym
  // handset member A's 'no' then governed member B's whole session: B's switch
  // drawn off A's boolean, and `registerForPush()` refusing behind it, so B
  // received nothing from their coach and nothing on screen said why.
  //
  // Re-reading is only half of it. `cacheLoaded` is the arming flag, and a flag
  // that survives the account changing is the sharper trap — it would leave the
  // reconciler below free to act on A's answer against B's account in the window
  // before the re-read lands. So it is put back to false BEFORE the read, and
  // the two latches are put back to 'unknown' in the same breath, which is a
  // refusal for both gates rather than a guess. `clearPersonalDeviceState` does
  // the same on the way out; this covers the sign-in the sign-out did not see —
  // a token refresh into a different account, or a launch that restored one.
  //
  // The unit fields are no longer in this blob at all, and that is the repair
  // in src/lib/unitCache.ts. They were the cache of an ACCOUNT-scoped setting
  // kept under a key with no account in it, so the next member on the handset
  // inherited them — and, because a NULL column deliberately does not overwrite
  // a device value, kept them, with `resolveUnits` reporting the stranger's
  // choice as `weightSource: 'chosen'`. Their cache now lives under
  // `repple.units:<uid>` and is read by the units effect below, which owns them
  // end to end. The two legacy fields are still on the device: unread, and
  // written back untouched, because a correction is a second recorded fact.
  const [cacheLoaded, setCacheLoaded] = useState(false);
  useEffect(() => { (async () => {
    setCacheLoaded(false);
    // False BEFORE the read, for the same reason `cacheLoaded` is: a hydration
    // flag that survives is a write armed by a read that belongs to a previous
    // launch of this effect.
    blobRead.current = false;
    legacyUnits.current = {};
    forgetPushConsent();
    forgetRestSoundConsent();
    setS((prev) => ({ ...prev, notifPush: DEFAULTS.notifPush, restSound: DEFAULTS.restSound }));
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(SETTINGS_KEY);
      // Held whether or not the blob has anything else in it, and held before
      // the two consents are read out, so that the very first write of this
      // blob after a launch cannot drop a pre-migration unit.
      legacyUnits.current = legacyUnitRemnant(raw);
      if (raw) {
        // Read key by key rather than spreading the parsed object over state.
        // Every phone that ran an older build still has `notifEmail` in this
        // blob, and a blind spread would carry a setting the app no longer has
        // back into state and then straight back into storage, for good.
        const c = JSON.parse(raw) as Record<string, unknown>;
        const patch: Partial<Settings> = {};
        if (typeof c.notifPush === 'boolean') patch.notifPush = c.notifPush;
        if (typeof c.restSound === 'boolean') patch.restSound = c.restSound;
        // `c.weightUnit` / `c.lengthUnit` are deliberately not read. This key
        // names no account; the value in it belongs to whoever used this
        // handset last and there is nothing on the device that says who.
        if (Object.keys(patch).length) setS((prev) => ({ ...prev, ...patch }));
      }
      // Only now. A read that threw must not arm the write: `{}` would be this
      // provider claiming the blob holds no pre-migration unit on the strength
      // of never having seen it, and the next flip of a notification switch
      // would write that claim down. The consents still work for this session
      // — the latches below are published either way — they simply are not
      // persisted until a launch manages to read the key.
      blobRead.current = true;
    } catch { raw = null; legacyUnits.current = {}; }
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
      // Published from the same raw blob and in the same breath as the push
      // answer, for the same reason: until this line runs the latch says
      // 'unknown' and src/ui/sounds.ts refuses outright, so nothing can make a
      // noise at somebody whose stored answer is no while their phone is still
      // reading it.
      recordRestSoundConsent(soundFromStored(raw));
      setCacheLoaded(true);
    }
  })(); }, [rev]);

  // ── The units: this account's cache, then this account's row ──────────────
  //
  // Keyed on the auth revision, not on mount: providers that read on mount
  // alone ran before anybody had signed in and were never asked again — see
  // authRevision.tsx.
  //
  // This effect now owns the units end to end — the device cache as well as the
  // account row — because the two decisions are one decision and splitting them
  // across two effects is what let a device value with no account in it survive
  // an account change. src/lib/unitCache.ts holds the rule and the argument.
  //
  // ── What a member sees before the read lands ──────────────────────────────
  //
  // The figure is DRAWN, not withheld, and it is drawn with its unit named.
  // src/lib/unitPreference.ts argues that side out in full: a weight has a true
  // value in every unit at once, so withholding it would blank the dashboard,
  // the goal, the scans and two dozen more screens for anybody whose read is in
  // flight, which is a worse product and a worse prompt to go and choose. So
  // the units start null on every account change, `resolveUnits` falls to the
  // handset's region, and it reports `'device'` — which is what `deviceUnitNote`
  // turns into "Not set yet — showing pounds, from your phone's region."
  //
  // That means a member on a shared handset can see one AsyncStorage read's
  // worth of the region unit before their own cached choice replaces it. That
  // is the trade this takes, deliberately: a figure that changes once from a
  // unit labelled as a guess into the member's own is a correction the reader
  // can see the basis for. What it replaces is the defect — a stranger's unit,
  // shown immediately, reported as `'chosen'`, with no note under it and the
  // Settings pill tinted as though the member had picked it.
  //
  // `unitsLoaded` is put back to FALSE here for the same reason `cacheLoaded`
  // is: a flag that survives the account changing tells the screens which wait
  // on it that the new person's units are settled while they are still the old
  // person's.
  useEffect(() => {
    if (!USE_SUPABASE) { setUnitsLoaded(true); return; }
    let cancelled = false;
    writable.current = null;
    // Synchronously, before anything is awaited: the cache record for nobody,
    // un-hydrated, so that nothing can be written under the previous account's
    // key while the new account is being resolved.
    unitStore.current = unitCache(null);
    setUnitsLoaded(false);
    // The units on screen belong to the account that has just left. Dropped on
    // the way IN, before the read lands and whatever it decides — the rule in
    // src/lib/accountScopedState.ts. A provider mounted at the root of
    // app/_layout.tsx outlives every sign-out, so without this the departing
    // member's unit stays on screen under the next member's name.
    setS((prev) => ({ ...prev, weightUnit: null, lengthUnit: null }));

    /** What THIS account's own key held. Nothing until a read of it lands, and
     *  nothing is never "prefers metric". */
    let cached: CachedUnits = NO_CACHED_UNITS;

    /**
     * One row read, turned into what this provider holds and what the device
     * may be told.
     *
     * The account's stated column always wins. Everything else keeps what is
     * already on screen and only fills a hole with the cache — so a NULL column
     * cannot erase a choice (the property this file has always protected) and
     * cannot lose a unit the member tapped while the read was in flight either.
     */
    const apply = (w: ColumnRead<WeightUnit>, l: ColumnRead<LengthUnit>, uid: string) => {
      const wc = chooseUnit(w, cached.weightUnit);
      const lc = chooseUnit(l, cached.lengthUnit);
      setS((prev) => ({
        ...prev,
        weightUnit: wc.from === 'account' ? wc.chosen : (prev.weightUnit ?? wc.chosen),
        lengthUnit: lc.from === 'account' ? lc.chosen : (prev.lengthUnit ?? lc.chosen),
      }));
      // Only the account's own answer is written back to the handset. The other
      // three origins are, in order, what the cache already holds, a nothing,
      // and a nothing that came out of a read NOBODY COMPLETED — and the last
      // is the one that would destroy this member's choice.
      if (!mayRefreshCache(wc.from) && !mayRefreshCache(lc.from)) return;
      const store = unitStore.current;
      // `mayWriteCache` is the hydration gate; the uid comparison is the second
      // half of it, because the account may have changed since this read began.
      if (!mayWriteCache(store) || store.uid !== uid) return;
      const blob = cachedUnitsBlob({ weightUnit: wc.chosen, lengthUnit: lc.chosen });
      const done = blob == null
        ? AsyncStorage.removeItem(store.key)
        : AsyncStorage.setItem(store.key, blob);
      done.catch((e: unknown) => reportError('settings.units.cache.write', e));
    };

    (async () => {
      try {
        // Narrowed on `fate`, never on `!who.uid`: `string` includes ''.
        const who = await signedInUid('settings.units.who');
        if (cancelled) return;
        if (who.fate === 'unreadable') {
          // ── the branch that threw away the only copy ──────────────────────
          //
          // This used to be the same line as the signed-out case below, and
          // that made the offline launch the launch that ignores the offline
          // cache. The member's chosen unit is under `repple.units:<uid>` —
          // the key NEEDS the account — so a `getUser()` that resolved with
          // `user: null` behind a retryable error skipped the cache read
          // entirely, and then set `unitsLoaded` true, which by its own
          // documented contract says the account's preference HAS been read
          // and there was none. A member who chose pounds got the region's
          // kilograms, on precisely the launch where the cache was the only
          // thing that still knew.
          //
          // The uid cannot be recovered from here — no uid, no key — so the
          // cache still cannot be opened. What changes is that nothing is
          // CLAIMED about it. `unitsLoaded` stays false, which is the truth:
          // the preference has not been read. `unitStore.current` stays the
          // un-hydrated `unitCache(null)` set at the top of this effect, so
          // `mayWriteCache` refuses and this launch writes nothing over a key
          // it could not read. The units on screen stay null and
          // `resolveUnits` keeps labelling the region's answer as the guess it
          // is, rather than as the member's own.
          //
          // The outage itself is recorded by `signedInUid` under this context.
          return;
        }
        // Signed out. There is no account to scope a cache to and nothing to
        // push to, and the region guess is the whole story. Not an error state.
        if (who.fate !== null) { setUnitsLoaded(true); return; }
        const uid = who.uid;

        // ── This account's own cached units ──────────────────────────────────
        //
        // Under `repple.units:<uid>`, which is the repair: the key names the
        // account, so what comes out of it was put there by that account and
        // nobody else on this handset can be read out of it.
        const store = unitCache(uid);
        unitStore.current = store;
        if (store.key) {
          try {
            const raw = await AsyncStorage.getItem(store.key);
            cached = parseCachedUnits(raw);
            // Hydrated only on a read that RETURNED. An empty store is a read
            // that landed; a read that threw is not, and leaving the flag false
            // is what stops this session writing over bytes nobody could read.
            if (!cancelled) unitStore.current = cacheHydrated(store);
          } catch (e) {
            reportError('settings.units.cache', e);
          }
        }
        if (cancelled) return;
        if (cached.weightUnit || cached.lengthUnit) {
          setS((prev) => ({
            ...prev,
            weightUnit: prev.weightUnit ?? cached.weightUnit,
            lengthUnit: prev.lengthUnit ?? cached.lengthUnit,
          }));
        }
        // Shared with clientData.tsx, which reads this same row on the same
        // launch for the rest of the member's profile — src/ui/myProfile.ts.
        // The outcome carries the error, so the guard below still tells a
        // refused read apart from an account that has no `clients` row.
        const cOut = await readMyClientRow(uid);
        if (cancelled) return;
        // Branched on `ok` and not on a truthy error. An outcome carries
        // whatever was thrown, and `throw undefined` is legal — testing the
        // error would let that one through as a successful read of nothing.
        if (!cOut.ok) {
          // The read failed. Leave `writable` null so nothing is pushed for the
          // rest of this session: the client may well have chosen pounds on
          // another device, and publishing this device's default over it is
          // precisely the failure this guard exists for.
          //
          // 'failed' rather than 'never': an unread column is not a NULL one,
          // so this keeps what the cache held and writes nothing back to it.
          reportError('settings.units.read', cOut.error);
          apply({ read: 'failed' }, { read: 'failed' }, uid);
          setUnitsLoaded(true);
          return;
        }
        const data = cOut.value;
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
          // The same shared read the tenant, profile and invites providers are
          // taking on this launch, for its own two columns.
          const pOut = await readMyProfileRow(uid);
          if (cancelled) return;
          if (!pOut.ok) {
            // Same reasoning as the clients read above: a failed read leaves
            // `writable` null so this device publishes nothing over a choice
            // made elsewhere, and says 'failed' rather than 'never' so the
            // member's cached unit survives it.
            reportError('settings.units.read', pOut.error);
            apply({ read: 'failed' }, { read: 'failed' }, uid);
            setUnitsLoaded(true);
            return;
          }
          row = pOut.value ?? null;
          home = 'profiles';
        }
        unitHome.current = home;
        // Three answers per column, and the third is the one that gets
        // collapsed. A NULL column means "never chosen" and deliberately does
        // NOT overwrite what this ACCOUNT's cache held — a member who set
        // pounds and whose write never reached the server keeps pounds, and the
        // next tap writes it up. NO ROW AT ALL in either table is 'failed', not
        // 'never': an account with nowhere to have stated a preference has not
        // told us it has none.
        apply(
          row ? (isWeightUnit(row.weight_unit) ? { read: 'said', unit: row.weight_unit } : { read: 'never' })
            : { read: 'failed' },
          row ? (isLengthUnit(row.length_unit) ? { read: 'said', unit: row.length_unit } : { read: 'never' })
            : { read: 'failed' },
          uid,
        );
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
        // Narrowed on `fate`, never on `!who.uid`: `string` includes ''.
        const who = await signedInUid('settings.push.apply');
        if (cancelled) return;
        // Both fates stop here, and unusually that is the ANSWER rather than a
        // fallback: the two things below this line are registering a push token
        // against an account and deleting one, and neither may be done under an
        // identity that was not established. Acting on a false sign-out is what
        // would be dangerous here — a revoke would silence a handset whose
        // owner never asked for silence.
        //
        //   'signed-out'  — nothing is registered against anybody, and asking
        //                   the OS for a token now would put a permission
        //                   prompt in front of the welcome screen.
        //   'unreadable'  — we could not ask. A member who turned push off
        //                   keeps their stale `push_tokens` row for one more
        //                   launch, which is the same deferral `revokePushToken`
        //                   already calls 'off-pending', and this effect re-runs
        //                   on the next auth revision.
        //
        // What is new is that the second one is no longer invisible:
        // `signedInUid` reports it under this context, so an applier that never
        // applied leaves a trace instead of looking like a device with nobody
        // on it.
        if (who.fate !== null) return;

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
    // Synchronously too, and for a sharper reason than push: the member may be
    // mid-session with a rest running when they change this, and a gate that
    // read the answer back out of AsyncStorage would let the very next chime
    // through after they turned it off.
    if (patch.restSound !== undefined) recordRestSoundConsent(patch.restSound ? 'yes' : 'no');
    // Only the two device-local answers go into the device-global blob now. The
    // legacy unit fields it may still be carrying are written back untouched —
    // they belong to whoever used this handset before, they are read by nothing
    // (src/lib/unitCache.ts), and deleting them here would be the sweep this
    // repair exists to avoid. Armed on `blobRead`: a blob nobody managed to
    // read is not a blob known to hold no unit.
    if (blobRead.current) {
      AsyncStorage.setItem(SETTINGS_KEY, deviceSettingsBlob(next, legacyUnits.current)).catch(() => {});
    }
    // The units go under this account's own key, and only once a read of that
    // key has come back. `mayWriteCache` is that gate; a null key means nobody
    // is signed in, and nobody signed in has no unit preference to keep.
    //
    // Written whatever the server write below does. The cache is what carries a
    // member's choice through a refused update or a dead gym network — if it
    // waited on the row landing, the one case where it is the only copy is the
    // one case it would not exist.
    if (patch.weightUnit !== undefined || patch.lengthUnit !== undefined) {
      const store = unitStore.current;
      // Not hydrated is a REFUSAL, and the cost of it is a real one: a member
      // who taps a unit in the moment between an account change and that
      // account's key coming back sees the tap on screen and does not keep it.
      // That is the smaller loss. The blob written here is computed from the
      // whole of `next`, so a tap on the weight before the read lands would
      // write `{"weightUnit":"kg"}` over a key that holds a LENGTH this launch
      // has not looked at — destroying a second answer in order to store the
      // first.
      if (mayWriteCache(store)) {
        // Never null on this path — `SettingsPatch` cannot express a null unit,
        // so `next` holds at least one — but a null means REMOVE THE KEY and
        // removing is not what a tap does. Checked rather than assumed.
        const blob = cachedUnitsBlob({ weightUnit: next.weightUnit, lengthUnit: next.lengthUnit });
        if (blob != null) {
          AsyncStorage.setItem(store.key, blob).catch((e: unknown) => reportError('settings.units.cache.write', e));
        }
      }
    }
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
    //
    // Counted, not merely un-errored. An UPDATE that matches no row is a 204
    // with `error` null — a coach whose `profiles` row the policy will not let
    // them touch, or an id that has moved between the two tables since the read
    // — so `if (error)` reported nothing and the choice quietly stayed on this
    // handset. Nothing on screen claims otherwise either way, which is why this
    // is a report rather than an alert; the point is that the report happens at
    // all, so the unit a coach reads and TYPES on somebody else's record has an
    // audit trail when it does not follow them to a second phone.
    // The row this account's providers share a read of has just changed, so
    // the held copy is dropped before the request is even sent. Dropped rather
    // than patched: what is shared is the read, not an answer anybody keeps in
    // step, and the next reader asking the server is the whole of the fix.
    forgetMyRows(uid);
    supabase.from(unitHome.current).update(row, { count: 'exact' }).eq('id', uid)
      .then((r) => {
        const why = writeFailure('Your units', r);
        if (why) reportError('settings.units.write', r.error ?? new Error(why), { table: unitHome.current });
      },
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
  // Memoised because `resolveUnits` builds a fresh object every time it is
  // called, and that object is spread straight into the context value below.
  // See the note under it.
  const units = useMemo(() => resolveUnits(s.weightUnit, s.lengthUnit, DEVICE_REGION), [s.weightUnit, s.lengthUnit]);

  // ── Why `set` and `setPushEnabled` are handed out through a ref ───────────
  //
  // This provider used to publish an inline object literal, so `useSettings()`
  // returned a different value on every render — and both functions on it were
  // different functions again. A consumer that keys an effect on the context
  // value, or on either function, then re-runs that effect on every render of
  // this provider, and any effect that writes a setting builds a machine that
  // cannot stop. src/ui/roster.tsx documents the shape at length.
  //
  // The wrappers are created once and read the current implementations out of
  // a ref, so they are stable for the life of the provider while still closing
  // over this render's `s` — `set` merges a patch into the CURRENT settings, so
  // freezing the implementation would freeze the settings it merges into.
  const impl = useRef({ set, setPushEnabled });
  impl.current = { set, setPushEnabled };
  const setStable = useCallback((...a: Parameters<typeof set>) => impl.current.set(...a), []);
  const setPushEnabledStable = useCallback((...a: Parameters<typeof setPushEnabled>) => impl.current.setPushEnabled(...a), []);
  const value = useMemo<SettingsValue>(
    () => ({ notifPush: s.notifPush, restSound: s.restSound, ...units, set: setStable, setPushEnabled: setPushEnabledStable, unitsLoaded }),
    [s.notifPush, s.restSound, units, setStable, setPushEnabledStable, unitsLoaded],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}
export function useSettings(): SettingsValue { const v = useContext(Ctx); if (!v) throw new Error('useSettings must be used inside <SettingsProvider>'); return v; }
