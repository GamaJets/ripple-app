"use strict";
// How long the rest between sets is, and when the timer is allowed to make a
// noise about it.
//
// Pure, and deliberately separate from the runner in app/(client)/workouts.tsx.
// Everything here is a decision that can be wrong in a way nobody would see on
// screen — a coach's "2" read as two seconds, a countdown cue that fires twice
// for the same second, a rest that silently becomes 90 because a field was left
// blank — and none of it is assertable while it lives inside a React component
// holding a wall clock.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COUNTDOWN_AT = exports.MIN_REST_SEC = exports.MAX_REST_SEC = exports.DEFAULT_REST_SEC = void 0;
exports.restSecondsFor = restSecondsFor;
exports.readRestSeconds = readRestSeconds;
exports.restClock = restClock;
exports.shouldTick = shouldTick;
exports.soundFromStored = soundFromStored;
exports.restSoundConsent = restSoundConsent;
exports.recordRestSoundConsent = recordRestSoundConsent;
exports.restSoundNote = restSoundNote;
/**
 * The rest used when nobody has said, in seconds.
 *
 * 90 because that is the number the runner has always passed to `startRest`
 * since it was written, so an existing programme's behaviour does not change
 * the day per-exercise rest lands. It is a FALLBACK and is labelled as one
 * everywhere it is shown: it is not a recommendation, and this file is not
 * entitled to make one about somebody else's training.
 */
exports.DEFAULT_REST_SEC = 90;
/**
 * The longest rest a coach may set, in seconds.
 *
 * Ten minutes. Not a judgement about training — heavy singles genuinely rest
 * that long — but a limit on typing accidents. The field takes seconds, and
 * "300" meaning five minutes is one keystroke away from "3000", which is fifty
 * minutes of a client sitting on a bench watching a timer that looks broken.
 */
exports.MAX_REST_SEC = 600;
/** The shortest. Under five seconds is not a rest, it is a typo or a zero that
 *  wandered off, and a timer that opens and closes within a set is noise. */
exports.MIN_REST_SEC = 5;
/**
 * The rest for this exercise, in seconds.
 *
 * `restSec` is optional on ProgramExercise for the same reason `loadKg` is —
 * most exercises have nothing said about them — so this is the one place that
 * decides what an absent value means, rather than each caller doing it again
 * slightly differently.
 *
 * Anything that is not a usable positive number falls back. A null, an
 * undefined, a NaN out of a parse that failed, an Infinity, a negative and a
 * zero all mean the same thing here: nobody set a rest for this movement.
 * Zero especially — `startRest(0)` is how the runner CLEARS the timer, so a
 * stored 0 taken literally would give an exercise a rest period that ends the
 * instant it begins and no sound would ever play for it.
 */
function restSecondsFor(ex, fallback = exports.DEFAULT_REST_SEC) {
    const v = ex?.restSec;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
        return fallback;
    return Math.min(exports.MAX_REST_SEC, Math.round(v));
}
/**
 * Read the rest field on the programme builder.
 *
 * Refused rather than coerced, exactly like `readLift` in src/lib/units.ts and
 * for the same reason: `parseInt(text, 10) || 0` is what a field like this gets
 * written with, and a mistyped rest silently becoming 0 does not look like an
 * error to anybody — it looks like an exercise the coach chose not to set a
 * rest for, which is a different sentence about their programme than the one
 * they meant.
 *
 * An EMPTY field is `{ ok: true, seconds: null }` and that is not the same as a
 * refusal. Blank is the ordinary case and means "no rest set for this one";
 * the client then falls back, and the screen says so.
 */
function readRestSeconds(text) {
    const s = (text ?? '').trim();
    if (!s)
        return { ok: true, seconds: null };
    // Whole seconds only. A decimal is either a slip or somebody typing minutes
    // into a seconds box, and rounding it would guess which.
    if (!/^\d+$/.test(s)) {
        return { ok: false, reason: 'Type the rest as a whole number of seconds, for example 90.' };
    }
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) {
        return { ok: false, reason: 'Type the rest as a whole number of seconds, for example 90.' };
    }
    if (n === 0) {
        // Said, not accepted. A coach who means "no rest" and a coach who has not
        // decided both end up with the same programme, and only one of them would
        // recognise it later.
        return { ok: false, reason: 'Leave the rest empty rather than setting it to 0 — an empty rest uses the app default of 90 seconds.' };
    }
    if (n < exports.MIN_REST_SEC) {
        return { ok: false, reason: `A rest under ${exports.MIN_REST_SEC} seconds is not long enough to time. Leave it empty if you do not want a rest timer.` };
    }
    if (n > exports.MAX_REST_SEC) {
        return { ok: false, reason: `That is over ${Math.round(exports.MAX_REST_SEC / 60)} minutes. Check the number — the box is in seconds, so three minutes is 180.` };
    }
    return { ok: true, seconds: n };
}
/** "1:30". The runner's own clock, so the label a coach reads while setting the
 *  rest is built by the same code as the digits a client watches count down. */
