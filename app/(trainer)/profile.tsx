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
import { useState } from 'react';
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
import { useMyCancellationPolicy } from '../../src/ui/sessions';
import { feeAmountLine, noticeLabel } from '../../src/lib/booking';
import { RepdbAttribution } from '../../src/ui/Attribution';

function Field({ t, label, value: val, onChangeText, placeholder, multiline, keyboardType }: { t: Theme; label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'numeric' }) {
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
  /** Confirmed, because signing out of a coach account on a shared gym tablet
   *  by mis-tapping is a nuisance nobody can undo without the password. */
  const signOut = () => {
    Alert.alert('Sign out of Repple Coach?', 'You will need your password to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('trainerProfile.signOut', e); } } },
    ]);
  };
  const p = useMyTrainerProfile();
  // The late-cancellation policy is NOT part of `useMyTrainerProfile`. That
  // provider is the coach's public identity — what clients see — and this is a
  // rule about money that binds them. It also has a constraint behind it
  // (`trainers_late_cancel_fee_stated`) that a debounced write of five other
  // fields would trip on the coach's behalf, taking their bio down with it.
  const lc = useMyCancellationPolicy();
  const [newOffer, setNewOffer] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const initials = p.name.replace('Coach ', '').split(' ').map((x) => x[0]).join('').slice(0, 2);

  const pickPhoto = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'set your profile photo'))) return;
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (!res.canceled && res.assets && res.assets[0]) p.setPhoto(res.assets[0].uri);
  };
  const addOffer = () => { const v = newOffer.trim(); if (v) { p.setOffers([...p.offers, v]); setNewOffer(''); } };
  const addSpec = () => { const v = newSpec.trim(); if (v) { p.setSpecialties([...p.specialties, v]); setNewSpec(''); } };

  // Upload / Take Photo, plus Remove only when there is a photo to remove.
  const photoActions: { icon: IconName; label: string; onPress: () => void }[] = [
    { icon: 'plus', label: 'Upload', onPress: () => pickPhoto(false) },
    { icon: 'camera', label: 'Take Photo', onPress: () => pickPhoto(true) },
  ];
  if (p.photo) photoActions.push({ icon: 'minus', label: 'Remove', onPress: () => p.setPhoto(null) });

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        {/* ── header. No hero — a profile has no single live number ───────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your profile</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>How Clients See You</Text>
          </View>
        </View>

        {/* ── live preview: the one surface on this screen that groups ────── */}
        <Card style={{ marginBottom: sp.lg }}>
          <View style={{ flexDirection: 'row', gap: sp.lg, alignItems: 'center' }}>
            {p.photo ? (
              <Image source={{ uri: p.photo }} style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
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

        <Rule />

        {/* Everything below this line writes to the signed-in user's own
            `profiles` and `trainers` rows, and the provider refuses to answer —
            and to write — when it cannot establish that those rows are really
            theirs. A form that accepts what a coach types and silently drops it
            is worse than one that is not offered, so when the profile could not
            be read the editor is withheld and the reason is stated. Account and
            sign-out sit below this branch and stay reachable. */}
        {p.access !== 'ok' ? (
          <Section>
            <Notice tone={t.warn} kicker="Profile" title="Your profile could not be opened for editing"
              note={p.accessNote ?? 'We could not confirm this is your own coaching profile, so nothing typed here would be stored.'} />
          </Section>
        ) : (
        <>

        {/* ── photo ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Photo" />
          <QuickRow items={photoActions} />
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

        <Section>
          <SectionHead title="Session Rate" />
          {/* `String(p.sessionFee)` literally rendered the text "null" into the
              box. And `|| 0` meant clearing the field set a real rate of zero
              rather than clearing it, so a coach could not un-set a rate once
              they had typed one. */}
          <Field t={t} label="Session Rate, per session"
            value={p.sessionFee == null ? '' : String(p.sessionFee)}
            onChangeText={(v) => {
              const digits = v.replace(/[^0-9]/g, '');
              const n = parseInt(digits, 10);
              p.setSessionFee(digits === '' || !Number.isFinite(n) ? null : n);
            }}
            placeholder="75" keyboardType="numeric" />
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
              value={lc.fee == null ? '' : String(lc.fee)}
              onChangeText={(v) => {
                const digits = v.replace(/[^0-9.]/g, '');
                const n = parseFloat(digits);
                lc.setFee(digits === '' || !Number.isFinite(n) ? null : n);
              }}
              placeholder="25" keyboardType="numeric" />
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

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Changes save automatically and appear on your clients' booking screen. Tap a chip to remove it.</Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
