// ── The in-session music bar (TF-36) ─────────────────────────────────────────
//
// A self-contained control surface for a running workout: what is playing, and
// previous / play-pause / next. Drop it into any screen with
//
//     import { SessionMusicBar } from '../../src/lib/SessionMusicBar';
//     …
//     <SessionMusicBar />
//
// It lives under src/lib rather than src/ui only because the workout screen is
// owned elsewhere and this had to be mountable without touching it. It takes no
// props and holds no state belonging to the session.
//
// Every state it can be in says which one it is. That is the whole design: the
// reason "Spotify won't connect" was reported at all is that a Spotify app in
// development mode hands a tester a valid token and then 403s every request,
// and the old screen answered that with silence. A bar that renders nothing
// when playback is refused would repeat the bug in a smaller box, so each
// failure gets one honest line and, where there is one, the action that fixes
// it. Transport buttons are hidden — not disabled-and-lying — whenever the
// account cannot actually drive playback.
import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '../ui/Icon';
import { useTheme } from '../ui/components';
import { sp, radius, hairline, type as ty } from '../theme/scale';
import {
  spotifyStatus, spotifyNowPlaying, spotifyPlay, spotifyPause, spotifyNext, spotifyPrevious,
  SpotifyError, spotifyConfigured, type NowPlaying,
} from './spotify';
import { progressLine } from './spotifyPlayback';

/** How often the bar re-reads the player. Spotify's own clients poll at about
 *  this rate; faster burns the development-mode quota for no visible gain. */
const POLL_MS = 8000;

type Phase = 'loading' | 'off' | 'reconnect' | 'ready' | 'failed';

export function SessionMusicBar() {
  const t = useTheme();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** True only when a failure means the transport buttons genuinely cannot work. */
  const [transportDead, setTransportDead] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const st = await spotifyStatus();
      if (!alive.current) return;
      if (!st.connected) { setPhase('off'); return; }
      if (st.needsReconnect) { setPhase('reconnect'); return; }
      const np = await spotifyNowPlaying();
      if (!alive.current) return;
      setNow(np);
      setProblem(null);
      setTransportDead(false);
      setPhase('ready');
    } catch (e) {
      if (!alive.current) return;
      const err = e instanceof SpotifyError ? e : null;
      // "Nothing is on a device yet" is not a broken connection — the person
      // just has to press play once in Spotify. It keeps the transport hidden
      // but does not claim the account is refused.
      setTransportDead(!!err && (err.kind === 'not_allowlisted' || err.kind === 'premium_required' || err.kind === 'signed_out' || err.kind === 'no_device'));
      setProblem(err ? err.message : 'Could not read Spotify.');
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => { alive.current = false; clearInterval(id); };
  }, [refresh]);

  const command = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      if (!alive.current) return;
      const err = e instanceof SpotifyError ? e : null;
      setTransportDead(!!err && (err.kind === 'not_allowlisted' || err.kind === 'premium_required' || err.kind === 'signed_out'));
      setProblem(err ? err.message : 'Spotify refused that.');
      setPhase('failed');
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [refresh]);

  // Nothing at all is wired up in this build; a bar offering a connection that
  // cannot exist would be the same lie in a different place.
  if (!spotifyConfigured()) return null;

  const shell = {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: sp.md,
    paddingVertical: sp.md, paddingHorizontal: sp.md,
    backgroundColor: t.surface2, borderRadius: radius.sm,
    borderWidth: hairline, borderColor: t.ring,
  };

  if (phase === 'loading') {
    return (
      <View style={shell}>
        <ActivityIndicator size="small" color={t.ink3} />
        <Text style={{ ...ty.label, color: t.ink3 }}>Reading Spotify…</Text>
      </View>
    );
  }

  if (phase === 'off' || phase === 'reconnect') {
    const line = phase === 'off'
      ? 'Connect Spotify to control music without leaving the session.'
      : 'Reconnect Spotify — this version needs playback permission, which the old sign-in did not grant.';
    return (
      <Pressable onPress={() => router.push('/(client)/music')} accessibilityRole="button" accessibilityLabel="Open music settings" style={shell}>
        <Icon name="play" size={17} color={t.ink3} />
        <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{line}</Text>
        <Icon name="chevron" size={15} color={t.ink3} />
      </Pressable>
    );
  }

  if (phase === 'failed') {
    return (
      <View style={[shell, { alignItems: 'flex-start' }]}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, marginTop: 6 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Spotify</Text>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: 3 }}>{problem}</Text>
          {!transportDead ? (
            <Pressable onPress={refresh} accessibilityRole="button" style={{ marginTop: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  // ready
  if (!now) {
    return (
      <View style={shell}>
        <Icon name="play" size={17} color={t.ink3} />
        <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>Nothing playing. Start a track in Spotify and it appears here.</Text>
        <Pressable onPress={() => command(() => spotifyPlay())} accessibilityRole="button" accessibilityLabel="Resume Spotify" disabled={busy}>
          <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Resume</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={shell}>
      {now.artUrl
        ? <Image source={{ uri: now.artUrl }} style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: t.surface3 }} />
        : <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: t.surface3, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="play" size={16} color={t.ink3} />
          </View>}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{now.title}</Text>
        <Text numberOfLines={1} style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {(now.artist ?? '—') + ' · ' + progressLine(now.progressMs, now.durationMs)}
        </Text>
      </View>
      <Pressable onPress={() => command(spotifyPrevious)} disabled={busy} accessibilityRole="button" accessibilityLabel="Previous track" hitSlop={8}>
        <Icon name="back" size={18} color={t.ink2} />
      </Pressable>
      <Pressable
        onPress={() => command(now.isPlaying ? spotifyPause : () => spotifyPlay())}
        disabled={busy} accessibilityRole="button"
        accessibilityLabel={now.isPlaying ? 'Pause' : 'Play'}
        style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
        {busy ? <ActivityIndicator size="small" color={t.brandInk} /> : <Icon name={now.isPlaying ? 'minus' : 'play'} size={16} color={t.brandInk} />}
      </Pressable>
      <Pressable onPress={() => command(spotifyNext)} disabled={busy} accessibilityRole="button" accessibilityLabel="Next track" hitSlop={8}>
        <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="back" size={18} color={t.ink2} /></View>
      </Pressable>
    </View>
  );
}

export default SessionMusicBar;
