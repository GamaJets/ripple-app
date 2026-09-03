// Referral attribution: the code, the person it belongs to, and what happened
// to the people who used it.
//
// ── What was broken here ───────────────────────────────────────────────────
//
// A new user could enter a friend's code at signup and `record_referral` stored
// (referred_user, code). Nothing stored WHOSE code it was. The code was derived
// on the phone — a first name, a dash, and four base-36 characters of a hash of
// the user's id — and the server had never seen that derivation, so a referral
// was a row carrying a string rather than a link between two people. Nothing
// could be credited to anybody, and the Invite screen said as much: the header
// admitted a referral "can be credited once reward attribution is wired on the
// backend".
//
// It is wired now (supabase/parts/128-a-cohort-and-a-credit.sql). The server
// owns the code, derives it with the same algorithm this file's screen used, and
// records the referrer on the row. There is still no reward, and the screen says
// so plainly rather than promising one — see REWARD_NOTE in ./referralCredit.
//
// ── Why the code now comes from the server ─────────────────────────────────
//
// `my_referral_code()` takes no argument. That is the whole security of it: a
// caller cannot ask for a code, only be given theirs, so nobody can register a
// string they watched somebody else share and inherit the referrals it earns.
// It produces the identical string the phone used to derive for the same
// person, so codes already in the wild keep working.
//
// Everything here is best-effort and OTA-safe. Nothing throws at a screen: a
// read that failed returns null, which is a distinct value from zero and from
// an empty list, and ./referralCredit turns each of those into a different
// sentence.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RawReferral } from './referralCredit';

const PENDING_KEY = 'repple.pendingRef';

/** Record the signed-in user as referred by `code` (idempotent per user).
 *
 *  The server resolves the code to a referrer, refuses a self-referral, and
 *  keeps the FIRST code recorded for a user — somebody arrived once, and which
 *  invitation brought them is not a thing they get to revise later. */
export async function recordReferral(code: string): Promise<void> {
  const c = (code || '').trim();
  if (!USE_SUPABASE || !c) return;
  try { await supabase.rpc('record_referral', { p_code: c }); } catch { /* ignore */ }
}

/** Stash a code entered during a confirm-by-email signup, to record on first sign-in. */
export async function stashPendingReferral(code: string): Promise<void> {
  const c = (code || '').trim();
  if (!c) return;
  try { await AsyncStorage.setItem(PENDING_KEY, c); } catch { /* ignore */ }
}

/**
 * Whatever a referral link left for us, or null. Does NOT consume it.
 *
 * Read by the sign-up form so the field arrives already filled in: the whole
 * point of `repple://join?r=CODE` is that nobody has to remember six characters
 * through an App Store install, and a stash the form cannot see would carry the
 * code invisibly while still showing an empty box that reads as "no code".
 *
 * Not consumed here, because being SHOWN a code is not the same as having spent
 * it — somebody who opens the form, gets distracted and comes back tomorrow must
 * still be attributed. `flushPendingReferral` is the only thing that clears it,
 * and only after a sign-in.
 */
export async function peekPendingReferral(): Promise<string | null> {
  try {
    const c = await AsyncStorage.getItem(PENDING_KEY);
    return c && c.trim() ? c.trim() : null;
  } catch { return null; }
}

/** After a successful sign-in, record any code stashed at signup, then clear it. */
export async function flushPendingReferral(): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    const c = await AsyncStorage.getItem(PENDING_KEY);
    if (c) { await recordReferral(c); await AsyncStorage.removeItem(PENDING_KEY); }
  } catch { /* ignore */ }
}

/**
 * The caller's own referral code, created on the server the first time it is
 * asked for.
 *
 * Null means it could not be read — NEVER a fallback code invented here. A code
 * derived locally and shown to a user is a code the server has not registered,
 * so anything a friend does with it is attributed to nobody, and the screen
 * would have handed somebody a string that quietly does not work. Better to
 * show nothing and say why.
 */
export async function myReferralCode(): Promise<string | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.rpc('my_referral_code');
    if (error) return null;
    const code = typeof data === 'string' ? data.trim() : '';
    return code || null;
  } catch { return null; }
}

/**
 * Everyone who arrived with the caller's code: a first name, when they joined,
 * and when they logged their first workout (null if they never have).
 *
 * Null for a failed read, which the screen renders as "we could not check" —
 * an empty array here means the code has genuinely brought nobody in yet, and
 * those two must not share a rendering. See src/ui/loadStatus.ts.
 */
/**
 * The ceiling `my_referrals()` takes, mirrored here so a read that came back at
 * it can be reported as a prefix rather than as the whole guest list.
 *
 * It is written INSIDE the function (supabase/parts/128-a-cohort-and-a-credit
 * .sql, `limit 200`), which is what makes it invisible from this side:
 * src/lib/rowCap.ts works by asking for one row more than it will accept, and
 * the server can never answer with 201 no matter what `.limit()` says. So
 * `capped()`, `assertWhole()` and `isTruncated()` are all blind to it and a
 * cut list arrives looking exactly like a complete one.
 *
 * src/ui/coachReferrals.ts has mirrored this same number as `ROW_CAP` for the
 * coach half of this feature since it was written — its comment even says "it
 * is the same limit `my_referrals()` uses" — and the member half never got it.
 * The test is `>= cap` and not the `> cap` used everywhere else, because 200
 * rows back from a `limit 200` is already the ceiling: there is no probe row to
 * find. That over-reports the member who has exactly two hundred, and telling
 * them their list may go on when it does not is the small wrong. The big one is
 * the other way round.
 */
export const REFERRAL_ROW_CAP = 200;

export async function myReferrals(): Promise<RawReferral[] | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.rpc('my_referrals');
    if (error) return null;
    return Array.isArray(data) ? (data as RawReferral[]) : null;
  } catch { return null; }
}

export interface ReferralSummary { joined: number; converted: number }

/**
 * How many joined with the code, and how many of those have started training.
 *
 * Read separately from the list rather than counted from it. `my_referrals()`
 * returns at most 200 rows; the summary is computed over all of them
 * server-side, so a long list cannot turn a total into a subtotal presented as
 * a total (src/lib/rowCap.ts is the same failure arriving through PostgREST's
 * silent 1000-row cap).
 */
export async function myReferralSummary(): Promise<ReferralSummary | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.rpc('my_referral_summary');
    if (error) return null;
    // A `returns table` function of one row arrives as an array of one object.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const joined = Number((row as any).joined);
    const converted = Number((row as any).converted);
    // Number(null) and Number('') are both 0, and a zero here is the sentence
    // "nobody has used your code". Only a real pair of counts is a summary.
    if (!Number.isFinite(joined) || !Number.isFinite(converted)) return null;
    return { joined, converted };
  } catch { return null; }
}
