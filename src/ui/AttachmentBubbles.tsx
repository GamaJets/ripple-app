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
/**
 * The player, wrapped so the BUBBLE is told when the sound ends.
 *
 * Nothing used to tell it. `playing` was set on the tap and cleared only by a
 * second tap, so a forty-second note left the button reading "Playing… Tap to
 * Stop" for the rest of the conversation, and the tap that followed paused a
 * player already sitting at its end — two taps to hear it again, with the first
 * doing nothing audible. `onEnd` is the fix, and `play` rewinds first for the
 * same reason: a player left at the end plays silence.
 */
function player(uri: string, onEnd: () => void): {
  play: () => void; pause: () => void; release: () => void;
} | null {
  try {
    const m = require('expo-audio');
    if (!m?.createAudioPlayer) return null;
    const p = m.createAudioPlayer({ uri });
    // Guarded: this is an optional part of the module's surface, and a build
    // without it should lose the auto-reset rather than the playback.
    let sub: { remove?: () => void } | null = null;
    try {
      sub = p.addListener?.('playbackStatusUpdate', (st: { didJustFinish?: boolean }) => {
        if (st?.didJustFinish) onEnd();
      }) ?? null;
    } catch { /* no listener, so the button is cleared by the next tap as before */ }
    return {
      play: () => {
        // Rewind, then play. `seekTo` is a promise on expo-audio and the
        // rejection is of no interest: the worst case is the note replaying
        // from wherever it was paused, which is what a pause means anyway.
        try { void p.seekTo?.(0)?.catch?.(() => {}); } catch { /* as above */ }
        try { p.play(); } catch (e) { reportError('voiceBubble.play', e); }
      },
      pause: () => { try { p.pause(); } catch { /* a pause that fails is a sound that keeps going, not a crash */ } },
      release: () => {
        try { sub?.remove?.(); } catch { /* nothing to do about it */ }
        try { p.remove?.(); } catch { /* nothing to do about it */ }
      },
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
    let live = true;
    // Through the `live` flag: the listener outlives nothing, but a status
    // update that arrives while the screen is unmounting would otherwise set
    // state on a gone component.
    p.current = player(url, () => { if (live) setPlaying(false); });
    return () => { live = false; p.current?.release(); p.current = null; };
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
            setSaid('That file could not be opened. The link may have expired, so pull down to refresh the conversation.');
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

/**
 * The bar that says the microphone is open, and the only way to close it.
 *
 * Recording starts from inside an action sheet, and once the sheet closed there
 * was NOTHING on screen to say it had started: no counter, no indicator, and no
 * stop — to end a take somebody had to find the attach menu again and tap an
 * item still labelled "Record a Voice Note", which reads as starting another
 * one. `useVoiceNote` returned `recording` and `seconds` all along and neither
 * composer drew them.
 *
 * A microphone that is open with nothing on screen saying so is the defect
 * src/ui/voiceNote.ts calls "a microphone left open in a gym". The cap stops it
 * at three minutes either way; this is what makes the first three minutes
 * visible.
 */
export function RecordingBar({ seconds, onStop, max }: {
  seconds: number; onStop: () => void; max: number;
}) {
  const t = useTheme();
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Recording. ${seconds} ${seconds === 1 ? 'second' : 'seconds'} so far. It stops itself at ${Math.round(max / 60)} minutes.`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: sp.md,
        padding: sp.md, borderRadius: radius.md, backgroundColor: t.surface,
        borderWidth: 1, borderColor: t.warn,
      }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.warn }} />
      <Text style={{ ...ty.body, ...font('600'), color: t.ink, flex: 1 }}>
        {`Recording · ${mmss(seconds)}`}
      </Text>
      <Pressable onPress={onStop} accessibilityRole="button"
        accessibilityLabel="Stop recording and keep what you have said"
        hitSlop={hitSlopFor(MIN_TARGET)}
        style={{ minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: sp.md }}>
        <Text style={{ ...ty.label, ...font('700'), color: t.ink }}>Stop</Text>
      </Pressable>
    </View>
  );
}
