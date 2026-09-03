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
import { Rule, Section, SectionHead, ListRow, Ghost, Cta, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
// 44pt, and the one place the number lives. See the rating row below.
import { MIN_TARGET } from '../../src/lib/a11y';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { useReadDeadline } from '../../src/ui/readDeadline';
import {
  fetchCoachCredentials, fetchMyReview, canReview, writeReview, withdrawReview,
} from '../../src/ui/reviews';
import { useToday } from '../../src/ui/today';
import {
  credentialBadge, credentialLine, expiryLine, sortCredentials, insuranceClaim, insuranceLine,
  credentialState, CLAIM_NOTE, type Credential,
} from '../../src/lib/coachCredentials';
import {
  reviewGate, reviewGateNote, writeOutcome, validateReview, draftProblemText,
  IDENTITY_NOTE, EDIT_NOTE, WITHDRAW_NOTE, MAX_BODY, MIN_RATING, MAX_RATING,
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

  // The four reads behind this screen: the coach's profile, their branding,
  // their credentials, and this member's own review and whether they may leave
  // one. `tick` runs the last three; `load` is the first.
  const pull = usePullToRefresh(useCallback(() => {
    void load(); setTick((n) => n + 1);
  }, [load]));

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Coaching</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Your Coach</Text>
          </View>
        </View>

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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
              {/* The coach's colour, where they have one and it applies. Drawn
                  as a ring rather than as a fill: the photo inside it is the
                  content, and a coloured plate behind a face is decoration
                  pretending to be identity. `applied.color` has already been
                  MEASURED — coachBrandColorOf refuses anything that could not
                  carry a readable label, whoever wrote it and by whatever
                  route — so nothing downstream needs to check it again. */}
              <View style={{
                width: 62, height: 62, borderRadius: 31, backgroundColor: t.surface2,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                borderWidth: applied.color ? 2 : 0, borderColor: applied.color ?? undefined,
              }}>
                {coach.avatar
                  ? <Image source={{ uri: coach.avatar }} style={{ width: 62, height: 62 }} />
                  : <Text style={{ ...ty.head, color: t.ink3 }}>{monogram(coach.name)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                {/* A name that could not be read renders as a dash. It is never
                    replaced with "Your coach", which would look like a name and
                    is not one. */}
                <Text style={{ ...ty.head, color: t.ink }}>{coach.name ?? '—'}</Text>
                {/* What they trade as, where that is not their own name. Only
                    when the coach's brand is the one in effect: a gym member's
                    app is the gym's, and printing the coach's business name in
                    it anyway would be the override this screen just declined to
                    make. */}
                {applied.source === 'coach' && applied.name && applied.name !== coach.name ? (
                  <Text style={{ ...ty.label, color: t.ink2, marginTop: 3 }}>{applied.name}</Text>
                ) : null}
                {coach.tagline ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{coach.tagline}</Text>
                ) : null}
              </View>
            </View>

            {/* One sentence, and only when there is something to say: either a
                gym is overriding branding this coach has set, or these really
                are the coach's colours and the client should be able to tell
                them from the app's. Null the rest of the time — a screen that
                explains an absence nobody noticed is noise. */}
            {brandNote ? (
              <Flag tone={applied.color ?? t.ink3} style={{ marginTop: sp.lg }}>{brandNote}</Flag>
            ) : null}

            {coach.bio ? (
              <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg, lineHeight: 22 }}>{coach.bio}</Text>
            ) : null}

            {coach.specialties.length ? (
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>SPECIALISES IN</Text>
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
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>OFFERS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {coach.offers.map((o) => (
                    <View key={o} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ ...ty.caption, color: t.ink2 }}>{o}</Text>
                    </View>
                  ))}
                </View>
              </View>
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
                    <Text style={{ ...ty.body, color: t.ink }}>
                      You rated {coach.name ?? 'them'} {live.rating} out of {MAX_RATING}.
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
            </Section>
          </>
        )}
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
