// Trainer · Credentials & Reviews. The two things a stranger judges a coach on,
// and the only screen where the coach gets a say in either.
//
// ── Why the two are on one screen ─────────────────────────────────────────
//
// They are the same surface. A `trainers` row could say what a coach likes
// talking about and what they charge, and could not say what they are qualified
// to do, whether they are insured, or what anybody who trained with them
// thought. Both gaps are filled by supabase/parts/139, and both are read by the
// same two client screens — the directory and Your Coach.
//
// The reviews half is not optional decoration. A review system with no answer
// back is a one-way channel from a client to a public profile about a named
// person's livelihood, and the first misunderstanding it carries is the one
// that costs somebody their account. The right of reply had to ship in the same
// change as the reviews, so it is here, and `REPLY_NOTE` tells the coach in
// plain words that a reply is the only recourse the app gives them.
//
// ── The word this screen may not print ────────────────────────────────────
//
// Repple has not checked any of this. Every credential is the coach's own
// statement, `credentialBadge` cannot produce a checked-looking label for one,
// and the three verification columns are not in any write this screen makes —
// `authenticated` holds no grant on them, so the database would refuse the row
// outright even if a future edit tried. The header of supabase/parts/139 sets
// out what verification would actually cost; until that exists, this screen
// says "Stated by you" and means it.
//
// ── Three states, not two, on every read ─────────────────────────────────
//
// "You have added no qualifications" and "we could not read your
// qualifications" look identical if the failure is allowed to become an empty
// list — and this is a screen a coach comes to when a client has asked whether
// they are insured. Both reads carry a LoadStatus and both empties are gated on
// it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, TextInput, Alert, ActivityIndicator, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import type { LoadStatus } from '../../src/ui/loadStatus';
import {
  fetchCoachCredentials, addCredential, updateCredential, deleteCredential,
  fetchReviews, replyToReview, todayKey,
} from '../../src/ui/reviews';
import {
  credentialBadge, credentialLine, credentialState, expiryLine, sortCredentials,
  validateDraft, draftProblemText, referenceAllowed, insuranceClaim,
  CLAIM_NOTE_COACH, MAX_TITLE, MAX_ISSUER, MAX_REFERENCE,
  type Credential, type CredentialDraft, type CredentialKind,
} from '../../src/lib/coachCredentials';
import {
  reviewListState, reviewerLabel, gymLine, unansweredCount, validateReply,
  askMomentNote, reviewAskDraft, askListNote, ASK_IS_UNFILTERED, WHO_REVIEWED_IS_HIDDEN,
  MAX_RATING, MAX_REPLY, REPLY_NOTE, type Review,
} from '../../src/lib/reviews';
import { useReviewAsks, type AskRow } from '../../src/ui/reviewAsks';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { useThread } from '../../src/ui/messaging';

const EMPTY: CredentialDraft = {
  kind: 'certification', title: '', issuer: '', reference: '', issuedOn: '', expiresOn: '',
};

/** A date a coach reads. An unparseable one stays a dash rather than "Invalid Date". */
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
}

