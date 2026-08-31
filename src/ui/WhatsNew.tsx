// What changed since this person was last in the app.
//
// Not a changelog — what is new TO THEM. The rules live in
// `src/lib/releaseNotes.ts` (tested in releaseNotes.test.ts); this file is the
// screen and the one thing the screen has to remember: which release each
// account was last shown. The same notes produce the App Store text, so what a
// tester reads in TestFlight and what they read in the app are one set of
// sentences.
//
// ── Why the stamp is per account, not per device ──────────────────────────
//
// It was a single device-wide key. Two people share a phone, or a coach signs
// out and a client signs in, and the second one inherits the first one's
// position in the history — which is either "you have seen everything" (they
// have not) or "you have seen nothing" (a brand-new account read a list of
// things that used to be broken). Keyed per user id, a new account has no key,
// which is exactly what a new account is: somebody who has missed nothing.
//
// The old device-wide key is deliberately NOT migrated. Reading it as a seed
// would hand a brand-new account the previous occupant's old position and open
// this sheet over their first ever launch, which is the one outcome this whole
// screen must not produce. Treating them as new costs an existing reader one
// silent release; the other way round costs the worst first impression the app
// can make.
//
// ── Why it never blocks ───────────────────────────────────────────────────
//
// It is news. Tapping outside it, the close button and the hardware back all
// dismiss it, and dismissing stamps, so it does not come back. It is mounted
// inside each portal's own layout, under the app lock and — in the client app —
// under the release of liability, so it can never be what somebody is reading
// instead of the thing they actually have to deal with.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Cta } from './kit';
import { sp, layout, radius, hairline, type as ty } from '../theme/scale';
import {
  CURRENT_RELEASE, RELEASES, MY_AUDIENCE, isVersion, releasesFor, unseenReleases,
  firstRunReleases, type Release,
} from '../lib/releaseNotes';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';

/** One key per account. See the header for why this is not one key per device. */
const seenKey = (userId: string) => `repple.whatsNew.lastSeen:${userId}`;

async function readSeen(userId: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(seenKey(userId));
    // Anything we cannot place is handed on as null, which unseenReleases
    // treats as "has missed nothing". A corrupt byte on disk must not turn into
    // every note ever written.
    return isVersion(v) ? v.trim() : null;
  } catch {
    // Storage unavailable. Saying nothing is the harmless direction: the
    // alternative is announcing the same release on every launch forever.
    return null;
  }
}

async function writeSeen(userId: string, version: string) {
  try { await AsyncStorage.setItem(seenKey(userId), version); } catch (e) { reportError('whatsNew.seen', e); }
}

