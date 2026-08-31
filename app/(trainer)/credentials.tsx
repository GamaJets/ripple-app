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
import { View, Text, ScrollView, TextInput, Alert, ActivityIndicator, Pressable, Modal } from 'react-native';
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
  MAX_RATING, MAX_REPLY, REPLY_NOTE, type Review,
} from '../../src/lib/reviews';

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
  const { user } = useAuth();
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
    if (!uid) return;
    setCredStatus('loading');
    setRevStatus('loading');
    const [c, r] = await Promise.all([fetchCoachCredentials(uid), fetchReviews(uid)]);
    setCreds(c.rows);
    setCredStatus(c.status);
    setReviews(r.rows);
    setRevStatus(r.status);
  }, [uid]);

  useEffect(() => { void load(); }, [load, attempt]);

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

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
                    <View style={{ marginTop: sp.md, paddingLeft: sp.md, borderLeftWidth: 2, borderLeftColor: t.ring }}>
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
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
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
      </Modal>

      {/* ── the reply sheet ─────────────────────────────────────────────── */}
      <Modal visible={!!replyTo} transparent animationType="slide" onRequestClose={() => setReplyTo(null)}>
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
      </Modal>
    </SafeAreaView>
  );
}
