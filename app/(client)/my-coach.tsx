// Client · Your Coach. The one person coaching you, and the ways to reach them.
//
// ── Why this screen did not exist ──────────────────────────────────────────
//
// `trainers.tsx` is a DIRECTORY — coaches who ticked "list me". There was no
// screen anywhere for the coach you already have, and one could not be built,
// because a client cannot read their coach's row: `trainers_peer_r` is
// trainer-to-trainer and `trainers_public_directory_r` only covers
// `listed = true`, which defaults to false.
//
// So the normal case was the broken one. A coach who found their client by
// join code — which is how this product is designed to work — was invisible to
// that client, while a stranger browsing the directory could read a listed
// coach's whole profile. The person paying them could see less than a passer-by.
//
// `my_coach_profile()` (part 130) is the fix, and it is a function rather than
// a policy for the reason part 115 sets out: RLS chooses ROWS, never columns,
// so a policy wide enough to show a bio also hands over `session_fee` and
// `join_code` — a join code being exactly the thing that lets somebody else
// attach themselves to that coach. The function returns the safe columns and
// takes no argument, so there is nothing to probe with.
//
// It answers only while the coaching relationship is ACTIVE. When coaching
// ends, `end_coaching()` clears `clients.trainer_id` and this screen empties —
// the profile goes when the relationship goes, which is what both parties
// would expect.
//
// ── What was added here, and why it belongs on this screen ────────────────
//
// Two facts a client is entitled to about the person they are paying, and
// neither existed anywhere: what the coach is qualified to do, and what the
// client themselves thinks of them.
//
// The credentials are the coach's own statement and are labelled as such on
// every line. Repple has not seen a certificate and has not asked an awarding
// body anything; `credentialBadge` in src/lib/coachCredentials.ts cannot
// produce a checked-looking label for a self-declared row, and the schema
// (supabase/parts/139) gives `authenticated` no write grant on the verification
// columns at all, so a coach cannot mark their own claim as checked either.
//
// The review box is HERE rather than on the directory because this is the
// screen of somebody who actually has a coach, which is the only person
// entitled to review one — `can_review_coach()` answers on an ACTIVE or ENDED
// relationship and never on a pending join-code request. A client who has left
// keeps the right to write one; they simply reach it from the directory
// instead, where their former coach's profile still is.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BRAND } from '../../src/lib/brands';
import { View, Text, ScrollView, Image, TextInput, Pressable, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, ListRow, Ghost, Cta, Flag, PageHead, AttentionRow } from '../../src/ui/kit';
import { sp, layout, radius, hairline, grown, type as ty } from '../../src/theme/scale';
// 44pt, and the one place the number lives. See the rating row below.
import { MIN_TARGET } from '../../src/lib/a11y';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { useReadDeadline } from '../../src/ui/readDeadline';
// The reader's locale, resolved once with a fallback — never a literal tag.
import { appLocale } from '../../src/lib/locale';
// Who this member is, for the one read on this screen that is keyed on THEM
// rather than on their coach.
import { useClientData } from '../../src/ui/clientData';
// ── What the coach can see of the plan the member rewrote ─────────────────
//
// `client_plan_edits` (supabase/parts/204) had one reference in the whole repo
// — the upsert in src/ui/planEdits.tsx — and the blob it writes was read back by
// nobody, in any of the three apps. The member's own phone shows them their
// edits out of its own storage; what nothing could tell them is whether the
// copy their COACH reads ever arrived, which is the only reason the row exists.
// `usePlanEdits.shared` cannot answer that: it is a flag about the last write
// this session made on this handset, so a reinstall or a second phone left a
// month of corrections unaccounted for.
import { fetchSharedPlanEdits, type SharedPlanEdits } from '../../src/ui/planEditsShared';
import { coachSeesPlanNote, planEditItemLine, planEditItems } from '../../src/lib/planEditsReadBack';
import { editCount } from '../../src/lib/planEdits';
import {
  fetchCoachCredentials, fetchMyReview, canReview, writeReview, withdrawReview,
} from '../../src/ui/reviews';
// ── Everything the member wrote, and everything the coach wrote to them ────
//
// Two things this screen was the natural home for and neither had one.
//
// `my_review_of(p_coach)` needs a coach id, and the only two places in the
// client app that hold one are `my_coach_profile()` — which stops answering
// when coaching ends — and a row of the directory, which lists opted-in coaches
// only. So a review of a coach the member has LEFT, or of one who never ticked
// "list me", was unreachable to its own author while the coach could still read
// it and reply to it. supabase/parts/2790 adds the read that asks the question
// the member actually has.
//
// `coach_feedback` had the opposite problem: readable, and shown one note at a
// time. app/(client)/dashboard.tsx renders `coachNotes[0]` clipped at four
// lines and nothing else in any of the three apps renders the rest.
import { fetchMyReviews } from '../../src/ui/myReviews';
import {
  myReviewsNote, myReviewRatingLine, myReviewVisibilityLine, myReviewEditedLine,
  type MyCoachReview,
} from '../../src/lib/myReviews';
import { CoachAdvice } from '../../src/ui/CoachAdvice';
// The provider `CoachAdvice` reads. Mounted app-wide, so this is the same
// instance and the same rows — nothing is read twice by asking for it here.
// It is imported for its `reload` alone: see the pull handler below.
import { useCoachFeedback } from '../../src/ui/feedback';
import { useToday } from '../../src/ui/today';
// The "Right Now" block: what is open between this member and their coach.
// All three are reads the app already holds — see `checkinAsk` below.
import { useCheckIns } from '../../src/ui/checkins';
import { useOutbox } from '../../src/ui/outbox';
import { unsentNote } from '../../src/lib/offlineQueue';
import { daysAgo, checkInAge } from '../../src/lib/coachCheckins';
import { fmtFullDay } from '../../src/lib/format';
import { coachedRemotely } from '../../src/lib/types';
import {
  credentialBadge, credentialLine, expiryLine, sortCredentials, insuranceClaim, insuranceLine,
  credentialState, CLAIM_NOTE, type Credential,
} from '../../src/lib/coachCredentials';
import {
  reviewGate, reviewGateNote, writeOutcome, validateReview, draftProblemText,
  IDENTITY_NOTE, EDIT_NOTE, WITHDRAW_NOTE, MAX_BODY, MIN_RATING, MAX_RATING,
  ownRatingLine,
  type MyReview,
} from '../../src/lib/reviews';
import { fetchClientCoachBrand, brandInputFor, type ClientCoachBrand } from '../../src/ui/coachBrand';
import { clientBrandNote, resolveClientBrand } from '../../src/lib/coachBrand';
import { EndReasonSheet } from '../../src/ui/EndReasonSheet';
import {
  endCoachingWithReason, endCoaching,
  CLIENT_END_REASONS, CLIENT_END_REASON_LABEL, CLIENT_END_REASON_NOTE, CLIENT_END_EXPLAINER,
  CLIENT_END_CONFIRM_TITLE, clientEndConfirmBody, clientEndOutcomeLine,
  type EndReason,
} from '../../src/lib/endCoaching';

