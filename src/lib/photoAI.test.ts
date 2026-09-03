// A photograph does not go to a third party on the strength of a camera
// permission. Compile with tsc, run with node.
import {
  consentFromStored, storedConsent, mayAnalyzePhoto, PHOTO_AI_KEY,
  PHOTO_SENT, PHOTO_NOT_SENT, PHOTO_DESTINATION, type PhotoConsent,
} from './photoAI';
import { COACH_SHARE_KEY } from './coachShare';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── nothing but a recorded yes is a yes ────────────────────────────────── */

eq(consentFromStored('yes'), 'yes', 'a recorded yes is a yes');
eq(consentFromStored('no'), 'no', 'a recorded no is a no');
eq(consentFromStored(null), 'unasked', 'nothing stored is unasked, never yes');
eq(consentFromStored(undefined), 'unasked', 'an absent read is unasked');
eq(consentFromStored(''), 'unasked', 'an empty value is unasked');
eq(consentFromStored('YES'), 'unasked', 'a value we did not write is not somebody’s permission');
eq(consentFromStored('{"consent":"yes"}'), 'unasked', 'nor is a shape from another version');
eq(consentFromStored(storedConsent('yes')), 'yes', 'what we write, we read back');
eq(consentFromStored(storedConsent('no')), 'no', 'both ways');

/* ── the gate ───────────────────────────────────────────────────────────── */

for (const c of ['yes', 'no', 'unasked', 'unknown'] as PhotoConsent[]) {
  ok(!mayAnalyzePhoto(c, false).allowed, `the reader being off refuses ${c} before consent is even considered`);
  eq(mayAnalyzePhoto(c, false).block, 'off', `and says which refusal it is for ${c}`);
}
ok(mayAnalyzePhoto('yes', true).allowed, 'a member who said yes on a build with a reader may send one');
eq(mayAnalyzePhoto('yes', true).block, null, 'and nothing is blocking it');

// The whole bug: the camera permission was granted and the frame went. These
// three are all "not yes", and all three must refuse.
eq(mayAnalyzePhoto('unasked', true).block, 'unasked', 'never having been asked is not consent');
eq(mayAnalyzePhoto('unknown', true).block, 'unknown', 'a read still in flight is not consent');
eq(mayAnalyzePhoto('no', true).block, 'refused', 'and no is no');
for (const c of ['unasked', 'unknown', 'no'] as PhotoConsent[]) {
  ok(!mayAnalyzePhoto(c, true).allowed, `${c} does not send a photograph`);
}

// The four refusals are four distinguishable answers, because the screen says
// a different sentence for each and one null would make them the same.
const blocks = new Set([
  mayAnalyzePhoto('yes', false).block,
  mayAnalyzePhoto('unknown', true).block,
  mayAnalyzePhoto('unasked', true).block,
  mayAnalyzePhoto('no', true).block,
]);
eq(blocks.size, 4, 'each refusal is its own answer');

/* ── the key, and the words ─────────────────────────────────────────────── */

// Not the settings blob, and not the AI Coach's key: a yes about figures is
// not a yes about a photograph of a room full of other members.
eq(PHOTO_AI_KEY, 'repple.photoAI', 'its own key');
ok((PHOTO_AI_KEY as string) !== COACH_SHARE_KEY, 'and not the health-figures one');
ok(PHOTO_SENT.length > 0 && PHOTO_NOT_SENT.length > 0, 'both halves of the list exist to be rendered');
ok(PHOTO_SENT.some((s) => /other people|frame/i.test(s)),
  'the list says the frame carries whoever else is in it — the fact a gym floor makes true');
ok(/Anthropic/.test(PHOTO_DESTINATION), 'the destination is named, not called "a service"');
for (const line of [...PHOTO_SENT, ...PHOTO_NOT_SENT]) {
  ok(line.trim() === line && line.length > 0, 'every line is renderable as written');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('photoAI: ok');