export default function TrainerCredentials() {
  const t = useTheme();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id ?? null;
  const G = layout.gutter;
  const today = useMemo(() => todayKey(), []);

  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [credStatus, setCredStatus] = useState<LoadStatus>('loading');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [revStatus, setRevStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  const [draft, setDraft] = useState<CredentialDraft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [replyTo, setReplyTo] = useState<Review | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    // The early return used to sit ABOVE both status setters, so with no `uid`
    // this screen kept the 'loading' it was initialised with — for good. Both
    // sections spun, and the "Try Again" the error branch offers was
    // unreachable, because the only way out of 'loading' is a read that this
    // return prevented. `app/(trainer)/_layout.tsx` checks the group and does
    // NOT redirect on a lost session, so a coach whose token expires while they
    // are in here is left watching two spinners with no way forward.
    //
    // Two different answers, and the difference is `authLoading`:
    if (!uid) {
      // The session is still being resolved. Nothing is known yet, and
      // 'loading' is exactly what that means — this is the honest spinner.
      if (authLoading) { setCredStatus('loading'); setRevStatus('loading'); return; }
      // Auth has settled and there is nobody signed in. We cannot read this
      // coach's credentials, which is 'error' — UNKNOWN, not "you have added
      // none" — and the error branch's Try Again then re-runs this and picks up
      // a session that has come back.
      setCreds(null); setCredStatus('error');
      setReviews([]); setRevStatus('error');
      return;
    }
    setCredStatus('loading');
    setRevStatus('loading');
    const [c, r] = await Promise.all([fetchCoachCredentials(uid), fetchReviews(uid)]);
    setCreds(c.rows);
    setCredStatus(c.status);
    setReviews(r.rows);
    setRevStatus(r.status);
  }, [uid, authLoading]);

  useEffect(() => { void load(); }, [load, attempt]);
  // Two reads in one call: the coach's own credentials, and the reviews their
  // clients wrote. The second arrives entirely from other people, so nothing
  // the coach does on this screen brings a new one in.
  const pull = usePullToRefresh(load);

  const openNew = () => { setEditing(null); setDraft(EMPTY); setFormOpen(true); };
  const openEdit = (c: Credential) => {
    setEditing(c.id);
    setDraft({
      kind: c.kind,
      title: c.title,
      issuer: c.issuer ?? '',
      reference: c.reference ?? '',
      issuedOn: c.issuedOn ?? '',
      expiresOn: c.expiresOn ?? '',
    });
    setFormOpen(true);
  };

  // Switching to insurance drops a registration number that is already typed
  // rather than carrying it silently into a row where it would be stripped.
  // The coach sees the field go, which is the point of refusing it.
  const setKind = (kind: CredentialKind) =>
    setDraft((d) => ({ ...d, kind, reference: referenceAllowed(kind) ? d.reference : '' }));

  const problem = validateDraft(draft);

  const save = async () => {
    if (!uid || saving || problem !== 'ok') return;
    setSaving(true);
    const r = editing
      ? await updateCredential(editing, draft, uid)
      : await addCredential(draft, uid);
    setSaving(false);
    if (!r.ok) {
      // Never "saved" over a write the server did not make. A zero-row write is
      // not an error in PostgREST, which is why addCredential counts rows.
      Alert.alert('Not saved', r.reason ?? 'Nothing was written. Try again in a moment.');
      return;
    }
    setFormOpen(false);
    setDraft(EMPTY);
    setEditing(null);
    setAttempt((n) => n + 1);
  };

  const remove = (c: Credential) => {
    Alert.alert(
      'Remove this?',
      `"${c.title}" comes off your profile for everyone who can see it. You can add it again later.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: () => {
            void (async () => {
              const r = await deleteCredential(c.id);
              if (!r.ok) { Alert.alert('Not removed', r.reason ?? 'Nothing changed.'); return; }
              setAttempt((n) => n + 1);
            })();
          },
        },
      ],
    );
  };

  const sendReply = async () => {
    if (!replyTo || replying) return;
    if (validateReply(replyText) !== 'ok') { Alert.alert('Too long', `Keep your reply under ${MAX_REPLY} characters.`); return; }
    setReplying(true);
    const ok = await replyToReview(replyTo.id, replyText);
    setReplying(false);
    if (!ok) { Alert.alert('Not posted', 'Your reply was not saved. Nothing has changed on your profile — try again in a moment.'); return; }
    setReplyTo(null);
    setReplyText('');
    setAttempt((n) => n + 1);
  };

  const sorted = creds ? sortCredentials(creds, today) : [];
  const listState = reviewListState(revStatus, reviews);
  const waiting = unansweredCount(reviews, revStatus);
  const insurance = insuranceClaim(creds, today);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 48 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your profile</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Credentials & Reviews</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>
              What you are qualified to do, and what your clients have said.
            </Text>
          </View>
        </View>

        {/* ── the honesty notice, first, before anything is typed ───────── */}
        <View style={{ marginTop: sp.lg }}>
          <Notice tone={t.ink3} kicker="Read this first" title="Repple does not check these"
            note={CLAIM_NOTE_COACH} />
        </View>

        {/* ── credentials ───────────────────────────────────────────────── */}
        <Section>
          <SectionHead
            title="What You Are Qualified To Do"
            note={credStatus === 'ready' && creds ? String(creds.length) : undefined}
          />

          {credStatus === 'loading' ? (
            <View style={{ paddingVertical: sp.xl, alignItems: 'center' }}><ActivityIndicator color={t.brand} /></View>
          ) : credStatus === 'error' ? (
            /* Not "you have added none". A coach reading that would add the
               same qualification a second time, and a coach checking whether
               their insurance is on their profile would be told it is not. */
            <Notice tone={t.warn} kicker="Credentials" title="We couldn’t load your credentials"
              note="This is our end. Don’t read it as your profile being empty — until it loads we can’t tell you what is on it.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={() => setAttempt((n) => n + 1)} />
              </View>
            </Notice>
          ) : sorted.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              You haven’t added any yet. A client browsing the directory has no way to tell what you are
              trained in, and the first thing most of them ask is whether you are insured.
            </Text>
          ) : sorted.map((c, i) => {
            const state = credentialState(c, today);
            const badge = credentialBadge(c);
            const detail = credentialLine(c);
            return (
              <View key={c.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                    {detail ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{detail}</Text> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 6, flexWrap: 'wrap' }}>
                      <Flag tone={state === 'expired' ? t.warn : t.ink3}>{expiryLine(c, today)}</Flag>
                      {/* Shown to the coach as well, so nobody is surprised by
                          what a client sees next to their certificate. */}
                      <Text style={{ ...ty.caption, color: t.ink3 }}>
                        {badge.checked ? badge.label : 'Stated by you'}
                      </Text>
                    </View>
                  </View>
                  <Ghost label="Edit" onPress={() => openEdit(c)} />
                  <Ghost icon="minus" a11yLabel={`Remove ${c.title}`} onPress={() => remove(c)} />
                </View>
              </View>
            );
          })}

          {credStatus === 'ready' && insurance === 'none-stated' ? (
            <View style={{ marginTop: sp.md }}>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                You have not listed insurance. Gyms ask for it before they let anybody on the floor, and
                clients ask before they book.
              </Text>
            </View>
          ) : null}
          {credStatus === 'ready' && insurance === 'lapsed' ? (
            <View style={{ marginTop: sp.md }}>
              <Flag tone={t.warn}>
                The cover you listed has expired, and that is what your profile is telling people. Update
                the date when you renew.
              </Flag>
            </View>
          ) : null}

          <View style={{ marginTop: sp.lg }}>
            <Cta label="Add a Qualification or Policy" wide onPress={openNew} />
          </View>
        </Section>

        <Rule />

        {/* ── asking for one ─────────────────────────────────────────────────
            The shelf was built and nothing ever offered to fill it: a coach
            could read their reviews and reply to them, and `askForReview`
            appeared nowhere in this repository. A review arrives only if a
            client thinks of it unprompted, which most of them never will.

            Two rules, and both are the nudge screen's:

            · NOTHING IS SENT FROM HERE. What comes out is a draft, in a box,
              that the coach edits and sends with their own thumb through the
              ordinary thread. A message that appears to come from a person who
              did not write it is a defect this codebase has already removed
              once.
            · NOT ON A TIMER. Asked at an evidenced moment — a goal they marked
              reached, or a long enough record to have something to say. A
              monthly "rate your coach" sweep is how a five-star business
              collects two-star reviews from people having a bad week.

            And the refusal that is not negotiable: this list is NOT filtered by
            who is likely to rate well. See `ASK_IS_UNFILTERED`. */}
        <ReviewAsks />

        <Rule />

        {/* ── reviews, and the answer back ───────────────────────────────── */}
        <Section>
          <SectionHead
            title="What Your Clients Said"
            note={revStatus === 'ready' && reviews.length > 0 ? String(reviews.length) : undefined}
          />

          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>{REPLY_NOTE}</Text>

          {waiting !== null && waiting > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
              {waiting} {waiting === 1 ? 'review has' : 'reviews have'} no reply from you yet.
            </Text>
          ) : null}

          {listState === 'loading' ? (
            <View style={{ paddingVertical: sp.xl, alignItems: 'center' }}><ActivityIndicator color={t.brand} /></View>
          ) : listState === 'unreadable' ? (
            <Notice tone={t.warn} kicker="Reviews" title="We couldn’t load your reviews"
              note="This is our end, not an empty profile. Until it loads we can’t tell you what clients have written or whether anything is waiting on a reply.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={() => setAttempt((n) => n + 1)} />
              </View>
            </Notice>
          ) : listState === 'none' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nobody has reviewed you yet. Only people you have actually coached — now or in the past —
              can, so this fills up slowly and on its own.
            </Text>
          ) : reviews.map((r, i) => {
            const gym = gymLine(r);
            return (
              <View key={r.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ paddingVertical: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.rating} / {MAX_RATING}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                      {reviewerLabel(r)} · {when(r.createdAt)}{r.edited ? ' · edited' : ''}
                    </Text>
                  </View>
                  {gym ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{gym}</Text> : null}
                  {r.body ? <Text style={{ ...ty.body, color: t.ink2, marginTop: 6 }}>{r.body}</Text> : null}

                  {r.coachReply ? (
                    <View style={{ marginTop: sp.md, paddingStart: sp.md, borderStartWidth: 2, borderStartColor: t.ring }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>YOUR REPLY</Text>
                      <Text style={{ ...ty.body, color: t.ink2, marginTop: 3 }}>{r.coachReply}</Text>
                    </View>
                  ) : null}

                  <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                    <Ghost
                      label={r.coachReply ? 'Change your reply' : 'Reply'}
                      onPress={() => { setReplyTo(r); setReplyText(r.coachReply ?? ''); }}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </Section>
      </ScrollView>

      {/* ── the credential form ─────────────────────────────────────────── */}
      {/* ── the keyboard covered this sheet ────────────────────────────────
          A bottom sheet is anchored to the bottom of the window, so the keyboard comes
          up OVER it: every field below the first one is behind it, and this form has seven.

          The fix a sheet takes is not the page one. `automaticallyAdjustKeyboardInsets`
          scrolls a focused row inside a scroller that stays where it is; here the whole
          sheet has to move. This wrapper is the pattern app/(trainer)/invoices.tsx,
          costs.tsx and receipts.tsx already use and the one on the picker in
          app/(trainer)/log-session.tsx: `behavior="padding"` pads the KAV, which shrinks
          the flex:1 scrim above the sheet and lifts the sheet with it — and the sheet's
          percentage maxHeight resolves against the shrunken box, so it stays whole
          instead of running off the top. */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setFormOpen(false)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '88%' }}>
            <ScrollView contentContainerStyle={{ padding: G, paddingBottom: sp.xxl }} showsVerticalScrollIndicator={false}>
              <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.md }}>
                {editing ? 'Edit' : 'Add'} a credential
              </Text>

              <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
                {(['certification', 'insurance'] as const).map((k) => (
                  <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="button"
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center',
                      backgroundColor: draft.kind === k ? t.brand : t.surface2,
                    }}>
                    <Text style={{ ...ty.caption, color: draft.kind === k ? t.bg : t.ink2 }}>
                      {k === 'certification' ? 'Qualification' : 'Insurance'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>
                {draft.kind === 'certification' ? 'QUALIFICATION' : 'COVER'}
              </Text>
              <TextInput
                value={draft.title}
                onChangeText={(v) => setDraft((d) => ({ ...d, title: v }))}
                placeholder={draft.kind === 'certification' ? 'Level 3 Personal Trainer' : 'Public liability'}
                placeholderTextColor={t.ink3}
                maxLength={MAX_TITLE}
                accessibilityLabel="What the credential is"
                style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 12, ...ty.body, color: t.ink, marginBottom: sp.md }}
              />

              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>
                {draft.kind === 'certification' ? 'AWARDING BODY' : 'INSURER'}
              </Text>
              <TextInput
                value={draft.issuer}
                onChangeText={(v) => setDraft((d) => ({ ...d, issuer: v }))}
                placeholder={draft.kind === 'certification' ? 'CIMSPA' : 'Insure4Sport'}
                placeholderTextColor={t.ink3}
                maxLength={MAX_ISSUER}
                accessibilityLabel="Who issued it"
                style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 12, ...ty.body, color: t.ink, marginBottom: sp.md }}
              />

              {/* Only for a qualification, and the reason is on the screen. A
                  registration number is the one thing that lets a reader check
                  the claim themselves; a policy number is checkable by nobody and
                  identifies a live policy, so it is not collected at all. */}
              {referenceAllowed(draft.kind) ? (<>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>REGISTRATION NUMBER (OPTIONAL)</Text>
                <TextInput
                  value={draft.reference}
                  onChangeText={(v) => setDraft((d) => ({ ...d, reference: v }))}
                  placeholder="R123456"
                  placeholderTextColor={t.ink3}
                  maxLength={MAX_REFERENCE}
                  autoCapitalize="characters"
                  accessibilityLabel="Registration or certificate number"
                  style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 12, ...ty.body, color: t.ink }}
                />
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5, marginBottom: sp.md }}>
                  Shown on your profile. It is what lets a client look you up on the register themselves —
                  which is worth more than anything we could put next to it.
                </Text>
              </>) : (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                  Policy numbers are not published. Nobody outside your insurer can check one, and it
                  identifies a live policy — the insurer and the renewal date are what a client needs.
                </Text>
              )}

              <View style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>ISSUED (OPTIONAL)</Text>
                  <TextInput
                    value={draft.issuedOn}
                    onChangeText={(v) => setDraft((d) => ({ ...d, issuedOn: v }))}
                    placeholder="2019-06-01"
                    placeholderTextColor={t.ink3}
                    maxLength={10}
                    accessibilityLabel="Issue date, year dash month dash day"
                    style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 12, ...ty.body, color: t.ink }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>EXPIRES (OPTIONAL)</Text>
                  <TextInput
                    value={draft.expiresOn}
                    onChangeText={(v) => setDraft((d) => ({ ...d, expiresOn: v }))}
                    placeholder="2027-06-01"
                    placeholderTextColor={t.ink3}
                    maxLength={10}
                    accessibilityLabel="Expiry date, year dash month dash day"
                    style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 12, ...ty.body, color: t.ink }}
                  />
                </View>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>
                Leave the expiry blank only if it genuinely never runs out. Blank is shown as "no expiry
                date given", which is a different thing from a date in the past.
              </Text>

              {problem !== 'ok' ? (
                <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{draftProblemText(problem)}</Flag>
              ) : null}

              <Cta label={saving ? 'Saving…' : editing ? 'Save Changes' : 'Add It'} wide
                disabled={saving || problem !== 'ok'} onPress={() => { void save(); }} />
              <View style={{ marginTop: sp.md }}>
                <Ghost label="Cancel" onPress={() => setFormOpen(false)} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── the reply sheet ─────────────────────────────────────────────── */}
      {/* ── the keyboard covered this sheet ────────────────────────────────
          A bottom sheet is anchored to the bottom of the window, so the keyboard comes
          up OVER it: the reply box and the button that posts it are both under it.

          The fix a sheet takes is not the page one. `automaticallyAdjustKeyboardInsets`
          scrolls a focused row inside a scroller that stays where it is; here the whole
          sheet has to move. This wrapper is the pattern app/(trainer)/invoices.tsx,
          costs.tsx and receipts.tsx already use and the one on the picker in
          app/(trainer)/log-session.tsx: `behavior="padding"` pads the KAV, which shrinks
          the flex:1 scrim above the sheet and lifts the sheet with it — and the sheet's
          percentage maxHeight resolves against the shrunken box, so it stays whole
          instead of running off the top. */}
      <Modal visible={!!replyTo} transparent animationType="slide" onRequestClose={() => setReplyTo(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setReplyTo(null)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '88%' }}>
            {replyTo ? (
              <ScrollView contentContainerStyle={{ padding: G, paddingBottom: sp.xxl }} showsVerticalScrollIndicator={false}>
                <Text style={{ ...ty.title, color: t.ink }}>Reply</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.md }}>
                  To {reviewerLabel(replyTo)}’s {replyTo.rating} of {MAX_RATING} review, {when(replyTo.createdAt)}.
                </Text>
                {replyTo.body ? (
                  <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{replyTo.body}</Text>
                ) : null}
                <TextInput
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder="Answer it the way you would in the gym."
                  placeholderTextColor={t.ink3}
                  multiline
                  maxLength={MAX_REPLY}
                  accessibilityLabel="Your public reply"
                  style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.lg, minHeight: 120, ...ty.body, color: t.ink, textAlignVertical: 'top' }}
                />
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>
                  Clearing the box removes your reply. If this client rewrites their review later, your reply
                  goes with it — it answered what they wrote before.
                </Text>
                <Cta label={replying ? 'Posting…' : 'Post Reply'} wide disabled={replying}
                  onPress={() => { void sendReply(); }} />
                <View style={{ marginTop: sp.md }}>
                  <Ghost label="Cancel" onPress={() => setReplyTo(null)} />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}


/* ── who is worth asking, and the draft ─────────────────────────────────────── */

/**
 * The list, and one sheet.
 *
 * Its own component and its own reads: this screen is about credentials and
 * reviews, and folding a roster read plus a goals read into its load would make
 * opening it wait on both. Renders nothing at all while the reads are in
 * flight, for src/ui/ScreenHelp.tsx's reason — a section that appears for one
 * frame and vanishes is worse than one that arrives a frame late.
 */
function ReviewAsks() {
  const t = useTheme();
  const asks = useReviewAsks();
  const [drafting, setDrafting] = useState<AskRow | null>(null);

  const rows = asks.rows;
  if (asks.status === 'loading' || rows == null) return null;
  const worth = rows.filter((r) => r.moment !== 'none');

  return (
    <Section>
      <SectionHead title="Worth Asking" note={worth.length ? String(worth.length) : undefined} />
      <Text style={{ ...ty.label, color: t.ink2 }}>{askListNote(rows)}</Text>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{ASK_IS_UNFILTERED}</Text>

      {/* The list is shorter than it should be, for a reason that is not about
          the clients. Said out loud rather than left as a short list. */}
      {asks.askedUnread ? (
        <View style={{ marginTop: sp.md }}>
          <Flag tone={t.warn}>
            Who you have already asked could not be read on this phone, so nobody is suggested — this is not a book
            with nobody worth asking in it. Nothing has been sent either way.
          </Flag>
        </View>
      ) : null}
      {asks.status === 'partial' ? (
        <View style={{ marginTop: sp.md }}>
          <Flag tone={t.warn}>
            Only part of your clients’ goals came back, so somebody who has just reached one may be missing from this
            list. Nobody here is wrong; the list is short.
          </Flag>
        </View>
      ) : null}

      {worth.length ? (
        <View style={{ marginTop: sp.md }}>
          {worth.map((r, i) => (
            <View key={r.clientId}
              style={{ paddingVertical: sp.md, borderTopWidth: i ? 1 : 0, borderTopColor: t.ring }}>
              <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>{r.name ?? 'Unnamed client'}</Text>
              <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{askMomentNote(r.moment, r.candidate)}</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                <Ghost label="Write the Ask"
                  a11yLabel={`Write a review request to ${r.name ?? 'this client'}`}
                  onPress={() => setDrafting(r)} />
              </View>
            </View>
          ))}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{WHO_REVIEWED_IS_HIDDEN}</Text>
        </View>
      ) : null}

      <Modal visible={!!drafting} animationType="slide" onRequestClose={() => setDrafting(null)}>
        {drafting ? (
          <AskSheet
            row={drafting}
            onClose={() => setDrafting(null)}
            onSent={async () => {
              // AFTER the message has landed, never before. A record written
              // first would mark somebody asked who was never reached, and they
              // would then never be suggested again. The same ordering
              // app/(trainer)/nudges.tsx keeps for `client_nudges`.
              await asks.markAsked(drafting.clientId);
              setDrafting(null);
            }}
          />
        ) : null}
      </Modal>
    </Section>
  );
}

/**
 * The draft, in a box, before anybody has sent anything.
 *
 * `useThread` is called here rather than in the list because it is keyed on one
 * client and opens a realtime channel for that thread; hoisting it would mean
 * the screen held a subscription to whichever client was selected last, for as
 * long as it was open. The same reasoning `DraftSheet` gives on the nudge
 * screen.
 */
function AskSheet({ row, onClose, onSent }: {
  row: AskRow;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const t = useTheme();
  const { name: coachName } = useMyTrainerProfile();
  const { send } = useThread(row.clientId, 'coach');
  const [body, setBody] = useState(reviewAskDraft(row.moment, row.name, coachName));
  const [sending, setSending] = useState(false);

  const doSend = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    const r = await send(text);
    setSending(false);
    if (!r.ok) {
      Alert.alert('Not sent', r.reason ?? 'That message did not reach the server, so it has not been sent.');
      return;
    }
    await onSent();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          220 rather than 40 because the message body is what this screen is for, and Send is
          directly under it. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 220 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={onClose} a11yLabel="Close without sending" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Draft — nothing sent yet</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>{row.name ?? 'Client'}</Text>
          </View>
        </View>

        <Section>
          <Text style={{ ...ty.label, color: t.ink2 }}>{askMomentNote(row.moment, row.candidate)}</Text>
        </Section>

        <Section>
          <SectionHead title="Your Message" note="edit before sending" />
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            accessibilityLabel="Message asking for a review"
            placeholderTextColor={t.ink3}
            style={{
              ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
              padding: sp.md, minHeight: 150, textAlignVertical: 'top',
            }}
          />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            This goes to {row.name ?? 'them'} from you, in your ordinary chat thread. It is not sent until you press
            Send, and what they write goes up exactly as they write it — at every rating.
          </Text>
        </Section>

        <Section>
          <Cta label={sending ? 'Sending…' : 'Send'} onPress={() => { void doSend(); }} wide
            disabled={sending || !body.trim()} />
          <View style={{ marginTop: sp.md }}>
            <Ghost label="Close Without Sending" onPress={onClose} />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
