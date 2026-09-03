// Client · Access. Full-screen member barcode for gym entry — scan at the turnstile.
//
// Deliberately off-theme: the card is real black-on-white because that is what a
// laser scanner can read, and the surround stays black so the screen is as bright
// as possible. Type comes from the scale; the colours here are a hardware
// requirement, not a palette choice.
//
// ── The brand this screen names, and the one it used to name ──────────────
//
// `useBrand().appName`, not `BRAND.label`. The two are different answers: the
// first is the GYM's own name as `tenants.name` has it, cached on this device
// (src/ui/brand.tsx), and the second is the build's compiled-in family label.
// The member number is derived from a three-letter prefix of whichever it is
// given, so on a white-label build Membership showed "REP-…" from one and this
// barcode encoded "EXA-…" from the other — a member giving reception one number
// and holding a different one up to the turnstile, which is precisely the
// failure the instruction below asks them to walk into. One source, and it is
// the same one app/(client)/membership.tsx reads.
//
// The encoded number is `memberNoFrom(...)` — derived from the signed-in user and
// stable for them. No gym billing system issues it, so a turnstile will NOT open
// on it unless the gym has been given this exact number and loaded it against the
// member. The screen used to read "Hold this to the scanner at the gym entrance",
// which promised a door that opens; it now says what the number is and what has
// to happen before it works.
import { useMemo, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { sp, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { isWhole } from '../../src/ui/loadStatus';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useBrand } from '../../src/ui/brand';
import { memberNoFrom, MEMBER_NO_CHANGED_NOTE } from '../../src/lib/membership';
import { code39Segments } from '../../src/lib/barcode';
import { BACK_ICON } from '../../src/ui/direction';

export default function Access() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { appName } = useBrand();
  const memberNo = memberNoFrom(c.name, c.id, appName);
  const segs = useMemo(() => code39Segments(memberNo), [memberNo]);
  // ── whether this card may be shown at all ────────────────────────────────
  //
  // The number is derived from the member's own name and id, both of which come
  // from the profile read. A profile that failed to read hands this screen a
  // name of '' and therefore a DIFFERENT barcode — one reception has never
  // seen — and it was printed at full size, on a black card, with nothing
  // saying so. The defect was written down in this comment and answered with a
  // pull gesture, which is not an answer: the member is at a turnstile with a
  // queue behind them and no reason to pull anything.
  //
  // So the read is asked. `c.id` is 'unknown' when nobody is signed in, and an
  // empty name is what a failed profile read leaves behind — either one means
  // the number below is not this person's, and a barcode that is not theirs
  // must not be drawn.
  const idKnown = !!c.id && c.id !== 'unknown';
  const nameKnown = !!c.name.trim();
  const canShow = idKnown && nameKnown;
  // Read, and not yet confirmed. A cached name gives the right number, so the
  // card is still drawn — with the caveat on it rather than in a comment.
  const confirmed = isWhole(c.profileStatus);
  const pull = usePullToRefresh(useCallback(() => { c.reload(); }, [c.reload]));
  // The bar width used to be a pinned 2. The number is longer now — nine base-36
  // characters instead of four digits, because four digits was nine thousand
  // buckets and two members of one gym could share one — so a fixed unit runs
  // off the side of a phone and a laser reads half a barcode. It is computed
  // from the space the card actually has, capped at 2 so a short number on a
  // tablet does not become a wall.
  const { width: screenW } = useWindowDimensions();
  const available = Math.max(120, screenW - sp.xl * 4);
  const totalUnits = segs.reduce((n, sg) => n + sg.w, 0);
  const unit = Math.max(1, Math.min(2, available / Math.max(1, totalUnits)));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl }} refreshControl={pull}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ position: 'absolute', top: 10, start: 6, padding: 10 }}>
          <Icon name={BACK_ICON} size={20} color="#fff" />
        </Pressable>
        {!canShow ? (
          /* No card at all. A barcode built off a name of '' encodes a
             different number, and one wrong barcode held up at a turnstile
             costs more than no barcode: the member stands there scanning
             something that cannot work and has nothing to tell the desk. */
          <View style={{ alignItems: 'center', paddingHorizontal: sp.xl }}>
            <Text style={{ ...ty.title, color: '#fff', textAlign: 'center' }}>
              {c.profileStatus === 'loading' ? 'Reading your account…' : 'We couldn’t read your account'}
            </Text>
            <Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.md }}>
              {c.profileStatus === 'loading'
                ? 'Your ID is built from your account, so the card appears once that has been read.'
                : 'Your ID is built from your account, and without it this card would show a number that is not yours — so it is not shown. Nothing is wrong with your membership. Try again, or give reception your name at the desk.'}
            </Text>
            {c.profileStatus !== 'loading' ? (
              <Pressable onPress={() => c.reload()} accessibilityRole="button" accessibilityLabel="Try reading your account again"
                style={{ marginTop: sp.xl, paddingVertical: 13, paddingHorizontal: sp.xxl, borderRadius: radius.sm, backgroundColor: '#1c1c1c' }}>
                <Text style={{ ...ty.label, fontWeight: '500', color: '#fff' }}>Try Again</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
        <>
        <Text style={{ ...ty.title, color: '#fff', marginBottom: 4 }}>{c.name || 'Member'}</Text>
        <Text style={{ ...ty.body, ...numeric, color: '#8a8a8a', marginBottom: sp.huge }}>{appName} ID {memberNo}</Text>

        <View style={{ backgroundColor: '#fff', borderRadius: radius.md, paddingVertical: sp.xl, paddingHorizontal: sp.xl, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 130 }}>
            {segs.map((s, i) => (
              <View key={i} style={{ width: s.w * unit, backgroundColor: s.bar ? '#000' : '#fff' }} />
            ))}
          </View>
          <Text style={{ ...value(15), letterSpacing: 3, color: '#000', marginTop: sp.md }}>{memberNo}</Text>
        </View>

        {/* Drawn off a name this session could not confirm. The number is
            almost certainly right — it is the one this device last read — and
            "almost certainly" is a thing the person holding it up is entitled
            to know before a queue forms behind them. */}
        {!confirmed ? (
          <Text style={{ ...ty.caption, color: '#8a8a8a', textAlign: 'center', marginTop: sp.lg }}>
            Your account could not be confirmed just now, so this is the ID this phone last read for you. Pull down to check it.
          </Text>
        ) : null}

        <Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.xxl }}>This is your {appName} ID, not a membership number your gym issued.{'\n'}Give it to reception once and they can link it to your account — after that the entrance scanner will read it.{'\n'}Turn your screen brightness up for a clean read.</Text>
        {/* The number widened and therefore changed. This is the screen the
            instruction above is on, so it is the screen that owes somebody who
            followed that instruction an explanation. */}
        <Text style={{ ...ty.caption, color: '#8a8a8a', textAlign: 'center', marginTop: sp.lg }}>{MEMBER_NO_CHANGED_NOTE}</Text>
        </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
