// Naming, ordering and reporting a coach's join codes.
//
// Pure, and separate from the RPCs that create and spend them, so the rules
// below can be asserted on without a database — src/lib/joinCode.ts already
// holds the rules for the six characters themselves, and this holds the rules
// for the SET of codes a coach now owns.
//
// The thing this file exists to get right is the sentence under each code.
// A join code's whole purpose is answering "which of the things I did worked?",
// and a count is the one part of that answer that can be silently wrong. Under a
// failed or truncated read the honest output is a dash: a coach who is shown
// "0 joined" for their flyer will conclude the flyer failed and stop printing
// it, and nothing on the screen would ever tell them the read did not complete.
// See src/ui/loadStatus.ts — an empty answer under 'error' means UNKNOWN.
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

/** Longest label the server accepts — create_join_code raises past this. */
export const MAX_LABEL = 40;

/** Most live codes one coach may hold, matching create_join_code's cap. */
export const MAX_LIVE_CODES = 20;

/** A row of my_join_codes(), as PostgREST hands it back. */
export type RawJoinCode = {
  id: string | null;
  code: string | null;
  label: string | null;
  created_at: string | null;
  revoked_at: string | null;
  is_default: boolean | null;
  joined: number | string | null;
  pending: number | string | null;
};

/** The same row, once it is safe to render. */
export type JoinCodeRow = {
  /** null for the default code, which lives on `trainers`, not in the table. */
  id: string | null;
  code: string;
  label: string;
  isDefault: boolean;
  /** False once revoked: it still resolves for attribution, but accepts nobody. */
  isLive: boolean;
  createdAt: string | null;
  joined: number;
  pending: number;
};

/**
 * What the coach typed → what to send as a label.
 *
 * Collapses runs of whitespace, because "Gym  flyer" and "Gym flyer" are the
 * same campaign to everybody except a duplicate check comparing strings, and a
 * coach who lands two live codes called the same thing has counts they cannot
 * attribute — the failure this whole feature exists to remove, arrived at from
 * the inside.
 */
export function normaliseLabel(input: string | null | undefined): string {
  return (input || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

/**
 * Why this label cannot be used, or null if it can.
 *
 * These mirror what `create_join_code` raises. The server stays the authority —
 * two devices can create codes at once and only it sees both — but a coach
 * should not have to make a round trip to be told they left the name blank, and
 * a raised Postgres exception is not a sentence anybody wants to read.
 *
 * `liveLabels` are the labels of codes that are still live. Revoked ones are
 * deliberately not compared: reusing last January's campaign name this January
 * is ordinary, and the server allows it.
 */
export function labelProblem(input: string | null | undefined, liveLabels: string[]): string | null {
  const clean = normaliseLabel(input);
  if (!clean) return 'Give the code a name, so you can tell later which one worked.';
  if ((input || '').replace(/\s+/g, ' ').trim().length > MAX_LABEL) {
    return `Keep the name to ${MAX_LABEL} characters or fewer.`;
  }
  const taken = liveLabels.some((l) => normaliseLabel(l).toLowerCase() === clean.toLowerCase());
  if (taken) return `You already have a live code called “${clean}”. Turn that one off first, or pick another name.`;
  return null;
}

/** Whether another code may be created, matching the server's cap. */
export function canCreateCode(rows: JoinCodeRow[]): boolean {
  return rows.filter((r) => r.isLive && !r.isDefault).length < MAX_LIVE_CODES;
}

const count = (v: number | string | null | undefined): number => {
  // PostgREST returns bigint as a STRING, because a bigint does not survive
  // JSON.parse intact. Number('') is 0 and Number(null) is 0, so both would
  // arrive as a confident zero; only a finite number is a count.
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/**
 * Raw rows → rows worth rendering, in the order they should be read.
 *
 * The default code first, because it is the one already printed on cards and in
 * bios; then live codes newest first, because the one a coach just made for the
 * thing they are doing today is the one they came here to look at; then revoked
 * ones last, kept visible because their counts are the record of what worked.
 *
 * A row with no code is dropped rather than drawn blank. `trainers.join_code` is
 * nullable and my_join_codes() already declines to emit a default row without
 * one, but a blank under the words "your code" is something a coach would read
 * out to somebody standing in front of them.
 */
export function shapeJoinCodes(rows: RawJoinCode[] | null | undefined): JoinCodeRow[] {
  const out: JoinCodeRow[] = [];
  for (const r of rows || []) {
    const code = (r?.code || '').trim().toUpperCase();
    if (!code) continue;
    const isDefault = !!r.is_default;
    out.push({
      id: r.id ?? null,
      code,
      label: normaliseLabel(r.label) || (isDefault ? 'Your main code' : code),
      isDefault,
      isLive: !r.revoked_at,
      createdAt: r.created_at ?? null,
      joined: count(r.joined),
      pending: count(r.pending),
    });
  }
  return out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (at !== bt) return bt - at;
    // Two codes made in the same millisecond, or two rows with no timestamp:
    // fall back to the code itself so the list does not reorder between reads.
    return a.code.localeCompare(b.code);
  });
}

/**
 * The line under one code.
 *
 * Under anything but 'ready' this states no figure. 'partial' cannot arise from
 * my_join_codes() today — it returns at most twenty-one rows and counts server
 * side, well inside PostgREST's cap — and it is still handled, because the
 * status is the provider's claim about whether what it holds is all of it, and
 * a screen that prints a total under a status saying otherwise is wrong the day
 * that changes rather than the day somebody notices.
 */
export function codeCountLine(status: LoadStatus, row: JoinCodeRow): string {
  if (status === 'loading') return 'Counting who has used it…';
  if (status === 'error') return 'We couldn’t check how many people have used it.';
  if (status === 'partial') return '— joined · — waiting: not all of your requests could be read.';
  if (row.joined === 0 && row.pending === 0) {
    return row.isLive ? 'Nobody has used it yet.' : 'Nobody used it.';
  }
  const joined = `${num(row.joined)} joined with it`;
  return row.pending ? `${joined} · ${num(row.pending)} waiting on you` : `${joined}.`;
}

/**
 * What to say about the default code's counts, which are not only its own.
 *
 * my_join_codes() attributes to the default row every code join that no NAMED
 * code claims — including joins made with a default code since rotated away,
 * whose string no longer exists anywhere. Those clients did arrive by code and
 * dropping them would shrink a coach's history every time they pressed "New
 * Code". The number is therefore right about the code PATH and not about the
 * six characters printed beside it, and saying so is the difference between a
 * figure and a misleading one.
 */
export const DEFAULT_CODE_NOTE =
  'Counts every join by code that no named code below claims, including codes this one has replaced.';

/**
 * The client-facing message for a failure only named codes can produce.
 *
 * Returns null for everything else so the caller falls through to
 * joinErrorMessage in src/lib/joinCode.ts, which owns the rest.
 */
export function spentCodeMessage(raw: string | null | undefined): string | null {
  const m = (raw || '').toLowerCase();
  if (m.includes('no longer in use')) {
    return 'That code has been turned off by the coach who gave it to you. Ask them for a current one — it is not a typo.';
  }
  return null;
}
