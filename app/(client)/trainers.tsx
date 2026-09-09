// Find a Trainer — client-side marketplace. Browse coaches who have opted in to
// the public directory, view a profile, and send a real coaching request.
//
// This screen previously rendered five hardcoded fictional coaches ("Sam
// Rivera", "Maya Chen", …) with invented star ratings and review counts, and a
// "Request coaching" button that wrote nothing anywhere while telling the
// client the coach would "confirm shortly". Everything here now comes from
// Supabase: `trainers.listed = true` (opt-in, set by the trainer themselves)
// and a real row in `coach_requests` that the trainer sees on their dashboard.
//
// ── The two things this directory could not tell anybody ──────────────────
//
// The invented star ratings came off this screen when the invented coaches did,
// and the header said for months that "there is no review system to feed them."
// There is now — supabase/parts/139 — along with the other half of the question
// a directory listing has to answer: what is this person qualified to do, and
// are they insured.
//
// Both are shown under rules that live in src/lib, not here:
//
//   · A rating is a COUNT below three reviews and only becomes an average above
//     it. `ratingDisplay` has no branch that can average two, so a single
//     five-star cannot be rendered as "5.0" next to a coach with forty ratings.
//   · A failed read prints NOTHING. "No reviews yet" and "no insurance stated"
//     are claims about a named person's reputation and professional standing,
//     and both are wrong in the state where the query merely did not answer.
//     `ratingLine` returns null for that and `insuranceClaim(null)` is
//     'unknown'.
//   · Every credential is the coach's own statement and is labelled as one.
//     Repple has not seen a certificate. `credentialBadge` cannot produce a
//     checked-looking label for a self-declared row, and the coach cannot write
//     the verification columns — they hold no grant on them.
//
// The reviews and the summary come back through SECURITY DEFINER functions
// rather than a table read, because `coach_reviews` carries `client_id` and RLS
// selects rows, not columns: any policy wide enough to show a review to a
// stranger browsing this screen would also hand over the reviewer's account id.
// Part 131 is the worked example of that mistake on this very table's neighbour
// — `join_code` was readable by every signed-in account for the same reason.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero (a directory has no single live number), a
// hairline-separated directory instead of a stack of bordered cards, and a
// <Notice> for the one thing that needs a decision — an invitation. Every
// query, conditional and route above is untouched.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BRAND } from '../../src/lib/brands';
import { View, Text, Pressable, ScrollView, Modal, Alert, ActivityIndicator, TextInput, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead, Flag } from '../../src/ui/kit';
import { capLimit, capped } from '../../src/lib/rowCap';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useInvites } from '../../src/ui/invites';
// The GYM's invitation, which is a different record from the coach's and had no
// screen at all: src/lib/memberInvites.ts could read and redeem one and nothing
// imported either function, so the email telling two hundred people to "sign up
// with this exact address" ended here, on the screen the getting-started
// checklist points at, with nothing about their gym on it.
import { useGymInvites } from '../../src/ui/gymInvites';
import { gymInviteCards, acceptedMessage, type GymInviteCard } from '../../src/lib/gymInvite';
import { joinByCode } from '../../src/ui/joinCode';
import { isPlausibleCode, normaliseCode, CODE_LENGTH } from '../../src/lib/joinCode';
import { peekJoinCode, clearJoinCode } from '../../src/ui/pendingJoinCode';
import { notifySuccess } from '../../src/ui/haptics';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { sendPushChecked } from '../../src/ui/pushNotifications';
import { COACHED_MODES, COACHED_MODE_SHORT, COACHING_MODE_NOTE, type CoachedMode } from '../../src/lib/types';
// Who coaches you, asked the way the database asks it — BOTH links, so this
// screen and the photo-sharing screen can never disagree about whether somebody
// is your coach.
import { fetchMyCoach, type CoachRef } from '../../src/lib/photoShare';
import { endCoaching, leaveCoachPrompt, leaveOutcome, coachLabel, replaceCoachNote } from '../../src/lib/endCoaching';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { fetchCredentials, fetchRatingSummaries, fetchReviews } from '../../src/ui/reviews';
import {
  credentialBadge, credentialLine, credentialState, expiryLine, sortCredentials,
  credentialsSummaryLine, insuranceClaim, insuranceLine, CLAIM_NOTE, type Credential,
} from '../../src/lib/coachCredentials';
import {
  ratingDisplay, ratingLine, reviewListState, reviewerLabel, gymLine,
  MAX_RATING, type RatingSummary, type Review,
} from '../../src/lib/reviews';
// What a session fee is denominated in, and the four different reasons there
// might be no answer. `wholeMoney` is the whole-unit formatter a human-typed
// rate wants, and it knows the zero-decimal currencies — a ¥50,000 rate divided
// by a hundred is the bug at the other end of this one.
import { wholeMoney } from '../../src/lib/coachMoney';
import { currencyGapOfStatus, currencyGapLineAbout } from '../../src/lib/currencyGap';
import { readSessionFee, sessionFeeAmount, sessionFeeShort, sessionFeeNote, type SessionFee } from '../../src/lib/sessionFee';
// What may be drawn as somebody's photo, and what may not. `avatarSource`
// returns null for a device path — `file:`, `ph:`, `/var/…` — which is a URL
// only on the phone that chose it and resolves to nothing anywhere else. Part
// 961 nulled the ones already stored and src/ui/coachProfile.tsx stopped
// writing them, but a value that has been in a column once can be in it again,
// and a broken circle in a directory reads as a coach who has not bothered.
import { avatarSource } from '../../src/lib/avatarImage';
import { useToday, useNow } from '../../src/ui/today';
import { BACK_ICON, END_ALIGN, FORWARD_ICON } from '../../src/ui/direction';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';

// `n.split(' ').map((x) => x[0]).join('')` is the obvious version and it is
// the `String(null)` mistake in another costume: any run of two spaces yields
// an empty part, `''[0]` is undefined, and `join` spells that out — so
// "Sam  Rivera" was drawn on the avatar as "SundefinedR". Dropping the empty
// parts is the fix; a name that leaves nothing falls back to a dash.
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((x) => x[0].toUpperCase()).join('') || '—';

/**
 * A coach's face, or their monogram — in the directory row and again on the
 * profile sheet the row opens.
 *
 * The directory drew a monogram for everybody, which is the one screen where a
 * photo is doing actual work: this is a member choosing between strangers, and
 * the thing they are choosing on is largely whether the person looks like
 * somebody they want in a room with them. The photos existed — part 961 put
 * them in a bucket and the coach app has been uploading them — and nothing here
 * had ever asked for the column.
 *
 * ── why the monogram is still here ────────────────────────────────────────
 *
 * Three ways there is no photo to draw, and all three land on the monogram
 * rather than on a grey disc:
 *
 *   · the coach has not set one — `photo` is null;
 *   · what is stored is a device path, which is a URL only on the phone that
 *     chose it. `avatarSource` returns null for those;
 *   · the fetch fails — the object was deleted out of the bucket, or the phone
 *     is on a captive-portal wifi that answers every request with a login page.
 *     That is the `onError` below, and it is the reason this is a component
 *     with state rather than a ternary at each call site.
 *
 * The broken URL is remembered rather than a boolean flag, because the sheet
 * keeps ONE instance of this component across every coach a member taps: a
 * boolean set by the first coach whose photo failed would have monogrammed
 * every coach opened afterwards.
 */
