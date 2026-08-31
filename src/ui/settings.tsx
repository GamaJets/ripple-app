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
import { registerForPush, pushAvailable } from './pushNotifications';
import type { WeightUnit, LengthUnit } from '../lib/units';

// Re-exported because every client screen has imported the weight unit from
// here since before there was a units module, and the shape of the union is
// not this provider's to own — src/lib/units.ts owns it, next to the
// conversions that depend on it.
export type { WeightUnit, LengthUnit };

interface Settings { notifPush: boolean; weightUnit: WeightUnit; lengthUnit: LengthUnit }

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

interface SettingsValue extends Settings {
  set: (patch: Partial<Settings>) => void;
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

// Metric, because Repple is a UAE product and the UAE is metric — as is every
// country the app is sold into except the United States. The imperial option
// exists because a large share of the UAE's residents are American and British
// expats who think in pounds, not because the default is in doubt.
//
// This default is the APP's, and it stays out of the database: clients.weight_unit
// is NULL for anybody who has not chosen, which is what lets this line change
// later without overwriting the choice of everybody who deliberately picked kg.
// See supabase/parts/61-unit-preference.sql.
const DEFAULTS: Settings = { notifPush: true, weightUnit: 'kg', lengthUnit: 'cm' };
const Ctx = createContext<SettingsValue | null>(null);

const isWeightUnit = (v: unknown): v is WeightUnit => v === 'kg' || v === 'lb';
const isLengthUnit = (v: unknown): v is LengthUnit => v === 'cm' || v === 'in';

/**
 * Take this handset's push token out of `push_tokens`, and keep it out.
 *
 * ── Why this is not one delete ─────────────────────────────────────────────
 *
 * src/ui/auth.tsx calls registerForPush() on every sign-in, unconditionally and
 * without consulting this preference. That file is not this one's to change, so
 * on a launch where the member's answer is 'off' there are two things happening
 * at once: this provider revoking the token, and auth.tsx writing it back. Which
 * lands last is a race between two chains of network calls, and losing it means
 * a member with the switch off quietly receives notifications for a session.
 *
 * So rather than racing it, we wait it out. registerForPush() is idempotent and
 * is exactly the work auth.tsx is doing, so awaiting our OWN call takes about as
 * long as theirs and hands back the very token they are about to write. Then the
 * row is deleted, read back, and deleted again if the in-flight registration put
 * it back between the two. A row that survives both passes is reported rather
 * than shrugged off: the switch says off and a live token says otherwise, and
 * nobody finds that out from a silent catch.
 *
 * It asks the OS for permission only where permission has never been decided —
 * and auth.tsx's own call is asking on this same launch regardless, so this adds
 * no prompt the member would not already be seeing.
 *
 * Yes, that means we write the row in order to delete it. The window is one
 * round trip on a launch where auth.tsx was going to write the same row anyway,
 * and it buys the one thing that makes the delete safe: the exact token for THIS
 * handset. There is no way to read a token without asking for one.
 *
 * The delete is scoped to the token, not to the user: `push_tokens` is keyed by
 * token and a member may be signed in on a second handset whose own answer is
 * yes. Deleting by user_id would silence a phone whose owner never asked for it.
 *
 * Resolves TRUE only when nothing in `push_tokens` can reach this handset any
 * more — either because the row is confirmed gone or because there was never a
 * token to begin with. A failed delete and a failed verify both resolve FALSE:
 * "we could not check" is not "it is gone", and this is the switch where the
 * difference is the member getting a notification they turned off.
 */
async function revokePushToken(cancelled: () => boolean): Promise<boolean> {
  const token = await registerForPush();
  // No token for this handset — nothing can reach it, and there is nothing to
  // delete. Not a failure.
  if (!token) return true;
  if (cancelled()) return false;
  for (let pass = 0; pass < 2; pass++) {
    const { error } = await supabase.from('push_tokens').delete().eq('token', token);
    if (error) { reportError('settings.push.revoke', error); return false; }
    if (cancelled()) return false;
    const { data, error: readErr } = await supabase.from('push_tokens').select('token').eq('token', token).maybeSingle();
    if (readErr) { reportError('settings.push.revoke.verify', readErr); return false; }
    if (!data) return true;         // gone, and it stayed gone
    if (cancelled()) return false;
  }
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
    try {
      const raw = await AsyncStorage.getItem('repple.settings');
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
    } catch {}
    finally { setCacheLoaded(true); }
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
  // when it should not. Every member on the current build has one: auth.tsx has
  // been registering unconditionally since long before this preference meant
  // anything, so somebody who turned push off a month ago has a live row in
  // `push_tokens` right now and no idea. This is the launch that removes it.
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

  const set = (patch: Partial<Settings>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setS(next);
    AsyncStorage.setItem('repple.settings', JSON.stringify(next)).catch(() => {});
    // Only the unit columns go up. The notification preference now reaches the server: it is applied to `push_tokens`, so a handset that opted out receives nothing whatever a sending screen believes
    // because push permission genuinely is a property of this handset.
    const uid = writable.current;
    if (!uid || (patch.weightUnit === undefined && patch.lengthUnit === undefined)) return;
    const row: Record<string, string> = {};
    if (patch.weightUnit !== undefined) row.weight_unit = next.weightUnit;
    if (patch.lengthUnit !== undefined) row.length_unit = next.lengthUnit;
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

  return <Ctx.Provider value={{ ...s, set, setPushEnabled, unitsLoaded }}>{children}</Ctx.Provider>;
}
export function useSettings(): SettingsValue { const v = useContext(Ctx); if (!v) throw new Error('useSettings must be used inside <SettingsProvider>'); return v; }
