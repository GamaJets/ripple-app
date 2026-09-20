// Client · the gym's own paperwork, and the first place a member has ever been
// able to sign any of it.
//
// ── What this replaces ────────────────────────────────────────────────────
//
// Nothing. There was no member-side path: the only control in the product that
// wrote to `gym_agreement_signatures` was a <select> of the roster beside a
// text box on studio-web/app/compliance/page.tsx, filled in by whoever was at
// the desk. So the gym's record of "this member signed our liability waiver"
// was, in every case, a member of staff typing that member's name — and that is
// the document the gym would produce if somebody were injured.
//
// A signature written here is attributed to the member by the DATABASE, from
// auth.uid(), by the trigger in supabase/parts/520. This screen does not send a
// member id and could not send somebody else's; the RLS policy refuses any
// insert where the row's member is not the session's own account.
//
// ── Which paperwork is which, and why the reader is told ──────────────────
//
// This app now has three sets of documents and a member who confuses them takes
// a dispute to the wrong party:
//
//   · the release agreed on joining      Repple's, part 84, src/ui/waiver.tsx
//   · your coach's own forms             one coach's, app/(client)/coach-documents.tsx
//   · these                              the GYM's, part 185
//
// The notices at the foot say so in the reader's own words rather than leaving
// it to a heading.
//
// ── Why the wording is on the screen and not behind a link ────────────────
//
// A signing screen that shows a title and a Sign button records agreement to a
// document nobody put in front of anybody, which is a worse record than the
// desk entry it replaces — the desk entry at least never pretended the member
// had read anything. So the body is here, in full, and Sign is refused until it
// has been opened. The database cannot check that; nothing about scrolling is
// visible to it, so the app is the only place it can be true.
import { useCallback, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BRAND } from '../../src/lib/brands';
import { View, Text, ScrollView, Alert, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Flag, PageHead } from '../../src/ui/kit';
import { Icon } from '../../src/ui/Icon';
import { sp, layout, radius, hairline, grown, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
// Storage-first, so it answers in a gym with no signal — and it keeps the
// outage apart from the sign-out, which is the distinction `signedOut` below
// was declared to make and could not. See src/lib/authReadFate.ts.
import { sessionUid } from '../../src/lib/sessionUid';
import type { LoadStatus } from '../../src/ui/loadStatus';

import { useReadDeadline } from '../../src/ui/readDeadline';
import { AGREEMENT_LABEL } from '../../src/lib/gymDocs';
import {
  forMember, outstanding, agreementSummary, signingBlocker, signAsMember,
  fetchGymAgreements, fetchMySignatures,
  fetchMyRevocations, withdrawConsent, mayWithdraw, withdrawBlocker,
  withdrawnLine, withdrawTitle, memberMayRevoke,
  WITHDRAW_LABEL, WITHDRAW_A11Y_HINT, WITHDRAW_WHAT_IT_DOES,
  WITHDRAW_WHAT_IT_DOES_NOT, WITHDRAW_CANNOT_BE_UNDONE, WITHDRAW_UNAVAILABLE_NOTE,
  NO_REVOCATION_TABLE,
  SIGNING_RULE, NOT_REPPLE, type MemberAgreement, type RevocationRead,
} from '../../src/lib/gymSigning';
import { useScrollPad } from '../../src/ui/keyboardPad';

export default function ClientGymAgreementsScreen() {
  const t = useTheme();
  const scrollPad = useScrollPad(160);
  const router = useRouter();

  const [rows, setRows] = useState<MemberAgreement[]>([]);
  // Under a ceiling. Every branch that leaves 'loading' is inside the try or
  // the catch of one function, and a request that never SETTLES runs neither —
  // no request in this app carries a timeout (src/lib/readDeadline.ts). A
  // member on a gym's captive-portal wifi was left reading "Reading what your
  // gym asks you to sign." for the life of the app, on the screen that tells
  // them what they are required to sign before they may train.
  const [readStatus, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const status = useReadDeadline(readStatus);
  const [tenantId, setTenantId] = useState<string | null>(null);
  /** Whether the read failed because nobody is signed in. A different sentence
   *  from a read that failed on the wire, and a different thing to do about it. */
  const [signedOut, setSignedOut] = useState(false);
  /**
   * Whether this account belongs to a gym at all.
   *
   * Not a failure and not an empty list: a client coached by an independent
   * trainer has no gym, and telling them their gym is asking for nothing would
   * be inventing a gym. Distinguished so the empty state can say which it is.
   */
  const [noGym, setNoGym] = useState(false);

  /**
   * What this member has withdrawn, and NOT an array.
   *
   * Held as the read itself because an empty list and a table that is not there
   * are different facts and only one of them may draw a Withdraw button.
   *
   * The default is the absent one, and it stays the default even now that
   * supabase/parts/3030 is applied to this project's database: it is what every
   * deployment without the part answers, and it is what this screen holds in
   * the moments before the read lands. Nothing here may offer a control whose
   * tap would come back "no such table" under the member's thumb.
   */
  const [revocations, setRevocations] = useState<RevocationRead>(NO_REVOCATION_TABLE);

  /** Which agreement is expanded. Expanding IS reading, and signing is gated on
   *  it — see the header. */
  const [open, setOpen] = useState<string | null>(null);
  const [read, setRead] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Kept apart from `busyId`: a signed document can be withdrawn and an
   *  unsigned one signed, and one flag for both would grey the wrong control. */
  const [withdrawId, setWithdrawId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      // Signed out is not 'ready'. An empty list under 'ready' is the one state
      // that entitles this screen to say the gym is asking for nothing, and a
      // session that had merely expired must never land in it — that sentence,
      // said to somebody with an unsigned waiver, is the whole failure mode.
      //
      // ── and 'signed out' is not 'could not ask' either ───────────────────
      //
      // Both of those were already true and neither was being told apart. This
      // was `if (!sess?.session)` followed by `if (authErr || !uid)`, and BOTH
      // branches set `signedOut` — so an outage put this sentence in front of a
      // signed-in member: "Your gym's paperwork is only readable once you are
      // signed in." The declaration of `signedOut` above says in as many words
      // that a wire failure deserves a different sentence; the code underneath
      // it gave them the same one. `getSession()` resolves with `session: null`
      // and a retryable error when the stored token has expired and the refresh
      // cannot reach the server, and `getUser()` does the same with
      // `user: null` — see src/lib/authReadFate.ts.
      //
      // One call now, not two. `sessionUid` answers from device storage, which
      // is the read this screen wants in a gym basement, and the uid it hands
      // back is the one PostgREST will scope the reads below to anyway — so the
      // second, network-only `getUser()` round trip was buying nothing but a
      // second chance to say the wrong sentence.
      //
      // Narrowed on `fate`, never on `!who.uid`: `string` includes ''.
      const who = await sessionUid('gymAgreements.load');
      if (who.fate !== null) {
        setSignedOut(who.fate === 'signed-out');
        setStatus('error');
        return;
      }
      const uid = who.uid;
      setSignedOut(false);


      const { data: prof, error: profErr } = await supabase
        .from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
      if (profErr) { reportError('gymAgreements.profile', profErr); setStatus('error'); return; }
      const tid = (prof as { tenant_id: string | null } | null)?.tenant_id ?? null;
      setTenantId(tid);
      if (!tid) { setNoGym(true); setRows([]); setStatus('ready'); return; }
      setNoGym(false);

      // Both reads or neither, and now all three. A list of what the gym asks
      // for, joined to a FAILED read of what this person has signed, renders
      // every signed document as outstanding — and asks somebody to sign a
      // waiver twice, which the unique index then refuses with a message about
      // a constraint.
      //
      // The third read is the one with the sharper edge. `fetchMyRevocations`
      // answers 'absent' for 42P01 alone and THROWS for everything else, so a
      // revocation read that failed on the wire lands in the catch below and
      // takes the whole screen to its error state. That is the point: a failed
      // read is not a member who has withdrawn nothing, and the difference
      // between those two is whether this screen tells somebody their consent
      // still stands while their gym has already been told it does not.
      const [agreements, signatures, revoked] = await Promise.all([
        fetchGymAgreements(supabase, tid),
        fetchMySignatures(supabase),
        fetchMyRevocations(supabase),
      ]);
      setRevocations(revoked);
      setRows(forMember(agreements, signatures, revoked));
      setStatus('ready');
    } catch (e) { reportError('gymAgreements.load', e); setStatus('error'); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // The gym's paperwork and which of it this member has signed — one read, and
  // the same one the screen already runs when it comes into focus.
  const pull = usePullToRefresh(load);

  function expand(a: MemberAgreement) {
    const next = open === a.id ? null : a.id;
    setOpen(next);
    if (next) {
      setRead((p) => (p.includes(a.id) ? p : [...p, a.id]));
      // The tick and the name belong to ONE document. Carrying them from the
      // last one open would let somebody agree to a waiver by having agreed to
      // the photo consent a moment earlier.
      setAgreed(false);
      setTypedName('');
    }
  }

  function sign(a: MemberAgreement) {
    const blocker = signingBlocker(a, typedName, agreed, read.includes(a.id));
    if (blocker) { Alert.alert('Not Yet', blocker); return; }
    if (!tenantId) { Alert.alert('Not Yet', 'Your gym could not be identified, so there is nothing to sign this against.'); return; }
    Alert.alert(
      `Sign “${a.title}”?`,
      SIGNING_RULE,
      [
        { text: 'Not Yet', style: 'cancel' },
        {
          text: 'Sign It',
          onPress: async () => {
            setBusyId(a.id);
            try {
              await signAsMember(supabase, tenantId, {
                agreementId: a.id, version: a.version, signedName: typedName,
              });
              setOpen(null); setAgreed(false); setTypedName('');
              await load();
            } catch (e: any) {
              reportError('gymAgreements.sign', e, { id: a.id });
              // ── one of these two refusals is not a failure ──────────────
              //
              // `gym_agreement_signatures_uq` is unique on (agreement, member),
              // so a second insert against a version this person has already
              // signed comes back 23505. That happens on a perfectly ordinary
              // path: they signed on another handset, or this screen's own
              // re-read failed and the list in front of them is out of date.
              //
              // The single sentence below used to be printed for every error
              // it could catch, and on THAT error both halves of it were
              // wrong. It showed a member a Postgres string about a unique
              // constraint, and then told them "as far as your gym can see you
              // have not signed it" — about a document their gym is holding
              // their signature for. On a screen whose subject is what a gym
              // can produce in a dispute, that is the one sentence it must
              // never say untruthfully.
              //
              // Everything else keeps it, and keeps it for the reason it was
              // written: the version refusal from supabase/parts/520 means the
              // gym replaced this wording while it was on screen, nothing was
              // recorded, and agreeing to what is no longer being asked would
              // be worth nothing to either party.
              const already = e?.code === '23505' || /duplicate key|already exists/i.test(String(e?.message ?? ''));
              Alert.alert(
                already ? 'Already Signed' : 'Not Signed',
                already
                  ? 'Your gym already holds your signature for this version, so it has not been asked for again. Nothing is outstanding on it.'
                  : `${e?.message ?? 'That could not be saved.'} Nothing has been recorded, so as far as your gym can see you have not signed it.`,
              );
              // Either way the list on screen has been shown to be out of date.
              await load();
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  /**
   * Withdraw a consent, having said out loud what that does and what it does
   * not do.
   *
   * The three paragraphs are the module's own, verbatim, and the middle one is
   * the reason this is a confirm and not a one-tap switch: a control that let
   * somebody believe the photographs were gone would be worse than no control,
   * and they would find out otherwise from a shop window. The dialog is where
   * the sentence has to be, because it is the last thing before the write.
   *
   * `mayWithdraw` is asked again here rather than trusted from the render. The
   * list on screen is as old as the last read, and a member holding this screen
   * open while the desk records a withdrawal for them is the ordinary way it
   * goes stale.
   */
  function withdraw(a: MemberAgreement) {
    const blocker = withdrawBlocker(a, revocations);
    if (blocker) { Alert.alert('Not Yet', blocker); return; }
    if (!tenantId) { Alert.alert('Not Yet', 'Your gym could not be identified, so there is nothing to record this against.'); return; }
    Alert.alert(
      withdrawTitle(a.title),
      `${WITHDRAW_WHAT_IT_DOES}\n\n${WITHDRAW_WHAT_IT_DOES_NOT}\n\n${WITHDRAW_CANNOT_BE_UNDONE}`,
      [
        { text: 'Keep It as It Is', style: 'cancel' },
        {
          text: WITHDRAW_LABEL,
          style: 'destructive',
          onPress: async () => {
            setWithdrawId(a.id);
            try {
              await withdrawConsent(supabase, tenantId, { kind: a.kind });
              await load();
            } catch (e: any) {
              reportError('gymAgreements.withdraw', e, { id: a.id, kind: a.kind });
              // 42P01 here is the table going missing between the read that
              // drew the button and the tap on it. The member is told what is
              // true of their gym rather than shown a Postgres string about a
              // relation, and the re-read below then takes the button away.
              const gone = e?.code === '42P01';
              Alert.alert(
                gone ? 'Not Switched On' : 'Not Withdrawn',
                gone
                  ? WITHDRAW_UNAVAILABLE_NOTE
                  : `${e?.message ?? 'That could not be recorded.'}`,
              );
              await load();
            } finally { setWithdrawId(null); }
          },
        },
      ],
    );
  }

  const ready = status === 'ready';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          The field is the name somebody signs a gym agreement with, and the button that signs it
          is directly under it — both have to be visible at once. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        <PageHead title="Paperwork" subtitle="From your gym" />

        {!USE_SUPABASE ? (
          <Section>
            <Flag tone={t.ink3}>
              This build is running without the server. Your gym’s paperwork lives on it, so there is
              nothing here to show.
            </Flag>
          </Section>
        ) : (
          <>
            {status === 'error' ? (
              <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
                {signedOut
                  ? 'Your gym’s paperwork is only readable once you are signed in, so this screen could not look it up. This is not a list of what your gym is asking for.'
                  : 'This could not be read just now, so it isn’t a list of what your gym is asking for. Check again when you have signal.'}
              </Flag>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
                {status === 'loading' ? 'Reading what your gym asks you to sign.'
                  : noGym ? 'You are not a member of a gym on Repple, so there is no gym paperwork to show you.'
                    : rows.length === 0 ? 'Your gym doesn’t publish anything for members to sign.'
                      : agreementSummary(rows)}
              </Text>
            )}

            {ready && rows.length ? (
              <Section>
                <SectionHead title="WHAT YOUR GYM ASKS" />
                {rows.map((a, i) => (
                  <View key={a.id}>
                    {i ? <Rule /> : null}
                    <View style={{ paddingVertical: sp.md }}>
                      <Pressable
                        onPress={() => expand(a)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open === a.id }}
                        accessibilityLabel={`${a.title}. ${statusLine(a)}. Tap to read it.`}
                      >
                        <Text style={{
                          ...ty.body,
                          // `outstanding`, not `waitingOn`: a guardian consent
                          // nobody has given yet is still an unsigned document,
                          // and drawing it in the same grey as a signed one is
                          // how it disappeared from the top of this screen.
                          fontWeight: outstanding(a) ? '600' : '500',
                          color: t.ink,
                        }}>
                          {a.title}
                        </Text>
                        {/* The tone lives in a dot, not in the caption ink: warn
                            as caption ink is under AA on the light palettes.
                            Same reasoning as coach-documents.tsx. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          {outstanding(a) ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
                          <Text style={{ ...ty.caption, color: outstanding(a) ? t.ink2 : t.ink3, flex: 1 }}>
                            {AGREEMENT_LABEL[a.kind] ?? a.kind} · v{a.version} · {statusLine(a)}
                          </Text>
                        </View>
                      </Pressable>

                      {open === a.id ? (
                        <View style={{ marginTop: sp.md }}>
                          <View style={{
                            backgroundColor: t.surface2, borderRadius: radius.sm,
                            borderWidth: hairline, borderColor: t.ring, padding: sp.lg,
                          }}>
                            {/* 20 rather than caption's own 16: this is the whole body of a legal
                                agreement in a box, and prose reads better with the extra
                                leading. `grown` because the looser line still has to follow
                                the reader's text size — a pinned 20 is the clipped paragraph
                                Rule 2 of scripts/check-a11y.mjs exists for, and this is the
                                one screen where not being able to read the terms means
                                signing something unread. */}
                            <Text style={{ ...ty.caption, color: t.ink2, lineHeight: grown(20) }}>{a.body}</Text>
                          </View>

                          {a.refusal ? (
                            <Flag tone={t.ink3} style={{ marginTop: sp.md }}>{a.refusal}</Flag>
                          ) : a.signedAt ? (
                            <Flag tone={t.ink3} style={{ marginTop: sp.md }}>
                              You have already agreed to this version. Signing cannot be undone and it
                              is not asked for twice.
                            </Flag>
                          ) : (
                            <>
                              <Tick
                                on={agreed}
                                label="I have read this and I agree to it."
                                detail="This is your agreement, given from your own account. Nobody at the gym can give it for you."
                                onPress={() => setAgreed((v) => !v)}
                              />
                              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm, marginBottom: sp.sm }}>
                                YOUR NAME
                              </Text>
                              <TextInput
                                value={typedName}
                                onChangeText={setTypedName}
                                placeholder="Type your full name"
                                placeholderTextColor={t.ink3}
                                autoCapitalize="words"
                                accessibilityLabel="The name you are signing with"
                                style={{
                                  ...ty.body, color: t.ink, backgroundColor: t.surface2,
                                  borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm,
                                  paddingHorizontal: sp.lg, paddingVertical: sp.md,
                                }}
                              />
                              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                                Kept exactly as you type it, separately from the name on your account,
                                so it stays what you wrote if you ever change that.
                              </Text>
                              <View style={{ marginTop: sp.md }}>
                                <Cta
                                  label={busyId === a.id ? 'Signing…' : 'Sign It'}
                                  onPress={() => sign(a)}
                                  disabled={busyId === a.id}
                                />
                              </View>
                            </>
                          )}

                          {/* ── withdrawing it, where that is a thing this member can do ──
                              Three states and they are not two. A consent already
                              withdrawn says so and offers nothing; one that can be
                              withdrawn draws the control; and one that cannot draws
                              the blocker's own sentence rather than a greyed button
                              with no explanation beside it.

                              The last of those is what a gym without part 3030 sees:
                              `fetchMyRevocations` answers 'absent' and `mayWithdraw`
                              is false for every photo consent there. The member reads
                              that their gym has not switched this on and that asking
                              at the desk works — which is true — instead of tapping a
                              button the database has nothing to answer.

                              `mayWithdraw` and `withdrawBlocker` are the same
                              question asked once: the first IS the second returning
                              null, so the button and the refusal cannot drift apart
                              into a live-looking control whose tap is refused. */}
                          {a.revokedAt ? (
                            <Flag tone={t.ink3} style={{ marginTop: sp.md }}>{withdrawnLine(a.revokedAt)}</Flag>
                          ) : a.signedAt && memberMayRevoke(a.kind) ? (
                            mayWithdraw(a, revocations) ? (
                              <View style={{ marginTop: sp.md, alignItems: 'flex-start' }}>
                                <Ghost
                                  label={withdrawId === a.id ? 'Withdrawing…' : WITHDRAW_LABEL}
                                  disabled={withdrawId === a.id}
                                  a11yLabel={`${WITHDRAW_LABEL} for ${a.title}. ${WITHDRAW_A11Y_HINT}`}
                                  onPress={() => withdraw(a)}
                                />
                              </View>
                            ) : (
                              <Flag tone={t.ink3} style={{ marginTop: sp.md }}>
                                {withdrawBlocker(a, revocations)}
                              </Flag>
                            )
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Section>
            ) : null}

            <Section>
              <Notice
                kicker="WHOSE DOCUMENTS THESE ARE"
                title={`Your gym’s, not ${BRAND.label}’s`}
                note={NOT_REPPLE}
              />
            </Section>
            <Section>
              <Notice
                kicker="SIGNING"
                title="It can’t be taken back"
                note={SIGNING_RULE}
              />
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The one line under each title, and the place this screen is most able to lie.
 *
 * A document somebody at the desk entered for this member says so. It is a real
 * record and it is not the member's own act, and a member who is told they
 * "signed" something they never saw has been told the same untruth the gym's
 * own file was telling. Every other screen in this product now draws that line;
 * this is where the person it is about gets to see it.
 */
function statusLine(a: MemberAgreement): string {
  // Withdrawn FIRST, and the sentence does not say who did it. A photo consent
  // the member withdrew from this screen and a guardian consent the responsible
  // adult withdrew at the desk are both true here, and the row is the wrong
  // place to guess between them. Said before anything else because a line
  // reading "signed by you on 3 Apr 2026", with nothing after it, is this
  // screen's only way to tell a gym's live consent and a withdrawn one apart —
  // and it was telling them apart wrongly.
  if (a.revokedAt) {
    const off = day(a.revokedAt);
    return `withdrawn${off ? ` on ${off}` : ''}`;
  }
  // The refusal is a property of the KIND, so it is still set once a guardian
  // consent has actually been given at the desk. Read in that order this told a
  // member a document already on file "has to be given at the gym".
  if (a.refusal && !a.signedAt) return 'not signed yet — has to be given at the gym';
  if (!a.signedAt) return 'waiting on you';
  const on = day(a.signedAt);
  if (a.attribution === 'member') return `signed by you${on ? ` on ${on}` : ''}`;
  if (a.attribution === 'staff') return `recorded for you at the gym${on ? ` on ${on}` : ''}`;
  return `on file${on ? ` since ${on}` : ''}, but it isn’t recorded who gave it`;
}

/** The date, or an empty string when it cannot be read — never a dash, which
 *  would leave a hole in the middle of a sentence. See scripts/check-prose.mjs. */
function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Lifted in shape from src/ui/waiver.tsx, which asks the same kind of question
 *  about a different party's document. */
function Tick({ on, label, detail, onPress }: {
  on: boolean; label: string; detail: string; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={{ flexDirection: 'row', gap: sp.md, paddingVertical: sp.md }}>
      <View style={{
        width: 24, height: 24, borderRadius: radius.sm, marginTop: 2,
        borderWidth: on ? 0 : 1.5, borderColor: t.ring,
        backgroundColor: on ? t.brand : 'transparent',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {on ? <Icon name="check" size={16} color={t.brandInk} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, color: t.ink, fontWeight: '500' }}>{label}</Text>
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>{detail}</Text>
      </View>
    </Pressable>
  );
}