interface CoachProfile {
  id: string;
  name: string | null;
  avatar: string | null;
  tagline: string | null;
  bio: string | null;
  specialties: string[];
  offers: string[];
}

/** Initials for the circle when there is no photo. Never built from a dash. */
function monogram(name: string | null): string {
  if (!name) return '';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export default function MyCoach() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const ci = useCheckIns();
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  // Under a ceiling — see src/lib/readDeadline.ts. Nothing here can leave
  // 'loading' without a request settling, and a captive portal settles none.
  const [readStatus, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const status = useReadDeadline(readStatus);
  // `useToday`, not `useMemo(() => todayKey(), [])`. That empty dependency list
  // fixes the day for the life of the MOUNT, and nothing here unmounts when a
  // phone goes in a pocket. This string is the second argument to every
  // judgement below — `insuranceClaim`, `credentialState`, `expiryLine` — so a
  // member who left this screen open overnight was shown "Insurance stated by
  // the coach" about cover that lapsed at midnight, presented as a current
  // fact about somebody they are about to pay to put them under a barbell.
  const today = useToday();

  // `null` under 'error' rather than `[]`, so nothing downstream can turn a
  // refused read into "this coach has declared no insurance" — which is a
  // statement about somebody's professional standing, not a blank field.
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [credStatus, setCredStatus] = useState<LoadStatus>('loading');
  const [mine, setMine] = useState<MyReview | null>(null);
  const [mineStatus, setMineStatus] = useState<LoadStatus>('loading');
  const [gate, setGate] = useState<boolean | null>(null);
  const [gateStatus, setGateStatus] = useState<LoadStatus>('loading');

  // The coach's BRANDING, which is a different question from their profile and
  // is asked separately for the same reason the three reads below are: a failed
  // branding read must not be able to look like "you have no coach". Null here
  // means nothing is applied and the app keeps its own colours, which is also
  // what a coach who has branded nothing produces — the two are the same
  // outcome on screen, and neither is a claim about the other.
  const [brand, setBrand] = useState<ClientCoachBrand | null>(null);

  const [open, setOpen] = useState(false);
  // Leaving. `endCoaching` lived only on the Find a Trainer directory — the
  // marketplace — so a member who wanted out had to open a shop to find the
  // exit, and it was the one-argument form, so the only churn reason ever
  // recorded was the coach's belief about somebody nobody had asked.
  const [leaving, setLeaving] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    const { data, error } = await supabase.rpc('my_coach_profile');
    if (error) {
      // A failed read is not "you have no coach". Somebody who has a coach and
      // is told they do not will go looking for a way to re-link, which is the
      // one action that could actually break something.
      reportError('myCoach.load', error);
      setStatus('error');
      return;
    }
    const row = Array.isArray(data) ? data[0] : null;
    setCoach(row ? {
      id: String(row.coach_id),
      name: row.coach_name ?? null,
      avatar: row.coach_avatar ?? null,
      tagline: row.tagline ?? null,
      bio: row.bio ?? null,
      specialties: Array.isArray(row.specialties) ? row.specialties.filter(Boolean) : [],
      offers: Array.isArray(row.offers) ? row.offers.filter(Boolean) : [],
    } : null);
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Its own effect, not folded into `load`. `my_coach_brand()` answers over the
  // same active-coaching gate as `my_coach_profile()`, so it needs no coach id
  // and can run in parallel with the profile rather than behind it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await fetchClientCoachBrand();
        if (!cancelled) setBrand(b);
      } catch (e) {
        // Left null. Nothing is drawn in a colour nobody could confirm, and the
        // screen says nothing about branding at all rather than saying there is
        // none.
        reportError('myCoach.brand', e);
      }
    })();
    return () => { cancelled = true; };
    // `tick` too, so one gesture brings back the coach's branding along with
    // everything else. It was read once at mount and never again.
  }, [tick]);

  // A separate effect from the profile above, and keyed on the coach's id: the
  // three reads below are about a coach we may not have yet, and folding them
  // into `load` would make a failure in any of them look like "you have no
  // coach" — the one sentence this screen must never manufacture.
  const coachId = coach?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!coachId) { setCredStatus('ready'); setMineStatus('ready'); setGateStatus('ready'); return; }
      setCredStatus('loading'); setMineStatus('loading'); setGateStatus('loading');
      const [c, m, g] = await Promise.all([
        fetchCoachCredentials(coachId),
        fetchMyReview(coachId),
        canReview(coachId),
      ]);
      if (cancelled) return;
      setCreds(c.rows); setCredStatus(c.status);
      setMine(m.rows); setMineStatus(m.status);
      setGate(g); setGateStatus(g === null ? 'error' : 'ready');
    })();
    return () => { cancelled = true; };
  }, [coachId, tick]);

  // ── the copy of the member's plan changes that their coach reads ─────────
  //
  // Keyed on the MEMBER, not the coach: the row is theirs and exists whether or
  // not anybody is currently coaching them, and folding this into the effect
  // above would make it wait on a coach id it does not need. `tick` so one pull
  // brings it back with everything else.
  const [planEdits, setPlanEdits] = useState<SharedPlanEdits | null>(null);
  const [planEditStatus, setPlanEditStatus] = useState<LoadStatus>('loading');
  const myId = cd.id;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPlanEditStatus('loading');
      const out = await fetchSharedPlanEdits(myId);
      if (cancelled) return;
      setPlanEdits(out.shared);
      setPlanEditStatus(out.status);
    })();
    return () => { cancelled = true; };
  }, [myId, tick]);

  // ── every review this member has written, not just the one above ────────
  //
  // Keyed on nobody. `my_coach_reviews()` (supabase/parts/2790) takes no
  // argument — every row it returns was written by the caller — which is what
  // makes it able to answer about coaches this screen has no id for: the ones
  // the member has left, and the ones who never listed themselves.
  //
  // Its own effect rather than a fourth entry in the coach-keyed Promise.all
  // above, and for the same reason that block exists: this read is about the
  // MEMBER, it does not need a coach id, and behind one it would not run at all
  // for the member who most needs it — somebody with no current coach, who is
  // exactly the person holding reviews they cannot reach.
  const [written, setWritten] = useState<MyCoachReview[]>([]);
  const [writtenStatus, setWrittenStatus] = useState<LoadStatus>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWrittenStatus('loading');
      const r = await fetchMyReviews();
      if (cancelled) return;
      setWritten(r.rows);
      setWrittenStatus(r.status);
    })();
    return () => { cancelled = true; };
  }, [tick]);

  // The current coach's review has its own block further up, with the form and
  // the withdraw button on it. Showing it a second time in the list below would
  // put the same words on one screen twice and give the member two places to
  // change one thing. It is filtered out only where we actually KNOW who the
  // current coach is: under a failed profile read `coachId` is null, the block
  // above is not drawn at all, and nothing is hidden here to match a section
  // that is not on screen.
  const otherWritten = useMemo(
    () => written.filter((r) => r.coachId !== coachId),
    [written, coachId],
  );

  // The reads behind this screen: the coach's profile, their branding, their
  // credentials, this member's own review and whether they may leave one, the
  // plan changes their coach can see, and every review they have written.
  // `tick` runs all but the first; `load` is the first.
  //
  // ── and the one the pull did not reach ────────────────────────────────
  //
  // What the coach has WRITTEN to this member is the largest block on the
  // screen and it comes out of `CoachFeedbackProvider`, which is mounted at
  // the root and keyed on nothing this screen owns — so `tick` could not move
  // it. A member pulling this screen down after their coach said they had left
  // a note got every other read refreshed and that one left exactly as it was,
  // with no way short of killing the app to bring it in. `reload` is the
  // provider's own, so this asks the same instance `CoachAdvice` is drawing
  // from rather than opening a second reader with a second opinion.
  const { reload: reloadAdvice } = useCoachFeedback();
  const pull = usePullToRefresh(useCallback(() => {
    // The check-ins too: the "Right Now" row's age is read out of that
    // provider, and a pull that left it alone would re-read everything on this
    // screen except the one line that says whether something is due.
    void load(); setTick((n) => n + 1); reloadAdvice(); ci.reload();
  }, [load, reloadAdvice, ci.reload]));

  const openForm = () => {
    setRating(mine && !mine.withdrawnAt ? mine.rating : null);
    setBody(mine && !mine.withdrawnAt ? (mine.body ?? '') : '');
    setOpen(true);
  };

  const problem = validateReview({ rating, body });

  const save = async () => {
    if (!coachId || busy || problem !== 'ok' || rating === null) return;
    setBusy(true);
    const r = await writeReview(coachId, rating, body);
    setBusy(false);
    const said = writeOutcome(r, coach?.name ?? null);
    if (said.saved) { setOpen(false); setTick((n) => n + 1); }
    Alert.alert(said.title, said.body, [{ text: 'OK' }]);
  };

  const withdraw = () => {
    if (!coachId) return;
    Alert.alert('Withdraw your review?', WITHDRAW_NOTE, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive', onPress: () => {
          void (async () => {
            const ok = await withdrawReview(coachId);
            if (!ok) {
              // Nothing changes on screen until the server has said it did.
              Alert.alert('Not withdrawn', 'Your review is still on their profile. Try again in a moment.');
              return;
            }
            setTick((n) => n + 1);
          })();
        },
      },
    ]);
  };

  const go = (route: string) => router.push(route as never);

  /**
   * The day the member's plan changes last reached their coach, or null.
   *
   * Null and never a dash: `coachSeesPlanNote` writes a sentence with no date
   * in it rather than one built around a hole — see scripts/check-prose.mjs.
   * The locale is the READER's, and the parse is `Date.parse` on a timestamptz,
   * which is a full instant rather than a bare `YYYY-MM-DD` compared as a
   * string.
   */
  const sentOn = (iso: string | null): string | null => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms)
      ? new Date(ms).toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
  };

  /** The changes themselves, listed only where the row was actually read and
   *  actually parsed. An empty list under anything else is a silence, not an
   *  answer — see src/ui/loadStatus.ts. */
  const planEditRows = planEditStatus === 'ready' && planEdits?.readable
    ? planEditItems(planEdits.edits)
    : [];

  /**
   * Leave, and say why if you want to.
   *
   * One server call, not two. `endCoachingWithReason` exists precisely because
   * two calls have a state between them — ended, unexplained — that every
   * dropped connection reaches, and the ending is the only moment the question
   * makes sense. Skipping is a real answer and takes the same path with no
   * reason attached, through `endCoaching`, so a member who wants out and wants
   * to say nothing is not held up by a write about their feelings.
   *
   * Nothing here is optimistic: the screen is only emptied on the server's own
   * answer, and `clientEndOutcomeLine` says which of the three things happened.
   */
  const doLeave = async (reason: EndReason | null, note: string | null) => {
    if (leaveBusy) return;
    setLeaveBusy(true);
    const res = reason
      ? await endCoachingWithReason(coach?.id ?? '', reason, note)
      : await endCoaching(coach?.id ?? '');
    setLeaveBusy(false);
    if (!res.ok) {
      Alert.alert('Not ended', `${res.reason}\n\nThey are still your coach and nothing has changed.`);
      return;
    }
    setLeaving(false);
    // ── the member's own answer to how they are coached, kept in step ──────
    //
    // app/(client)/trainers.tsx does this on its own leave path and says why:
    // "without this the AI coach would go on being told there is somebody in
    // the room for their booked sessions." This screen was built to move the
    // exit OFF that marketplace and onto the screen about the coach somebody
    // actually has — and it moved the ending without moving this, so leaving
    // from here left `coachingMode` at 'inperson' or 'hybrid' for good.
    //
    // It is not cosmetic and it is not one screen. `coachingMode` is a device
    // preference, not a server fact: app/(client)/coach.tsx hands it to a
    // language model as `coaching` and gets back "your coach is in the room
    // for your booked sessions" about a coach who is not; the dashboard keeps
    // `booksSessions` true; app/(client)/workouts.tsx keeps waiting on a
    // programme nobody is going to assign; and the Me hub keeps showing the
    // rows `soloHide` exists to take away. Every one of those is a claim about
    // a relationship the server has just ended.
    //
    // Only on the server's own `ok`, like everything else here — a refusal
    // changes nothing, and `ended: false` still means the server is certain
    // there is no live link.
    cd.setCoachingMode('solo');
    Alert.alert(
      res.ended ? 'You have left' : 'Nothing to end',
      clientEndOutcomeLine(res.ended, reason != null, (res as { reasonStored?: boolean }).reasonStored === true),
      [{ text: 'Done', onPress: () => { setTick((n) => n + 1); void load(); } }],
    );
  };

  const confirmLeave = () => {
    Alert.alert(
      CLIENT_END_CONFIRM_TITLE,
      clientEndConfirmBody(coach?.name),
      [
        { text: 'Stay', style: 'cancel' },
        // Straight to the reason sheet rather than ending here. The sheet's own
        // Skip button is the way out that records nothing, and it is a
        // different answer from a reason — see src/ui/EndReasonSheet.tsx.
        { text: 'Continue', style: 'destructive', onPress: () => setLeaving(true) },
      ],
    );
  };

  // Whose brand this client's app wears, decided in one place.
  //
  // THE GYM WINS where there is one, and src/lib/coachBrand.ts sets out why at
  // length: membership is the fact the database actually holds about this
  // person, and a coach rebranding a gym's members is a coach advertising over
  // their employer inside the employer's own product. `inGym` is measured
  // server-side — a client cannot count their own tenant's occupants under RLS.
  const brandInput = brandInputFor(brand);
  const applied = resolveClientBrand(brandInput);
  const brandNote = clientBrandNote(brandInput);

  // ── the current ask ──────────────────────────────────────────────────────
  //
  // What the "Right Now" block under the head says. Every branch is a read this
  // app already makes; nothing is asked of the server for it.
  //
  // The check-in row is drawn for anybody coached at a distance — the same gate
  // the home screen uses for its own check-in row, so the two never disagree
  // about who is expected to send one — and ALSO for anybody holding an unsent
  // one, whatever their mode, because a check-in stuck on this phone is news to
  // its author however they are coached.
  //
  // "Due" is a claim about the calendar, not about the coach: the screen it
  // opens is the WEEKLY check-in, so seven days after the last one the server
  // holds, this week's has not been sent. It is measured from `latestSent` and
  // never from `latest` — a pending check-in is not one a coach could have
  // read, and counting it would call the week done on the strength of a row
  // nobody has received. Under a read that is not whole there is no age and no
  // "none yet": the sentence says it could not be checked (rule 5).
  const checkinAsk = useMemo<{ title: string; note: string; flagged: boolean } | null>(() => {
    if (!coachedRemotely(cd.coachingMode) && ci.unsent <= 0) return null;
    const waiting = unsentNote(ci.unsent, 'check-in', 'check-ins');
    if (waiting) return { title: 'Weekly Check-in', note: `${waiting} Your coach cannot see it until then.`, flagged: true };
    if (ci.status === 'loading') return { title: 'Weekly Check-in', note: 'Reading when you last sent one…', flagged: false };
    if (!isWhole(ci.status)) {
      return { title: 'Weekly Check-in', note: 'When you last sent one could not be checked just now. That is not a statement that none was sent.', flagged: false };
    }
    if (!ci.latestSent) return { title: 'Weekly Check-in', note: 'None sent yet. Your coach only sees how the week went if you send one.', flagged: false };
    const days = daysAgo(ci.latestSent.at);
    const age = checkInAge(ci.latestSent.at);
    const last = `Last sent ${fmtFullDay(ci.latestSent.at)}${age ? ` · ${age.toLowerCase()}` : ''}`;
    return days != null && days >= 7
      ? { title: 'Check-in Due', note: `${last}. This week’s has not been sent.`, flagged: true }
      : { title: 'Weekly Check-in', note: last, flagged: false };
    // `today` so a screen left open over midnight re-ages the line.
  }, [cd.coachingMode, ci.unsent, ci.status, ci.latestSent, today]);

  // Words typed to the coach that are still on this phone. Counted from the
  // outbox itself, as app/(trainer)/messages.tsx counts its own, and drawn only
  // when there are some: an outbox that could not be read is not an empty one,
  // and this says nothing at all rather than "everything has been sent".
  const outbox = useOutbox();
  const queuedWords = outbox ? outbox.countOf('message') : 0;
  const queuedWordsNote = unsentNote(queuedWords, 'message', 'messages');
  const showAsk = !!checkinAsk || !!queuedWordsNote;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          The padding stays at 40: the field sits well above the end of this screen, and the
          inset iOS adds already gives the focused row the room it needs to rise. Padding it
          out to a keyboard's height here would only scroll into empty space. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="Your Coach" />

        {status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xl }}>Loading.</Text>
        ) : status === 'error' ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xl }}>
            This could not be read just now. It is not a statement that you have no coach — try again when
            you have signal.
          </Text>
        ) : !coach ? (
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.body, color: t.ink }}>You are training on your own.</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              {/* Six CHARACTERS, not six digits: CODE_ALPHABET in
                  src/lib/joinCode.ts is letters and digits with the ambiguous
                  ones removed, so a real code looks like K7M2QX. Find a
                  Trainer, where the code is actually typed, has always said
                  "six characters"; this was the one screen that told the member
                  to expect something other than what is in their hand. */}
              If a coach has given you a six-character code, enter it on Find a Trainer and they will get
              your request.
            </Text>
            <View style={{ marginTop: sp.lg }}>
              <Ghost label="Find a Trainer" onPress={() => go('/(client)/trainers')} />
            </View>
          </View>
        ) : (
          <>
            {/* ── the record's head, the board's way ──────────────────────
                Centred, as the coach's own view of a client is (app/(trainer)/
                client.tsx) and as Me is: the photo, the name under it, and the
                one quiet line — what they trade as, or their tagline. */}
            <View style={{ alignItems: 'center', marginTop: sp.md }}>
              {/* The coach's colour, where they have one and it applies. Drawn
                  as a ring rather than as a fill: the photo inside it is the
                  content, and a coloured plate behind a face is decoration
                  pretending to be identity. `applied.color` has already been
                  MEASURED — coachBrandColorOf refuses anything that could not
                  carry a readable label, whoever wrote it and by whatever
                  route — so nothing downstream needs to check it again. */}
              <View style={{
                width: 64, height: 64, borderRadius: 32, backgroundColor: t.surface2,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                borderWidth: applied.color ? 2 : 0, borderColor: applied.color ?? undefined,
              }}>
                {coach.avatar
                  ? <Image source={{ uri: coach.avatar }} style={{ width: 64, height: 64 }} />
                  : <Text style={{ ...ty.head, color: t.ink3 }}>{monogram(coach.name)}</Text>}
              </View>
              {/* A name that could not be read renders as a dash. It is never
                  replaced with "Your coach", which would look like a name and
                  is not one. */}
              <Text accessibilityRole="header" style={{ ...ty.title, color: t.ink, textAlign: 'center', marginTop: sp.md }}>{coach.name ?? '—'}</Text>
              {/* What they trade as, where that is not their own name. Only
                  when the coach's brand is the one in effect: a gym member's
                  app is the gym's, and printing the coach's business name in
                  it anyway would be the override this screen just declined to
                  make. */}
              {applied.source === 'coach' && applied.name && applied.name !== coach.name ? (
                <Text style={{ ...ty.label, color: t.ink2, marginTop: 3, textAlign: 'center' }}>{applied.name}</Text>
              ) : null}
              {coach.tagline ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, textAlign: 'center' }}>{coach.tagline}</Text>
              ) : null}
            </View>


            {/* ── what is open between the two of you, before anything else ──
                The data-layout review's order for this screen is identity, then
                the current ask, then the conversation — and this screen went
                from the face straight to an index of seven rows, so a member
                whose check-in had been sitting on their phone since Tuesday
                read "Book a Session" before anything told them their coach had
                never received it.

                Two facts, both already held above this screen and neither read
                here before: the check-in provider's `latestSent`/`unsent`, and
                the outbox's queued messages. Each is said BESIDE the thing it
                is about (rule 6) — the check-in's state on the check-in row,
                the unsent words on a row that opens the thread — rather than in
                a banner.

                There is deliberately no "unread from your coach" count. Nothing
                in the client app reads one: `coach_unread_counts()` is the
                coach's side only, and mounting `useThread` here to count would
                move the read watermark — it would mark the thread read from a
                screen that never showed it. A number is not invented to fill
                the slot.

                The kit's `AttentionRow`, which is this shape — subject, reason,
                and a `SyncBadge` on the row where the row IS the queued write. */}
            {showAsk ? (
              <Section>
                <SectionHead title="Right Now" />
                {checkinAsk ? (
                  <AttentionRow icon="message" name={checkinAsk.title} reason={checkinAsk.note}
                    tone={checkinAsk.flagged ? t.warn : undefined}
                    sync={ci.unsent > 0 ? 'queued' : undefined}
                    onPress={() => go('/(client)/checkin')} />
                ) : null}
                {queuedWordsNote ? (
                  <AttentionRow icon="message" name="Messages to Your Coach" reason={queuedWordsNote}
                    tone={t.warn} sync="queued" divider={!!checkinAsk}
                    onPress={() => go('/(client)/messages')} />
                ) : null}
              </Section>
            ) : null}

            {/* ── the one thing this screen is opened to do ───────────────
                Reaching the person it is about. It was reachable only from a
                row called "Message", four sections down, under a heading that
                is itself below the qualifications and the review box — so on a
                coach with a bio and six specialities it was off the bottom of
                the first screen. The row is still there and still says the same
                words; this is the same destination at the top, where somebody
                who tapped "Your Coach" in order to talk to them will find it.
                Unconditional, like the standing-appointment row below and for
                the same reason: the thread exists whether or not anything has
                been said in it, and a control hidden on a failed read hides the
                way to speak to the person whose profile is on screen. */}
            <View style={{ marginTop: sp.lg }}>
              <Cta label="Message Coach" wide onPress={() => go('/(client)/messages')} />
            </View>

            {/* ── everything else you do with them ─────────────────────────
                Directly under the primary action, as the board's record pages
                put their rows: the head, the one button, then the index. What
                the coach has written follows, then the bio and the chips,
                because a member who opened this screen to book or ask has found
                what they came for by now. Only the rows that REACH the coach
                are here; what was bought, agreed and signed is in "Your
                Arrangement" further down. */}
            <Section>
              <SectionHead title="Reach Them" />
              {/* "Message" on its own said what the row WAS rather than what
                  tapping it does, on a screen where three other rows also reach
                  this person. Reported by the product owner as wanting a
                  "Message Coach" control on the coach screen, and the same
                  words are on the button above so the two are recognisably one
                  thing rather than two. It goes to the real thread —
                  app/(client)/messages.tsx, keyed by `messages.client_id` with
                  the coach named through `my_coach()` — and not to a second
                  messaging surface. */}
              <ListRow icon="message" title="Message Coach" note="Your thread with them" onPress={() => go('/(client)/messages')} />
              <ListRow icon="calendar" title="Book a Session" note="Their open times" onPress={() => go('/(client)/calendar')} />
              {/* ── and the hour they have NOT opened ──────────────────────
                  The row above books from what the coach has published, and
                  the product owner's own report is about the half that leaves
                  out: "i can't see my coach Dayne's availability and am not
                  able to book a session or send a request for a booking."
                  app/(client)/request-session.tsx is the answer to it and has
                  been reachable from the calendar, the PT sessions screen and
                  the standing-appointment screen — every screen about a DIARY,
                  and not the one screen about the PERSON. So a member who
                  opened "Your Coach" in order to ask their coach for Tuesday at
                  seven found Message, Book, Packs, Standing and Documents, and
                  the one control that does what they came to do was on none of
                  them.

                  Directly under Book a Session because the two are one
                  decision: a member looks for an open time first and asks for
                  one only when there is none. The note is what keeps them
                  apart — asking is not booking, which is the rule that whole
                  screen exists to hold. */}
              <ListRow icon="clock" title="Ask for a Time" note="A time they haven’t opened — it asks, it doesn’t book" onPress={() => go('/(client)/request-session')} />
            </Section>

            {/* Moved up, above the bio and the qualifications: the review's
                order for this screen is identity, the current ask, the
                conversation, THEN what is shared between the two — and what a
                coach wrote to this member last week is read far more often
                than the paragraph the coach wrote about themselves once. */}
            {/* ── what they have actually written to you ──────────────────
                `coach_feedback` is the advice this coach leaves on this member,
                and until now the member's whole view of it was one line on the
                dashboard: `coachNotes[0]`, clipped at four lines. Note two and
                everything before it were unreachable in all three apps, while
                the coach kept reading the lot from their own client detail —
                so neither side had any reason to think anything was missing.

                Here rather than on the dashboard because a dashboard that grows
                a noticeboard stops being a dashboard; that is the argument the
                gym-notice block on that screen already makes for itself, and it
                ends "the rest are one tap away in Notices". The coach's advice
                had no Notices. This is it. */}
            <CoachAdvice clientId={myId} coachName={coach.name} />

            <Section>
              <SectionHead title="What They Can See" />
              {/* Said here rather than left to be discovered. A client is
                  entitled to know what coaching costs them in privacy, and the
                  answers are not obvious: the injury document stays with the
                  client and only the extracted injury reaches the coach, and
                  blood sugar is invisible until the client turns sharing on. */}
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Your training log, your check-ins, your scans and measurements, and any injury you have
                disclosed. Not the document behind an injury — only what was read out of it. Not your blood
                sugar, unless you turn sharing on yourself.
              </Text>

              {/* ── and the plan you rewrote ──────────────────────────────
                  The one thing in that list the member MADE, and the only one
                  they had no way to check. Every swap, removal, addition and
                  corrected set goes up to `client_plan_edits` the moment it is
                  made (src/ui/planEdits.tsx) and nothing in any of the three
                  apps has ever read the row back — so a member who reinstalled,
                  or picked up a second handset, could not find out whether a
                  month of corrections had arrived. This is the server's copy,
                  not the phone's, which is what makes it an answer.

                  Read-only on purpose. The plan screen owns the writing and
                  holds its own copy in memory; an undo from here would be
                  overwritten by that screen's next tap, silently, after the
                  member had been told it was done. */}
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
                {coachSeesPlanNote(
                  planEditStatus,
                  planEdits ? editCount(planEdits.edits) : 0,
                  planEdits ? planEdits.readable : true,
                  sentOn(planEdits?.updatedAt ?? null),
                )}
              </Text>

              {planEditRows.length > 0 ? (
                <View style={{ marginTop: sp.md }}>
                  {planEditRows.map((it) => (
                    <Text key={it.id} style={{ ...ty.caption, color: t.ink2, marginTop: 4 }}>
                      {planEditItemLine(it)}
                    </Text>
                  ))}
                  {/* Where the change was actually made, and the only place it
                      can be undone. Said rather than implied: the list above
                      names a day and a kind of change and deliberately does not
                      name the movement, because the stored key is a slug and
                      the programme that would turn it into a name is on that
                      screen and not on this one. */}
                  <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                    <Ghost label="Open My Plan" onPress={() => go('/(client)/workouts')} />
                  </View>
                </View>
              ) : null}
            </Section>

            <Rule />

            {/* ── who they are ────────────────────────────────────────────── */}
            <Section>
              <SectionHead title="About Them" />
              {/* One sentence, and only when there is something to say: either a
                gym is overriding branding this coach has set, or these really
                are the coach's colours and the client should be able to tell
                them from the app's. Null the rest of the time — a screen that
                explains an absence nobody noticed is noise. */}
              {brandNote ? (
                <Flag tone={applied.color ?? t.ink3} style={{ marginBottom: sp.md }}>{brandNote}</Flag>
              ) : null}

              {/* A paragraph of somebody's own words, set a point looser than body's
                21. `grown` keeps that choice and still tracks the reader: pinned, a
                bio is the longest run of text on this screen and so the first thing
                to overlap itself. */}
              {coach.bio ? (
                <Text style={{ ...ty.body, color: t.ink2, lineHeight: grown(22) }}>{coach.bio}</Text>
              ) : null}
              {/* Nothing to say about themselves yet: said, so the card is
                  not an empty box under a heading. Not a claim about them. */}
              {!coach.bio && !coach.specialties.length && !coach.offers.length && !brandNote ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>{coach.name ?? 'Your coach'} hasn’t written a profile in {BRAND.label} yet.</Text>
              ) : null}

              {coach.specialties.length ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Specialises In</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {coach.specialties.map((s) => (
                      <View key={s} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>{s}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {coach.offers.length ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Offers</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {coach.offers.map((o) => (
                      <View key={o} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>{o}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </Section>

            <Rule />

            {/* ── what they say they are qualified to do ──────────────────
                Their own claim, said so on every line. The alternative — a
                bare list under a heading — reads as something Repple stands
                behind, and a client picks who to trust with their body partly
                on that. */}
            <Section>
              <SectionHead title="Qualifications & Insurance" />

              {credStatus === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Loading.</Text>
              ) : credStatus === 'error' ? (
                /* Never "they have listed nothing". A client who is told their
                   coach has declared no insurance, when the read simply
                   failed, has been told something false about that coach. */
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  We couldn’t load this. It is not a statement that {coach.name ?? 'your coach'} has listed
                  nothing — try again when you have signal.
                </Text>
              ) : (creds ?? []).length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {coach.name ?? 'Your coach'} hasn’t listed any qualifications or insurance in {BRAND.label}. Ask
                  them directly — it is a normal thing to ask.
                </Text>
              ) : (<>
                {sortCredentials(creds ?? [], today).map((c, i) => (
                  <View key={c.id} style={{ paddingVertical: sp.sm, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                    {credentialLine(c) ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{credentialLine(c)}</Text>
                    ) : null}
                    <View style={{ marginTop: 5 }}>
                      <Flag tone={credentialState(c, today) === 'expired' ? t.warn : t.ink3}>
                        {expiryLine(c, today)} · {credentialBadge(c).label}
                      </Flag>
                    </View>
                  </View>
                ))}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {insuranceLine(insuranceClaim(creds, today))}
                </Text>
              </>)}

              {credStatus === 'ready' && (creds ?? []).length > 0 ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{CLAIM_NOTE}</Text>
              ) : null}
            </Section>

            <Rule />

            {/* ── the arrangement itself ───────────────────────────────────
                These three rows sat in "Reach Them", between Ask for a Time and
                the bio. They are not ways of reaching anybody — they are what
                has been bought, what has been agreed and what has been signed —
                and the review's order puts relationship administration under
                the conversation and what the coach has written, not beside the
                booking controls. Same rows, same destinations, same notes. */}
            <Section>
              <SectionHead title="Your Arrangement" />
              <ListRow icon="trophy" title="Packs & Memberships" note="What you have bought from them" onPress={() => go('/(client)/packages')} />
              {/* A standing appointment is an agreement between these two
                  people, which is what makes this the screen it belongs on —
                  and part 135 is explicit that EITHER party may end one. The
                  row is unconditional rather than shown only to members who
                  have one: the read that would decide it can fail, and a row
                  hidden on a failed read hides the way out from the member
                  whose arrangement could not be confirmed. */}
              <ListRow icon="clock" title="Standing Appointments" note="The same hour with them every week" onPress={() => go('/(client)/standing')} />
              {/* On the screen about this coach, because that is the only place
                  the answer to "whose waiver is this?" is already on the page.
                  The same row is in the Me hub for the member who is looking
                  for a form rather than for their coach. */}
              <ListRow icon="pencil" title="Their Documents" note="Waivers and forms they ask you to read" onPress={() => go('/(client)/coach-documents')} />
            </Section>

            <Rule />

            {/* ── your review of them ─────────────────────────────────────
                Gated on `can_review_coach()` rather than on the presence of a
                coach on this screen: the two are nearly always the same, and
                "nearly" is where a wrong sentence about somebody's record
                comes from. */}
            <Section>
              <SectionHead title="Your Review" />
              {(() => {
                const g = reviewGate({ status: gateStatus, canReview: gate, isSelf: false });
                const note = reviewGateNote(g);
                if (g !== 'allowed') {
                  return note ? <Text style={{ ...ty.label, color: t.ink3 }}>{note}</Text> : null;
                }
                if (mineStatus === 'loading') {
                  return <Text style={{ ...ty.label, color: t.ink3 }}>Loading.</Text>;
                }
                if (mineStatus === 'error') {
                  return (
                    <Text style={{ ...ty.label, color: t.ink3 }}>
                      We couldn’t check whether you have already written one, so the form is closed rather
                      than risk replacing something you wrote.
                    </Text>
                  );
                }
                const live = mine && !mine.withdrawnAt ? mine : null;
                return (<>
                  {live ? (<>
                    {/* The sentence is in src/lib/reviews.ts because it has three
                        states and one of them is new: a rating that did not come back
                        used to arrive here as a 0 and print "You rated them 0 out of
                        5" over somebody's own words. */}
                    <Text style={{ ...ty.body, color: t.ink }}>
                      {ownRatingLine(live.rating, coach.name ?? null)}
                    </Text>
                    {live.body ? (
                      <Text style={{ ...ty.body, color: t.ink2, marginTop: 6 }}>{live.body}</Text>
                    ) : null}
                    {live.coachReply ? (
                      <View style={{ marginTop: sp.md, paddingStart: sp.md, borderStartWidth: 2, borderStartColor: t.ring }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>THEIR REPLY</Text>
                        <Text style={{ ...ty.body, color: t.ink2, marginTop: 3 }}>{live.coachReply}</Text>
                      </View>
                    ) : null}
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{EDIT_NOTE}</Text>
                    <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                      <View style={{ flex: 1 }}><Ghost label="Withdraw" onPress={withdraw} /></View>
                      <View style={{ flex: 1 }}><Ghost label="Change It" onPress={openForm} /></View>
                    </View>
                  </>) : (<>
                    <Text style={{ ...ty.label, color: t.ink3 }}>
                      {mine?.withdrawnAt
                        ? 'You withdrew your review. Writing a new one replaces it rather than adding a second.'
                        : `Nobody browsing ${BRAND.label} can tell what a coach is like to train with until somebody who has says so.`}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{IDENTITY_NOTE}</Text>
                    <View style={{ marginTop: sp.lg }}>
                      <Cta label={mine?.withdrawnAt ? 'Write a New Review' : 'Write a Review'} wide onPress={openForm} />
                    </View>
                  </>)}

                  {open ? (
                    <View style={{ marginTop: sp.lg }}>
                      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>YOUR RATING</Text>
                      {/* ── Which number is chosen, said three ways ──────────
                          It used to be said once, in colour: the selected box
                          took `t.brand` and the other four took `t.surface2`,
                          and that was the whole of it. A screen reader was told
                          "3 out of 5, button" about every one of the five, with
                          nothing anywhere saying which was picked — so somebody
                          reviewing their coach by voice could not tell what
                          they were about to send, and someone who cannot
                          separate the brand hue from the surface could not
                          either. The tone is `radio`, because that is what a
                          row of five where exactly one may be chosen IS, and
                          `selected` is what turns the colour into something a
                          screen reader can read out. The ring and the weight
                          are the non-colour cue on screen, per the rule
                          src/lib/hr.ts states about the zone palette: colour
                          confirms what is already said, it never says it
                          alone. */}
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }} accessibilityRole="radiogroup">
                        {[MIN_RATING, 2, 3, 4, MAX_RATING].map((n) => {
                          const on = rating === n;
                          return (
                            <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="radio"
                              accessibilityState={{ selected: on, checked: on }}
                              accessibilityLabel={`${n} out of ${MAX_RATING}`}
                              style={{
                                flex: 1, paddingVertical: 12, minHeight: MIN_TARGET, justifyContent: 'center',
                                alignItems: 'center', borderRadius: radius.sm,
                                borderWidth: on ? 2 : hairline, borderColor: on ? t.ink : t.ring,
                                backgroundColor: on ? t.brand : t.surface2,
                              }}>
                              <Text style={{ ...ty.body, fontWeight: on ? '700' : '400', color: on ? t.bg : t.ink2 }}>{n}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <TextInput
                        value={body}
                        onChangeText={setBody}
                        placeholder="What was it actually like to train with them?"
                        placeholderTextColor={t.ink3}
                        multiline
                        maxLength={MAX_BODY}
                        accessibilityLabel="Your review"
                        style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.lg, minHeight: 110, ...ty.body, color: t.ink, textAlignVertical: 'top' }}
                      />
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{IDENTITY_NOTE}</Text>
                      {problem !== 'ok' ? (
                        <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{draftProblemText(problem)}</Flag>
                      ) : null}
                      <View style={{ marginTop: sp.lg }}>
                        <Cta label={busy ? 'Saving…' : 'Post Review'} wide disabled={busy || problem !== 'ok'}
                          onPress={() => { void save(); }} />
                      </View>
                      <View style={{ marginTop: sp.md }}>
                        <Ghost label="Cancel" onPress={() => setOpen(false)} />
                      </View>
                    </View>
                  ) : null}
                </>);
              })()}
            </Section>

            <Rule />

            {/* ── the way out ────────────────────────────────────────────
                The only `endCoaching` call in the client app was on
                app/(client)/trainers.tsx — the marketplace — so a member who
                wanted to leave had to open a directory of other coaches to find
                the exit. It is here now, on the screen about the coach they
                actually have, under everything else on the page rather than
                beside the things they use every day. */}
            <Section>
              <SectionHead title="Ending It" />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                You can stop being coached by them at any time. Nothing you have logged is deleted, and you can be
                coached by them again later if you both want that.
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <Ghost label="Leave This Coach" onPress={confirmLeave} />
              </View>
            </Section>
          </>
        )}

        {/* ── the reviews you have written ────────────────────────────────
            OUTSIDE the ternary above, on purpose, and it is the whole reason
            this block is worth having. Every branch of that ternary except the
            last is a member with no readable coach — they are training alone,
            or the profile read failed — and a member who has LEFT their coach
            is precisely the person holding a review they had no way to reach.
            Nested inside, this would have appeared only for people who did not
            need it.

            It says nothing about a coach on its own account: every sentence
            comes from src/lib/myReviews.ts, where the three visibility states
            are asserted on, because "on their public profile" said about a
            review that is not on one is a claim about who is reading somebody's
            words. */}
        <Section>
          <SectionHead title="Coaches You Have Reviewed" />
          <Text style={{ ...ty.label, color: t.ink3 }}>
            {myReviewsNote(
              // `isWhole`, not `!== 'error'`. Under 'loading' the list is empty
              // because nothing has arrived, and under 'partial' it is a prefix
              // — and the figure in this sentence is a count.
              writtenStatus,
              isWhole(writtenStatus) ? otherWritten.length : 0,
              // Whether the block further up is already showing one of these.
              // Without it, a member whose only review is of their current
              // coach would be told they have never reviewed anybody, six
              // inches under their own words.
              coachId != null && written.some((r) => r.coachId === coachId),
            )}
          </Text>

          {/* Drawn whenever any came back, 'partial' included: reviews that
              arrived are real reviews, and withholding them would hide somebody
              from their own words. It is the sentence above that declines to
              say how many there are. */}
          {otherWritten.map((r, i) => (
            <View key={r.id} style={{ paddingVertical: sp.md, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: t.ring }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{myReviewRatingLine(r)}</Text>
              {r.body ? (
                /* `grown`, never a pinned lineHeight: this is a paragraph of
                   the member's own writing and the longest run of text in the
                   row, so it is the first thing to overlap itself at a large
                   text size. */
                <Text style={{ ...ty.body, color: t.ink2, marginTop: 6, lineHeight: grown(22) }}>{r.body}</Text>
              ) : null}
              {r.coachReply ? (
                <View style={{ marginTop: sp.md, paddingStart: sp.md, borderStartWidth: 2, borderStartColor: t.ring }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>THEIR REPLY</Text>
                  <Text style={{ ...ty.body, color: t.ink2, marginTop: 3 }}>{r.coachReply}</Text>
                </View>
              ) : null}
              {/* Who can read it. Three states and three sentences, and the
                  colour is `t.ink3` rather than `t.warn` even for a withdrawn
                  one: a withdrawn review is a thing the member chose, not a
                  warning, and warn ink fails the contrast gate as text. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{myReviewVisibilityLine(r)}</Text>
              {myReviewEditedLine(r) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{myReviewEditedLine(r)}</Text>
              ) : null}
            </View>
          ))}
        </Section>
      </ScrollView>

      {/* The same sheet the coach's side uses, with the member's own wording
          and the same reason IDS — so a churn list can hold a client's own
          account beside a coach's guess, which is the distinction
          `reasonAttribution` exists to keep. */}
      <Modal visible={leaving} animationType="slide" onRequestClose={() => setLeaving(false)}>
        <EndReasonSheet
          name={coach?.name || 'your coach'}
          heading="Why you are leaving"
          verb={leaveBusy ? 'Leaving…' : 'Leave and Tell Them Why'}
          explainer={CLIENT_END_EXPLAINER}
          notePlaceholder="Anything you want them to know, in your own words."
          reasons={CLIENT_END_REASONS}
          labels={CLIENT_END_REASON_LABEL}
          notes={CLIENT_END_REASON_NOTE}
          onCancel={() => setLeaving(false)}
          onDone={(reason, note) => { void doLeave(reason, note); }}
        />
      </Modal>
    </SafeAreaView>
  );
}
