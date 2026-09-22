// Part 3320's copy and routing. Compile with tsc, run with node.
import {
  ASSESSMENT_TITLE, REPLY_TITLE, REPORT_TITLE, assessmentBody, communityRoute, replyBody, replyNotifies, reportBody,
} from './communityNotify';
import { notificationChannel } from './notifyDispatch';
import { REPORT_REASONS } from './community';
import { safeRoute } from './notifyInbox';

const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

eq(assessmentBody('Back Squat', true), 'Back Squat · See how it compares with last time', 'a repeat test compares');
eq(assessmentBody('Movement Screen', false), 'Movement Screen · See your first result', 'a first test has nothing to compare with');
eq(replyBody('Sam'), 'Sam replied to your post.', 'the replier is named');
eq(replyBody('  '), 'Someone replied to your post.', 'a blank name is not a blank sentence');
eq(reportBody('comment', 'hate'), 'A comment was reported for hate speech. Open Community to review it.', 'reason in words');
eq(reportBody('post', 'other'), 'A post was reported for another reason. Open Community to review it.', 'other reads naturally');

eq(replyNotifies('a', 'a', []), false, 'your own reply is silent');
eq(replyNotifies('a', 'b', []), true, 'a reply reaches the author');
eq(replyNotifies('a', 'b', [{ blocker: 'a', blocked: 'b' }]), false, 'a blocked replier notifies nothing');
eq(replyNotifies('a', 'b', [{ blocker: 'b', blocked: 'a' }]), false, 'nor does one who blocked the author');

for (const role of ['client', 'trainer', 'owner'] as const) {
  const r = communityRoute(role);
  eq(notificationChannel(r, REPLY_TITLE), 'clients', `${r} has a channel, so the dispatcher pushes it`);
  eq(safeRoute(r, role), r, `${r} is followable by the ${role} build`);
}
eq(notificationChannel('/(client)/assessments', ASSESSMENT_TITLE), 'clients', 'an assessment has a channel');
eq(safeRoute('/(client)/assessments', 'client'), '/(client)/assessments', 'and opens Assessments');

// Every reason the app offers has words, not the fallback.
for (const { key } of REPORT_REASONS) {
  if (key !== 'other') ok(!/another reason/.test(reportBody('post', key)), `reason '${key}' has its own words`);
}

// The SQL is the sender. Its literals must be these.
const sql = readFileSync('supabase/parts/3320-assessments-and-community-reach-a-phone.sql', 'utf8');
for (const s of [ASSESSMENT_TITLE, REPLY_TITLE, REPORT_TITLE, 'See how it compares with last time', 'See your first result',
  ' replied to your post.', '. Open Community to review it.', 'hate speech', 'sexual content', 'another reason',
  '/(client)/assessments', '/(client)/community', '/(trainer)/community', '/(owner)/community']) {
  ok(sql.includes(s), `part 3320 says '${s}'`);
}
ok(!/—/.test(sql.replace(/^\s*--.*$/gm, '')), 'no em dash in anything the part writes');

if (errors.length) {
  console.error(`communityNotify.test.ts: ${errors.length} failures:`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
