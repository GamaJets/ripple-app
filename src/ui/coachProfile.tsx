// The signed-in user's OWN trainer profile — their photo, tagline, bio, what
// they offer and what they charge. Shared state so the coach edits it in one
// place on their own app. Starts empty until they fill it in.
//
// Persistence: profiles(full_name, avatar) + trainers(bio, tagline, offers,
// specialties, session_fee). Previously every field except the name lived only
// in AsyncStorage, which this provider clears on launch when USE_SUPABASE is on
// — so a coach's tagline/bio/offers/specialties/fee were silently lost on every
// restart, and an edited name never reached the server at all (clients kept
// seeing the old one, and the next launch overwrote the edit with the stale
// server value).
//
// ── Read the name of the hook (TF-32) ───────────────────────────────────────
//
// It is `useMyTrainerProfile`, not `useCoachProfile`, and the "My" is the whole
// point. This does not load "the coach" for whoever is looking; it calls
// `supabase.auth.getUser()` and loads THAT user's own two rows. On the coach app
// that is the coach and it is correct. On the client app the signed-in user is
// the client, and under the old name four client screens read it and got the
// reader back — headed "Your coach", with the reader's own face beside it, in an
// ICS file written into their real calendar, and interpolated into a push sent
// to other people. The full account of what that produced is in
// src/lib/trainerProfileAccess.ts.
//
// A better name is advice, so the refusal is enforced here as well:
// `resolveTrainerAccess` decides whether this bundle and this user can possibly
// be a trainer, and `guardTrainerProfile` holds every field back when they
// cannot. On a client or owner build the fetch below is never issued at all, so
// there is no branch on which `name` or `photo` can be the reader's own — the
// row they would come from is never read.
//
// The client app names its coach through `useThreadPeerName`
// (src/lib/threadPeer.ts), which reads `clients.trainer_id` and then that id's
// profile and no other. It is the right source there. This one never is.
import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { VARIANT } from '../lib/variant';
import { reportError } from '../lib/reportError';
import {
  resolveTrainerAccess,
  mayReadTrainerProfile,
  guardTrainerProfile,
  trainerAccessNote,
  type TrainerAccess,
  type TrainerProfileFields,
  type TrainerRowRead,
} from '../lib/trainerProfileAccess';

interface MyTrainerProfileValue extends TrainerProfileFields {
  /** Whether these fields are really the signed-in user's own, and if not, why
   *  not. A screen with a case to handle should branch on this rather than on
   *  a field being empty — empty is also what a new coach's profile looks like. */
  access: TrainerAccess;
  /** A sentence for a coach-app screen with nothing to show, or null. */
  accessNote: string | null;
  setName: (v: string) => void;
  setPhoto: (v: string | null) => void;
  setTagline: (v: string) => void;
  setBio: (v: string) => void;
  setOffers: (v: string[]) => void;
  setSpecialties: (v: string[]) => void;
  /** Null clears the rate. It is not the same as 0, which is a rate. */
  setSessionFee: (v: number | null) => void;
  setListed: (v: boolean) => void;
}

const Ctx = createContext<MyTrainerProfileValue | null>(null);

