// Turning what somebody types into the number Twilio will actually text.
//
// Pure, so the rules below can be asserted on without a device or a network.
//
// ── The trunk zero ────────────────────────────────────────────────────────
//
// This is the bug that would otherwise ship. Across most of the world people
// write their mobile number with a leading zero — 050 767 1842 in the UAE,
// 07700 900123 in the UK — because that zero is what you dial DOMESTICALLY. It
// is a trunk prefix, not part of the number. E.164 has no trunk prefix, so:
//
//     +971 0507671842   is not a number and never reaches anyone
//     +971 507671842    is the number
//
// Somebody typing their own number correctly, as they have written it their
// whole life, gets silence. They would retype it, get silence again, and
// conclude the app is broken — which, for them, it is. So the zero is stripped
// on the way to E.164, and the display format puts it back, because a UAE
// number shown as 50 767 1842 does not look like anyone's number to them.

import { retryLine, type Reach } from './reachability';

export interface Country {
  /** ISO 3166-1 alpha-2, used for the flag and as the stable key. */
  iso: string;
  name: string;
  /** Dial prefix without the plus. */
  dial: string;
  /** Digits AFTER the dial code, trunk zero excluded. A range where it varies. */
  len: [number, number];
}

/**
 * Deliberately not every country. This list leads with the ones a Gulf gym's
 * membership actually comes from; `COUNTRIES` is searchable in the picker and
 * anything missing can still be typed in full with a +.
 */
export const COUNTRIES: Country[] = [
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', len: [9, 9] },
  { iso: 'GB', name: 'United Kingdom',       dial: '44',  len: [10, 10] },
  { iso: 'US', name: 'United States',        dial: '1',   len: [10, 10] },
  { iso: 'SA', name: 'Saudi Arabia',         dial: '966', len: [9, 9] },
  { iso: 'IN', name: 'India',                dial: '91',  len: [10, 10] },
  { iso: 'PK', name: 'Pakistan',             dial: '92',  len: [10, 10] },
  { iso: 'PH', name: 'Philippines',          dial: '63',  len: [10, 10] },
  { iso: 'EG', name: 'Egypt',                dial: '20',  len: [10, 10] },
  { iso: 'ZA', name: 'South Africa',         dial: '27',  len: [9, 9] },
  { iso: 'AU', name: 'Australia',            dial: '61',  len: [9, 9] },
  { iso: 'CA', name: 'Canada',               dial: '1',   len: [10, 10] },
  { iso: 'IE', name: 'Ireland',              dial: '353', len: [9, 9] },
  { iso: 'FR', name: 'France',               dial: '33',  len: [9, 9] },
  { iso: 'DE', name: 'Germany',              dial: '49',  len: [10, 11] },
  { iso: 'LB', name: 'Lebanon',              dial: '961', len: [7, 8] },
  { iso: 'JO', name: 'Jordan',               dial: '962', len: [9, 9] },
  { iso: 'KW', name: 'Kuwait',               dial: '965', len: [8, 8] },
  { iso: 'QA', name: 'Qatar',                dial: '974', len: [8, 8] },
  { iso: 'BH', name: 'Bahrain',              dial: '973', len: [8, 8] },
  { iso: 'OM', name: 'Oman',                 dial: '968', len: [8, 8] },
];

/**
 * What `toE164` and friends assume when a CALLER states no country.
 *
 * A last resort inside this file, not a default for the SCREEN. It is 'AE'
 * because the list above leads with the Gulf and the first entry has to be
 * something; it is never a claim about the person holding the phone.
 *
 * `app/phone-signin.tsx` used to seed its picker with this, which turned a
 * fallback into an answer: a UK member typed their number the way they always
 * write it, got `+9717700900123`, no text arrived, and nothing on screen
 * explained why — a guess dressed up as a choice, one country over. That screen
 * now asks the handset. See `initialCountry` below and src/lib/locale.ts on why
 * this product has no region to assume.
 */
export const DEFAULT_COUNTRY = 'AE';

export function countryFor(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0];
}

/**
 * The country to open the picker on, given what the handset says its region is.
 *
 * Pure, and takes the region rather than reading it, so the rule can be argued
 * with in a test instead of inferred from whichever machine the test runs on.
 * `deviceRegion()` in src/lib/unitPreference.ts is the impure half and is
 * already written and already guarded.
 *
 * A region this list does not carry falls back rather than inventing an entry:
 * the picker is searchable and a full +international number can always be
 * typed, so being on the wrong row is recoverable in a way that a dial code
 * this file has never verified is not.
 */
export function initialCountry(region: string | null | undefined): string {
  const iso = String(region || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return DEFAULT_COUNTRY;
  return COUNTRIES.some((c) => c.iso === iso) ? iso : DEFAULT_COUNTRY;
}

/**
 * What to show in the empty number field.
 *
 * The screen printed the literal "50 767 1842" — a UAE mobile — whatever
 * country was selected, so a member in London was shown an example that is not
 * a number in their country and does not have the right number of digits. This
 * says the one thing that is true of every country on the list and is checked
 * by `isPlausiblePhone`: how many digits go after the dial code.
 */
export function nationalPlaceholder(c: Country): string {
  const [lo, hi] = c.len;
  return lo === hi ? `${lo} digits` : `${lo}–${hi} digits`;
}

/** The flag emoji for an ISO code, derived rather than stored. */
export function flagFor(iso: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso)) return '';
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Just the digits. */
export function digitsOnly(s: string): string {
  return (s || '').replace(/\D+/g, '');
}

