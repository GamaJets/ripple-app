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
import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { VARIANT } from '../lib/variant';
import { reportError } from '../lib/reportError';
// Whether the autosave actually landed. Until this module the write ended
// `.then(() => {}, () => {})` and the screen could not tell a saved profile
// from a refused one — see that file's header.
import { IDLE_SAVE, markPending, afterWrite, profileWriteFailure, profileFingerprint, isProfileEdit, type SaveStatus } from '../lib/profileSave';
// What may be stored in `profiles.avatar` at all. A device path is not a URL
// anywhere but on the phone that chose it — see src/lib/avatarImage.ts.
import { isDeviceAvatar } from '../lib/avatarImage';
import {
  resolveTrainerAccess,
  mayReadTrainerProfile,
  guardTrainerProfile,
  trainerAccessNote,
  type TrainerAccess,
  type TrainerProfileFields,
  type TrainerRowRead,
} from '../lib/trainerProfileAccess';
import { asPublishResult, normaliseHandle, type PublishResult } from '../lib/publicProfile';

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
  /** Whether the last autosave landed. See src/lib/profileSave.ts. */
  save: SaveStatus;
  /**
   * Claim a public-page address and switch the page on or off, in one call.
   *
   * NOT a setter, and deliberately shaped unlike every other member of this
   * object. The debounced write below is fire-and-forget — `.then(() => {}, ()
   * => {})` — which is right for a bio and wrong for this: a handle can be
   * TAKEN, it can be a word we reserve, and a coach who is not in the directory
   * cannot publish at all. Each of those is a sentence somebody has to read,
   * and a swallowed 23505 would leave a coach looking at a handle they do not
   * own. So `set_my_public_page` returns a word, this awaits it, and the screen
   * says which one happened.
   *
   * `trainers.public_handle` and `trainers.public_page` also hold no UPDATE
   * grant (part 340 §4), so there is no other route to them from here.
   */
  publishPage: (handle: string, on: boolean) => Promise<PublishResult>;
  /** Read `profiles` and `trainers` again. Flushes a pending edit first — see
   *  the docstring on the implementation for why that ordering is not
   *  optional. */
  reload: () => Promise<void>;
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
  // Both read back from the server and written only through publishPage below.
  // Null is "no address claimed", which is a different thing from the empty
  // string a text field holds while somebody is typing one.
  const [publicHandle, setPublicHandle] = useState<string | null>(null);
  const [publicPage, setPublicPage] = useState(false);
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

  useEffect(() => { (async () => { try { if (USE_SUPABASE) { await AsyncStorage.removeItem('repple.coachProfile'); } else { const raw = await AsyncStorage.getItem('repple.coachProfile'); if (raw) { const p = JSON.parse(raw); if (typeof p.name === 'string') setName(p.name); if (p.photo === null || typeof p.photo === 'string') setPhoto(p.photo ?? null); if (typeof p.tagline === 'string') setTagline(p.tagline); if (typeof p.bio === 'string') setBio(p.bio); if (Array.isArray(p.offers)) setOffers(p.offers); if (Array.isArray(p.specialties)) setSpecialties(p.specialties); setSessionFee(typeof p.sessionFee === 'number' && p.sessionFee > 0 ? p.sessionFee : null); if (typeof p.listed === 'boolean') setListed(p.listed); } } } catch { /* ignore */ } setHydrated(true); })(); }, []);

  // Load the real server-side profile. Re-fetches on every auth state change (not
  // just once at hydration) — if the Supabase session hasn't finished restoring at
  // the moment this effect first runs (common on a cold launch), a one-shot fetch
  // gives up permanently and the real values never appear.
  //
  // Not issued at all on a client or owner build. That is the refusal made
  // physical rather than advisory: the two rows this reads are the SIGNED-IN
  // user's, so on those apps there is no request whose result could be mistaken
  // for a coach's name or a coach's face, because no request is made.
  // Bumped by `reload` below. In the dependency array of the read effect so a
  // refresh goes back through the one read this provider has, rather than
  // growing a second one that would have to repeat every assignment rule in it.
  const [readNonce, setReadNonce] = useState(0);

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

        const tr = await supabase.from('trainers').select('bio, tagline, offers, specialties, session_fee, listed, public_page, public_handle').eq('id', u.id).single();
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
          //
          // A stored 0 is the same statement as NULL and is mapped the same way.
          // It is not a coach who charges nothing — `trainers.session_fee`
          // defaulted to 0 for rows created before the column was nullable, and
          // three of the eight rows on production still hold one. Read as a
          // rate, that zero came out the other end of Analytics as "AED 0.00 at
          // your AED 0.00 session rate": the app quoting a coach a rate they
          // never set, and calling their month's takings zero on the strength
          // of it. Every reader downstream already branches on `null` and says
          // "Set a session rate in your profile" — this is the one place that
          // has to agree that an unset rate is unset.
          const fee = Number(t.session_fee);
          setSessionFee(t.session_fee != null && Number.isFinite(fee) && fee > 0 ? fee : null);
          if (typeof t.listed === 'boolean') setListed(t.listed);
          // Assigned in both directions, like session_fee above and for the
          // same reason: a page the coach has just taken down must not go on
          // reading as live because the previous value was left in place.
          setPublicHandle(typeof t.public_handle === 'string' && t.public_handle.trim() ? t.public_handle.trim() : null);
          setPublicPage(t.public_page === true);
        }
      } catch (e) { reportError('coachProfile.hydrate', e); }
      if (!cancelled) setSynced(true);
    };
    fetchReal();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      if (!session) {
        // ── the sign-out this listener did not have ────────────────────────
        //
        // It was `if (cancelled || !session) return;`, so a session ending was
        // the one auth event this provider ignored, and every field below kept
        // the departing coach's answers: their name, their face, their tagline,
        // their bio, what they offer, their session rate, whether their public
        // page is live and what its address is.
        //
        // This provider is mounted at the root and outlives the Sign Out
        // button's `router.replace('/welcome')`, so the next coach to sign in
        // on the same handset — a shared gym phone, a coach handing a device to
        // a colleague — gets app/(trainer)/profile.tsx and the dashboard header
        // drawn from it before their own read lands. And because the read only
        // ASSIGNS a name it actually found (`if (real.trim()) setName(...)`), a
        // profiles row with a blank full_name, or a read that failed, leaves the
        // previous coach's name and photo in place for the whole session.
        //
        // Cleared to the values the `useState` calls above open with, so a
        // sign-out returns this provider to the state a fresh launch has. The
        // local blob needs nothing done to it: the hydrate effect above deletes
        // `repple.coachProfile` outright whenever USE_SUPABASE is on, and the
        // persist effect below is gated on `mine`, which this clear makes false.
        //
        // `uid` null is what disarms the debounced push effect and what makes
        // `resolveTrainerAccess` answer 'signed-out', so a cleared bio can never
        // be written up as though the coach had erased it themselves.
        //
        // `synced` goes TRUE, not false, for the reason fetchReal's own
        // signed-out branch settles rather than returns: `settled` is
        // `hydrated && synced`, and an unsettled read resolves to 'loading',
        // which would hold a screen on a spinner nothing is ever going to
        // resolve. There is nothing left to wait for here — the answer is that
        // nobody is signed in.
        setUid(null);
        setTrainerRow('unknown');
        setName(''); setPhoto(null); setTagline(''); setBio('');
        setOffers([]); setSpecialties([]); setSessionFee(null); setListed(false);
        setPublicHandle(null); setPublicPage(false);
        setSynced(true);
        return;
      }
      setSynced(false);
      fetchReal();
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [hydrated, readNonce]);

  // Push edits back to the server. Debounced so typing in a text field doesn't fire
  // a write per keystroke. Update-only (never inserts): the trainer row is created
  // at signup, and inventing one here without a tenant_id would be wrong.
  //
  // Gated on `mine` as well as on `uid`, so a build that is not the coach app can
  // never write these columns for the signed-in user — the same reason it does
  // not read them.
  const [save, setSave] = useState<SaveStatus>(IDLE_SAVE);
  // The values the next write should carry, kept in a ref so the flush below
  // can fire without being in anybody's dependency array.
  const latest = useRef({ name, photo, tagline, bio, offers, specialties, sessionFee, listed, uid });
  latest.current = { name, photo, tagline, bio, offers, specialties, sessionFee, listed, uid };
  // Whether there is an edit that has not reached the server. Cleared only by a
  // write that came back OK, so a failed one stays dirty and gets flushed again.
  const dirty = useRef(false);
  // The fingerprint of what the server last confirmed, or null when no baseline
  // has been taken. Declared beside `dirty` because `flush` below writes to it.
  // See the effect further down, and `profileFingerprint` in
  // src/lib/profileSave.ts, for what it is guarding against.
  const baseline = useRef<string | null>(null);

  /**
   * Write, and report what happened.
   *
   * Both statements are awaited together and BOTH must succeed. `profiles`
   * holds the name and avatar and `trainers` holds everything else, so a screen
   * that reported success on the first alone would tell a coach their bio was
   * saved on the strength of their name having been.
   */
  const flush = useCallback(async (): Promise<void> => {
    const v = latest.current;
    if (!USE_SUPABASE || !v.uid || !mine) return;
    try {
      const [a, b] = await Promise.all([
        // `count: 'exact'`, on both. Without it PostgREST answers an UPDATE that
        // matched ZERO rows with 204 and `error: null` — indistinguishable here
        // from one that changed something — and this screen printed "Saved."
        // over it. The two coaches who get that are not edge cases: one with no
        // `trainers` row yet, and one an RLS policy refuses. `session_fee` is in
        // the second statement, and it is the figure Analytics and the Assistant
        // price everything from.
        //
        // `avatar` is the second lock, the same one src/ui/clientData.tsx puts
        // on the same column: a picker on a phone hands back a path INSIDE THIS
        // HANDSET, and that path in a shared row is a blank circle for every
        // client, every thread and the directory card meant to win the coach
        // work. src/ui/avatarUpload.ts is where a photo becomes a URL; nothing
        // else may reach this column.
        supabase.from('profiles')
          .update({
          // Trimmed, and never stored blank: a coach who cleared this field was
          // storing an empty string for real. Blank is not a name any screen can
          // show, and action_account_deletion() freezes this column into
          // deletion_log — where it can never be repaired, because the profile it
          // came from is deleted on the next line. See supabase/parts/2370.
          //
          // NULL rather than the client app's answer, and the difference is
          // deliberate. app/(client)/profile.tsx does `setName(nameVal.trim() ||
          // cd.name)` — it keeps the OLD name, so clearing the box silently does
          // nothing. That is fine there and wrong here: `full_name` is nullable,
          // every reader of it already handles null (my_coach and
          // my_coach_profile nullif this exact column), and a coach who clears
          // their name has asked for something the schema can express. Reverting
          // would tell them it saved when it had not.
          full_name: v.name.trim() || null,
          avatar: isDeviceAvatar(v.photo) ? null : v.photo,
        }, { count: 'exact' })
          .eq('id', v.uid),
        supabase.from('trainers').update({
          bio: v.bio, tagline: v.tagline, offers: v.offers,
          specialties: v.specialties, session_fee: v.sessionFee, listed: v.listed,
        }, { count: 'exact' }).eq('id', v.uid),
      ]);
      // Counted, never assumed. The sentence names which of the two halves did
      // not land, because "your profile did not save" leaves a coach unable to
      // tell whether it is their name or their rate that is still only here.
      const why = profileWriteFailure(a, b);
      if (why) {
        if (a.error) reportError('coachProfile.persist.profiles', a.error);
        if (b.error) reportError('coachProfile.persist.trainers', b.error);
        // Left dirty on purpose: the values are still only on this handset, and
        // the next edit or the unmount flush should try them again.
        setSave((prev) => afterWrite(prev, false, Date.now(), why));
        return;
      }
      dirty.current = false;
      // What the server now holds. Taken from the values that were actually
      // sent, not from the current render, so an edit made DURING the write is
      // still seen as an edit afterwards.
      baseline.current = profileFingerprint(v);
      setSave((prev) => afterWrite(prev, true, Date.now()));
    } catch (e) {
      reportError('coachProfile.persist', e);
      setSave((prev) => afterWrite(prev, false, Date.now(), null));
    }
  }, [mine]);

  // A re-read, or a different person signing in, invalidates the baseline. It
  // is retaken on the first settled render afterwards.
  useEffect(() => { if (!synced) baseline.current = null; }, [synced]);

  // ── the write that fired on every launch ──────────────────────────────────
  //
  // This effect used to set `dirty` and schedule a PATCH whenever ANY of its
  // dependencies changed, and `synced` is one of them. So the instant the
  // server read settled — carrying the values that had just come FROM the
  // server — it wrote them straight back. Every launch, for every coach, over
  // both tables, including `session_fee`, `listed` and `avatar`. Confirmed on
  // an iPhone: relaunch the app, type nothing, and the badge already reads
  // "Saved."; scroll, and it re-fires. The comment further down this screen
  // saying "Nothing is drawn before the first edit" was describing a screen
  // this one had stopped being.
  //
  // The cost is not the round trip. It is that a launch wrote HANDSET-held
  // state over SERVER-held state, which is the direction that loses work: a
  // coach who edits their rate on one device and then opens the app on another
  // has the second device quietly put the old rate back.
  //
  // `baseline` is the fingerprint of what the server last confirmed. Until it
  // is taken, nothing is written; while it matches, nothing is written; a
  // re-read retakes it and a successful write replaces it. See
  // `profileFingerprint` in src/lib/profileSave.ts for why it is a fingerprint
  // and not a flag per setter.
  useEffect(() => {
    if (!USE_SUPABASE || !uid || !hydrated || !synced || !mine) return;
    const values = { name, photo, tagline, bio, offers, specialties, sessionFee, listed };
    if (baseline.current === null) {
      // The first settled render. This is what the server has; it is not an
      // edit and there is nothing to save.
      baseline.current = profileFingerprint(values);
      return;
    }
    if (!isProfileEdit(baseline.current, values)) return;
    dirty.current = true;
    setSave(markPending);
    const timer = setTimeout(() => { void flush(); }, 600);
    return () => clearTimeout(timer);
  }, [name, photo, tagline, bio, offers, specialties, sessionFee, listed, uid, hydrated, synced, mine, flush]);

  // ── the write that used to be cancelled on the way out ────────────────────
  //
  // The debounce cleanup above is `clearTimeout`, and React runs it on unmount
  // as well as on every dependency change. So a coach who changed a setting and
  // left the screen inside 600ms had the write cancelled — never attempted, and
  // nothing on screen had suggested anything was in flight.
  //
  // Mount-only, so its cleanup runs ONLY on unmount and cannot defeat the
  // debounce. Fired without awaiting because a component coming apart cannot be
  // held open; the request outlives it either way, and `dirty` means this is
  // reached only when there is something that has genuinely not landed.
  useEffect(() => () => { if (dirty.current) void flush(); }, [flush]);

  /**
   * Read the profile and the trainers row again.
   *
   * The pending edit is FLUSHED FIRST, and this is the whole subtlety. The read
   * below assigns `bio`, `tagline`, `session_fee` and the rest in both
   * directions — that is deliberate, and it is what lets a cleared rate stay
   * cleared — so a re-read that landed on top of a debounced edit still sitting
   * in `latest` would take the coach's typing back off the screen and out of
   * the app. Writing it first means the values the server hands back are the
   * coach's own. A failed flush leaves `dirty` set, so nothing is lost that was
   * not already at risk, and the re-read is still worth doing: it is how a
   * refused read gets a second chance.
   */
  const reload = useCallback(async (): Promise<void> => {
    if (dirty.current) await flush();
    setSynced(false);
    setReadNonce((n) => n + 1);
  }, [flush]);

  useEffect(() => { if (!hydrated || !mine) return; AsyncStorage.setItem('repple.coachProfile', JSON.stringify({ name, photo, tagline, bio, offers, specialties, sessionFee, listed })).catch(() => {}); }, [hydrated, mine, name, photo, tagline, bio, offers, specialties, sessionFee, listed]);

  // The fields go out through the guard, so a consumer on the wrong app or under
  // a non-trainer account gets the blank profile and not the reader's own
  // details. The setters go out through the same test: a screen that cannot read
  // this profile must not be able to write it either, and a silent no-op is
  // better than a write that lands on somebody's real `profiles` row.
  /**
   * The one write on this provider that is not a setter. See the docstring on
   * `publishPage` in the value shape above for why it is awaited and why it
   * comes back as a word.
   *
   * On a build that may not read this profile it returns 'not_a_coach' without
   * issuing anything, which is the same refusal `off` makes for every setter
   * beside it — except that a caller of this one is owed an answer rather than
   * a silent no-op, because it is about to print one.
   */
  const publishPage = useCallback(async (handle: string, on: boolean): Promise<PublishResult> => {
    if (!mine || !uid) return 'not_a_coach';
    if (!USE_SUPABASE) return 'failed';
    try {
      const { data, error } = await supabase.rpc('set_my_public_page', {
        p_handle: normaliseHandle(handle),
        p_on: on,
      });
      // supabase-js resolves rather than rejecting, so `error` is read here and
      // not inferred from a missing `data`: a refusal arrives as a word and a
      // failure arrives as an error, and the two say different things.
      if (error) { reportError('coachProfile.publishPage', error); return 'failed'; }
      const result = asPublishResult(data);
      // Re-read from what the server actually did rather than from what was
      // asked for. 'needs_directory' and 'taken' both leave the row alone, and
      // a screen showing the requested state after one of those would be
      // showing a page that is not there.
      if (result === 'published' || result === 'saved') {
        setPublicHandle(normaliseHandle(handle) || null);
        setPublicPage(result === 'published');
      } else if (result === 'cleared') {
        setPublicHandle(null);
        setPublicPage(false);
      }
      return result;
    } catch (e) {
      reportError('coachProfile.publishPage', e);
      return 'failed';
    }
  }, [mine, uid]);

  const value = useMemo<MyTrainerProfileValue>(() => {
    const fields = guardTrainerProfile(access, { name, photo, tagline, bio, offers, specialties, sessionFee, listed, publicHandle, publicPage });
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
      save,
      publishPage,
      reload,
    };
  }, [access, mine, name, photo, tagline, bio, offers, specialties, sessionFee, listed, publicHandle, publicPage, publishPage, save, reload]);

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
