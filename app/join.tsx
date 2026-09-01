// Where `repple://join?c=CODE` lands.
//
// A coach puts their link in a bio. Until now that link could only ever open a
// web page, because the app declares a custom scheme and no universal links —
// so the best the page could do was print six characters and ask somebody to
// remember them through an App Store install. This route is the other half:
// with the app installed, the link opens it, the code comes with them, and the
// trainer-search screen is already filled in.
//
// It renders almost nothing on purpose. There is no decision to make here and
// nothing to read: it is a doorway, and standing in it is not the experience.
// The one thing it will not do is act as though a code makes somebody a
// client — it hands the code to the screen that asks the server about it, and
// the coach still accepts the request.
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { sp, layout, type as ty } from '../src/theme/scale';
import { rememberJoinCode } from '../src/ui/pendingJoinCode';
import { isPlausibleReferralCode, normaliseReferralCode } from '../src/lib/referralLink';
import { stashPendingReferral } from '../src/lib/referrals';
import { supabase } from '../src/lib/supabase';
import { USE_SUPABASE } from '../src/lib/config';

export default function JoinLanding() {
  const t = useTheme();
  const router = useRouter();
  // Two parameters, two meanings, and they are never tried as one another.
  //
  //   ?c=  a COACH's join code. Prefills trainer search; ends in a coaching
  //        request the coach accepts.
  //   ?r=  a MEMBER's referral code. Recorded once at sign-up and creates no
  //        relationship with anybody.
  //
  // `record_referral` keeps the FIRST code an account records, permanently and
  // with no way to revise it, so a coach code spent as a referral would
  // attribute a new member to a stranger for the life of the account. Falling
  // back from one to the other is therefore forbidden rather than merely
  // avoided — see the header of src/lib/referralLink.ts.
  const params = useLocalSearchParams<{ c?: string; r?: string }>();
  const raw = typeof params.c === 'string' ? params.c : null;
  const rawRef = typeof params.r === 'string' ? params.r : null;
  // Only ever set to true. A link with a broken or missing code still gets
  // somebody into the app — it just gets them there with nothing typed in.
  const [badCode, setBadCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kept = await rememberJoinCode(raw);
      if (cancelled) return;
      if (raw && !kept) setBadCode(true);

      // The referral code, stashed rather than recorded: there is no session
      // yet on the path this route exists for — somebody arriving from a
      // friend's message has no account — and `flushPendingReferral` spends it
      // at the first successful sign-in. A member who is ALREADY signed in has
      // it stashed too rather than dropped, because the server keeps the first
      // code recorded for an account and will simply ignore a second one; the
      // alternative is losing the attribution for somebody who taps a friend's
      // link before installing anything.
      if (rawRef) {
        const ref = normaliseReferralCode(rawRef);
        if (isPlausibleReferralCode(ref)) await stashPendingReferral(ref);
        else setBadCode(true);
      }
      if (cancelled) return;

      // Signed in already: straight to the screen that spends it. Signed out:
      // the code waits in storage through sign-up and is there afterwards,
      // which is the case this whole route exists for — somebody arriving from
      // a bio has no account yet.
      let signedIn = false;
      if (USE_SUPABASE) {
        try {
          const { data } = await supabase.auth.getSession();
          signedIn = !!data?.session;
        } catch { signedIn = false; }
      }
      if (cancelled) return;
      // A referral link with no coach code has no business opening trainer
      // search: nothing there is about it, and a signed-in member who tapped a
      // friend's invitation would be dropped into "find a coach" with a
      // prefilled field they never asked for. It sends them home instead, where
      // the stash is already spent or will be at their next sign-in.
      const refOnly = !raw && !!rawRef;
      router.replace(signedIn ? (refOnly ? '/' : '/(client)/trainers') : '/welcome');
    })();
    return () => { cancelled = true; };
  }, [raw, router]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: layout.gutter }}>
      <ActivityIndicator color={t.brand} />
      <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg, textAlign: 'center' }}>
        {badCode
          ? 'That link was missing a usable code — opening Repple so you can enter the code yourself.'
          : 'Opening Repple…'}
      </Text>
    </View>
  );
}
