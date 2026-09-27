// The two attachment kinds that are not a picture: a voice note, and a file.
//
// One component file because both chat screens draw both, and the pair of them
// were about to become four copies — which is how a coach's bubble and a
// member's bubble come to disagree about what "Open" does.
//
// ── What a file card may claim ─────────────────────────────────────────────
//
// The name is the SENDER'S text, cleaned by `attachmentName` in
// src/lib/messageAttachments.ts and rendered as text and nothing else. It is
// never made into a link, never parsed for an extension this app then asserts
// something about, and never used to decide how to open the thing — the
// storage key decides that, and the key is ours.
//
// Opening hands the signed URL to the OS. That is deliberate and is the only
// safe way to do it: this app has no PDF renderer, a WebView pointed at
// somebody else's document is a browser with an unclear origin, and the OS
// viewer is the one piece of software on the phone that is actually built to
// open a stranger's PDF. The URL expires (MESSAGE_MEDIA_TTL_S), so a link
// forwarded out of this app stops working.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useTheme } from './components';
import { Icon } from './Icon';
import { reportError } from '../lib/reportError';
import { MIN_TARGET, hitSlopFor } from '../lib/a11y';
import { sp, radius, type as ty, font } from '../theme/scale';

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
function player(uri: string): { play: () => void; pause: () => void; release: () => void } | null {
  try {
    const m = require('expo-audio');
    if (!m?.createAudioPlayer) return null;
    const p = m.createAudioPlayer({ uri });
    return {
      play: () => { try { p.play(); } catch (e) { reportError('voiceBubble.play', e); } },
      pause: () => { try { p.pause(); } catch { /* a pause that fails is a sound that keeps going, not a crash */ } },
      release: () => { try { p.remove?.(); } catch { /* nothing to do about it */ } },
    };
  } catch {
    return null;
  }
}

/**
 * A voice note, as a play button and nothing else.
 *
 * No waveform: this app has no sample data for a remote file and a drawn one
 * would be decoration pretending to be information. No transcript, for the
 * reason src/ui/voiceNote.ts gives.
 */
export function VoiceNoteBubble({ url, label }: { url: string; label: string }) {
  const t = useTheme();
  const [playing, setPlaying] = useState(false);
  const p = useRef<ReturnType<typeof player>>(null);

  useEffect(() => {
    p.current = player(url);
    return () => { p.current?.release(); p.current = null; };
  }, [url]);

  const toggle = () => {
    if (!p.current) return;
    if (playing) { p.current.pause(); setPlaying(false); return; }
    p.current.play();
    setPlaying(true);
  };

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityState={{ selected: playing }}
      accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
      hitSlop={hitSlopFor(MIN_TARGET)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: sp.sm,
        minHeight: MIN_TARGET, paddingHorizontal: sp.md, paddingVertical: sp.sm,
        borderRadius: radius.sm, backgroundColor: t.surface2, alignSelf: 'flex-start',
      }}
    >
      {/* The icon set is deliberately short and has no pause glyph, so the
          state is carried by the WORD — which is the channel that works for
          somebody who cannot tell two small shapes apart anyway. */}
      <Icon name="play" size={18} color={t.ink} />
      <Text style={{ ...ty.label, ...font('600'), color: t.ink }}>
        {playing ? 'Playing… Tap to Stop' : 'Voice Note'}
      </Text>
    </Pressable>
  );
}

/**
 * A file, as its name and a way to open it.
 *
 * The name is drawn on one line and truncated in the middle of the component
 * rather than by this app rewriting the string: a filename shortened into the
 * data is a filename somebody cannot check against what they sent.
 */
export function FileBubble({ url, name }: { url: string; name: string | null }) {
  const t = useTheme();
  const [said, setSaid] = useState<string | null>(null);
  // Never the raw name as the only thing said: a file with no name still has
  // to be openable, and "Open" on its own is not a label.
  const shown = name ?? 'A file';

  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <Pressable
        onPress={async () => {
          setSaid(null);
          try {
            const ok = await Linking.canOpenURL(url);
            if (!ok) { setSaid('Your phone has nothing that opens this file.'); return; }
            await Linking.openURL(url);
          } catch (e) {
            reportError('fileBubble.open', e);
            setSaid('That file could not be opened. It may have expired — pull down to refresh the conversation.');
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${shown}`}
        hitSlop={hitSlopFor(MIN_TARGET)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: sp.sm, maxWidth: 260,
          minHeight: MIN_TARGET, paddingHorizontal: sp.md, paddingVertical: sp.sm,
          borderRadius: radius.sm, backgroundColor: t.surface2,
        }}
      >
        <Icon name="grid" size={18} color={t.ink} />
        <Text numberOfLines={1} style={{ ...ty.label, ...font('600'), color: t.ink, flexShrink: 1 }}>{shown}</Text>
      </Pressable>
      {said ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs, maxWidth: 260 }}>{said}</Text> : null}
    </View>
  );
}
