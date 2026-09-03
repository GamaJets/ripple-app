// Trainer · Profile — the coach's public identity: photo, tagline, bio, specialties,
// what they offer, and session fee. A live preview shows how clients see it.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: no hero (a profile has
// no single live number to lead with), hairline-separated sections instead of
// five stacked bordered boxes, and `<ListRow>` for the navigational rows.
//
// The Find a Trainer directory opt-in keeps its switch affordance and its
// explanatory copy verbatim — only its styling moved onto the scale.
import { useCallback, useState, useEffect } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, Pressable, ScrollView, TextInput, Image, Alert } from 'react-native';
import { Icon, type IconName } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/ui/auth';
import { reportError } from '../../src/lib/reportError';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Card, ListRow, QuickRow, Cta, Flag, Notice, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { trainerAccessNote } from '../../src/lib/trainerProfileAccess';
import { useDeliveryFact } from '../../src/ui/coachDelivery';
import { DeliveryModeChoice } from '../../src/ui/DeliveryModeChoice';
import { deliveryAskLine, deliveryNote, HIDDEN_NOT_GONE } from '../../src/lib/coachDelivery';
import { useMyCancellationPolicy } from '../../src/ui/sessions';
import { feeAmountLine, noticeLabel } from '../../src/lib/booking';
import { readNumber } from '../../src/lib/units';
// Whether the autosave landed. This screen has no Save button and had no
// answer: the write discarded both outcomes, so a refused one looked exactly
// like a stored one. See src/lib/profileSave.ts.
import { saveLine } from '../../src/lib/profileSave';
// A profile photo used to be stored as the picker's own path — a location
// inside THIS handset, written into a row every client, the gym and the web
// console read, where it drew as a blank circle for all of them. The coach was
// the one person who could not see that it was broken, because their own
// device could open its own file. The bytes now go to the `avatars` bucket
// (supabase/parts/961) and the column holds the URL of the stored object —
// the same route app/(client)/profile.tsx has taken since that part was run.
import { uploadMyAvatar } from '../../src/ui/avatarUpload';
import { avatarSource, isDeviceAvatar, DEVICE_AVATAR_NOTE_COACH, AVATAR_UPLOAD_FAILED_NOTE } from '../../src/lib/avatarImage';
import { RepdbAttribution } from '../../src/ui/Attribution';
import { HAS_NATIVE_CLIPBOARD, CLIPBOARD_UNAVAILABLE_NOTE, copyToClipboard } from '../../src/ui/nativeModules';
import { BRAND } from '../../src/lib/brands';
import {
  normaliseHandle, handleProblem, handleProblemText, publicPageUrl,
  publicPageState, publicPageStateNote, publishOutcome,
  PUBLISHED_FIELDS, WITHHELD_FIELDS, HANDLE_MAX,
} from '../../src/lib/publicProfile';

