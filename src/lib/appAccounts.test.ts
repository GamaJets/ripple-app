// Tests for appAccounts — who on a gym's roster the app can actually reach.
//
// The four things being pinned are all refusals to overstate:
//
//   · a membership is an account, because the schema cannot record one without
//     an account behind it, and two memberships held by one person are one
//     person;
//   · an invitation that was accepted is NOT counted as somebody outside the
//     app — they are the membership row, and counting both is the double-count
//     the module's own copy warns the owner about;
//   · a truncated read counts as nothing. 'partial' is not 'ready', and the
//     error it would make here is the flattering one: fewer people shown as
//     unreachable than there are;
//   · a failed invitations read still lets the membership half answer, because
//     withholding a true count to protect a question nobody asked is its own
//     kind of wrong.
//
// Compile with tsc, run with node.
import {
  appAccountSplit, offAppWithheld, APP_ACCOUNT_LABEL, APP_ACCOUNT_MEANS, COUNTS_ARE_NOT_A_TOTAL,
  type AppAccount,
} from './appAccounts';
import { sliceReady, sliceFailed, slicePartial, sliceLoading } from './memberView';
import type { Membership } from './gymRecord';
import type { MemberInvite } from './memberInvites';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-13T10:00:00Z');

const member = (id: string, memberId: string | null, name: string | null): Membership => ({
  id,
  // The column is nullable live (part 184) while the type still says string.
  memberId: memberId as string,
  memberName: name,
  planId: null,
  planName: null,
  startedOn: '2026-01-01',
  endsOn: null,
  status: 'active',
  frozenFrom: null,
  frozenTo: null,
});

const invite = (
  id: string, email: string, status: MemberInvite['status'], expiresAt: string | null,
): MemberInvite => ({
  id,
  tenantId: 't1',
  email,
  fullName: null,
  planId: null,
  planName: null,
  invitedBy: null,
  token: null,
  status,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt,
  acceptedAt: status === 'accepted' ? '2026-08-10T00:00:00Z' : null,
  acceptedBy: status === 'accepted' ? 'u9' : null,
});

const OPEN = '2026-12-01T00:00:00Z';
const GONE = '2026-08-30T00:00:00Z';

/* ── a membership is an account, and a person is not two of them ──────────── */
{
  const s = appAccountSplit(
    sliceReady([member('m1', 'u1', 'Ada'), member('m2', 'u1', 'Ada'), member('m3', 'u2', 'Bo')]),
    sliceReady([]),
    NOW,
  );
  eq(s.counts.onTheApp, 2, 'two memberships held by one person are one account on the app');
  eq(s.counts.accountErased, 0, 'and nobody erased, over a read that landed whole');
  eq(s.offTheApp?.length, 0, 'an all-account roster leaves nobody outside the app');
}

/* ── the erased account, which both halves used to drop ───────────────────── */
{
  const s = appAccountSplit(
    sliceReady([member('m1', 'u1', 'Ada'), member('m2', null, 'Cal')]),
    sliceReady([]),
    NOW,
  );
  eq(s.counts.onTheApp, 1, 'a membership with no account behind it is not an account');
  eq(s.counts.accountErased, 1, 'it is counted as what it is');
  eq(s.offTheApp?.[0].state, 'account-erased', 'and it is listed as unreachable');
  eq(s.offTheApp?.[0].email, null, 'with no address, because there is not one — a blank is not an address');
}

/* ── an accepted invitation is the member, not a second person ────────────── */
{
  const s = appAccountSplit(
    sliceReady([member('m1', 'u9', 'Dee')]),
    sliceReady([invite('i1', 'dee@example.com', 'accepted', OPEN)]),
    NOW,
  );
  eq(s.counts.onTheApp, 1, 'the account holder is counted once');
  eq(s.counts.invited, 0, 'and an accepted invitation is nobody waiting outside the app');
  eq(s.offTheApp?.length, 0, 'so nothing is listed to chase');
}

