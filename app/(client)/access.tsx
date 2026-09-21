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
import { sp, radius, type as ty, numeric, value, font } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { isWhole } from '../../src/ui/loadStatus';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useBrand } from '../../src/ui/brand';
import { memberNoFrom, MEMBER_NO_CHANGED_NOTE } from '../../src/lib/membership';
import { code39Fit } from '../../src/lib/barcode';
import { BACK_ICON } from '../../src/ui/direction';

export default function Access() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { appName } = useBrand();
  const memberNo = memberNoFrom(c.name, c.id, appName);
  // ── whether this card may be shown at all ────────────────────────────────
  //
  // `c.id` is the whole of it, and this used to also require a name.
  //
  // The reasoning written here was that "a profile that failed to read hands
  // this screen a name of '' and therefore a DIFFERENT barcode". That is not
  // what `memberNoFrom` does: it seeds on `id || name || 'repple'`, so once the
  // id is known the name contributes NOTHING to the number — the same member,
  // named or nameless, gets the same nine characters. The name gate was
  // therefore withholding a correct barcode, and telling the member the number
  // "is not yours" about a number that was.
  //
  // It withheld it in exactly the place it is needed. `sbUid` comes from
  // `supabase.auth.getUser()` and `name` comes from a second read of `profiles`
  // (src/ui/clientData.tsx); on a fresh handset on a gym's captive-portal wifi
  // the first lands and the second does not, which is a member standing at a
  // turnstile being shown "We couldn't read your account" over a card that
  // would have worked.
  //
  // What the id gate is for stays exactly as it was: `c.id` is the literal
  // string 'unknown' when nobody is signed in, the derivation is pure, and so
  // every member of a brand would otherwise be shown the SAME number. That one
  // must never be drawn.
  const idKnown = !!c.id && c.id !== 'unknown';
  const nameKnown = !!c.name.trim();
  const canShow = idKnown;
  // Read, and not yet confirmed. A cached name gives the right number, so the
  // card is still drawn — with the caveat on it rather than in a comment.
  const confirmed = isWhole(c.profileStatus);
  const pull = usePullToRefresh(useCallback(() => { c.reload(); }, [c.reload]));
  // The bar width used to be a pinned 2, then `Math.max(1, Math.min(2, …))`.
  // Both drew a symbol wider than the card on a 320-point screen, and a clipped
  // Code 39 has lost its start and stop guards and decodes as nothing. The
  // ratio is chosen along with the width now — see `code39Fit` in
  // src/lib/barcode.ts, which drops from 3:1 to the equally legal 2:1 rather
  // than let the symbol run off the edge.
  const { width: screenW } = useWindowDimensions();
  const available = Math.max(120, screenW - sp.xl * 4);
  const fit = useMemo(() => code39Fit(memberNo, available), [memberNo, available]);
  const segs = fit.segs;
  const unit = fit.unit;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl }} refreshControl={pull}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ position: 'absolute', top: 10, start: 6, padding: 10 }}>
          <Icon name={BACK_ICON} size={20} color="#fff" />
        </Pressable>
        {!canShow ? (
          /* No card at all, and only ever for one reason: nobody is signed in,
             or the session read has not landed. The number is then derived from
             the literal string 'unknown', which is the SAME number for every
             member of this brand — and one member holding up another member's
             barcode at a turnstile costs more than no barcode. */
          <View style={{ alignItems: 'center', paddingHorizontal: sp.xl }}>
            <Text style={{ ...ty.title, color: '#fff', textAlign: 'center' }}>
              {c.profileStatus === 'loading' ? 'Reading your account…' : 'We couldn’t read your account'}
            </Text>
            <Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.md }}>
              {c.profileStatus === 'loading'
                ? 'Your ID is built from your account, so the card appears once that has been read.'
                : 'Your ID is built from your account, and without it this card would show a number that is not yours, so it is not shown. Nothing is wrong with your membership. Try again, or give reception your name at the desk.'}
            </Text>
            {c.profileStatus !== 'loading' ? (
              <Pressable onPress={() => c.reload()} accessibilityRole="button" accessibilityLabel="Try reading your account again"
                style={{ marginTop: sp.xl, paddingVertical: 13, paddingHorizontal: sp.xxl, borderRadius: radius.sm, backgroundColor: '#1c1c1c' }}>
                <Text style={{ ...ty.label, ...font('500'), color: '#fff' }}>Try Again</Text>
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

        {/* Two different things this session may not have confirmed, and they
            deserve two different sentences.

            The NAME is the one above the barcode, and it is the only part of
            this card a failed profile read can take away — the number is
            derived from the account id alone (see the gate at the top), so it
            is right whether or not the name arrived. Saying "this is the ID
            this phone last read for you" about a number that was derived a
            frame ago would be inviting doubt where there is none.

            The profile READ not having settled is the other, and it is where
            that sentence is true: the name on screen is a cached one and it is
            worth a pull to check. */}
        {canShow && !nameKnown ? (
          <Text style={{ ...ty.caption, color: '#8a8a8a', textAlign: 'center', marginTop: sp.lg }}>
            Your name could not be read just now, so it is not on the card. The ID below it is built from your account and is yours. Reception can look you up on it.
          </Text>
        ) : !confirmed ? (
          <Text style={{ ...ty.caption, color: '#8a8a8a', textAlign: 'center', marginTop: sp.lg }}>
            Your account could not be confirmed just now, so this is the name this phone last read for you. The ID is built from your account and is unaffected. Pull down to check it.
          </Text>
        ) : null}

        <Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.xxl }}>This is your {appName} ID, not a membership number your gym issued.{'\n'}Give it to reception once and they can link it to your account. After that, the entrance scanner will read it.{'\n'}Turn your screen brightness up for a clean read.</Text>
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