export function MyTrainerProfileProvider({ children }: { children: ReactNode }) {
  // Always starts empty. Real data loads from Supabase for a signed-in user;
  // there is nothing to fall back to for anyone else.
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [offers, setOffers] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  // Null, not 0. Nobody has told us the rate yet, and 0 is a rate a coach can
  // charge — so 0 cannot also mean "unknown". This initial value used to be 0,
  // and on the client app, where the `trainers` read never returns a row, it
  // stayed 0 forever and printed "Session rate $0" and "a $0 late fee may
  // apply" to somebody deciding whether cancelling would cost them money.
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  const [listed, setListed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Set only once the server copy has been read for this uid. Nothing is written
  // back before then, so a stale local value can never clobber the real profile
  // (same guard clientData.tsx uses for the client name).
  const [uid, setUid] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  // What the `trainers` read found. Three-valued, not a boolean: a signed-in
  // user whose row came back ABSENT is not a trainer, and the fields below would
  // be a half-loaded profile made of their `profiles` row alone — but a read
  // that failed says nothing at all, and treating it as absence would demote a
  // real coach every time their connection dropped.
  const [trainerRow, setTrainerRow] = useState<TrainerRowRead>('unknown');

  const access = resolveTrainerAccess({
    variant: VARIANT,
    settled: hydrated && (!USE_SUPABASE || synced),
    signedIn: !USE_SUPABASE || uid != null,
    trainerRow,
  });
  const mine = mayReadTrainerProfile(access);

  useEffect(() => { (async () => { try { if (USE_SUPABASE) { await AsyncStorage.removeItem('repple.coachProfile'); } else { const raw = await AsyncStorage.getItem('repple.coachProfile'); if (raw) { const p = JSON.parse(raw); if (typeof p.name === 'string') setName(p.name); if (p.photo === null || typeof p.photo === 'string') setPhoto(p.photo ?? null); if (typeof p.tagline === 'string') setTagline(p.tagline); if (typeof p.bio === 'string') setBio(p.bio); if (Array.isArray(p.offers)) setOffers(p.offers); if (Array.isArray(p.specialties)) setSpecialties(p.specialties); setSessionFee(typeof p.sessionFee === 'number' ? p.sessionFee : null); if (typeof p.listed === 'boolean') setListed(p.listed); } } } catch { /* ignore */ } setHydrated(true); })(); }, []);

  // Load the real server-side profile. Re-fetches on every auth state change (not
  // just once at hydration) — if the Supabase session hasn't finished restoring at
  // the moment this effect first runs (common on a cold launch), a one-shot fetch
  // gives up permanently and the real values never appear.
  //
  // Not issued at all on a client or owner build. That is the refusal made
  // physical rather than advisory: the two rows this reads are the SIGNED-IN
  // user's, so on those apps there is no request whose result could be mistaken
  // for a coach's name or a coach's face, because no request is made.
  useEffect(() => {
    if (!hydrated || !USE_SUPABASE || VARIANT !== 'trainer') return;
    let cancelled = false;
    const fetchReal = async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (cancelled) return;
        setUid(u?.id ?? null);
        // Settle rather than return: a signed-out launch used to leave `synced`
        // false forever, which now reads as "still loading" and would hold a
        // screen on a spinner that nothing is ever going to resolve.
        if (!u) { setTrainerRow('unknown'); setSynced(true); return; }

        const prof = await supabase.from('profiles').select('full_name, avatar').eq('id', u.id).single();
        if (cancelled) return;
        // Always trust the fetched real profile over whatever was cached locally (a
        // stale name from a previous account on a shared/reused device is not just
        // the mock default — it can be any other real person's name).
        const real = prof.data?.full_name;
        if (typeof real === 'string' && real.trim()) setName(real.trim());
        if (typeof prof.data?.avatar === 'string' && prof.data.avatar) setPhoto(prof.data.avatar);

        const tr = await supabase.from('trainers').select('bio, tagline, offers, specialties, session_fee, listed').eq('id', u.id).single();
        if (cancelled) return;
        const t = tr.data as any;
        // PGRST116 is PostgREST's "the .single() matched no rows", which is the
        // one error here that is an answer rather than a failure. Anything else
        // — offline, RLS refusing, a 500 — leaves this 'unknown', because a
        // coach whose read failed is still a coach.
        setTrainerRow(t ? 'present' : tr.error?.code === 'PGRST116' ? 'absent' : 'unknown');
        if (t) {
          if (typeof t.bio === 'string') setBio(t.bio);
          if (typeof t.tagline === 'string') setTagline(t.tagline);
          if (Array.isArray(t.offers)) setOffers(t.offers);
          if (Array.isArray(t.specialties)) setSpecialties(t.specialties);
          // Assigned in both directions. A NULL session_fee is the server saying
          // there is no rate, and leaving the previous value in place would let
          // a rate the coach had just cleared go on being quoted.
          const fee = Number(t.session_fee);
          setSessionFee(t.session_fee != null && Number.isFinite(fee) ? fee : null);
          if (typeof t.listed === 'boolean') setListed(t.listed);
        }
      } catch (e) { reportError('coachProfile.hydrate', e); }
      if (!cancelled) setSynced(true);
    };
    fetchReal();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled || !session) return;
      setSynced(false);
      fetchReal();
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [hydrated]);

  // Push edits back to the server. Debounced so typing in a text field doesn't fire
  // a write per keystroke. Update-only (never inserts): the trainer row is created
  // at signup, and inventing one here without a tenant_id would be wrong.
  //
  // Gated on `mine` as well as on `uid`, so a build that is not the coach app can
  // never write these columns for the signed-in user — the same reason it does
  // not read them.
  useEffect(() => {
    if (!USE_SUPABASE || !uid || !hydrated || !synced || !mine) return;
    const timer = setTimeout(() => {
      try {
        supabase.from('profiles').update({ full_name: name, avatar: photo }).eq('id', uid).then(() => {}, () => {});
        supabase.from('trainers').update({
          bio, tagline, offers, specialties, session_fee: sessionFee, listed,
        }).eq('id', uid).then(() => {}, () => {});
      } catch (e) { reportError('coachProfile.persist', e); }
    }, 600);
    return () => clearTimeout(timer);
  }, [name, photo, tagline, bio, offers, specialties, sessionFee, listed, uid, hydrated, synced, mine]);

  useEffect(() => { if (!hydrated || !mine) return; AsyncStorage.setItem('repple.coachProfile', JSON.stringify({ name, photo, tagline, bio, offers, specialties, sessionFee, listed })).catch(() => {}); }, [hydrated, mine, name, photo, tagline, bio, offers, specialties, sessionFee, listed]);

  // The fields go out through the guard, so a consumer on the wrong app or under
  // a non-trainer account gets the blank profile and not the reader's own
  // details. The setters go out through the same test: a screen that cannot read
  // this profile must not be able to write it either, and a silent no-op is
  // better than a write that lands on somebody's real `profiles` row.
  const value = useMemo<MyTrainerProfileValue>(() => {
    const fields = guardTrainerProfile(access, { name, photo, tagline, bio, offers, specialties, sessionFee, listed });
    const off = () => {};
    return {
      ...fields,
      access,
      accessNote: trainerAccessNote(access),
      setName: mine ? setName : off,
      setPhoto: mine ? setPhoto : off,
      setTagline: mine ? setTagline : off,
      setBio: mine ? setBio : off,
      setOffers: mine ? setOffers : off,
      setSpecialties: mine ? setSpecialties : off,
      setSessionFee: mine ? setSessionFee : off,
      setListed: mine ? setListed : off,
    };
  }, [access, mine, name, photo, tagline, bio, offers, specialties, sessionFee, listed]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The signed-in user's own trainer profile.
 *
 * Only correct on the coach app, and the name says so on purpose — see the note
 * at the top of this file for what happened when it did not. On any other build
 * every field comes back blank and `sessionFee` comes back null; nothing here
 * will ever name, picture or price the coach of whoever is reading.
 */
export function useMyTrainerProfile(): MyTrainerProfileValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMyTrainerProfile must be used inside <MyTrainerProfileProvider>');
  // The provider already refuses to answer off the coach app, so this cannot
  // leak anybody's details. It warns anyway: a screen reading a blanked profile
  // renders empty rather than wrong, and empty is the state somebody
  // investigates for an hour before finding out the hook was never going to
  // answer. Better to say so the first time it is read.
  warnOnceOffCoachApp();
  return v;
}

// Once per session, not once per render: this sits behind a hook that a screen
// calls on every frame, and a warning nobody can read past is a warning nobody
// reads.
let warnedOffCoachApp = false;
function warnOnceOffCoachApp(): void {
  if (warnedOffCoachApp || VARIANT === 'trainer') return;
  warnedOffCoachApp = true;
  console.warn(
    `useMyTrainerProfile() was read on the ${VARIANT} app. It loads the SIGNED-IN user's own ` +
    'profile and trainers row, so here it can only ever describe the reader — it is blanked ' +
    'rather than answered. To name a client\'s coach use useThreadPeerName (src/lib/threadPeer.ts).',
  );
}