/* ── open, expired and withdrawn are three different sentences ────────────── */
{
  const s = appAccountSplit(
    sliceReady([]),
    sliceReady([
      invite('i1', 'open@example.com', 'pending', OPEN),
      invite('i2', 'late@example.com', 'pending', GONE),
      invite('i3', 'gone@example.com', 'revoked', OPEN),
    ]),
    NOW,
  );
  eq(s.counts.invited, 1, 'one invitation is still in flight');
  eq(s.counts.inviteLapsed, 2, 'an expired one and a withdrawn one both need sending again');
  eq(s.offTheApp?.find((p) => p.key === 'i2')?.invite, 'expired',
    'the expiry is named rather than folded into "lapsed"');
  eq(s.offTheApp?.find((p) => p.key === 'i3')?.invite, 'revoked', 'and so is a withdrawal');
}

/* ── one address chased twice is one person, and the open one wins ────────── */
{
  const s = appAccountSplit(
    sliceReady([]),
    sliceReady([
      invite('i1', 'Twice@Example.com ', 'pending', GONE),
      invite('i2', 'twice@example.com', 'pending', OPEN),
    ]),
    NOW,
  );
  eq(s.counts.invited, 1, 'the same address invited twice is one person waiting');
  eq(s.counts.inviteLapsed, 0, 'and the lapsed one does not also count them');
  eq(s.offTheApp?.length, 1, 'one row to act on, not two');
}

/* ── an address that will never arrive is kept, not dropped ───────────────── */
{
  const s = appAccountSplit(
    sliceReady([]),
    sliceReady([invite('i1', 'not an address', 'pending', OPEN)]),
    NOW,
  );
  eq(s.counts.invited, 1, 'an unparseable address is still an invitation that was made');
  eq(s.offTheApp?.[0].email, 'not an address',
    'shown as typed, because that is the thing to fix');
}

/* ── 'partial' is not 'ready', in the flattering direction ────────────────── */
{
  const s = appAccountSplit(
    slicePartial([member('m1', 'u1', 'Ada')], 1000),
    slicePartial([invite('i1', 'a@example.com', 'pending', OPEN)], 1000),
    NOW,
  );
  eq(s.counts.onTheApp, null, 'a prefix of the roster is not a count of the roster');
  eq(s.counts.invited, null, 'nor is a prefix of the invitations');
  eq(s.offTheApp, null, 'and a list somebody works through is never a prefix of itself');
}

/* ── one read failing does not blank the other ────────────────────────────── */
{
  const s = appAccountSplit(
    sliceReady([member('m1', 'u1', 'Ada')]),
    sliceFailed('the invitations were refused'),
    NOW,
  );
  eq(s.counts.onTheApp, 1, 'the membership half still answers');
  eq(s.counts.invited, null, 'the invitation half does not');
  eq(s.offTheApp, null, 'and the list waits for both, because a short one is worked through as if it were whole');

  const why = offAppWithheld(sliceReady([member('m1', 'u1', 'Ada')]), sliceFailed('boom'));
  ok(!!why && why.includes('the invitations could not be read'),
    'the sentence names the read that is missing');
  ok(!!why && why.includes('rather than nobody being outside the app'),
    'and says what the empty list is not');
  eq(offAppWithheld(sliceReady([]), sliceReady([])), null, 'nothing to say when both landed');
  ok((offAppWithheld(sliceLoading(), sliceLoading()) ?? '').includes('reading'),
    'a read still in flight says so rather than reading as a refusal');
}

/* ── the copy ─────────────────────────────────────────────────────────────── */
{
  const states: AppAccount[] = ['on-the-app', 'invited', 'invite-lapsed', 'account-erased'];
  for (const st of states) {
    ok(APP_ACCOUNT_LABEL[st].length > 0, `${st} has a label`);
    ok(APP_ACCOUNT_MEANS[st].length > 20, `${st} says what it means in a sentence`);
  }
  ok(COUNTS_ARE_NOT_A_TOTAL.includes('overstate'),
    'the note says what adding the two columns would do, rather than only forbidding it');
}

if (errors.length) {
  console.error(`appAccounts: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('appAccounts ok');
