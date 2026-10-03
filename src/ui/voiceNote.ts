// Recording a voice note for a message thread.
//
// ── Why this exists at all ─────────────────────────────────────────────────
//
// Explaining why a knee caves takes forty seconds to say and four paragraphs
// to type, and a coach standing on a gym floor between clients types neither.
// Every messaging product a coach already uses records audio; ours answered
// with a text box. supabase/parts/3360 opened the bucket and the check
// constraint; this is the recorder in front of it.
//
// ── What it refuses to do ──────────────────────────────────────────────────
//
// It does not transcribe. A transcript is this app's reading of somebody's
// words about somebody else's body, and a wrong one is worse than none — the
// recipient plays the recording, which is the thing that was actually said.
//
// It does not record in the background and it stops itself at
// `MESSAGE_AUDIO_MAX_SECONDS`. A recorder that runs until somebody remembers
// it is a microphone left open in a gym, and a five-minute note arriving on a
// phone is a thing the other person puts off listening to. The cap is applied
// by stopping, not by refusing afterwards: a take that is discarded for being
// too long is a take somebody has to do again.
//
// ── The module is required, not imported ───────────────────────────────────
//
// Same shape src/ui/sounds.ts uses and for the same reason: `expo-audio` has
// no usable entry point under plain node, and this file is reachable from a
// test tree that runs there. A static import would take the whole module graph
// down at require time; a guarded require leaves recording unavailable and the
// screen saying so.
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../lib/reportError';
import { MESSAGE_AUDIO_MAX_SECONDS } from '../lib/messageAttachments';

/** What a finished recording is, in the shape the composer already sends. */
export interface RecordedNote {
  uri: string;
  seconds: number;
}

interface Recorder {
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  uri: string | null;
}

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
function audioModule(): {
  useAudioRecorder: (preset: unknown) => Recorder;
  RecordingPresets: Record<string, unknown>;
  requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
  setAudioModeAsync: (mode: Record<string, unknown>) => Promise<void>;
} | null {
  try {
    const m = require('expo-audio');
    return m?.useAudioRecorder ? m : null;
  } catch {
    return null;
  }
}

/**
 * The recorder, as a screen needs it: whether it is running, how long for, and
 * two functions.
 *
 * `stop` resolves with the take, or null when there is nothing worth sending —
 * a recording under a second is a mis-tap, and sending one is a notification
 * for silence.
 */
export function useVoiceNote(onAutoStop?: (note: RecordedNote) => void): {
  /** False when this build has no audio module. The button is not drawn. */
  available: boolean;
  recording: boolean;
  /**
   * Between the tap and the first sample.
   *
   * `prepareToRecordAsync` is not instant — on a simulator it took MINUTES —
   * and until it resolves there is no recorder, no counter and nothing on
   * screen. Measured 3 Oct 2026 by tapping "Record a Voice Note" and watching
   * nothing happen, then tapping twice more, which is what anybody would do.
   */
  starting: boolean;
  /** Whole seconds so far, for the counter beside the button. */
  seconds: number;
  start: () => Promise<string | null>;
  stop: () => Promise<RecordedNote | null>;
} {
  const mod = useRef(audioModule()).current;
  const recorder = mod ? mod.useAudioRecorder(mod.RecordingPresets.HIGH_QUALITY) : null;
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef(0);
  /** Guards against a SECOND start while the first is still preparing.
   *
   *  Without it, every extra tap queued another `prepareToRecordAsync`, and
   *  each one that resolved reset `startedAt` and set `recording` again — so
   *  the counter kept dropping back to 0:00 and `stop()` lost a race against
   *  the next queued start, which is why the Stop button appeared dead. A ref
   *  rather than the state above because two taps in the same tick must both
   *  see it. */
  const inFlight = useRef(false);
  const stopRef = useRef<(() => Promise<RecordedNote | null>) | null>(null);
  /** Through a ref so the timer below always calls the CURRENT handler: the
   *  interval is armed once per recording and a screen that re-renders while
   *  it runs would otherwise be handed its first render's closure. */
  const onAutoStopRef = useRef(onAutoStop);
  onAutoStopRef.current = onAutoStop;

  const stop = useCallback(async (): Promise<RecordedNote | null> => {
    if (!recorder || !recording) return null;
    setRecording(false);
    try {
      await recorder.stop();
    } catch (e) {
      reportError('voiceNote.stop', e);
      return null;
    }
    const took = Math.round((Date.now() - startedAt.current) / 1000);
    const uri = recorder.uri;
    // A take under a second is a mis-tap on the button, and sending it would
    // put a notification on somebody's phone for silence.
    if (!uri || took < 1) return null;
    return { uri, seconds: took };
  }, [recorder, recording]);
  stopRef.current = stop;

  // The cap, applied by stopping. The timer is also what draws the counter, so
  // there is one clock rather than two that can disagree.
  useEffect(() => {
    if (!recording) { setSeconds(0); return; }
    const id = setInterval(() => {
      const took = Math.round((Date.now() - startedAt.current) / 1000);
      setSeconds(took);
      if (took >= MESSAGE_AUDIO_MAX_SECONDS) {
        // The take is HANDED BACK, not discarded. `stop()` resolves with the
        // recording and this used to throw that away with `void`, so a coach
        // who talked for the full three minutes watched the recorder stop and
        // nothing arrive — the one outcome this module's header promises will
        // not happen ("a take that is discarded for being too long is a take
        // somebody has to do again").
        void stopRef.current?.().then((note) => { if (note) onAutoStopRef.current?.(note); });
      }
    }, 500);
    return () => clearInterval(id);
  }, [recording]);

  const start = useCallback(async (): Promise<string | null> => {
    if (!mod || !recorder) return 'This build cannot record audio.';
    // Already recording, or already on the way there. Not an error: the person
    // tapped twice because the first tap said nothing, which is now fixed at
    // the other end by `starting`.
    if (inFlight.current) return null;
    inFlight.current = true;
    setStarting(true);
    try {
      const perm = await mod.requestRecordingPermissionsAsync();
      if (!perm?.granted) {
        return 'Recording needs access to your microphone. You can turn it on in Settings.';
      }
      // Without this the recording is silent on iOS when the app was last
      // playing something, which is a take somebody has to discover is empty.
      await mod.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setSeconds(0);
      setRecording(true);
      return null;
    } catch (e) {
      reportError('voiceNote.start', e);
      return 'The recorder could not be started. Try again.';
    } finally {
      // Cleared in both directions, or a failed start would lock the button
      // for the rest of the session.
      inFlight.current = false;
      setStarting(false);
    }
  }, [mod, recorder]);

  return { available: !!recorder, recording, starting, seconds, start, stop };
}
