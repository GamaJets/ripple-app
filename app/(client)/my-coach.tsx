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
import { View, Text, ScrollView, Image, TextInput, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, ListRow, Ghost, Cta, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';
import {
  fetchCoachCredentials, fetchMyReview, canReview, writeReview, withdrawReview, todayKey,
} from '../../src/ui/reviews';
import {
  credentialBadge, credentialLine, expiryLine, sortCredentials, insuranceClaim, insuranceLine,
  credentialState, CLAIM_NOTE, type Credential,
} from '../../src/lib/coachCredentials';
import {
  reviewGate, reviewGateNote, writeOutcome, validateReview, draftProblemText,
  IDENTITY_NOTE, EDIT_NOTE, WITHDRAW_NOTE, MAX_BODY, MIN_RATING, MAX_RATING,
  type MyReview,
} from '../../src/lib/reviews';

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
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const today = useMemo(() => todayKey(), []);

  // `null` under 'error' rather than `[]`, so nothing downstream can turn a
  // refused read into "this coach has declared no insurance" — which is a
  // statement about somebody's professional standing, not a blank field.
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [credStatus, setCredStatus] = useState<LoadStatus>('loading');
  const [mine, setMine] = useState<MyReview | null>(null);
  const [mineStatus, setMineStatus] = useState<LoadStatus>('loading');
  const [gate, setGate] = useState<boolean | null>(null);
  const [gateStatus, setGateStatus] = useState<LoadStatus>('loading');

  const [open, setOpen] = useState(false);
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
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
              If a coach has given you a six-digit code, enter it on Find a Trainer and they will get your
              request.
            </Text>
            <View style={{ marginTop: sp.lg }}>
              <Ghost label="Find a Trainer" onPress={() => go('/(client)/trainers')} />
            </View>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
              <View style={{
                width: 62, height: 62, borderRadius: 31, backgroundColor: t.surface2,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
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
                {coach.tagline ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{coach.tagline}</Text>
                ) : null}
              </View>
            </View>

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
                  {coach.name ?? 'Your coach'} hasn’t listed any qualifications or insurance in Repple. Ask
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
                      <View style={{ marginTop: sp.md, paddingLeft: sp.md, borderLeftWidth: 2, borderLeftColor: t.ring }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>THEIR REPLY</Text>
                        <Text style={{ ...ty.body, color: t.ink2, marginTop: 3 }}>{live.coachReply}</Text>
                      </View>
                    ) : null}
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{EDIT_NOTE}</Text>
                    <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                      <View style={{ flex: 1 }}><Ghost label="Withdraw" onPress={withdraw} /></View>
                      <View style={{ flex: 1 }}><Ghost label="Change it" onPress={openForm} /></View>
                    </View>
                  </>) : (<>
                    <Text style={{ ...ty.label, color: t.ink3 }}>
                      {mine?.withdrawnAt
                        ? 'You withdrew your review. Writing a new one replaces it rather than adding a second.'
                        : 'Nobody browsing Repple can tell what a coach is like to train with until somebody who has says so.'}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{IDENTITY_NOTE}</Text>
                    <View style={{ marginTop: sp.lg }}>
                      <Cta label={mine?.withdrawnAt ? 'Write a New Review' : 'Write a Review'} wide onPress={openForm} />
                    </View>
                  </>)}

                  {open ? (
                    <View style={{ marginTop: sp.lg }}>
                      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>YOUR RATING</Text>
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
                        {[MIN_RATING, 2, 3, 4, MAX_RATING].map((n) => (
                          <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="button"
                            accessibilityLabel={`${n} out of ${MAX_RATING}`}
                            style={{
                              flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: radius.sm,
                              backgroundColor: rating === n ? t.brand : t.surface2,
                            }}>
                            <Text style={{ ...ty.body, color: rating === n ? t.bg : t.ink2 }}>{n}</Text>
                          </Pressable>
                        ))}
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
              <ListRow icon="message" title="Message" note="Your thread with them" onPress={() => go('/(client)/messages')} />
              <ListRow icon="calendar" title="Book a Session" note="Their open times" onPress={() => go('/(client)/calendar')} />
              <ListRow icon="trophy" title="Packs & Memberships" note="What you have bought from them" onPress={() => go('/(client)/packages')} />
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
    </SafeAreaView>
  );
}