function CoachFace({ photo, name, size, mono }: { photo: string | null; name: string; size: number; mono: number }) {
  const t = useTheme();
  const [brokenUri, setBrokenUri] = useState<string | null>(null);
  const uri = avatarSource(photo);
  const box = { width: size, height: size, borderRadius: radius.pill, backgroundColor: t.surface2 };
  if (uri && brokenUri !== uri) {
    return (
      <Image
        source={{ uri }}
        style={box}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        onError={() => setBrokenUri(uri)}
      />
    );
  }
  return (
    <View style={{ ...box, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...value(mono), color: t.brand }}>{initials(name)}</Text>
    </View>
  );
}

interface Coach {
  id: string;
  name: string;
  tagline: string;
  specialties: string[];
  /** Three different nothings, kept apart. See src/lib/sessionFee.ts — this
   *  field used to be a `number` that read every one of them as zero, and the
   *  row below renders a zero as no fee at all. */
  sessionFee: SessionFee;
  bio: string;
  /** The coach's photo as a URL other accounts can fetch, or null. Null is
   *  also what a device path and a failed name read leave here — see
   *  `avatarSource`. Never a device path, and never the string 'null'. */
  photo: string | null;
}

/**
 * How the read of what these coaches charge IN went.
 *
 * Its own status, and its own read, for the same reason the ratings and the
 * credentials have theirs: the directory above is real and useful without it,
 * and losing it must cost the currency in front of a figure rather than the
 * list of coaches.
 */
type CcyStatus = 'loading' | 'ready' | 'error';