/**
 * The national part, with the trunk zero removed.
 *
 * Only ONE leading zero is dropped, and only when something follows it: "0" on
 * its own is somebody mid-type, not a trunk prefix, and "00" is an
 * international prefix that `toE164` handles separately.
 */
export function stripTrunkZero(national: string): string {
  const d = digitsOnly(national);
  return d.length > 1 && d.startsWith('0') ? d.replace(/^0+/, '') : d;
}

/**
 * What the user typed → E.164, or null when it cannot be one.
 *
 * Accepts three shapes, because all three are things people type:
 *   +971507671842   already international
 *   00971507671842  the international prefix used across Europe and the Gulf
 *   0507671842      national, with the trunk zero, in `iso`'s country
 */
export function toE164(input: string, iso: string = DEFAULT_COUNTRY): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  const c = countryFor(iso);

  // Already international, in either notation.
  let intl: string | null = null;
  if (raw.startsWith('+')) intl = digitsOnly(raw);
  else if (digitsOnly(raw).startsWith('00')) intl = digitsOnly(raw).slice(2);

  if (intl) {
    // E.164 allows at most 15 digits, and a country code is at least one.
    if (intl.length < 8 || intl.length > 15) return null;
    return '+' + intl;
  }

  const national = stripTrunkZero(raw);
  if (!national) return null;
  const [lo, hi] = c.len;
  if (national.length < lo || national.length > hi) return null;
  const full = c.dial + national;
  if (full.length > 15) return null;
  return '+' + full;
}

/** Whether this is worth sending. The server is still the authority. */
export function isPlausiblePhone(input: string, iso: string = DEFAULT_COUNTRY): boolean {
  return toE164(input, iso) !== null;
}

/**
 * E.164 → something a person recognises as their own number.
 *
 * Puts the trunk zero back for countries that use one, because +971 50 767 1842
 * is correct and unfamiliar, while 050 767 1842 is what they would write down.
 */
export function formatNational(e164: string, iso: string = DEFAULT_COUNTRY): string {
  const c = countryFor(iso);
  const d = digitsOnly(e164);
  const national = d.startsWith(c.dial) ? d.slice(c.dial.length) : d;
  if (!national) return e164;
  // The US and Canada do not use a trunk zero; everywhere else in this list does.
  const trunk = c.dial === '1' ? '' : '0';
  const grouped = national.length > 6
    ? `${national.slice(0, national.length - 7)} ${national.slice(-7, -4)} ${national.slice(-4)}`.trim()
    : national;
  return (trunk + grouped).trim();
}

/** For "we sent a code to …" — never invent formatting we are unsure of. */
export function maskedForDisplay(e164: string): string {
  const d = digitsOnly(e164);
  if (d.length < 5) return e164;
  return `+${d.slice(0, d.length - 4).replace(/\d(?=\d{2})/g, '•')}${d.slice(-4)}`;
}

/** The OTP length Supabase issues. */
export const OTP_LENGTH = 6;

export function isCompleteOtp(code: string): boolean {
  return digitsOnly(code).length === OTP_LENGTH;
}

/**
 * Turn a Supabase phone-auth failure into something the person can act on.
 *
 * The generic ones matter here: an SMS that does not arrive is the single most
 * common support message any OTP flow gets, and "Invalid login credentials"
 * tells somebody nothing about what to do next.
 *
 * ── `opts`, and why the reach comes IN rather than being read here ─────────
 *
 * This file's header claims it is pure so the rules can be asserted on without
 * a device or a network, and that claim is worth keeping: `currentReach()` is a
 * module singleton that changes under a test's feet. So the caller — which is
 * src/ui/auth.tsx, in the catch, one line after the request that filed the
 * verdict through `observedFetch` — reads it and passes it in.
 *
 * `reach` defaults to 'unknown', and `retryLine('unknown')` is the sentence
 * this function printed unconditionally before: a caller who says nothing gets
 * exactly what it used to say, and claims nothing it cannot support.
 *
 * `step` exists because the last line is shared by two operations that fail
 * differently. It said "The code could not be sent" for BOTH — so a code that
 * was typed in and could not be CHECKED told somebody no code had gone out,
 * and sent them back to ask for another one they did not need.
 */
export function phoneAuthError(
  raw: string | null | undefined,
  opts: { reach?: Reach; step?: 'send' | 'check' } = {},
): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('token has expired') || m.includes('expired')) {
    return 'That code has expired. Ask for a new one.';
  }
  if (m.includes('invalid') && (m.includes('otp') || m.includes('token') || m.includes('credentials'))) {
    return 'That code was not right. Check the last message — codes are six digits, and a new one replaces the old.';
  }
  if (m.includes('rate') || m.includes('too many') || m.includes('over_sms_send_rate_limit')) {
    return 'Too many codes requested. Wait a minute before asking for another.';
  }
  if (m.includes('invalid phone') || m.includes('phone number')) {
    return 'That does not look like a mobile number. Check the country and try again.';
  }
  if (m.includes('signups not allowed') || m.includes('phone_provider_disabled')) {
    return 'Signing in by phone is not switched on yet. Use your email and password for now.';
  }
  // Nothing recognised and nothing said. `retryLine` is then the whole of what
  // is knowable — and it is the reason "Check your connection and try again"
  // is no longer printed here regardless of what happened. See
  // src/lib/reachability.ts.
  if (raw?.trim()) return raw.trim();
  const head = opts.step === 'check' ? 'That code could not be checked.' : 'No code was sent.';
  return `${head} ${retryLine(opts.reach ?? 'unknown')}`;
}