function Field({ t, label, value: val, onChangeText, placeholder, multiline, keyboardType }: { t: Theme; label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'numeric' | 'decimal-pad' }) {
  return (
    <View style={{ marginBottom: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{label}</Text>
      <TextInput
        value={val}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.ink3}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
      />
    </View>
  );
}

function ChipEditor({ t, items, onAdd, onRemove, value: val, setValue, placeholder }: { t: Theme; items: string[]; onAdd: () => void; onRemove: (i: number) => void; value: string; setValue: (v: string) => void; placeholder: string }) {
  return (
    <View>
      {items.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
          {items.map((it, i) => (
            <Pressable key={i} onPress={() => onRemove(i)} accessibilityRole="button" accessibilityLabel={'Remove ' + it}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{it}</Text>
              <Icon name="minus" size={12} color={t.ink3} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        <TextInput value={val} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={t.ink3}
          style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
        <Cta label="Add" onPress={onAdd} />
      </View>
    </View>
  );
}

export default function CoachProfile() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  /** The signed-in coach, for the avatar upload. The bucket's policy scopes a
   *  write by the first folder of the key being `auth.uid()`, so an empty id
   *  here is refused with a sentence rather than a 403 nobody can read. */
  const uid = auth.user?.id ?? null;
  /** Confirmed, because signing out of a coach account on a shared gym tablet
   *  by mis-tapping is a nuisance nobody can undo without the password. */
  const signOut = () => {
    Alert.alert('Sign out of Repple Coach?', 'You will need your password to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('trainerProfile.signOut', e); } } },
    ]);
  };
  const p = useMyTrainerProfile();
  // Their own answer and their roster, reconciled. Read here so the section
  // below can say what the answer is currently doing rather than only offering
  // it — an answer with no visible effect is a switch nobody trusts.
  const delivery = useDeliveryFact();
  // The late-cancellation policy is NOT part of `useMyTrainerProfile`. That
  // provider is the coach's public identity — what clients see — and this is a
  // rule about money that binds them. It also has a constraint behind it
  // (`trainers_late_cancel_fee_stated`) that a debounced write of five other
  // fields would trip on the coach's behalf, taking their bio down with it.
  const lc = useMyCancellationPolicy();
  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * Two reads: the profile provider (`profiles` and `trainers`) and the
   * cancellation policy, which is deliberately not part of it.
   *
   * `p.reload` flushes a pending edit BEFORE re-reading — see its docstring
   * in src/ui/coachProfile.tsx. That ordering is what makes this gesture safe
   * on a screen that is almost entirely text fields: the server's answer
   * lands on top of the coach's own values rather than on top of a debounced
   * edit that had not gone out yet. */
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([p.reload(), Promise.resolve(lc.reload())]),
    [p, lc],
  ));
  const [newOffer, setNewOffer] = useState('');
  const [newSpec, setNewSpec] = useState('');
  /**
   * The two money boxes are held as TEXT while they are being typed, and only
   * as a number once the text reads as one.
   *
   * Both were controlled by the stored figure alone — `value={String(fee)}` —
   * which meant the decimal point vanished the instant it was typed: "62."
   * reads back as 62, the box re-renders as "62", and the coach can never reach
   * the "5" of 62.50. `trainers.session_fee` is `numeric` and
   * `trainers.late_cancel_fee` is `numeric(8,2)`, so the record was always able
   * to hold the halves this screen would not let anybody type.
   *
   * Null means "not being edited": the box shows the record. The draft is not
   * cleared on blur because nothing else on this screen writes these two
   * columns, and re-deriving the text would put the point back where it started.
   */
  const [feeDraft, setFeeDraft] = useState<string | null>(null);
  const [lcFeeDraft, setLcFeeDraft] = useState<string | null>(null);
  /**
   * The web address, held as text while it is being typed.
   *
   * Null means "not being edited" and the box shows the record, the same
   * arrangement the two money boxes above use. It is NOT written on every
   * keystroke like the rest of this screen: claiming an address can be refused
   * — taken, reserved, or not in the directory — and each refusal is a sentence
   * somebody has to read, so it goes through one deliberate press.
   */
  const [handleDraft, setHandleDraft] = useState<string | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  /** What the last press did, in the server's own words. Cleared on the next. */
  const [pageSaid, setPageSaid] = useState<{ title: string; body: string } | null>(null);
  const [pageOpen, setPageOpen] = useState(false);

  const pageHandle = handleDraft ?? p.publicHandle ?? '';
  const pageState = publicPageState({ listed: p.listed, handle: p.publicHandle, on: p.publicPage });
  // Ticked so "Saved a moment ago" ages while the screen is open, and only
  // while there is something whose age matters.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (p.save.state !== 'saved' && lc.save.state !== 'saved') return;
    const h = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(h);
  }, [p.save.state, p.save.savedAt, lc.save.state, lc.save.savedAt]);
  const saveNote = saveLine(p.save, nowMs);
  const lcSaveNote = saveLine(lc.save, nowMs);
  const pageUrl = publicPageUrl(BRAND.joinOrigin, p.publicHandle);
  const draftProblem = handleProblem(normaliseHandle(pageHandle));

  /**
   * One press, one round trip, one sentence back.
   *
   * `on` is what the coach asked for and NOT what they get: the server refuses
   * to publish a coach who is not in the directory, and refuses an address
   * somebody else holds. The provider only moves its own state on the results
   * that actually wrote, so what this screen shows afterwards is what the row
   * says rather than what was asked for.
   */
  const savePage = async (on: boolean, address?: string) => {
    if (pageBusy) return;
    setPageBusy(true);
    setPageSaid(null);
    // `address` is passed explicitly by the two buttons that do not mean "what
    // is in the box": releasing an address sends the empty string. It is a
    // parameter rather than a setState followed by a read, because a state
    // update does not land before the next line and this closure would send the
    // old handle — which is the difference between giving an address back and
    // silently keeping it.
    const wanted = normaliseHandle(address ?? pageHandle);
    const result = await p.publishPage(wanted, on);
    const said = publishOutcome(result, wanted);
    setPageSaid({ title: said.title, body: said.body });
    if (said.changed) setHandleDraft(null);
    setPageBusy(false);
  };

  const copyPageUrl = async () => {
    if (!pageUrl) return;
    if (!(await copyToClipboard(pageUrl))) {
      Alert.alert('Not copied', `Your page address could not be copied. It is ${pageUrl} — write it down.`, [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Copied', `${pageUrl} is on your clipboard. Paste it into your bio.`, [{ text: 'OK' }]);
  };
  const initials = p.name.replace('Coach ', '').split(' ').map((x) => x[0]).join('').slice(0, 2);

  // Uploaded FIRST, and the column is only ever pointed at something that is in
  // the bucket. `setPhoto` used to be handed `res.assets[0].uri` straight —
  // which is a path inside this phone, so the coach saw their face, every
  // client saw a blank circle, and the app said it had saved.
  const [photoBusy, setPhotoBusy] = useState(false);
  const pickPhoto = async (fromCamera: boolean) => {
    if (photoBusy) return;
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'set your profile photo'))) return;
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    setPhotoBusy(true);
    const up = await uploadMyAvatar(uid ?? '', res.assets[0].uri);
    setPhotoBusy(false);
    if (!up.url) {
      // Nothing is set. A photo the server never received must not sit on this
      // screen as though it had been — that is the whole defect being closed.
      Alert.alert('Photo not saved', up.error ?? AVATAR_UPLOAD_FAILED_NOTE);
      return;
    }
    p.setPhoto(up.url);
  };
  const addOffer = () => { const v = newOffer.trim(); if (v) { p.setOffers([...p.offers, v]); setNewOffer(''); } };
  const addSpec = () => { const v = newSpec.trim(); if (v) { p.setSpecialties([...p.specialties, v]); setNewSpec(''); } };

  // Upload / Take Photo, plus Remove only when there is a photo to remove.
  const photoActions: { icon: IconName; label: string; onPress: () => void }[] = [
    { icon: 'plus', label: photoBusy ? 'Uploading…' : 'Upload', onPress: () => pickPhoto(false) },
    { icon: 'camera', label: 'Take Photo', onPress: () => pickPhoto(true) },
  ];
  if (p.photo) photoActions.push({ icon: 'minus', label: 'Remove', onPress: () => p.setPhoto(null) });

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── header. No hero — a profile has no single live number ───────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your profile</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>How Clients See You</Text>
          </View>
        </View>

        {/* ── live preview: the one surface on this screen that groups ──────
            Withheld until the read has settled, and that is not tidiness. This
            Card is labelled as WHAT A CLIENT SEES, and `guardTrainerProfile`
            hands back the frozen blank under 'loading' and 'signed-out' — so a
            coach who spent an evening writing a bio opened their profile and
            was shown their public page with the bio missing, under a line
            telling them clients read it first. The editor below has always been
            withheld until the read lands; the preview above it is the half that
            makes a claim, and it was not. */}
        {p.access !== 'ok' ? (
          <Card style={{ marginBottom: sp.lg }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {trainerAccessNote(p.access) ?? 'There is no profile to preview on this app.'}
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Nothing is shown here until then. An empty preview is not what a client sees — it is what
              this screen knows so far, and the two are not the same page.
            </Text>
          </Card>
        ) : (
        <Card style={{ marginBottom: sp.lg }}>
          <View style={{ flexDirection: 'row', gap: sp.lg, alignItems: 'center' }}>
            {/* `avatarSource` and not `p.photo`: a row still carrying a device
                path from before this was fixed draws as the monogram every
                client sees, rather than as a photo only this phone can open. */}
            {avatarSource(p.photo) ? (
              <Image source={{ uri: avatarSource(p.photo) as string }} style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...value(20), color: t.brand }}>{initials}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.head, color: t.ink }} numberOfLines={1}>{p.name || 'Your name'}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{p.tagline || 'No tagline yet'}</Text>
            </View>
          </View>

          {p.specialties.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: sp.lg }}>
              {p.specialties.map((s, i) => (
                <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                  <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2 }}>{s}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={{ ...ty.body, color: p.bio ? t.ink2 : t.ink3, marginTop: sp.lg }}>{p.bio || 'No bio yet — clients read this first.'}</Text>

          {p.offers.length > 0 && (
            <View style={{ marginTop: sp.lg }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>What I Offer</Text>
              {p.offers.map((o, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: 6 }}>
                  <Icon name="check" size={14} color={t.brand} />
                  <Text style={{ ...ty.label, color: t.ink }}>{o}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: sp.lg, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>Session rate</Text>
            {/* Null is "not set", and 0 is a rate somebody may genuinely charge.
                They used to be the same value, so an unset rate rendered as a
                confident "$0 / session" on the coach's own profile — and on the
                client's calendar as a "$0 late fee". */}
            {/* No currency symbol, because this app has not been told one.
                `trainers` has a `session_fee numeric` and no currency column at
                all, and part 99 (supabase/parts/99-tenant-currency.sql) made
                `tenants.currency` NULLABLE on purpose: Repple is white-labelled,
                a gym that has not said which money it charges in is not to be
                guessed at, and an independent coach has no gym to ask. A '$'
                stood here regardless — so a trainer in London or Dubai read
                their own rate back in dollars, which is not a formatting slip
                but a different number. The figure is the coach's own and they
                know what it is denominated in; the app does not, and says so by
                not saying. */}
            {p.sessionFee == null
              ? <Text style={{ ...ty.body, color: t.ink3 }}>— no rate set</Text>
              : <Text style={{ ...value(20), color: t.ink }}>{p.sessionFee}<Text style={{ ...ty.caption, color: t.ink3 }}> / session</Text></Text>}
          </View>
        </Card>
        )}

        <Rule />

        {/* Everything below this line writes to the signed-in user's own
            `profiles` and `trainers` rows, and the provider refuses to answer —
            and to write — when it cannot establish that those rows are really
            theirs. A form that accepts what a coach types and silently drops it
            is worse than one that is not offered, so when the profile could not
            be read the editor is withheld and the reason is stated. Account and
            sign-out sit below this branch and stay reachable. */}
        {p.access === 'loading' ? (
          /* NOT the warning below. `resolveTrainerAccess` returns 'loading'
             until the read settles, and `trainerAccessNote('loading')` is
             "Loading your profile…" — which was being printed as the note under
             a headline saying the profile could not be opened, in the warning
             tone. On a slow link a coach's public profile was announced as
             broken for as long as it took to load, and the coach stops typing
             and goes looking for support. */
          <Notice tone={t.ink3} kicker="Profile" title="Reading your profile"
            note="Nothing below is editable until it has arrived, so an edit cannot be made against fields that are not yours yet." />
        ) : p.access !== 'ok' ? (
          <Section>
            <Notice tone={t.warn} kicker="Profile" title="Your profile could not be opened for editing"
              note={p.accessNote ?? 'We could not confirm this is your own coaching profile, so nothing typed here would be stored.'} />
          </Section>
        ) : (
        <>

        {/* ── did that save? ─────────────────────────────────────────────────
            Above the fields, not under them. This screen commits on change with
            no Save button, so the one thing a coach cannot otherwise find out is
            whether what they just typed reached the server — and they look for
            that where they are typing.

            Nothing is drawn before the first edit: a permanent "Saved" badge
            over an untouched screen is exactly the reassurance people stop
            reading, which is the failure this is fixing. */}
        {saveNote ? (
          <Section>
            <Flag tone={p.save.state === 'failed' ? t.crit : p.save.state === 'pending' ? t.ink3 : t.good}>{saveNote}</Flag>
          </Section>
        ) : null}

        {/* ── photo ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Photo" />
          <QuickRow items={photoActions} />
          {/* Said to the one person who can fix it, and the one person who
              cannot see the problem: their own device opens its own file
              happily. Never "add a photo" — they did add one. */}
          {isDeviceAvatar(p.photo) ? (
            <View style={{ marginTop: sp.md }}>
              <Flag tone={t.warn}>{DEVICE_AVATAR_NOTE_COACH}</Flag>
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── who you are ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Details" />
          <Field t={t} label="Name" value={p.name} onChangeText={p.setName} placeholder="Coach name" />
          <Field t={t} label="Tagline" value={p.tagline} onChangeText={p.setTagline} placeholder="One line on what you do" />
          <Field t={t} label="Bio" value={p.bio} onChangeText={p.setBio} placeholder="Tell clients about your experience and approach" multiline />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Specialties" note="Tap a chip to remove" />
          <ChipEditor t={t} items={p.specialties} onAdd={addSpec} onRemove={(i) => p.setSpecialties(p.specialties.filter((_, x) => x !== i))} value={newSpec} setValue={setNewSpec} placeholder="e.g. Mobility" />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="What You Offer" note="Tap a chip to remove" />
          <ChipEditor t={t} items={p.offers} onAdd={addOffer} onRemove={(i) => p.setOffers(p.offers.filter((_, x) => x !== i))} value={newOffer} setValue={setNewOffer} placeholder="e.g. Nutrition coaching" />
        </Section>

        <Rule />

        {/* ── how you coach ──────────────────────────────────────────────
            The same three options, the same words and the same order as the
            Getting Started list — one control, rendered in both places, so a
            coach who reads one description at signup and another six months on
            is reading the same sentence.

            It sits directly above Session Rate because the two are the same
            conversation: what you charge for, and whether it is an hour in a
            room. A coach who realises their rate is beside the point is one tap
            from saying so.

            Nothing here can narrow the app on its own. The answer is a FLOOR
            and the roster may only widen it, so a coach who says "online" and
            then takes somebody on in person gets everything back without
            returning to this screen. `deliveryNote` says which of those is
            currently true. */}
        <Section>
          <SectionHead title="How You Coach" />
          <DeliveryModeChoice />
          {/* The ask while it is unanswered — the setup checklist counts this
              question and `deliveryNote` only ever described a state. See
              `deliveryAskLine` in src/lib/coachDelivery.ts. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {deliveryAskLine(delivery) ?? deliveryNote(delivery)}
          </Text>
          {delivery.shape === 'remote' ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              {HIDDEN_NOT_GONE}
            </Text>
          ) : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Session Rate" />
          {/* `String(p.sessionFee)` literally rendered the text "null" into the
              box. And `|| 0` meant clearing the field set a real rate of zero
              rather than clearing it, so a coach could not un-set a rate once
              they had typed one. */}
          {/* `replace(/[^0-9]/g, '')` was here, and it did two things nobody
              asked for. It deleted the decimal point, so a coach charging 62.50
              could only ever record 6250 — and it turned a European coach's
              "16,5" into "165" by deleting the comma and closing the gap, which
              is a tenfold error on the one figure a client is quoted. Read the
              same way every typed figure in the app is now read. */}
          <Field t={t} label="Session Rate, per session"
            value={feeDraft ?? (p.sessionFee == null ? '' : String(p.sessionFee))}
            onChangeText={(v) => {
              setFeeDraft(v);
              // An emptied box clears the rate — that is an instruction. Text
              // that will not read is NOT: it is somebody mid-keystroke, and
              // wiping their stored rate on the way past would be a change
              // they never made.
              if (!v.trim()) { p.setSessionFee(null); return; }
              const n = readNumber(v);
              // A typed 0 clears the rate rather than storing one, because a
              // rate of nothing is not a rate — and the reader in
              // src/ui/coachProfile.tsx maps a stored 0 back to null on the
              // next load anyway. Accepting it here made the two disagree: the
              // box said 0 until the app was reopened and then said nothing.
              if (n != null && n > 0) p.setSessionFee(n);
              else if (n === 0) p.setSessionFee(null);
            }}
            placeholder="75" keyboardType="decimal-pad" />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {p.sessionFee == null
              ? 'Leave this empty and nothing quotes a rate for you — your figures show a dash rather than a zero.'
              : 'Shown to clients as a number, in whatever currency you charge in. Repple does not print a symbol it has not been told.'}
          </Text>
        </Section>

        <Rule />

        {/* ── late cancellations ─────────────────────────────────────────
            The policy a coach can actually state, in place of the bare number
            this app used to quote as one. `trainers.session_fee` is what a
            SESSION costs; it was being printed to clients as the late-cancel
            fee as well, which is a different figure, and for a coach who had
            not set a rate it was printed as zero.

            Three separate facts, because a client is owed all three before
            they cancel: whether there is a policy at all, how much notice it
            wants, and what it costs. Off by default — a coach who has said
            nothing has not agreed to charge anybody.

            What Repple does with it is RECORD it. There is no payment here, no
            card, no balance: when a client cancels inside the window a row is
            written that says who owes what for which session, and the coach
            settles it themselves. Every sentence on both apps says so. */}
        <Section>
          <SectionHead title="Late Cancellations" />
          {lc.status === 'error' ? (
            <Notice tone={t.warn} kicker="Policy" title="We couldn’t read your cancellation policy"
              note="Nothing typed here would be stored, so the controls are withheld rather than accepting an edit that goes nowhere. Your existing policy is unchanged — clients are still held to whatever it already says." />
          ) : lc.status === 'loading' ? (
            /* Withheld for the same reason the error branch is, and it used to
               fall straight through to the live control drawn from the empty
               defaults — `applies: false`, `fee: null` — which prints a policy
               that is ON as off, and tells the coach clients may cancel at any
               time with nothing recorded against them. A tap in that window did
               not survive either: the write in src/ui/sessions.tsx returns early
               until the read has landed, and the read then overwrote what they
               set. So they turned their own policy back on and watched it go
               off again. */
            <Notice tone={t.ink3} kicker="Policy" title="Reading your cancellation policy"
              note="It is unchanged and still applies to your clients while this loads. The controls are withheld for a moment rather than showing a policy that is off before we know whether it is." />
          ) : (
          <>
          <Pressable
            onPress={() => lc.setApplies(!lc.applies)}
            accessibilityRole="switch"
            accessibilityState={{ checked: lc.applies }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.md,
              backgroundColor: t.surface, borderRadius: radius.md, padding: sp.lg, ...elevation.e1,
              ...(lc.applies ? { borderWidth: hairline, borderColor: t.brand } : null),
            }}
          >
            <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" size={17} color={lc.applies ? t.brand : t.ink3} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Charge for late cancellations</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {lc.applies
                  ? `Cancelling inside ${noticeLabel(lc.noticeHours)} records a fee against the client. Repple does not take it — you settle it with them.`
                  : 'Off — clients can cancel at any time and nothing is recorded against them.'}
              </Text>
            </View>
            <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: lc.applies ? t.brand : t.surface3, borderWidth: hairline, borderColor: lc.applies ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: lc.applies ? t.brandInk : t.ink3, alignSelf: lc.applies ? 'flex-end' : 'flex-start' }} />
            </View>
          </Pressable>

          {/* Presets rather than a free number field: the notice period is a
              policy, not a measurement, and the database holds it between 1
              hour and a week. A coach who types 0 has not written a policy that
              never applies, they have written one that always does. */}
          <View style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Notice Required</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {[6, 12, 24, 48, 72].map((h) => (
                <Pressable key={h} onPress={() => lc.setNoticeHours(h)}
                  accessibilityRole="button" accessibilityState={{ selected: lc.noticeHours === h }}
                  style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: lc.noticeHours === h ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: lc.noticeHours === h ? '500' : '400', color: lc.noticeHours === h ? t.brandInk : t.ink2 }}>{noticeLabel(h)}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ marginTop: sp.lg }}>
            {/* The currency goes in the LABEL, where it stays, rather than only
                in the prose underneath — this box arrives holding the fee the
                coach set last time, and an amount being edited is the moment
                the unit matters most. `lc.currency` is the gym's own ISO code
                and may be null; nothing is invented in its place. */}
            <Field t={t} label={`Late-Cancellation Fee${lc.currency ? ` · ${lc.currency}` : ''}`}
              value={lcFeeDraft ?? (lc.fee == null ? '' : String(lc.fee))}
              onChangeText={(v) => {
                setLcFeeDraft(v);
                // `replace(/[^0-9.]/g, '')` kept the point and deleted the
                // COMMA, so a coach in Berlin typing "25,50" had it closed up
                // into "2550" and billed a client fifty-one times the fee they
                // meant. The comma is a decimal point here, as it is
                // everywhere else a figure is typed.
                if (!v.trim()) { lc.setFee(null); return; }
                const n = readNumber(v);
                if (n != null && n >= 0) lc.setFee(n);
              }}
              placeholder="25" keyboardType="decimal-pad" />
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {/* The currency is the GYM's (tenants.currency), never a symbol
                  this app picked. A coach with no gym sees the bare figure and
                  is told why, exactly as the session rate above does it. */}
              {lc.fee == null
                ? 'No amount set. A policy with no amount cannot be switched on — a fee of nothing is a policy that does not apply.'
                : lc.currency
                  ? `Clients see ${feeAmountLine(lc.fee, lc.currency)} before they confirm a late cancellation, and again on the record afterwards.`
                  : `Clients see this figure as a number. Your gym hasn’t told us what it charges in, so Repple prints no symbol rather than guessing one.`}
            </Text>
          </View>

          {/* The database refuses `applies` with no amount behind it, so the
              coach is told before the write rather than after it fails —
              silently, in a debounce, with the switch still showing on. */}
          {lc.blocker ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>{lc.blocker}</Flag>
          ) : (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Repple records the fee and never collects it. Your client sees what they owe and who to pay — you.
            </Text>
          )}
          {/* The same answer the fields above this section get, for the same
              reason: this is the one setting in the app a client can be held
              to, and the sentence beside it states what Repple does with a fee
              that may never have left the phone. See src/lib/profileSave.ts. */}
          {lcSaveNote ? (
            <View style={{ marginTop: sp.md }}>
              <Flag tone={lc.save.state === 'failed' ? t.crit : lc.save.state === 'pending' ? t.ink3 : t.good}>{lcSaveNote}</Flag>
            </View>
          ) : null}
          </>
          )}
        </Section>

        <Rule />

        {/* Public directory opt-in. Off by default and never set on the
            trainer's behalf — clients only see coaches who switched this on. */}
        <Section>
          <SectionHead title="Find a Trainer Directory" />
          <Pressable
            onPress={() => p.setListed(!p.listed)}
            accessibilityRole="switch"
            accessibilityState={{ checked: p.listed }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.md,
              backgroundColor: t.surface, borderRadius: radius.md, padding: sp.lg, ...elevation.e1,
              ...(p.listed ? { borderWidth: hairline, borderColor: t.brand } : null),
            }}
          >
            <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="search" size={17} color={p.listed ? t.brand : t.ink3} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>List me in Find a Trainer</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{p.listed ? 'Clients browsing Repple can see your name, tagline, bio, specialties and rate, and can request coaching.' : 'Off — you are not visible to clients browsing for a coach.'}</Text>
            </View>
            <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: p.listed ? t.brand : t.surface3, borderWidth: hairline, borderColor: p.listed ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: p.listed ? t.brandInk : t.ink3, alignSelf: p.listed ? 'flex-end' : 'flex-start' }} />
            </View>
          </Pressable>
        </Section>

        <Rule />

        {/* ── the address a coach can put in a bio ────────────────────────── */}
        {/* Directly under the directory switch, because it is the same profile
            shown to a wider audience and the two decisions belong side by side.
            It is a SECOND consent and not a consequence of the first: Find a
            Trainer is a screen inside the client app behind a sign-in, and this
            is the open web. src/lib/publicProfile.ts holds the rules and
            supabase/parts/340 enforces them; a coach who leaves the directory
            has their page taken down in the same statement, so the state below
            can never claim a page that is not being served.

            Nothing here is written on a keystroke. Every other field on this
            screen goes through the provider's debounced fire-and-forget write,
            which is right for a bio and wrong for an address that can be TAKEN:
            a swallowed 23505 leaves a coach looking at a handle they do not
            own. One press, one round trip, one sentence back. */}
        <Section>
          <SectionHead title="Your Page on the Web" />

          <Card>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>A link for your bio</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              A page anybody can open, with your name, what you do, what you are qualified in and a
              button that brings somebody into the app already attached to you.
            </Text>
            <Text style={{ ...ty.caption, color: pageState === 'live' ? t.brand : t.ink3, marginTop: sp.md }}>
              {publicPageStateNote(pageState)}
            </Text>
          </Card>

          {/* What is on it and what is never on it, before anything is
              published. This IS the consent: a coach who cannot see what they
              are handing to the open web has not agreed to anything. Folded by
              default because it is long, and long is the point. */}
          <Pressable onPress={() => setPageOpen(!pageOpen)} accessibilityRole="button"
            accessibilityLabel={pageOpen ? 'Hide what is on your page' : 'Show what is on your page'}
            style={{ marginTop: sp.md, paddingVertical: sp.sm }}>
            <Text style={{ ...ty.label, color: t.brand }}>
              {pageOpen ? 'Hide what goes on it' : 'What goes on it, and what never does'}
            </Text>
          </Pressable>
          {pageOpen ? (
            <Card style={{ marginTop: sp.sm }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>On the page</Text>
              {PUBLISHED_FIELDS.map((f) => (
                <Flag key={f} tone={t.brand} style={{ marginBottom: sp.sm }}>{f}</Flag>
              ))}
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md, marginBottom: sp.sm }}>Never on it</Text>
              {WITHHELD_FIELDS.map((f) => (
                <Flag key={f} tone={t.ink3} style={{ marginBottom: sp.sm }}>{f}</Flag>
              ))}
            </Card>
          ) : null}

          {/* The address. Normalised as it is typed, so the coach can see what
              they are actually claiming rather than being corrected after the
              press: "Jas Fitness" becomes "jas-fitness" under their thumb. */}
          <View style={{ marginTop: sp.lg }}>
            <Field t={t} label="Your address" value={pageHandle}
              onChangeText={(v) => setHandleDraft(normaliseHandle(v))}
              placeholder="jas-fitness" />
            {pageUrl ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: -sp.md, marginBottom: sp.md }}>{pageUrl}</Text>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: -sp.md, marginBottom: sp.md }}>
                {`Up to ${HANDLE_MAX} characters. Letters, numbers and hyphens.`}
              </Text>
            )}
            {draftProblem !== 'ok' && draftProblem !== 'empty' ? (
              <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{handleProblemText(draftProblem)}</Flag>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {/* Publishing an unlisted coach is refused by the server rather
                  than corrected, so the button is offered and the refusal is
                  read: a control that vanishes teaches nobody which switch to
                  press. */}
              <Cta label={p.publicPage ? 'Save Changes' : 'Publish My Page'}
                a11yLabel={p.publicPage ? 'Save changes to your public page' : 'Publish your public page'}
                disabled={pageBusy || draftProblem !== 'ok'}
                onPress={() => savePage(true)} />
              {/* Offered whenever an address is held, not only when the page
                  is live: clearing the box and pressing Publish is refused (an
                  empty address is not an address), so without this a coach who
                  had switched their page off could never give the address back. */}
              {p.publicHandle ? (
                <Ghost label={p.publicPage ? 'Take It Down' : 'Release Address'} icon="minus"
                  a11yLabel={p.publicPage ? 'Take your public page down' : 'Give up your page address'}
                  onPress={() => savePage(false, p.publicPage ? p.publicHandle ?? '' : '')} />
              ) : null}
              {pageUrl && p.publicPage && HAS_NATIVE_CLIPBOARD ? (
                <Ghost label="Copy Link" icon="plus" a11yLabel="Copy your page address" onPress={copyPageUrl} />
              ) : null}
            </View>
            {pageUrl && p.publicPage && !HAS_NATIVE_CLIPBOARD ? (
              <Flag tone={t.ink3} style={{ marginTop: sp.md }}>{CLIPBOARD_UNAVAILABLE_NOTE}</Flag>
            ) : null}

            {/* What the server did, in its own words. Shown until the next
                press rather than flashed, because "that address is taken" is
                the one a coach needs while they think of another. */}
            {pageSaid ? (
              <Notice kicker="Your page" title={pageSaid.title} note={pageSaid.body} />
            ) : null}
          </View>
        </Section>

        </>
        )}

        <Rule />

        {/* ── who is waiting on a reply ──────────────────────────────────── */}
        {/* Its own section, above everything else here, because it is the thing
            a coach opens the app to do and it was reachable from nowhere. The
            chat screen is per-client and needs a clientId, so the only routes
            into a conversation were a client's own page, a leaderboard row and
            a push notification — all of which start from a client already
            chosen. A coach with twenty clients could not find out who had
            written to them.

            Deliberately NOT next to the Notifications row under Account. The
            bell is bookings and cancellations; this is people talking, and they
            are two lists with two different answers. Filing them together is
            what makes a coach look for a client's message among their booking
            confirmations. */}
        <Section>
          <SectionHead title="Messages" />
          <ListRow icon="message" title="Messages"
            note="Every client conversation in one list, newest first, with who is waiting on a reply"
            onPress={() => router.push('/(trainer)/messages')} />
        </Section>

        <Rule />

        {/* ── what a stranger judges you on ──────────────────────────────── */}
        {/* Directly under the directory opt-in, because this is what the
            directory SHOWS — the toggle above decides whether clients can see
            you, and this row is the rest of what they see when they do.

            Outside the `p.access !== 'ok'` branch on purpose. That branch
            withholds the profile EDITOR when this coach's own `trainers` row
            could not be read, which is right for a form that would silently
            drop what is typed into it. Credentials and reviews are different
            reads with their own three-state handling, and a coach whose profile
            row failed is exactly the coach who needs to check whether a client
            can see a review they have not answered. */}
        <Section>
          <SectionHead title="Credentials & Reviews" />
          <ListRow icon="trophy" title="Credentials & Reviews"
            note="Your qualifications and insurance, and your right of reply to what clients wrote"
            onPress={() => router.push('/(trainer)/credentials')} />
        </Section>

        <Rule />

        {/* ── what your clients see around your coaching ─────────────────── */}
        {/* Its own section rather than a row under Account, because it is the
            coach's PUBLIC face and Account is where private settings live —
            the same split the sections above it make. Outside the
            `p.access !== 'ok'` branch for the reason Credentials gives: the
            Branding screen does its own three-state read and tells a coach
            when it failed, rather than showing an empty form that would
            silently save nothing. */}
        <Section>
          <SectionHead title="Your Branding" />
          <ListRow icon="sparkle" title="Your Branding"
            note="The name and colour your clients see around your coaching"
            onPress={() => router.push('/(trainer)/brand')} />
        </Section>

        <Rule />

        {/* ── your paperwork, not Repple's ───────────────────────────────── */}
        {/* Its own section rather than a row under Account, for the reason the
            screen itself opens with: the waiver a client signs on joining is
            Repple's and the coach cannot read it, and these are the coach's own
            — a studio waiver, a par-form, house rules. Filing them together
            under one heading is how the two get confused. */}
        <Section>
          <SectionHead title="Your Paperwork" />
          <ListRow icon="pencil" title="Your Documents"
            note="Waivers and forms you ask clients to accept, and who has accepted them"
            onPress={() => router.push('/(trainer)/documents')} />
        </Section>

        <Rule />

        {/* ── the coach's own training ───────────────────────────────────── */}
        {/* Its own section rather than a row under Account, because the thing
            that has to be legible from the outside is WHOSE training it is.
            Coaches train too, and until this row there was nowhere in this app
            to log a session of their own — a coach who lifts had to keep a
            second account in the client app. It sits above Account because it
            is something a coach does weekly; signing out is not. */}
        <Section>
          <SectionHead title="Your Training" />
          <ListRow icon="dumbbell" title="My Training"
            note="Log and review your own workouts — separate from every client's record"
            onPress={() => router.push('/(trainer)/my-training')} />
        </Section>

        <Rule />

        {/* ── money ──────────────────────────────────────────────────────── */}
        {/* Account — the in-app route to sign out, export, and account deletion.
            Repple Coach had none of the three before this. */}
        <Section>
          <SectionHead title="Account" />
          {/* Above Settings, because Settings holds the switch that decides
              whether pushes are sent and this holds the pushes themselves —
              and a coach hunting for "notifications" will otherwise find only
              the toggle and conclude there is no inbox. There is: the Clients
              tab has no bell, so this row and Explore are the only ways in. */}
          <ListRow icon="bell" title="Notifications" note="Bookings, cancellations and anything sent to you"
            onPress={() => router.push('/(trainer)/notifications')} />
          <ListRow icon="settings" title="Settings" note="Who you are signed in as, your data, and deleting your account"
            onPress={() => router.push('/(trainer)/settings')} />
          {/* Reported as "there is no sign out button on the coach app". There
              was one — three levels down, at the foot of Settings, which is the
              same as not having one. Signing out is the single control people
              expect to find on a profile screen without hunting, so it is on
              the profile screen. Settings keeps its copy; this is a second way
              in, not a move, because somebody who has learned the old path
              should not find it gone. */}
          <View style={{ marginTop: sp.md }}>
            <Ghost label="Sign Out" onPress={signOut} />
          </View>
        </Section>

        <Rule />

        <Section>
          {/* The User Guide was filed under "Money", which it is not. A heading
              that does not describe the rows beneath it is worse than none —
              somebody looking for help does not read a section called Money. */}
          <SectionHead title="Help" />
          <ListRow icon="search" title="User Guide" note="What each tab does, any time"
            onPress={() => router.push('/guide')} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Money" />
          {/* First, and above the three screens that each own a piece of it.
              Payments, Invoices and Billing are where a coach DOES something;
              this is the only place that answers "how did the month go" without
              making them visit five screens and add up in their head. It writes
              nothing and owns nothing — every section on it ends in a row that
              opens one of the three below. */}
          <ListRow icon="chart" title="Money" note="What came in and what went out, kept apart"
            onPress={() => router.push('/(trainer)/money')} />
          <ListRow icon="people" title="Payments" note="Get paid by clients — memberships & packs"
            onPress={() => router.push('/(trainer)/payments')} />
          {/* Under Payments and above Billing, in that order, because the three
              rows are three different people's money and the order says whose:
              what clients pay you, what you hand THEM as a record of it, and
              what you pay Repple. The row above takes the money and produces
              nothing anybody can be given — that gap is the whole reason
              invoices.tsx exists, and the two belong next to each other. */}
          <ListRow icon="grid" title="Invoices" note="Issue a document for what somebody paid you, and see what you have issued"
            onPress={() => router.push('/(trainer)/invoices')} />
          <ListRow icon="chart" title="Billing & Subscription" note="Your plan, payment method & invoices"
            onPress={() => router.push('/(trainer)/billing')} />
          {/* Last in the section, because it is the one row that is about all
              three of the rows above at once: it is a period summary of what
              this app recorded, for handing to somebody else. It is deliberately
              not called a tax export — it calculates no tax and says so on its
              own face — and the note says what it is for so nobody has to open
              it to find out. */}
          <ListRow icon="grid" title="Statement of Record" note="What this app recorded in a year or a quarter, to hand to an accountant"
            onPress={() => router.push('/(trainer)/statement')} />
        </Section>

        <Rule />

        {/* ── credits ────────────────────────────────────────────────────── */}
        {/* Its own section with its own heading, not a grey line at the foot of
            the screen. The exercise catalogue this app now searches — every
            description, every illustration, the naming itself — is licensed
            under a free tier whose one condition is a visible credit, and a
            credit nobody can find is not one. scripts/check-attribution.mjs
            fails the build if the coach app reads the catalogue and this is not
            on screen, because the way this term gets breached is nobody
            deciding to: somebody rewrites a settings screen and it goes with
            it, and no test notices because nothing is broken. */}
        <Section>
          <SectionHead title="Credits" />
          <RepdbAttribution />
        </Section>

        {/* ── the stranded footer that used to be here ────────────────────
            "Changes save automatically and appear on your clients' booking
            screen. Tap a chip to remove it." — a caption in its own section at
            the very bottom of the screen, below the RepDB credits.

            Both halves are already said, in place and better. "Tap a chip to
            remove" is the `note` on BOTH chip editors (Specialties and What
            You Offer, above) — this third copy sat some five hundred points
            further down, after the legal attribution block, referring to chips
            the reader could not see and could not have been looking at. And
            "changes save automatically" is what the save flag at the top of
            the screen says with an actual timestamp against it.

            Seen on a device it read as a caption belonging to whatever was
            above it, which was the exercise-data credit. */}

      </ScrollView>
    </SafeAreaView>
  );
}