export default function FindTrainer() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const { received, acceptInvite, declineInvite, reload: reloadInvites } = useInvites();
  const gym = useGymInvites();
  const reach = useReachability();
  // Which one is mid-accept, so the button says so and no second tap can fire a
  // second redemption at the same row.
  const [acceptingGym, setAcceptingGym] = useState<string | null>(null);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  // Three answers where there were two. `coaches: []` meant both "no trainer has
  // published a profile" and "we never got an answer from the server", and this
  // screen asserted the first in both cases — a client read "No coaches listed
  // yet" off a directory that was full, and concluded there was nobody on
  // Repple to hire. `status` is what the empty state is now gated on.
  // 'partial' is a real state here and the type had no member for it, so a
  // truncated read arrived as 'ready' and the count at the bottom of the screen
  // rendered the row cap as the size of the directory. Worse than the count:
  // the three reads COMPOUND. `trainers` truncating makes `ids` a prefix, the
  // `profiles` `.in(ids)` a prefix of that, and coaches are silently dropped
  // from a directory reporting itself complete — a coach who has paid to be
  // listed simply is not there, and nobody is told.
  const [status, setStatus] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [sel, setSel] = useState<Coach | null>(null);
  // The directory and its ratings both run off `attempt` — the same counter the
  // three "Try Again" buttons on this screen bump — and the invitations waiting
  // at the top of it are their own read. An invitation sent while this screen
  // was open appeared nowhere until the app was killed.
  const pull = usePullToRefresh(useCallback(() => {
    setAttempt((n) => n + 1); reloadInvites(); gym.reload(); cd.reload();
  }, [reloadInvites, gym.reload, cd.reload]));
  const [sent, setSent] = useState<Record<string, boolean>>({});
  // Set only when the pending-requests read itself failed. Absence of a request
  // and an unreadable list of requests are different things: the first means
  // "ask this coach", the second means "we don't know whether you already did".
  const [pendingUnknown, setPendingUnknown] = useState(false);
  // The trust surface of a listing. Both are read for the whole page at once
  // and both carry their own status: a directory that loads and a set of
  // ratings that does not is a real, common state, and the coaches must still
  // be shown — with no rating beside them rather than a fabricated "no reviews
  // yet", which is a sentence about somebody's reputation.
  // `useMemo(() => todayKey(), [])` froze this at the moment the screen mounted.
  // It is the date every credential on this directory is judged expired-or-not
  // against, and a phone that has this screen open at midnight — or in a pocket
  // for a day, which is the ordinary case — went on telling a member that a
  // lapsed insurance certificate was current. `useToday()` re-reads at the local
  // day boundary and on return from the background. See src/ui/today.ts.
  const today = useToday();
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({});
  const [ratingStatus, setRatingStatus] = useState<LoadStatus>('loading');
  const [creds, setCreds] = useState<Record<string, Credential[]> | null>(null);
  const [credStatus, setCredStatus] = useState<LoadStatus>('loading');
  // What each listed coach's fee is denominated in, by trainer id. A key that
  // is PRESENT with a null value means that coach's gym has genuinely not set a
  // currency; a key that is ABSENT means we did not get an answer about them.
  // Those are two different sentences (src/lib/currencyGap.ts) and collapsing
  // them is how a member gets sent to chase a setting that was already correct.
  const [feeCcy, setFeeCcy] = useState<Record<string, string | null>>({});
  const [ccyStatus, setCcyStatus] = useState<CcyStatus>('loading');
  // The reviews of the one coach whose profile is open, fetched when it opens
  // rather than for the whole directory — a page of twenty coaches is twenty
  // review lists nobody asked to read.
  const [selReviews, setSelReviews] = useState<Review[]>([]);
  const [selReviewStatus, setSelReviewStatus] = useState<LoadStatus>('loading');
  // The direct path. The directory below is opt-in — a coach who has not
  // published a profile cannot be found in it at all — and the email invite
  // only arrives if the coach spelled the address exactly as the client did.
  // A code the coach hands over depends on neither.
  const [code, setCode] = useState('');
  // Filled from the link they arrived on, if there was one. A coach's bio link
  // carries their code through the install and lands here already typed, which
  // is the difference between an audience and a client: the alternative was
  // asking somebody to memorise six characters across an App Store visit, and
  // whoever forgets them joins attributed to nothing at all.
  //
  // Not consumed on arrival. Somebody who taps a link, gets distracted and comes
  // back tomorrow should still find it waiting — it is spent when the request is
  // actually sent, not when it is shown. And it never overwrites something they
  // have started typing themselves.
  const [fromLink, setFromLink] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await peekJoinCode();
      if (cancelled || !pending) return;
      setCode((cur) => (cur ? cur : pending));
      setFromLink(true);
    })();
    return () => { cancelled = true; };
  }, []);
  const [codeBusy, setCodeBusy] = useState(false);
  // ── The way out ────────────────────────────────────────────────────────────
  //
  // This screen has always been able to START a coaching relationship — an
  // invitation, a code, a directory request — and until now nothing anywhere in
  // the product could end one. A client who wanted to leave had no way to, and
  // their coach kept reading every workout, scan, measurement, check-in and
  // message indefinitely. It belongs here because this is where every other
  // transition of the relationship already lives.
  //
  // Three states again, and for the same reason as the directory below: `coach
  // === null` must mean "nobody coaches you", never "we could not find out".
  // Getting that wrong here would hide the Leave control from somebody who is
  // being coached and wants out, which is the worst direction to fail in.
  const [coach, setCoach] = useState<CoachRef | null>(null);
  const [coachStatus, setCoachStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [leaving, setLeaving] = useState(false);

  const submitCode = async () => {
    if (codeBusy || !isPlausibleCode(code)) return;
    setCodeBusy(true);
    // Their own answer to how they are coached, not an assumption. 'solo'
    // means they had no coach until now, and asking for one online is the
    // safer default — a wrong 'inperson' puts them on a roster for sessions
    // nobody is going to run. 'hybrid' passes straight through; joinByCode
    // narrows it for the RPC and says why.
    const r = await joinByCode(code, cd.coachingMode === 'solo' ? 'online' : cd.coachingMode);
    setCodeBusy(false);
    if (!r.ok) { Alert.alert('That code didn’t work', r.reason); return; }
    // Spent, so it does not come back next time. Only now — not when it was
    // shown — because a code that was merely displayed has not done its job.
    setCode('');
    setFromLink(false);
    void clearJoinCode();
    // `already` is a real outcome, not a failure: they had asked before, or are
    // already coached by this person. Saying "request sent" again would have
    // them waiting on a second answer that is never coming.
    Alert.alert(
      r.already ? 'You’ve already asked ' + r.trainerName : 'Request sent to ' + r.trainerName,
      r.already
        ? 'Nothing new was sent. ' + r.trainerName + ' has your earlier request, or already coaches you.'
        : r.trainerName + ' sees your request in their app and adds you once they accept. Not who you expected? Check the code with them before they do.',
      [{ text: 'OK' }],
    );
  };

  // Who coaches you. A separate effect from the directory below because the two
  // answers are independent: the directory failing must not hide your own coach,
  // and not knowing your coach must not empty the directory.
  //
  // `fetchMyCoach()` THROWS on a read failure rather than returning null, which
  // is the whole reason it can be trusted here — "you have no coach" is a real
  // state with a real screen behind it and must never be manufactured out of a
  // refused query.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!USE_SUPABASE) { setCoachStatus('ready'); return; }
      setCoachStatus('loading');
      try {
        // Signed out is a true answer, not a failed check — and fetchMyCoach()
        // throws when there is no session, which would land in the catch below
        // and report an error to somebody who is simply not signed in.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setCoach(null); setCoachStatus('ready'); return; }
        const mine = await fetchMyCoach();
        if (cancelled) return;
        setCoach(mine);
        setCoachStatus('ready');

        // ── and then the name ──────────────────────────────────────────────
        //
        // fetchMyCoach() reads the name straight off `profiles`, and a client
        // cannot read that row. Every SELECT policy on `profiles` runs the
        // other way — coach → client, owner → tenant — except
        // profiles_public_directory_r, which shows `trainers.listed = true`
        // to everybody and is the only reason this ever appeared to work.
        // `listed` defaults to FALSE, so for a coach who got their first
        // client by handing over a join code rather than by publishing a
        // directory profile — which is every new independent coach — the read
        // matches no row and the card above renders their coach as "—", above
        // a button offering to "Leave your coach". Confirmed on the live
        // database against a freshly provisioned coach and client.
        //
        // my_coach() is the answer the rest of the app already uses for this
        // (supabase/parts/67, extended by 115; src/ui/messaging.ts calls it for
        // the thread header). It is SECURITY DEFINER, takes no argument — so
        // there is no id to probe with and no coach but your own can be named
        // — and it names the two columns it returns rather than handing over a
        // whole profiles row.
        //
        // Asked SECOND, and only to fill a blank. fetchMyCoach() stays the
        // authority on WHETHER somebody coaches you, so this screen and the
        // photo-sharing screen still cannot disagree about that; all that is
        // taken from here is the label. A refusal leaves the dash exactly
        // where it already was.
        if (mine && !(mine.name || '').trim()) {
          const { data: named, error: namedErr } = await supabase.rpc('my_coach');
          if (cancelled) return;
          if (namedErr) {
            reportError('findTrainer.coachName', namedErr);
          } else {
            const row = Array.isArray(named) ? named[0] : named;
            const n = typeof row?.coach_name === 'string' ? row.coach_name.trim() : '';
            // Only when it is the same coach. The two reads are a moment
            // apart and a link that changed in between must not put one
            // coach's name against another's id.
            if (n && row?.coach_id === mine.id) setCoach({ ...mine, name: n });
          }
        }
      } catch (e) {
        reportError('findTrainer.myCoach', e);
        if (!cancelled) setCoachStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  // Ask first, in plain words about what actually changes. The copy is built in
  // src/lib/endCoaching.ts and asserted on in endCoaching.test.ts rather than
  // written inline, because the sentence that must never appear — "you have
  // left" over a call the server refused — is not something a screen can be
  // trusted to keep out of itself.
  const confirmLeave = () => {
    if (!coach || leaving) return;
    const p = leaveCoachPrompt(coach.name);
    Alert.alert(p.title, p.body, [
      { text: p.cancelLabel, style: 'cancel' },
      { text: p.confirmLabel, style: 'destructive', onPress: () => { void leaveCoach(); } },
    ]);
  };

  const leaveCoach = async () => {
    if (!coach) return;
    setLeaving(true);
    const result = await endCoaching(coach.id);
    setLeaving(false);
    // Nothing on this screen changes until the server has said what happened.
    // `ok` covers both true outcomes — the link was ended, or there was never
    // one to end — and in both the server is certain there is no live link, so
    // the coach comes off the screen. A refusal changes nothing at all.
    if (result.ok) {
      setCoach(null);
      // Their own answer to how they are coached, kept in step. It was set when
      // they accepted an invitation (`acceptCoach` below); leaving is the same
      // fact in reverse, and without this the AI coach would go on being told
      // there is somebody in the room for their booked sessions.
      cd.setCoachingMode('solo');
      // Re-read the pending-request list: leaving does not create one, but the
      // screen below is now the screen of somebody looking for a coach.
      setAttempt((n) => n + 1);
    }
    const said = leaveOutcome(result, coach.name);
    Alert.alert(said.title, said.body, [{ text: 'OK' }]);
  };

  const acceptCoach = async (id: string, coachName: string | null, mode: string) => {
    // "You are connected" used to be said whether or not the link was made. The
    // accept RPC resolves on refusal rather than throwing, so a failed accept
    // told the client they had a coach, switched their coaching mode, and left
    // the coach with no client — and neither side had anything to look at that
    // would explain it.
    const { mode: m, ok } = await acceptInvite(id);
    if (!ok) {
      Alert.alert(
        'Not connected yet',
        'We could not link you to ' + (coachName || 'your coach') + '. Your invitation is still here — try accepting it again in a moment.',
      );
      return;
    }
    cd.setCoachingMode(m);
    notifySuccess();
    Alert.alert('You are connected', (coachName || 'Your coach') + ' is now your ' + COACHED_MODE_SHORT[m].toLowerCase() + ' coach. Their plan, feedback and messaging are now on your app.', [{ text: 'Great' }]);
  };

  // Every sentence on these cards is composed in src/lib/gymInvite.ts, where it
  // is tested — including the two this screen would otherwise get wrong: a plan
  // attached but unreadable is not "no plan", and a gym this account cannot yet
  // read the name of is described rather than named.
  /* `nowMs` passed, and IN the dependency list. `gymInviteCards` defaults its
   * third argument to `Date.now()`, and that argument is what `isRedeemable`
   * decides on — which invitations are OPEN, which order the cards come in, and
   * what each card's sentence says. Read inside a memo keyed on the invites and
   * the gym names, it was the moment the screen first mounted, and this screen
   * is reached from a tab that never unmounts. An invitation that lapsed while
   * the phone was in a pocket kept its Accept button, and the tap came back
   * with the server's refusal instead of the card saying it had run out. */
  const gymCardsNow = useNow().getTime();
  const gymCards = useMemo(
    () => gymInviteCards(gym.invites, { byTenant: gym.gymNames }, gymCardsNow),
    [gym.invites, gym.gymNames, gymCardsNow],
  );

  /**
   * Accept the gym's invitation.
   *
   * Nothing is said to have happened until the server returns the membership it
   * opened — the hook returns that id and nothing else counts as a yes. The
   * failure sentence comes from the reason the SQL raised, so "you had already
   * accepted this" and "this has lapsed" stay two different answers, which is
   * exactly what accept_member_invite went to the trouble of distinguishing.
   */
  const acceptGym = async (card: GymInviteCard) => {
    const inv = gym.invites.find((i) => i.id === card.id) ?? null;
    setAcceptingGym(card.id);
    const r = await gym.accept(card.id);
    setAcceptingGym(null);
    if (!r.ok) {
      Alert.alert('Not accepted', r.message ?? 'Nothing was accepted.');
      // Ask again: the invitation may have been withdrawn or used elsewhere,
      // and the card must stop offering a button for a row that is gone.
      gym.reload();
      return;
    }
    notifySuccess();
    Alert.alert(
      'You have joined',
      acceptedMessage(inv ? gym.gymNames.get(inv.tenantId) ?? null : null),
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Open Membership', onPress: () => router.push('/(client)/membership') },
      ],
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!USE_SUPABASE) { setStatus('ready'); return; }
      setStatus('loading');
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id ?? null;

        // supabase-js resolves; it does not throw. An RLS refusal or a dead
        // connection arrives as `error` set and `data` null, so a query read for
        // its `data` alone degrades into an empty directory that looks exactly
        // like an honest one. Every read below now checks `error` first.
        // Capped, and ordered so the cut is deterministic rather than
        // whatever the planner happened to return — two loads of a truncated
        // directory that disagree about who is in it are worse than one that
        // is honestly short.
        const { data: rowData, error: rowsErr } = await supabase
          .from('trainers')
          .select('id, bio, tagline, specialties, session_fee')
          .eq('listed', true)
          .order('id', { ascending: true })
          .limit(capLimit());
        if (cancelled) return;
        if (rowsErr) throw rowsErr;
        const page = capped((rowData ?? []) as any[]);
        const rows = page.rows;

        const ids = rows.map((r: any) => r.id).filter((id: string) => id !== uid);
        if (ids.length === 0) { setCoaches([]); setStatus(page.truncated ? 'partial' : 'ready'); return; }

        // `.in(ids)` with at most `ROW_CAP` ids can itself come back at the
        // cap, and a name that did not arrive drops its coach from the list
        // below — so this one is capped too and its truncation counts.
        const { data: profs, error: profsErr } = await supabase.from('profiles').select('id, full_name, avatar').in('id', ids).limit(capLimit());
        if (cancelled) return;
        // Names live in `profiles`, not in `trainers`, and a coach we cannot name
        // is dropped below as an unfinished profile. So a failure here does not
        // thin the directory, it empties it: every listing we just read
        // successfully would vanish and the screen would report a working
        // directory as "No coaches listed yet". Having listings we cannot put a
        // name to is a failed load, and it is reported as one.
        if (profsErr) throw profsErr;
        const profPage = capped((profs ?? []) as any[]);
        const nameById = new Map<string, string>(profPage.rows.map((p: any) => [p.id, p.full_name]));
        // Read from the same page as the names, so a coach whose row was cut by
        // the cap loses their name and their face together rather than arriving
        // as a face with nobody behind it.
        const photoById = new Map<string, string | null>(
          profPage.rows.map((p: any) => [p.id, typeof p.avatar === 'string' ? p.avatar : null]),
        );

        const list: Coach[] = rows
          .filter((r: any) => ids.includes(r.id))
          .map((r: any) => ({
            id: r.id,
            name: (nameById.get(r.id) || '').trim(),
            tagline: typeof r.tagline === 'string' ? r.tagline : '',
            specialties: Array.isArray(r.specialties) ? r.specialties : [],
            sessionFee: readSessionFee(r.session_fee),
            bio: typeof r.bio === 'string' ? r.bio : '',
            photo: photoById.get(r.id) ?? null,
          }))
          // A coach with no name has not set up a profile — don't show a blank card.
          .filter((c) => c.name.length > 0);

        // Also hide any trainer this client already has a pending request with.
        // Worth its own branch rather than the outer catch: the directory we
        // just loaded is real and useful on its own, so losing this read should
        // caveat the request buttons, not throw away the list of coaches.
        if (uid) {
          const { data: reqs, error: reqsErr } = await supabase
            .from('coach_requests')
            .select('trainer_id')
            .eq('client_id', uid)
            .eq('status', 'pending');
          if (cancelled) return;
          if (reqsErr) {
            reportError('findTrainer.pending', reqsErr);
            setPendingUnknown(true);
          } else {
            setSent(Object.fromEntries((reqs ?? []).map((r: any) => [r.trainer_id, true])));
            setPendingUnknown(false);
          }
        }

        if (!cancelled) { setCoaches(list); setStatus(page.truncated || profPage.truncated ? 'partial' : 'ready'); }

        // ── the trust surface, in two calls for the whole page ───────────
        //
        // Their own branch, not the outer catch: the directory above is real
        // and useful without either of these, and losing them must cost the
        // rating line and the credentials line, not the list of coaches.
        // Each sets its own status so the screen can tell "this coach has no
        // reviews" apart from "we could not ask".
        const listed = list.map((c) => c.id);
        const [sum, cr] = await Promise.all([
          fetchRatingSummaries(listed),
          fetchCredentials(listed),
        ]);
        if (cancelled) return;
        setRatings(sum.rows);
        setRatingStatus(sum.status);
        setCreds(cr.rows);
        setCredStatus(cr.status);

        // ── and what those figures are actually denominated in ───────────
        //
        // Through an RPC rather than a read of `tenants`, because RLS selects
        // ROWS and not columns: any policy wide enough to show a stranger the
        // currency would hand over the whole gym row. Part 131 is the worked
        // example of that mistake one table over. `listed_trainer_currencies`
        // returns exactly two columns, and only for coaches who opted into the
        // directory (supabase/parts/242).
        try {
          const { data: ccyRows, error: ccyErr } = await supabase.rpc('listed_trainer_currencies', { p_ids: listed });
          if (cancelled) return;
          // Checked, and it has to be: a refused RPC arriving as `data: null`
          // would fall through to an empty map, and an empty map is
          // indistinguishable from every gym having set no currency. That is
          // the one sentence this feature must not print off a failed read.
          if (ccyErr) { reportError('findTrainer.currencies', ccyErr); setCcyStatus('error'); }
          else {
            const map: Record<string, string | null> = {};
            for (const r of (ccyRows ?? []) as any[]) {
              const code = typeof r?.currency === 'string' ? r.currency.trim() : '';
              map[String(r?.trainer_id)] = code || null;
            }
            setFeeCcy(map);
            setCcyStatus('ready');
          }
        } catch (e) {
          reportError('findTrainer.currencies', e);
          if (!cancelled) setCcyStatus('error');
        }
      } catch (e) {
        reportError('findTrainer.load', e);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const request = useCallback(async (coach: Coach, mode: CoachedMode) => {
    setSel(null);
    // Whether the row is on the server, read by the catch below. The `try` runs
    // past the insert — a profile read and a push — so a throw after this point
    // is a request that HAS been made, and telling that member their coach was
    // never asked would send them to ask again and stack a second row against
    // the unique index.
    let stored = false;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { Alert.alert('Sign in required', `Sign in to ${BRAND.label} to request coaching.`); return; }
      // `source` is what makes the coach's attribution add up. The column and
      // its check constraint have allowed 'directory' since part 56 and nothing
      // ever wrote it: this insert left it null, so a client who found their
      // coach by browsing was indistinguishable from a row created before the
      // column existed, and the coach's "where did people come from?" had one
      // real bucket and one permanently empty one.
      // `.select('id')` so a genuine insert can be told from a duplicate. It
      // matters for the push below: a client tapping Request twice must not
      // buzz the coach's phone twice for one request.
      const { data: made, error } = await supabase.from('coach_requests').insert({
        client_id: uid, trainer_id: coach.id, mode, status: 'pending', source: 'directory',
      }).select('id');
      const duplicate = !!error && /duplicate|unique/i.test(error.message);
      if (error && !duplicate) {
        Alert.alert('Could not send request', error.message);
        return;
      }

      // ── a duplicate and a write that stored nothing are not the same ─────
      //
      // They were handled by one branch — `if (duplicate || !made?.length)` —
      // under a badge that had already been set to "Request pending". But an
      // insert PostgREST narrows to zero rows under a policy is NOT an error;
      // it resolves with `error: null` and an empty array, a fact this very
      // file relies on elsewhere. So a request the server stored nothing for
      // was reported back as "you have already asked them", the row was badged
      // as pending, and the member waited for an answer to a question nobody
      // had been asked.
      //
      // The unique violation is a real duplicate: a request of theirs IS
      // sitting with that coach, so the badge and the sentence are both true.
      if (duplicate) {
        setSent((s) => ({ ...s, [coach.id]: true }));
        notifySuccess();
        Alert.alert(
          'Already asked',
          `You have already asked ${coach.name} to coach you and they have not answered yet. Asking again does not move you up any list — they still have the first one.`,
          [{ text: 'Got it' }],
        );
        return;
      }
      // No row came back and nothing objected. Nothing was written, so nothing
      // is claimed and no badge is set.
      if (!made?.length) {
        reportError('findTrainer.request', new Error('coach_requests insert returned no row'));
        Alert.alert(
          'Not sent',
          `Your request to ${coach.name} was not stored, so they have not been asked. Nothing has been sent anywhere — try again in a moment.`,
          [{ text: 'OK' }],
        );
        return;
      }

      stored = true;
      setSent((s) => ({ ...s, [coach.id]: true }));
      notifySuccess();

      // ── the push that was never sent ──────────────────────────────────────
      //
      // Until now this insert was the whole of it. The row landed, the coach's
      // dashboard would show it WHENEVER THEY NEXT OPENED THE APP, and the
      // alert below said so plainly — which was honest and useless. A person
      // deciding to be coached is at their most likely to change their mind in
      // the hours after asking, and the coach had no way to know they had been
      // asked until they happened to look.
      //
      // 'clients' is the channel COACH_CHANNELS calls "Somebody asking to be
      // coached by you, and somebody ending their coaching", so a coach who has
      // muted chat still hears about this one.
      //
      // The name is the CLIENT'S OWN, read from their own profile — a coach
      // cannot read a stranger's row (no policy runs client to coach before a
      // relationship exists), so it has to travel in the message rather than be
      // looked up on the other side. A name that could not be read is left out
      // of the sentence rather than dashed into it.
      // no-error-ok: a name that could not be read is left out of the push
      // sentence entirely — the fallback below says "Somebody" rather than
      // dashing a blank into the middle of it. The request itself has already
      // been written at this point, so a failure here costs a name and nothing
      // else, and there is no honest way to report it that a person would act on.
      const { data: me, error: meErr } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
      // A failed read is not a nameless client, it is an unknown name — and both
      // land on the same sentence below, which says 'Somebody' rather than
      // dashing a blank into the middle of it.
      const who = meErr ? '' : (me?.full_name || '').trim();
      const push = await sendPushChecked(
        [coach.id],
        'New coaching request',
        who
          ? `${who} has asked you to coach them — ${COACHED_MODE_SHORT[mode].toLowerCase()}.`
          : `Somebody has asked you to coach them — ${COACHED_MODE_SHORT[mode].toLowerCase()}.`,
        { route: '/(trainer)/dashboard' },
        'clients',
      );

      // Two different sentences, because they are two different situations for
      // the person waiting. `sendPushChecked` records the inbox row before it
      // sends, so a failed push still leaves something the coach will see.
      Alert.alert(
        'Request sent',
        push.ok
          ? `${coach.name} has been notified on their phone. You'll be connected once they accept — nothing changes on your app until then.`
          : `${coach.name} will see your ${COACHED_MODE_SHORT[mode].toLowerCase()} coaching request the next time they open their app — we couldn't reach their phone just now. You'll be connected once they accept.`,
        [{ text: 'Got it' }]
      );
    } catch (e) {
      reportError('findTrainer.request', e);
      // The whole of this alert used to be "Check your connection and try
      // again" — a sentence with no first half at all, so it did not say the
      // one thing the member needed, which is whether the coach has been asked.
      //
      // It is now answered from `stored` rather than assumed, because both
      // answers are reachable here: a throw before the insert means nothing was
      // written, and a throw after it — the profile read, the push — means the
      // request is sitting with the coach and only the notification failed.
      // Telling the second member to try again is how a second row gets stacked
      // against the unique index and comes back as "Already asked".
      //
      // `retryLine` is the second half where there is something to retry — it
      // says whether the phone or the server is the reason, rather than sending
      // somebody to their router over a refusal. See src/lib/reachability.ts.
      Alert.alert(
        stored ? 'Request sent, but not notified' : 'Could not send request',
        stored
          ? `${coach.name} has your ${COACHED_MODE_SHORT[mode].toLowerCase()} coaching request and will see it the next time they open their app — we couldn't reach their phone just now. Do not ask again: it is already with them.`
          : `${coach.name} has not been asked and nothing has been sent anywhere. ${retryLine(reach)}`,
      );
    }
  }, [reach]);

  /**
   * The tap. Asks first when there is a coach to lose.
   *
   * The Flag above the buttons says what accepting would do; this is the
   * confirmation, because reading a warning and acting on it are different
   * things and the consequence here is somebody's coaching relationship. With
   * no coach — the ordinary case — it goes straight through, unchanged.
   */
  const askToRequest = (c: Coach, m: CoachedMode) => {
    if (!coach || coach.id === c.id) { void request(c, m); return; }
    Alert.alert(
      `Ask ${c.name} instead of ${coachLabel(coach.name)}?`,
      replaceCoachNote(coach.name, c.name),
      [
        { text: 'Keep my coach', style: 'cancel' },
        { text: `Ask ${c.name}`, onPress: () => { void request(c, m); } },
      ],
    );
  };

  // Reviews for the open profile. Reset to 'loading' the moment the sheet
  // changes coach, so the previous coach's reviews can never sit under a new
  // name for the length of a round trip.
  const selId = sel?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    setSelReviews([]);
    setSelReviewStatus('loading');
    if (!selId) return;
    (async () => {
      const r = await fetchReviews(selId);
      if (cancelled) return;
      setSelReviews(r.rows);
      setSelReviewStatus(r.status);
    })();
    return () => { cancelled = true; };
  }, [selId]);

  /** The rating beside a directory row, or null when nothing may be said. */
  const rateLine = (id: string) => ratingLine(ratingDisplay(ratings[id] ?? null, ratingStatus));

  /**
   * The fee, with the money it is in, or null when we cannot put a unit on it.
   *
   * `wholeMoney` returns null the moment either half is missing, so there is no
   * branch here on which a number acquires a currency nobody chose. That is the
   * whole rule this screen already followed by printing the figure bare; what
   * is new is that it can now often print it properly.
   */
  const feeMoney = (id: string, fee: number): string | null =>
    wholeMoney(fee, ccyStatus === 'ready' ? (feeCcy[id] ?? null) : null);

  /**
   * Why there is no currency in front of that number, in the third person.
   *
   * The status handed to `currencyGapOfStatus` is per COACH, not per screen: a
   * coach whose row did not come back is 'error' even on a read that otherwise
   * succeeded, because we were told nothing about them specifically. Null when
   * there is a currency and therefore nothing to explain.
   */
  const feeGap = (id: string): string | null => {
    if (ccyStatus === 'loading') return currencyGapLineAbout('reading', 'this coach');
    const known = ccyStatus === 'ready' && Object.prototype.hasOwnProperty.call(feeCcy, id);
    const gap = currencyGapOfStatus({
      currency: known ? feeCcy[id] : null,
      status: ccyStatus === 'error' || !known ? 'error' : 'ready',
    });
    return gap ? currencyGapLineAbout(gap, 'this coach') : null;
  };
  /** What this coach has stated. `null` under a failed read, never `[]`. */
  const credsFor = (id: string): Credential[] | null =>
    credStatus === 'ready' && creds ? (creds[id] ?? []) : null;

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          The padding stays at 40: the field sits well above the end of this screen, and the
          inset iOS adds already gives the focused row the room it needs to rise. Padding it
          out to a keyboard's height here would only scroll into empty space. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Connect</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Find a Trainer</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Enter your coach's code, or browse everyone coaching on {BRAND.label}.</Text>
          </View>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
        </View>

        {/* ── your coach, and the way out ─────────────────────────────────
            Above the invitations and the directory because it is the fact the
            rest of this screen is relative to: what a client can usefully do
            here depends on whether somebody is already coaching them. */}
        {coachStatus === 'loading' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingTop: sp.lg }}>
            <ActivityIndicator color={t.brand} size="small" />
            <Text style={{ ...ty.caption, color: t.ink3 }}>Checking who coaches you…</Text>
          </View>
        ) : coachStatus === 'error' ? (
          <View style={{ marginTop: sp.lg }}>
            {/* Not "you have no coach". The read failed, and a client who IS
                being coached must not read this as confirmation that nobody
                is — that is the state in which they would stop asking to
                leave. */}
            <Notice tone={t.warn} kicker="Your coach" title="We couldn’t check who coaches you"
              note="This is our end, not an answer about you. Until it loads we can’t show you your coach or let you leave them, so don’t read this as nobody coaching you.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={() => setAttempt((n) => n + 1)} />
              </View>
            </Notice>
          </View>
        ) : coach ? (
          <Section>
            <SectionHead title="Your Coach" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                {/* A coach who has not set a name is a real state — part 67
                    returns a row with a null name for exactly that — and a dash
                    is what the record supports. Never a placeholder that reads
                    like a name. */}
                <Text style={{ ...value(13), color: t.brand }}>{coach.name?.trim() ? initials(coach.name) : '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{coach.name?.trim() || '—'}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  Sees your workouts, measurements, check-ins, scans and anything you send them.
                </Text>
              </View>
            </View>
            <View style={{ marginTop: sp.lg }}>
              {/* Ghost rather than a brand Cta: leaving is not the action this
                  screen is encouraging, and it asks before it does anything. */}
              <Ghost label={leaving ? 'Leaving…' : `Leave ${coachLabel(coach.name)}`} onPress={confirmLeave} />
            </View>
          </Section>
        ) : null}

        {/* ── invitations: the one thing that needs a decision ────────────── */}
        {received.length > 0 ? (
          <View style={{ marginTop: sp.lg }}>
            {received.map((iv) => (
              <Notice key={iv.id} tone={t.brand}
                kicker="Coaching invitation"
                title={`${iv.coachName || 'A Coach'} invited you`}
                note={`${COACHED_MODE_SHORT[iv.mode]} coaching. ${COACHING_MODE_NOTE[iv.mode]} Accept to connect — their program, feedback and messaging turn on for you.`}>
                <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                  <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineInvite(iv.id)} /></View>
                  <View style={{ flex: 2 }}><Cta label="Accept Invitation" wide onPress={() => acceptCoach(iv.id, iv.coachName, iv.mode)} /></View>
                </View>
              </Notice>
            ))}
          </View>
        ) : null}

        {/* ── the gym's invitation ────────────────────────────────────────
            A different record from the coach invitation above and, until now,
            one with no screen anywhere: the gym emails "sign up with this exact
            address — that is how the invitation finds you", the member does
            exactly that, and every route in the app ended without mentioning
            their gym. The plan the gym attached sat pending until reception
            typed them in again.

            Nothing is drawn while the read is in flight. An error is drawn,
            because "we could not check" is not "nobody has invited you", and
            the member is the only person who can tell those apart by trying
            again. */}
        {gym.status === 'error' ? (
          <View style={{ marginTop: sp.lg }}>
            <Notice tone={t.warn} kicker="Your gym" title="We couldn’t check for a gym invitation"
              note="This is our end, not an answer about you. If a gym has invited you it is still waiting — this screen simply could not read it.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={gym.reload} />
              </View>
            </Notice>
          </View>
        ) : gymCards.length > 0 ? (
          <View style={{ marginTop: sp.lg }}>
            {gymCards.map((card) => (
              <Notice key={card.id} tone={card.canAccept ? t.brand : t.warn}
                kicker="Gym invitation" title={card.title} note={card.note}>
                {/* No button at all on one that cannot be redeemed. The SQL
                    would refuse it, and a button that fails is worse than the
                    sentence explaining why there is none. */}
                {card.canAccept ? (
                  <View style={{ marginTop: sp.lg }}>
                    <Cta label={acceptingGym === card.id ? 'Accepting…' : 'Accept and Join'} wide
                      disabled={acceptingGym != null}
                      onPress={() => acceptGym(card)} />
                  </View>
                ) : null}
              </Notice>
            ))}
          </View>
        ) : null}

        <Rule />

        {/* ── the direct path ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Have a code from your coach?" />
          {/* rtl-ok: a navigation PATH inside an English sentence — "the screen
            called X, and inside it the thing called Y". The separator belongs to
            the sentence, not to the layout: dropping FORWARD_CHAR into it would
            put a mirrored chevron in the middle of an unmirrored English clause,
            which is worse than leaving it. When the catalogue is translated the
            whole sentence moves and the separator goes with it. */}
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
            {fromLink
              ? 'Your coach’s code came in with the link you tapped, so it is already filled in below. Send it when you are ready — they see the request and add you once they accept.'
              : 'Ask them for their coaching code — it’s six characters, in their app under Clients › Add a client. This works even if they aren’t listed in the directory below.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(normaliseCode(v))}
              placeholder="ABC123"
              placeholderTextColor={t.ink3}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={CODE_LENGTH}
              returnKeyType="go"
              onSubmitEditing={submitCode}
              accessibilityLabel="Your coach’s six-character code"
              style={{
                flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm,
                paddingHorizontal: sp.lg, paddingVertical: 13,
                ...ty.body, color: t.ink, letterSpacing: 4,
              }}
            />
            <View style={{ flex: 1 }}>
              {/* Disabled until it could actually be a code, so the failure a
                  half-typed code produces is never reached. */}
              <Cta label={codeBusy ? 'Checking…' : 'Join'} wide
                disabled={codeBusy || !isPlausibleCode(code)}
                onPress={submitCode} />
            </View>
          </View>
        </Section>

        <Rule />

        {/* ── the directory ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title={`Coaches on ${BRAND.label}`} note={status === 'ready' && coaches.length > 0 ? String(coaches.length) : undefined} />

          {/* The read failed, so nothing below this line is a statement about who
              is coaching on Repple. Naming the gap is the whole point: the old
              screen turned this into "No coaches listed yet", which a client has
              no way to tell apart from the truth. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Directory" title="We couldn’t load the directory"
              note={`This is our end, not an empty directory. Until it loads we can't tell you who is coaching on ${BRAND.label}.`}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={() => setAttempt((n) => n + 1)} />
              </View>
            </Notice>
          ) : status === 'partial' ? (
            <PartialRead what="listed coaches" shown={coaches.length} onPress={() => setAttempt((n) => n + 1)} />
          ) : null}

          {status === 'loading' ? (
            <View style={{ paddingVertical: sp.huge, alignItems: 'center' }}><ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel="Reading the coach directory…" /></View>
          ) : status === 'error' ? null : coaches.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
              <View style={{ width: 52, height: 52, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: sp.md }}>
                <Icon name="people" size={24} color={t.ink3} />
              </View>
              <Text style={{ ...ty.head, color: t.ink, textAlign: 'center' }}>No coaches listed yet</Text>
              <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 6, maxWidth: 300 }}>Trainers appear here once they publish their profile to the directory. If a coach has invited you directly, their invitation shows above.</Text>
            </View>
          ) : coaches.map((c, i) => (
            <View key={c.id}>
              {i > 0 ? <Rule inset={46} /> : null}
              {/* Everything the row draws, in the order it draws it.
                  A Pressable is ONE accessibility element — it renders
                  `accessible={true}` — so an `accessibilityLabel` on it does
                  not add to the lines below, it REPLACES them. This said
                  `c.name`, and the whole of what a person picks a coach by
                  went with it: the tagline, the rating, the credentials, the
                  specialities, whether a request is already pending, and the
                  session fee — the figure the long note further down this file
                  exists to get right. A member using VoiceOver was handed a
                  directory of names and no way to tell one coach from another,
                  and no way to know they had already asked. */}
              <Pressable onPress={() => setSel(c)} accessibilityRole="button"
                accessibilityLabel={[
                  c.name,
                  c.tagline?.trim() || null,
                  [rateLine(c.id), credentialsSummaryLine(credsFor(c.id), today)].filter(Boolean).join(' · ') || null,
                  sent[c.id] ? 'Request pending' : null,
                  c.specialties.slice(0, 3).join(', ') || null,
                  // The same figure the row prints, said the same way: the
                  // priced arm never acquires a currency nobody chose, and the
                  // other three keep the three different nothings apart.
                  sessionFeeAmount(c.sessionFee) != null
                    ? `${feeMoney(c.id, sessionFeeAmount(c.sessionFee)!) ?? sessionFeeAmount(c.sessionFee)} per session`
                    : sessionFeeShort(c.sessionFee),
                ].filter(Boolean).join('. ')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <CoachFace photo={c.photo} name={c.name} size={34} mono={13} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.name}</Text>
                  {c.tagline ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={1}>{c.tagline}</Text> : null}
                  {/* The two lines a person actually decides on. Each is null
                      when the read behind it did not complete — a rating that
                      could not be fetched leaves a gap, never "No reviews yet",
                      and a credentials read that failed leaves a gap, never
                      the impression that this coach has listed nothing. */}
                  {rateLine(c.id) || credentialsSummaryLine(credsFor(c.id), today) ? (
                    <Text style={{ ...ty.caption, color: t.ink2, marginTop: 3 }}>
                      {[rateLine(c.id), credentialsSummaryLine(credsFor(c.id), today)].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {c.specialties.length > 0 || sent[c.id] ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 7, flexWrap: 'wrap' }}>
                      {sent[c.id] ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>Request pending</Text>
                        </View>
                      ) : null}
                      {c.specialties.slice(0, 3).map((sx) => (
                        <View key={sx} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.sm, paddingVertical: 3 }}>
                          <Text style={{ ...ty.caption, color: t.ink3 }}>{sx}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
                {/* No currency symbol. `trainers` has a `session_fee numeric`
                    and no currency column at all, and part 99 made
                    `tenants.currency` NULLABLE on purpose — Repple is
                    white-labelled and a gym that has not said which money it
                    charges in is not to be guessed at. A '$' stood here, so a
                    client browsing a directory of coaches priced in dirhams
                    read every one of them in dollars: not a formatting slip but
                    a different amount, on the figure somebody picks a coach by.
                    The coach's own profile screen already prints this bare and
                    tells them "Repple does not print a symbol it has not been
                    told" — this is the screen that sentence was describing, and
                    it was the half still printing one. */}
                {/* The figure now carries its currency WHEN THE APP HAS BEEN
                    TOLD ONE. `feeMoney` is `wholeMoney`, which returns null the
                    moment either half is missing, so there is still no branch
                    on which a number acquires a currency nobody chose — the
                    bare number below is the same honest fallback that has stood
                    here since the '$' came off. What is different is that the
                    app can now find out: supabase/parts/242 returns the
                    currency of a listed coach's gym, which is where a session
                    fee has always been denominated (part 126).

                    The row shows the figure and nothing else. The SENTENCE
                    explaining a missing currency is in the profile sheet
                    instead: it is four different sentences depending on why,
                    and a directory of twenty coaches carrying twenty of them is
                    unreadable — while the sheet is where somebody actually
                    decides. */}
                {/* Three different nothings used to render as one blank slot:
                    charges nothing, has not stated a rate, and we could not
                    read the rate. `sessionFeeShort` keeps them apart in two or
                    three words — the sentence is in the sheet below, because
                    twenty of them stacked down a directory is unreadable. */}
                {sessionFeeAmount(c.sessionFee) != null ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ ...value(17), color: t.ink }}>{feeMoney(c.id, sessionFeeAmount(c.sessionFee)!) ?? sessionFeeAmount(c.sessionFee)}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>/ session</Text>
                  </View>
                ) : (
                  <Text style={{ ...ty.caption, color: t.ink3, textAlign: END_ALIGN, flexShrink: 1 }}>{sessionFeeShort(c.sessionFee)}</Text>
                )}
                <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
              </Pressable>
            </View>
          ))}
        </Section>
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '86%', ...elevation.e2 }}>
          {sel && (
            <ScrollView contentContainerStyle={{ padding: G, paddingBottom: sp.xxl }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
                <CoachFace photo={sel.photo} name={sel.name} size={58} mono={20} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.title, color: t.ink }}>{sel.name}</Text>
                  {sel.tagline ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 2 }}>{sel.tagline}</Text> : null}
                </View>
              </View>

              {/* Same rule as the list row above, and the same reason: the app
                  has never been told what this figure is denominated in, so it
                  states the number and not a currency nobody chose. */}
              <View style={{ marginBottom: sp.lg }}>
                {sessionFeeAmount(sel.sessionFee) != null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>Session fee</Text>
                    <Text style={{ ...value(20), color: t.ink }}>{feeMoney(sel.id, sessionFeeAmount(sel.sessionFee)!) ?? sessionFeeAmount(sel.sessionFee)}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginStart: 4 }}>/ session</Text>
                  </View>
                ) : (
                  <>
                    <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 2 }}>Session fee</Text>
                    {/* The one field on this sheet that could not say it was
                        unknown. An unreadable rate is flagged; a rate nobody has
                        stated, and a rate of nothing, are facts rather than
                        faults and read as ordinary caption. */}
                    {sel.sessionFee.kind === 'unreadable' ? (
                      <Flag tone={t.warn}>{sessionFeeNote(sel.sessionFee, sel.name)}</Flag>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{sessionFeeNote(sel.sessionFee, sel.name)}</Text>
                    )}
                  </>
                )}
                  {/* The screen where somebody decides is the screen that owes
                      them the explanation. Four causes, four sentences, and
                      only one of them says nobody has stated a currency — the
                      other three are reads that did not answer, and printing
                      the confident sentence for those is the defect
                      src/lib/currencyGap.ts exists to stop. */}
                  {sessionFeeAmount(sel.sessionFee) != null && feeGap(sel.id) ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{feeGap(sel.id)}</Flag>
                  ) : null}
              </View>

              {sel.bio ? <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{sel.bio}</Text> : null}

              {/* ── what they say they are qualified to do ─────────────────
                  Above the specialties and the request buttons, because it is
                  the thing a serious client is here to check. Every row says
                  whose claim it is; nothing on this screen may imply Repple
                  looked at a certificate, because Repple has not. */}
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Qualifications & insurance</Text>
              {credStatus === 'loading' ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>Loading.</Text>
              ) : credsFor(sel.id) === null ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>
                  We couldn’t load this. It is not a statement that {sel.name} has listed nothing.
                </Text>
              ) : credsFor(sel.id)!.length === 0 ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>
                  {sel.name} hasn’t listed any. Ask them before you book — it is a normal thing to ask.
                </Text>
              ) : (
                <View style={{ marginBottom: sp.xl }}>
                  {sortCredentials(credsFor(sel.id)!, today).map((c) => (
                    <View key={c.id} style={{ marginBottom: sp.md }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                      {credentialLine(c) ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{credentialLine(c)}</Text>
                      ) : null}
                      {/* expiryLine() already says "expired" in words; warn as
                          caption ink is 3.87–4.08:1 on the three light palettes,
                          under AA, so the tone goes into a dot beside it. This
                          is what a member reads before choosing a coach. */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {credentialState(c, today) === 'expired' ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
                        <Text style={{ ...ty.caption, color: credentialState(c, today) === 'expired' ? t.ink2 : t.ink3, flex: 1 }}>
                          {expiryLine(c, today)} · {credentialBadge(c).label}
                        </Text>
                      </View>
                    </View>
                  ))}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    {insuranceLine(insuranceClaim(credsFor(sel.id), today))}
                  </Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{CLAIM_NOTE}</Text>
                </View>
              )}

              {sel.specialties.length > 0 ? (<>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Specialties</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: sp.xl }}>
                  {sel.specialties.map((sx) => (
                    <View key={sx} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                      <Text style={{ ...ty.caption, color: t.ink2 }}>{sx}</Text>
                    </View>
                  ))}
                </View>
              </>) : null}

              {/* ── what their clients said ───────────────────────────────
                  Only people this coach has actually trained can write one —
                  `can_review_coach()` answers on an active or ended
                  relationship and never on a pending join-code request, so a
                  stranger holding a code cannot leave one. The reviewer is a
                  first name and nothing else: `client_id` never leaves the
                  database. */}
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>
                Reviews{ratingLine(ratingDisplay(ratings[sel.id] ?? null, ratingStatus)) ? ` · ${rateLine(sel.id)}` : ''}
              </Text>
              {(() => {
                const state = reviewListState(selReviewStatus, selReviews);
                if (state === 'loading') {
                  return <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>Loading.</Text>;
                }
                if (state === 'unreadable') {
                  /* Not "no reviews yet". That sentence, printed about a coach
                     whose reviews simply did not load, is a claim about their
                     reputation that nothing here has any basis for. */
                  return (
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>
                      We couldn’t load the reviews. This is our end — it does not mean there are none.
                    </Text>
                  );
                }
                if (state === 'none') {
                  return (
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>
                      Nobody has reviewed {sel.name} yet. Only their current and former clients can, so a
                      new coach starts here.
                    </Text>
                  );
                }
                return (
                  <View style={{ marginBottom: sp.xl }}>
                    {selReviews.map((r) => (
                      <View key={r.id} style={{ marginBottom: sp.lg }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>
                          {r.rating} / {MAX_RATING} · {reviewerLabel(r)}{r.edited ? ' · edited' : ''}
                        </Text>
                        {/* A review earned at another gym is shown, and said to
                            be from another gym. Hiding it would report a coach
                            with a record as having none; showing it unlabelled
                            would pass one gym's work off as this one's. */}
                        {gymLine(r) ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 1 }}>{gymLine(r)}</Text>
                        ) : null}
                        {r.body ? (
                          <Text style={{ ...ty.body, color: t.ink2, marginTop: 4 }}>{r.body}</Text>
                        ) : null}
                        {r.coachReply ? (
                          <View style={{ marginTop: sp.sm, paddingStart: sp.md, borderStartWidth: 2, borderStartColor: t.ring }}>
                            <Text style={{ ...ty.micro, color: t.ink3 }}>{sel.name.toUpperCase()} REPLIED</Text>
                            <Text style={{ ...ty.body, color: t.ink2, marginTop: 2 }}>{r.coachReply}</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                );
              })()}

              {sent[sel.id] ? (
                <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.lg, marginBottom: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Request pending</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{sel.name} has your request. You'll be connected when they accept.</Text>
                </View>
              ) : (<>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Start coaching</Text>
                {/* Without the pending-requests read, the absence of a "Request
                    pending" badge is not evidence that none is outstanding —
                    it's evidence we couldn't look. Sending again is harmless
                    (the insert is deduplicated), but the client should know
                    they may be asking twice rather than for the first time. */}
                {pendingUnknown ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                    We couldn’t check your existing requests, so we can’t tell whether you’ve already asked {sel.name}. Sending again won’t create a second request.
                  </Text>
                ) : null}
                {/* You already have a coach, and accepting ends them.
                    `link_coaching` (part 155) ends every other active
                    relationship — "one person has one coach in this product" —
                    so these three buttons were one accept away from removing
                    the coach whose name is drawn at the top of this same
                    screen, and said nothing about it. */}
                {coach && coach.id !== sel.id ? (
                  <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{replaceCoachNote(coach.name, sel.name)}</Flag>
                ) : null}
                {/* And when we could not read who coaches them, that is not
                    evidence that nobody does. */}
                {coachStatus === 'error' ? (
                  <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                    We couldn’t check who coaches you. If somebody does, asking {sel.name} would replace them once they accept.
                  </Flag>
                ) : null}
                {/* Three buttons, each with the line that says what it changes.
                    "Hybrid" is a word until it is spelled out, and the same is
                    true of the two that were already here — a client picking
                    between them had nothing to pick on. */}
                {COACHED_MODES.map((m) => (
                  <View key={m} style={{ marginBottom: sp.md }}>
                    <Cta label={`Request ${COACHED_MODE_SHORT[m].toLowerCase()} coaching`} wide onPress={() => askToRequest(sel, m)} />
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5, textAlign: 'center' }}>{COACHING_MODE_NOTE[m]}</Text>
                  </View>
                ))}
              </>)}

              <View style={{ marginTop: sp.sm }}>
                <Ghost label="Close" onPress={() => setSel(null)} />
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