function Body({ releases }: { releases: Release[] }) {
  const t = useTheme();
  return (
    <>
      {releases.map((r) => {
        const headline = r.headlines?.[MY_AUDIENCE];
        return (
          <View key={r.version} style={{ marginBottom: sp.xl }}>
            {headline ? (
              <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{headline}</Text>
            ) : null}
            {r.entries.map((e, i) => (
              <View key={e.title} style={{
                flexDirection: 'row', gap: sp.md, paddingVertical: sp.md,
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                {/* 'new' and 'fixed' read differently and deserve to look
                    different — somebody scanning for what they can now DO
                    should not have to read every line to find it. */}
                <View style={{
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm,
                  backgroundColor: e.kind === 'new' ? t.brand + '22' : t.surface2,
                  alignSelf: 'flex-start', minWidth: 46, alignItems: 'center',
                }}>
                  <Text style={{ ...ty.micro, color: e.kind === 'new' ? t.brand : t.ink3 }}>
                    {e.kind === 'new' ? 'New' : 'Fixed'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.title}</Text>
                  {e.note ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{e.note}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </>
  );
}

/**
 * The sheet.
 *
 * `releases` is what to show; the caller has already worked out what this
 * reader has not seen. `force` opens it from Settings with the whole history
 * for this app instead, which is the one case where "nothing new" is a real
 * answer worth printing.
 */
export function WhatsNewSheet({ visible, force, releases, onClose }: {
  visible: boolean;
  force?: boolean;
  releases?: Release[];
  onClose: () => void;
}) {
  const t = useTheme();
  const shown = force ? releasesFor(MY_AUDIENCE, RELEASES) : (releases ?? []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        {/* News, not a gate: the backdrop dismisses it, and so does the phone's
            own back gesture via onRequestClose. */}
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{
          backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
          paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: sp.xxl, maxHeight: '84%',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.sm }}>
            <Icon name="sparkle" size={16} color={t.brand} />
            <Text style={{ ...ty.micro, color: t.ink3 }}>Version {CURRENT_RELEASE}</Text>
          </View>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>What’s New</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {shown.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.xl }}>
                Nothing new since you last opened Repple.
              </Text>
            ) : <Body releases={shown} />}
          </ScrollView>
          <View style={{ marginTop: sp.lg }}>
            <Cta label="Got It" wide onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Decides whether this account has anything to catch up on, and remembers the
 * answer once they have read it.
 *
 * `userId` is the account, not the device — pass null when nobody is signed in
 * and nothing happens, because there is nothing to tell a sign-in screen.
 *
 * `hold` is for anything that outranks news. The client app passes the release
 * of liability: somebody who has not signed it must be looking at it, not at a
 * list of features. The check still runs while held, so the sheet is ready the
 * moment the more important thing is dealt with.
 *
 * Mount the returned props on <WhatsNewSheet> inside the portal layout.
 */
export function useWhatsNew(userId: string | null, hold = false) {
  const [unseen, setUnseen] = useState<Release[]>([]);
  const [dismissed, setDismissed] = useState(false);
  // Which account we have already asked about, so a sign-out and a sign-in as
  // somebody else asks again rather than reusing the first answer.
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) { askedFor.current = null; setUnseen([]); setDismissed(false); return; }
    if (askedFor.current === userId) return;
    askedFor.current = userId;
    setDismissed(false);
    let off = false;
    (async () => {
      const seen = await readSeen(userId);
      if (off) return;
      if (seen === null) {
        // No stored position. That is TWO different people wearing one absence:
        // somebody who signed up this morning, and somebody who has used Repple
        // for months and is simply running the first build that has this
        // feature at all. Local storage cannot tell them apart — it has nothing
        // either way — so this asks the server how old the account is.
        //
        // Getting this wrong in the old code meant the release that introduced
        // the changelog was the one release nobody was ever shown.
        let createdAt: string | null = null;
        try {
          const { data } = await supabase.auth.getUser();
          createdAt = data?.user?.created_at ?? null;
        } catch {
          // Unknown age. firstRunReleases treats that as "stamp silently",
          // which is the harmless direction: the cost is one missed changelog,
          // and the cost of guessing the other way is a sheet in front of every
          // new signup.
        }
        if (off) return;
        const first = firstRunReleases(createdAt, CURRENT_RELEASE, MY_AUDIENCE);
        // Stamped now only when there is nothing to show. When there IS, the
        // stamp waits for the dismissal, exactly as it does on every other
        // run — a sheet recorded as read before it was read is the same bug in
        // a different place.
        if (first.length === 0) void writeSeen(userId, CURRENT_RELEASE);
        setUnseen(first);
        return;
      }
      setUnseen(unseenReleases(seen, CURRENT_RELEASE, MY_AUDIENCE));
    })();
    return () => { off = true; };
  }, [userId]);

  const onClose = useCallback(() => {
    setDismissed(true);
    // Stamped on dismissal, not on display: a sheet that appeared behind
    // something else, or during a force-quit, was not read.
    if (userId) void writeSeen(userId, CURRENT_RELEASE);
  }, [userId]);

  return { visible: !hold && !dismissed && unseen.length > 0, releases: unseen, onClose };
}