function restClock(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/**
 * The seconds remaining at which a countdown tick is played.
 *
 * Three, two, one — and never zero, because zero is the chime. A tick at zero
 * would double the moment it is counting towards, which is the same class of
 * bug as firing a haptic twice: a cue that announces something must happen
 * exactly as often as the thing.
 */
exports.COUNTDOWN_AT = [3, 2, 1];
/**
 * Should a countdown tick be played, given the seconds left now and the seconds
 * left the last time this was asked?
 *
 * Takes the PREVIOUS value rather than keeping one, because the caller is a
 * 500 ms interval that reads a wall clock: it sees the same second twice, and a
 * rule of "left is 3" would tick twice for every one of the three. It is the
 * TRANSITION that is the event.
 *
 * `prev` of null is a rest that has only just started, and nothing is played
 * for it however few seconds it has left — a coach who sets a 3 second rest
 * would otherwise get a tick the instant the set is logged.
 *
 * A backgrounded phone is the case this is really written for. iOS suspends the
 * interval, so a member who pockets the phone at 0:30 and takes it out at 0:00
 * gets one reading at 30 and the next at 0. Ticks for 3, 2 and 1 all became due
 * while nothing was running, and playing all three at once — or playing one,
 * late, after the rest is already over — is worse than playing none. So a jump
 * that skips a tick skips it for good.
 */
function shouldTick(left, prev) {
    if (prev == null)
        return false;
    // `left === prev - 1` rather than "left is in the list", and it is doing four
    // jobs at once, which is why there is no separate guard above it: the same
    // second read twice is not a crossing, a jump from 30 to 1 is not a crossing
    // either, time going backwards after a clock change is not one, and only a
    // second that was genuinely entered ticks.
    return left === prev - 1 && exports.COUNTDOWN_AT.includes(left);
}
/**
 * What the persisted settings blob says about the rest-timer sound.
 *
 * `raw` is exactly what AsyncStorage handed back for 'repple.settings'. Absent
 * and unreadable both resolve to 'yes', because that is the product default
 * (`DEFAULTS.restSound = true` in src/ui/settings.tsx) and because the switch on
 * the settings screen falls back to the same default when its own parse fails.
 * The two must agree: a screen rendering the switch ON over a module that was
 * silently refusing to play is the original defect pointing the other way.
 *
 * Only a real boolean `false` is a refusal. A string "false" is damage, not
 * somebody's answer, and src/ui/settings.tsx's own reader accepts booleans and
 * nothing else.
 */
function soundFromStored(raw) {
    if (raw == null)
        return 'yes';
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return 'yes';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return 'yes';
    const v = parsed.restSound;
    if (typeof v !== 'boolean')
        return 'yes';
    return v ? 'yes' : 'no';
}
// Starts 'unknown' because at module load nobody has read anything.
let soundAnswer = 'unknown';
/**
 * The answer, or 'unknown' while the stored one is still being read.
 *
 * 'unknown' is a REFUSAL for sound, and that is the opposite call from the one
 * push makes. Push refuses while unknown because asking the OS for a permission
 * cannot be taken back; sound refuses because a rest period only begins after a
 * set has been logged, minutes into a session, by which time the AsyncStorage
 * read has long landed — so refusing costs nobody a cue they wanted, and
 * guessing yes would play a noise in a quiet gym at somebody who had turned it
 * off and whose phone had simply not finished reading their answer.
 */
function restSoundConsent() { return soundAnswer; }
/** Record the answer, once it is known. Takes only 'yes' or 'no': a read
 *  landing or a member tapping the switch, neither of which can un-know an
 *  answer. Nothing may put the process back into 'unknown', because that would
 *  silence the timer for the rest of the session. */
function recordRestSoundConsent(answer) { soundAnswer = answer; }
/**
 * The sentence under the Rest Timer Sound switch.
 *
 * On an install made before expo-audio was added there is no audio code in the
 * binary at all, and a switch that offers a sound that build cannot make is the
 * expo-video defect again — a control for a feature that is not there, with
 * nothing on screen admitting it. That case says so and names the fix, which is
 * a new build rather than anything the member can do here.
 *
 * ── WHY THE WORKING SENTENCE IS PER-PLATFORM ───────────────────────────────
 *
 * It named the MUTE SWITCH on every platform, and an Android phone does not
 * have one. The first handset this feature was ever put on — a Motorola Edge 60
 * Fusion — has no such control anywhere on it, so the single sentence the app
 * offers to explain a silent chime pointed at a piece of hardware the member
 * cannot find, and the fault they would report is "the toggle is on and it
 * never makes a noise".
 *
 * The BEHAVIOUR is right on both, and it is one behaviour described twice.
 * `playsInSilentMode: false` maps on iOS to AVAudioSession category `.ambient`,
 * which obeys the physical mute switch. expo-audio implements the same flag on
 * Android against the RINGER: AudioModule.kt gates `play()` on
 * `playsInSilentMode || audioManager.ringerMode == RINGER_MODE_NORMAL`, and a
 * RingerModeReceiver pauses anything already sounding the moment the ringer
 * leaves normal. So on Android the chime goes quiet when the phone is on silent
 * OR ON VIBRATE — the right call in a gym, and what this now says out loud.
 *
 * Both versions also state the pocket limit rather than letting people discover
 * it: when the app is not on screen it is a notification that arrives, not the
 * chime, which is why it is silent on a phone whose notifications are switched
 * off. Neither limit is a defect, and both are the kind of thing somebody would
 * otherwise report as one.
 */
function restSoundNote(available, platform) {
    if (!available) {
        return 'This version of the app was installed before sounds were added, so it can only buzz. A newer build restores the chime.';
    }
    const pocket = 'while the app is in your pocket it arrives as a notification instead.';
    if (platform === 'android') {
        // No mute switch exists on this platform to point at. expo-audio maps
        // `playsInSilentMode: false` to the RINGER here, so silent and vibrate both
        // suppress the chime — see the note above.
        return `A chime when your rest between sets is over. It goes quiet when your phone is on silent or vibrate, and ${pocket}`;
    }
    if (platform !== 'ios') {
        // Anything that is not a handset. There is no mute switch and no ringer to
        // name, and inventing one would be the same mistake in a third direction —
        // so this describes the rule rather than the control.
        return `A chime when your rest between sets is over. It follows however this device has been silenced, and ${pocket}`;
    }
    return 'A chime when your rest between sets is over. It follows your phone\u2019s mute switch, and while the app is in your pocket it arrives as a notification instead.';
}
