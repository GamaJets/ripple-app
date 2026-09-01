// Every sound this app can make, and the only way to make one.
//
// ── Why src/ui and not src/lib ─────────────────────────────────────────────
//
// src/lib is compiled a second time by tsconfig.test.json and run under plain
// node, where `require('expo-audio')` resolves to a package whose entry point
// calls requireNativeModule() and throws, and where `require('…/rest-over.wav')`
// is not a module at all. A file that cannot be loaded by the test compiler
// cannot live in the directory the test compiler walks. This belongs beside its
// neighbours anyway: haptics.ts, pushNotifications.ts and nativeModules.ts are
// the three other modules that own a native handle and hide it from screens,
// and this is the fourth. The pure half — the fallback rest, the countdown
// rule, and the consent latch that gates everything here — is in
// src/lib/restTimer.ts, which is where the tests are.
//
// ── Why expo-audio and not expo-av ─────────────────────────────────────────
//
// Checked rather than assumed. node_modules/expo/bundledNativeModules.json is
// the file the Expo CLI resolves `npx expo install` against for THIS SDK, and
// for expo 57.0.16 it lists `expo-audio: ~57.0.4` and does not list expo-av at
// all. expo-av's newest published version on npm is 16.0.8, which is the SDK
// 54 line — it has shipped nothing for 55, 56 or 57. So expo-av is not "the
// older option", it is a package with no build for the SDK this app is on.
//
// ── This adds a NATIVE MODULE, so it needs a new build ─────────────────────
//
// expo-audio ships an iOS podspec and an Android gradle module. It cannot
// arrive in an over-the-air update: an install made before the build that
// includes it has this file, has the settings toggle, has the timer, and has no
// audio code whatsoever. That is exactly the expo-video failure written up in
// src/ui/nativeModules.ts — clips listed, player absent, nothing played and no
// error to read, because the code that would have errored was not in the
// binary. `npm run check:native` lists expo-audio from the moment it is in
// package.json, and HAS_NATIVE_AUDIO below is the runtime half: on an older
// install every function here is a no-op and the rest timer goes on buzzing.
//
// ── The audio session, and the silent switch ───────────────────────────────
//
// Deliberate, and the deliberate choice is `playsInSilentMode: false` with
// `interruptionMode: 'mixWithOthers'`. In expo-audio's iOS layer
// (AudioModule.swift) that pair maps to AVAudioSession category `.ambient`,
// which is the category that OBEYS the physical mute switch. A gym is full of
// people who muted their phone on purpose, and a rest timer is not important
// enough to overrule them. `mixWithOthers` because the member is very likely
// playing music — see SessionMusicBar in the runner — and taking exclusive
// focus for a third of a second would pause their track and not resume it.
//
// The two are also not independently choosable: AudioUtils.validateAudioMode
// throws InvalidAudioModeException for `playsInSilentMode: false` combined with
// `duckOthers`, with `allowsRecording`, or with `shouldPlayInBackground`. So
// respecting the mute switch settles the rest of the mode, and the ducking that
// would otherwise be nicer than mixing is not available with it.
//
// The mode is re-applied before EVERY play, not once at startup, and that is
// not belt-and-braces. expo-video's VideoManager.setAudioSession() sets the
// shared session to `.playback` whenever a video plays and never puts it back —
// and the exercise demonstration plays inside the very same SessionRunner as
// this timer. Setting the mode once at launch would mean the first rest after a
// member watched a demo played through the speaker of a phone that is on
// silent, which is the one outcome this whole paragraph exists to prevent.
//
// ── Backgrounded ───────────────────────────────────────────────────────────
//
// It does not play. `shouldPlayInBackground` cannot be true here (see above),
// and iOS suspends a backgrounded app's JavaScript anyway, so the interval that
// would call playSound() is not running. The rest timer's whole point is that
// the phone is in a pocket, so the runner ALSO schedules a local notification
// for the instant the rest ends — see scheduleRestOverAlert in
// pushNotifications.ts. The notification is what makes a noise from a pocket;
// this module is what makes one when the screen is on. They are cancelled
// against each other so nobody gets both.
import { restSoundConsent } from '../lib/restTimer';
import { HAS_NATIVE_AUDIO } from './nativeModules';

// Required through try/catch, exactly like expo-haptics and expo-notifications
// in this directory. `import` would be evaluated at module scope, and
// expo-audio's entry point calls requireNativeModule('ExpoAudio'), which THROWS
// on a binary that predates the dependency — taking the whole workouts screen
// down rather than the sound.
let Audio: any = null;
try { Audio = require('expo-audio'); } catch { /* not in this build yet */ }

/**
 * The library. Every sound the app owns, in one place, with where it came from
 * written beside it.
 *
 * The provenance column is not decoration. These binaries are white-labelled
 * and sold to gyms under their own brand, and an audio file with no recorded
 * source looks exactly like one that has a licence until somebody asks. Both of
 * these are generated by scripts/build-rest-tones.mjs from sine waves this
 * repository computes — there is no third-party audio in the app and nothing to
 * attribute. See assets/sounds/README.md, and add a row here with a real source
 * and licence if that ever stops being true.
 *
 * The `require` calls are at module scope because Metro resolves asset requires
 * statically; a computed path would bundle nothing and fail only on a device.
 */
