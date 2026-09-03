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
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Flag } from '../../src/ui/kit';
import { Icon } from '../../src/ui/Icon';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { AGREEMENT_LABEL } from '../../src/lib/gymDocs';
import {
  forMember, waitingOn, waitingCount, signingBlocker, signAsMember,
  fetchGymAgreements, fetchMySignatures,
  SIGNING_RULE, NOT_REPPLE, type MemberAgreement,
} from '../../src/lib/gymSigning';

export default function ClientGymAgreementsScreen() {
  const t = useTheme();
  const router = useRouter();

  const [rows, setRows] = useState<MemberAgreement[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
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

  /** Which agreement is expanded. Expanding IS reading, and signing is gated on
   *  it — see the header. */
  const [open, setOpen] = useState<string | null>(null);
  const [read, setRead] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      // Signed out is not 'ready'. An empty list under 'ready' is the one state
      // that entitles this screen to say the gym is asking for nothing, and a
      // session that had merely expired must never land in it — that sentence,
      // said to somebody with an unsigned waiver, is the whole failure mode.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setSignedOut(true); setStatus('error'); return; }
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      if (authErr || !uid) { setSignedOut(true); setStatus('error'); return; }
      setSignedOut(false);

      const { data: prof, error: profErr } = await supabase
        .from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
      if (profErr) { reportError('gymAgreements.profile', profErr); setStatus('error'); return; }
      const tid = (prof as { tenant_id: string | null } | null)?.tenant_id ?? null;
      setTenantId(tid);
      if (!tid) { setNoGym(true); setRows([]); setStatus('ready'); return; }
      setNoGym(false);

      // Both reads or neither. A list of what the gym asks for, joined to a
      // FAILED read of what this person has signed, renders every signed
      // document as outstanding — and asks somebody to sign a waiver twice,
      // which the unique index then refuses with a message about a constraint.
      const [agreements, signatures] = await Promise.all([
        fetchGymAgreements(supabase, tid),
        fetchMySignatures(supabase),
      ]);
      setRows(forMember(agreements, signatures));
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
    if (blocker) { Alert.alert('Not yet', blocker); return; }
    if (!tenantId) { Alert.alert('Not yet', 'Your gym could not be identified, so there is nothing to sign this against.'); return; }
    Alert.alert(
      `Sign “${a.title}”?`,
      SIGNING_RULE,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Sign it',
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
              Alert.alert(
                'Not signed',
                // The version refusal from supabase/parts/520 is the one worth
                // saying in full: it means the gym replaced this wording while
                // it was on screen, and agreeing to what is no longer being
                // asked would be worth nothing to either party.
                `${e?.message ?? 'That could not be saved.'} Nothing has been recorded, so as far as your gym can see you have not signed it.`,
              );
              await load();
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  const ready = status === 'ready';
  const waiting = waitingCount(rows);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>From your gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Paperwork</Text>
          </View>
        </View>

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
                      : waiting === 0 ? 'Nothing is waiting on you.'
                        : `${waiting} document${waiting === 1 ? '' : 's'} waiting on you.`}
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
                          fontWeight: waitingOn(a) ? '600' : '500',
                          color: t.ink,
                        }}>
                          {a.title}
                        </Text>
                        {/* The tone lives in a dot, not in the caption ink: warn
                            as caption ink is under AA on the light palettes.
                            Same reasoning as coach-documents.tsx. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          {waitingOn(a) ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
                          <Text style={{ ...ty.caption, color: waitingOn(a) ? t.ink2 : t.ink3, flex: 1 }}>
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
                            <Text style={{ ...ty.caption, color: t.ink2, lineHeight: 20 }}>{a.body}</Text>
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
  if (a.refusal) return 'has to be given at the gym';
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
