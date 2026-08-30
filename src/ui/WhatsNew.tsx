// What changed since the version you last opened.
//
// Shown once per version, on the first launch after an update, and reachable
// any time from Settings. The content is `src/lib/releaseNotes.ts`, which also
// produces the App Store text — so what a tester reads in TestFlight and what
// they read in the app are the same sentences.
//
// Deliberately not shown on a fresh install: `unseenReleases` returns nothing
// for a null "last seen", because opening an app for the first time to a list
// of things that used to be broken is a poor introduction to it.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Cta } from './kit';
import { sp, layout, radius, hairline, type as ty } from '../theme/scale';
import { APP_VERSION } from './appFeedback';
import { RELEASES, unseenReleases, releasesFor, MY_AUDIENCE, type Release } from '../lib/releaseNotes';
import { reportError } from '../lib/reportError';

const SEEN_KEY = 'repple.whatsNew.lastSeenVersion';

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
 * The sheet. `force` opens it from Settings with the full history rather than
 * only what is unseen.
 */
export function WhatsNewSheet({ visible, force, onClose }: { visible: boolean; force?: boolean; onClose: () => void }) {
  const t = useTheme();
  const [unseen, setUnseen] = useState<Release[]>([]);

  useEffect(() => {
    if (!visible) return;
    if (force) { setUnseen(releasesFor(MY_AUDIENCE, RELEASES)); return; }
    (async () => {
      let seen: string | null = null;
      try { seen = await AsyncStorage.getItem(SEEN_KEY); } catch { /* treated as a fresh install */ }
      setUnseen(unseenReleases(seen, APP_VERSION, MY_AUDIENCE));
    })();
  }, [visible, force]);

  const dismiss = useCallback(async () => {
    // Stamp the CURRENT version, not the newest release listed: the point is
    // "you have seen what this build brought", and a build can ship before its
    // notes are written.
    try { await AsyncStorage.setItem(SEEN_KEY, APP_VERSION); } catch (e) { reportError('whatsNew.seen', e); }
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={dismiss} accessibilityLabel="Close" />
        <View style={{
          backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
          paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: sp.xxl, maxHeight: '84%',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.sm }}>
            <Icon name="sparkle" size={16} color={t.brand} />
            <Text style={{ ...ty.micro, color: t.ink3 }}>Version {APP_VERSION}</Text>
          </View>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>What’s New</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {unseen.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.xl }}>
                Nothing new since you last opened Repple.
              </Text>
            ) : <Body releases={unseen} />}
          </ScrollView>
          <View style={{ marginTop: sp.lg }}>
            <Cta label="Got It" wide onPress={dismiss} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Decides whether to show the sheet on launch, and remembers the answer.
 *
 * Returns the props for <WhatsNewSheet>. Mount once, high up, inside the auth
 * provider — there is nothing to tell somebody who is not signed in yet.
 */
export function useWhatsNew(signedIn: boolean) {
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!signedIn || checked) return;
    let off = false;
    (async () => {
      let seen: string | null = null;
      try { seen = await AsyncStorage.getItem(SEEN_KEY); } catch { /* fresh install */ }
      if (off) return;
      setChecked(true);
      if (seen === null) {
        // First run since this feature shipped, or a fresh install. Record the
        // current version silently so the NEXT update is the first one they
        // are told about — showing a changelog to somebody who has never seen
        // the old behaviour explains nothing.
        try { await AsyncStorage.setItem(SEEN_KEY, APP_VERSION); } catch { /* shown again next launch, which is harmless */ }
        return;
      }
      if (unseenReleases(seen, APP_VERSION, MY_AUDIENCE).length > 0) setVisible(true);
    })();
    return () => { off = true; };
  }, [signedIn, checked]);

  return { visible, onClose: () => setVisible(false) };
}
