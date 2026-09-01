#!/usr/bin/env node
// Generate the app's sound library, so its provenance is arithmetic.
//
// ── Why the tones are computed rather than downloaded ──────────────────────
//
// The alternative was a sound file off the internet, and the way that goes
// wrong is not that somebody notices — it is that nobody does. A .wav with no
// recorded licence sits in assets/ looking exactly like a .wav that has one,
// ships in a binary sold to gyms under their own brand, and the first person to
// ask where it came from is the person asking for money. scripts/
// check-attribution.mjs exists because that already nearly happened with the
// exercise catalogue.
//
// Every sample below is the value of a sine at a frequency this file names.
// There is no recording, no sample pack and no third party: the provenance of
// assets/sounds/*.wav is this script, and re-running it reproduces them byte
// for byte. assets/sounds/README.md says so beside the files.
//
// ── Why WAV and not MP3 ────────────────────────────────────────────────────
//
// Uncompressed PCM has no encoder to license and no decoder latency, and these
// are a third of a second each — the compression would save perhaps 20 KB and
// cost the one thing the cue has to be, which is immediate. Metro's default
// assetExts already includes wav (metro-config/src/defaults/defaults.js), so no
// bundler configuration hangs on this choice.
//
//   node scripts/build-rest-tones.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44100;          // CD rate; the phone resamples if it wants to
const BITS = 16;             // signed little-endian PCM
const CHANNELS = 1;          // mono: this is a cue, not music

/**
 * One note, as an array of floats in -1..1.
 *
 * The envelope is not decoration. A sine that starts at full amplitude on
 * sample zero is a step change in air pressure, which is a click — audible as a
 * spit before the note on every speaker, and worst on the tinny one a phone has.
 * So amplitude ramps in over `attack` and decays exponentially to silence,
 * which is also roughly what a struck object does and therefore what a person
 * hears as a chime rather than as a beep from a machine.
 */
function note(freq, seconds, { attack = 0.006, decay = 5.5, gain = 0.5 } = {}) {
  const n = Math.round(seconds * RATE);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const tt = i / RATE;
    const rampIn = Math.min(1, tt / attack);
    // Exponential decay, and forced to exactly 0 at the final sample. Without
    // that last touch the note ends on a non-zero value, which is the same step
    // change as the missing attack and clicks in the same way.
    const env = rampIn * Math.exp(-decay * tt) * (1 - i / (n - 1));
    out[i] = Math.sin(2 * Math.PI * freq * tt) * env * gain;
  }
  return out;
}

/** Silence, for the gap between the two notes of the chime. */
const rest = (seconds) => new Float64Array(Math.round(seconds * RATE));

function concat(parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Float samples → a RIFF/WAVE file. */
function wav(samples) {
  const bytesPerSample = BITS / 8;
  const dataBytes = samples.length * bytesPerSample * CHANNELS;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);                                  // PCM fmt chunk size
  buf.writeUInt16LE(1, 20);                                   // 1 = uncompressed PCM
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * CHANNELS * bytesPerSample, 28);    // byte rate
  buf.writeUInt16LE(CHANNELS * bytesPerSample, 32);           // block align
  buf.writeUInt16LE(BITS, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    // Clamped before scaling. A float above 1 wraps round to a large negative
    // 16-bit integer, which is not a loud sample, it is a bang.
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// ── The two sounds ─────────────────────────────────────────────────────────
//
// A5 (880 Hz) then E6 (1318.51 Hz) — a rising fifth, which is the interval
// every appliance in a kitchen uses to say "finished" and reads as an ending
// rather than as an alarm. High, because a gym is loud below 500 Hz: fans,
// plates, other people's music, and a phone speaker cannot compete down there.
//
// The countdown tick is a single lower note (E5, 659.25 Hz) at half the volume
// and a third of the length. It has to be recognisably NOT the end-of-rest
// sound, or three ticks followed by the chime is four sounds that all mean
// "go" — so it is quieter, shorter and lower, and the thing it is counting
// towards is the only one that rises.
const SOUNDS = {
  'rest-over.wav': concat([
    note(880.0, 0.16, { gain: 0.55 }),
    rest(0.035),
    note(1318.51, 0.30, { gain: 0.55, decay: 4.0 }),
  ]),
  'countdown.wav': note(659.25, 0.09, { gain: 0.28, decay: 9.0 }),
};

const dir = join(process.cwd(), 'assets', 'sounds');
mkdirSync(dir, { recursive: true });
for (const [name, samples] of Object.entries(SOUNDS)) {
  const buf = wav(samples);
  writeFileSync(join(dir, name), buf);
  console.log(`${name.padEnd(18)} ${(samples.length / RATE).toFixed(3)}s  ${buf.length} bytes`);
}
console.log('\nwritten to assets/sounds/ — see the README there for provenance.');