export const SOUND_LIBRARY = {
  restOver: {
    title: 'Rest Over',
    description: 'A rising two-note chime, played the moment a rest period ends.',
    provenance: 'Generated by scripts/build-rest-tones.mjs — sine waves at 880 Hz and 1318.51 Hz. No third-party audio, no licence to comply with.',
    source: require('../../assets/sounds/rest-over.wav'),
  },
  countdown: {
    title: 'Countdown Tick',
    description: 'One short tick, played at three, two and one second remaining.',
    provenance: 'Generated by scripts/build-rest-tones.mjs — a sine wave at 659.25 Hz. No third-party audio, no licence to comply with.',
    source: require('../../assets/sounds/countdown.wav'),
  },
} as const;

export type SoundName = keyof typeof SOUND_LIBRARY;

/** Whether this binary can make a sound at all. False on every install made
 *  before the build that added expo-audio, and on web. */
export const SOUNDS_AVAILABLE = HAS_NATIVE_AUDIO && !!Audio?.createAudioPlayer;

// One player per sound, created on first use and kept. Created rather than
// re-created because building a player decodes the file, and a rest timer that
// decoded a WAV at the instant it was supposed to make a noise would make it
// late — which for a cue is the same as making the wrong one.
const players = new Map<SoundName, any>();

// The last time each sound was actually started. A cue announces an event, and
// an event that happens once must not be announced twice: React can run an
// effect twice in development, an interval that fires at 500 ms sees the same
// second twice, and `logSet` and a re-render can both reach for the same tone.
// The pure rule in src/lib/restTimer.ts already makes the timer fire once; this
// is the backstop for every other caller that has not been written yet.
const lastPlayedAt = new Map<SoundName, number>();
const REPEAT_GUARD_MS = 150;

/**
 * Put the audio session into the mode described at the top of this file.
 *
 * Not awaited by callers and deliberately not awaited before play() either —
 * see playSound. Failure is silent because there is nothing a member could do
 * about it and nothing worth interrupting a workout to say.
 */
async function applyAudioMode(): Promise<void> {
  try {
    await Audio?.setAudioModeAsync?.({
      // The mute switch wins. See the long note above: this is the one setting
      // here that is about somebody else's evening rather than about audio.
      playsInSilentMode: false,
      // Forced by the line above — 'duckOthers' throws when combined with it —
      // and right anyway for a third-of-a-second cue over somebody's music.
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch { /* another app holds the session, or this build has no audio */ }
}

/** The player for a sound, built on first use. Null if anything at all went
 *  wrong — a missing asset, a binary without the module, a decoder that
 *  refused. A silent timer is a degraded timer; a crashed one loses the hour of
 *  training the runner is holding in memory. */
function playerFor(name: SoundName): any {
  if (!SOUNDS_AVAILABLE) return null;
  const existing = players.get(name);
  if (existing) return existing;
  try {
    const entry = SOUND_LIBRARY[name];
    if (!entry) return null;
    const p = Audio.createAudioPlayer(entry.source);
    players.set(name, p);
    return p;
  } catch { return null; }
}

/**
 * Play a sound, or do nothing, and never throw.
 *
 * Refuses when the member has turned the sound off, and refuses while the
 * answer is still 'unknown' — the reasoning for treating unknown as a refusal
 * is in src/lib/restTimer.ts next to the latch. No screen may pass an override:
 * there is exactly one way to make a noise in this app and it asks first, which
 * is what stops the next call site from being the one that forgot the toggle.
 *
 * Fire and forget. It returns void rather than a promise on purpose, because
 * every caller is a timer tick or a button handler and none of them has
 * anything sensible to do with a rejection.
 */
export function playSound(name: SoundName): void {
  if (restSoundConsent() !== 'yes') return;
  const now = Date.now();
  const last = lastPlayedAt.get(name) ?? 0;
  if (now - last < REPEAT_GUARD_MS) return;
  lastPlayedAt.set(name, now);
  const p = playerFor(name);
  if (!p) return;
  // The mode is applied first and NOT awaited before play(). Awaiting it would
  // put a native round trip between the zero on the clock and the noise, and
  // setAudioModeAsync applies to the session rather than to a player — the
  // ordering that matters is that it was requested before playback started, not
  // that it completed. A member who has just come back from a demo video may
  // get one cue on the old category; every one after it is on the right one.
  void applyAudioMode();
  try {
    // Rewound rather than restarted. A player that finished sits at the end of
    // the file, and play() there plays nothing at all — which is how a second
    // rest period ends in silence.
    p.seekTo?.(0)?.catch?.(() => {});
    p.play?.();
  } catch { /* the session was taken, or the file would not decode */ }
}

/**
 * Let the players go.
 *
 * Called when the guided session closes. Each player holds a decoded buffer and
 * a native object, and the runner is the only screen that makes sounds, so
 * holding them for the rest of the app's life is memory nobody is using. Safe
 * to call twice, and safe to call on a build with no audio.
 */
export function releaseSounds(): void {
  for (const [, p] of players) {
    try { p?.remove?.(); } catch { /* already gone */ }
  }
  players.clear();
  lastPlayedAt.clear();
}

/**
 * Build the players and set the session mode ahead of time.
 *
 * Called when the guided session OPENS, so the first chime does not pay for
 * decoding a file. Silent and harmless on a build without audio, and harmless
 * if the member has the sound switched off — priming a player they will never
 * hear costs a few kilobytes and means the switch works the moment they change
 * their mind mid-session.
 */
export function primeSounds(): void {
  if (!SOUNDS_AVAILABLE) return;
  void applyAudioMode();
  for (const name of Object.keys(SOUND_LIBRARY) as SoundName[]) playerFor(name);
}
