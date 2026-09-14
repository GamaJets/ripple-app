// A coach's unsaved programme belongs to the coach who typed it.
// Compile with tsc, run with node.
//
// The middle of this file is not a unit test. It is one long-lived handset
// driven through sign-in → sign-out → sign-in with a fake store, calling the
// REAL functions from ./builderDraft, because every defect this file exists to
// pin is a defect of sequence: a key that ignores the account, an arming flag
// that survives a key change, state that outlives the session that made it.
// Asserting the pieces one call at a time is how all three got shipped.
import {
  BUILDER_DRAFT_PREFIX, LEGACY_BUILDER_DRAFT_KEY, builderDraftKey, isBuilderDraftKey,
  readBuilderDraft, writeBuilderDraft, draftHasContent, restoreDraftDecision, draftStepFor,
  type BuilderDraft,
} from './builderDraft';
import { PERSONAL_DEVICE_KEYS, ACCOUNT_SCOPED_PREFIXES } from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the key carries the account ────────────────────────────────────────── */

const kA = builderDraftKey('coach-a')!;
const kB = builderDraftKey('coach-b')!;
ok(kA !== kB, 'two coaches on one handset do not share a draft');
ok(isBuilderDraftKey(kA) && kA.startsWith(BUILDER_DRAFT_PREFIX), 'and the key is recognisable as what it is');
ok(kA.includes('coach-a'), 'the account really is in it');
ok(!isBuilderDraftKey(LEGACY_BUILDER_DRAFT_KEY),
  'the unqualified key is not one of these — it has no account in it, which was the whole defect');

/* ── no account, no key, and never a fallback ───────────────────────────── */

eq(builderDraftKey(null), null, 'nobody signed in is not an account');
eq(builderDraftKey(undefined), null, 'nor is an absent one');
eq(builderDraftKey(''), null, 'nor an empty id');
eq(builderDraftKey('   '), null, 'nor a blank one');
// The literal src/ui/clientData.tsx settles on before the auth read lands.
eq(builderDraftKey('unknown'), null, "'unknown' is not an account — every signed-out session would share it");
eq(builderDraftKey('unknown '), null, 'and it is not an account with a space after it either');

/* ── it is account-scoped, so sign-out leaves the stored bytes alone ────── */

ok(!PERSONAL_DEVICE_KEYS.some((k) => isBuilderDraftKey(k)),
  'it is not on the device-key list — that list is only for keys with no account in them');
ok(!PERSONAL_DEVICE_KEYS.includes(LEGACY_BUILDER_DRAFT_KEY),
  'and the old unqualified key is not on it either — nothing reads it, the screen deletes it');
ok(ACCOUNT_SCOPED_PREFIXES.every((p) => !BUILDER_DRAFT_PREFIX.startsWith(p)),
  'it is its own prefix, not smuggled under another module’s');

/* ── reading bytes back ─────────────────────────────────────────────────── */

type Day = { day: string; focus: string };
const dayOf = (d: string): Day => ({ day: d, focus: 'Push' });

{
  const r = readBuilderDraft<Day>(null);
  eq(r.draft, null, 'nothing stored is no draft');
  eq(r.read, true, 'and that is a real answer, not a failure to look');
}
{
  const r = readBuilderDraft<Day>('not json');
  eq(r.draft, null, 'bytes that will not parse are no draft');
  eq(r.read, false, 'and they are NOT the same answer as nothing stored');
}
{
  const r = readBuilderDraft<Day>('[1,2,3]');
  eq(r.read, true, 'an array parsed, so we did read it');
  eq(r.draft, null, 'and what it says is that there is no draft here');
}
{
  // Every draft written before blocks existed carries `days` and no `weeks`.
  const r = readBuilderDraft<Day>(JSON.stringify({ title: 'Old', days: [dayOf('Mon')] }));
  eq(r.draft!.weeks.length, 1, 'a pre-block draft comes back as a one-week block');
  eq(r.draft!.weeks[0].days.length, 1, 'with its week one intact');
  eq(r.draft!.note, '', 'and a missing note is an empty one, never undefined');
}
{
  const full: BuilderDraft<Day> = {
    title: 'Hypertrophy 8',
    note: 'watch her left shoulder',
    days: [dayOf('Mon')],
    weeks: [{ days: [dayOf('Mon')] }, { days: [dayOf('Tue')], label: 'Deload', deload: true }],
  };
  const back = readBuilderDraft<Day>(writeBuilderDraft(full)).draft!;
  eq(back.title, 'Hypertrophy 8', 'the title round-trips');
  eq(back.note, 'watch her left shoulder', 'and so does the note the coach wrote');
  eq(back.weeks.length, 2, 'and every week');
  eq(back.weeks[1].label, 'Deload', 'and a week label the coach actually set');
  eq(back.weeks[1].deload, true, 'and its deload flag');
  ok(!('label' in back.weeks[0]), 'an unset label stays absent rather than becoming an empty string');
}

/* ── what counts as work worth keeping ──────────────────────────────────── */

const emptyDraft = (): BuilderDraft<Day> => ({ title: '', note: '', days: [], weeks: [{ days: [] }] });
eq(draftHasContent(emptyDraft()), false, 'an empty builder is not a draft');
eq(draftHasContent({ ...emptyDraft(), title: '   ' }), false, 'nor is whitespace in the title');
eq(draftHasContent({ ...emptyDraft(), title: 'Push/Pull' }), true, 'a named block is work');
eq(draftHasContent({ ...emptyDraft(), note: 'ask about her knee' }), true, 'so is a note on its own');
// A six-week block opened on its one empty week is still six weeks of work.
eq(draftHasContent({ ...emptyDraft(), weeks: [{ days: [] }, { days: [dayOf('Mon')] }] }), true,
  'content in ANY week counts, not only the week on screen');

/* ── the restore decision ───────────────────────────────────────────────── */

{
  const stored: BuilderDraft<Day> = { ...emptyDraft(), title: 'Stored', weeks: [{ days: [dayOf('Mon')] }] };
  eq(restoreDraftDecision({ stored: null, builderHasContent: false }).why, 'no-draft', 'nothing stored restores nothing');
  eq(restoreDraftDecision({ stored: emptyDraft(), builderHasContent: false }).why, 'empty-draft',
    'an empty draft is not resurrected over what the screen was given');
  eq(restoreDraftDecision({ stored, builderHasContent: false }).why, 'restore', 'a real draft into an empty builder is a restore');
  eq(restoreDraftDecision({ stored, builderHasContent: false }).restore?.title, 'Stored', 'and it is the stored one that comes back');
  eq(restoreDraftDecision({ stored, builderHasContent: true }).why, 'builder-in-use',
    'a builder with work in it is never overwritten by what is on disk');
  eq(restoreDraftDecision({ stored, builderHasContent: true }).restore, null, 'and nothing is handed back to put on screen');
}

/* ── the step: three answers to "who is signed in" ──────────────────────── */

eq(draftStepFor({ uid: 'coach-a', onScreenKey: null, onScreenSaved: false }).do, 'load', 'an account is a read');
{
  const s = draftStepFor({ uid: 'coach-b', onScreenKey: kA, onScreenSaved: true });
  ok(s.do === 'load' && s.key === kB && s.forget, 'a DIFFERENT account drops what is on screen before reading its own');
}
{
  const s = draftStepFor({ uid: 'coach-a', onScreenKey: kA, onScreenSaved: true });
  ok(s.do === 'load' && !s.forget, 'the same account keeps its own work');
}
eq(draftStepFor({ uid: null, onScreenKey: kA, onScreenSaved: true }).do, 'forget',
  'the account going away, with a copy safely on the device, clears the screen');
eq(draftStepFor({ uid: null, onScreenKey: kA, onScreenSaved: false }).do, 'hold',
  'but UNSAVED work is held: a null session is a failed refresh as often as it is a sign-out');
eq(draftStepFor({ uid: null, onScreenKey: null, onScreenSaved: false }).do, 'hold',
  'and an empty builder with nobody signed in has nothing to do');
eq(draftStepFor({ uid: 'unknown', onScreenKey: kA, onScreenSaved: true }).do, 'forget',
  "'unknown' is treated as no account here too, not as a third coach");

/* ── one handset, three sessions ────────────────────────────────────────── */

/** A fake AsyncStorage. `shut` makes reads throw, which is how a store that
 *  will not answer differs from one that answers "nothing". */
class Store {
  items = new Map<string, string>();
  shut = false;
  reads = 0;
  get(k: string): string | null {
    this.reads += 1;
    if (this.shut) throw new Error('store will not open');
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  set(k: string, v: string) { this.items.set(k, v); }
  remove(k: string) { this.items.delete(k); }
}

/**
 * The builder screen, reduced to the three things that can go wrong: the state
 * it holds, the flag that arms its autosave, and the account the two belong to.
 *
 * Every decision below comes from ./builderDraft. Nothing is re-implemented
 * here — if it were, the mutations at the bottom of this file would pass.
 */
class Builder {
  title = '';
  note = '';
  weeks: { days: Day[]; label?: string; deload?: boolean }[] = [{ days: [] }];
  /** The screen's `draftLoaded`: false until a read of the CURRENT key has come
   *  back, and it arms the write. */
  loaded = false;
  /** Which account the state above belongs to. */
  onScreenKey: string | null = null;
  constructor(private store: Store) {}

  private snapshot(): BuilderDraft<Day> {
    return { title: this.title, note: this.note, days: this.weeks[0]?.days ?? [], weeks: this.weeks };
  }
  hasContent(): boolean { return draftHasContent(this.snapshot()); }
  private wipe() { this.title = ''; this.note = ''; this.weeks = [{ days: [] }]; this.onScreenKey = null; }

  /** The `[draftKey]` effect. */
  session(uid: string | null) {
    const step = draftStepFor({ uid, onScreenKey: this.onScreenKey, onScreenSaved: this.loaded });
    // Cleared BEFORE the read and before anything else, never left at what the
    // last key's read set it to.
    this.loaded = false;
    if (step.do === 'hold') return;
    if (step.do === 'forget') { this.wipe(); return; }
    if (step.forget) this.wipe();
    this.onScreenKey = step.key;
    let raw: string | null;
    try { raw = this.store.get(step.key); } catch { return; } // learnt nothing: stay disarmed
    const { draft } = readBuilderDraft<Day>(raw);
    const d = restoreDraftDecision({ stored: draft, builderHasContent: this.hasContent() });
    if (d.restore) { this.title = d.restore.title; this.note = d.restore.note; this.weeks = d.restore.weeks; }
    this.loaded = true;
  }

  /** The autosave effect. It only ever WRITES — see the screen for why. */
  private autosave() {
    if (!this.loaded || !this.onScreenKey) return;
    if (!this.hasContent()) return;
    this.store.set(this.onScreenKey, writeBuilderDraft(this.snapshot()));
  }
  type(patch: { title?: string; note?: string; day?: string }) {
    if (patch.title !== undefined) this.title = patch.title;
    if (patch.note !== undefined) this.note = patch.note;
    if (patch.day) this.weeks = [{ days: [...(this.weeks[0]?.days ?? []), dayOf(patch.day)] }, ...this.weeks.slice(1)];
    this.autosave();
  }
  /** A fresh mount of the same tab — new React state, same store. */
  remount(): Builder { return new Builder(this.store); }
}

{
  const store = new Store();
  // A draft left by a build that had no account in its key at all.
  store.set(LEGACY_BUILDER_DRAFT_KEY, writeBuilderDraft({
    title: "Somebody's block", note: '', days: [dayOf('Mon')], weeks: [{ days: [dayOf('Mon')] }],
  }));

  // ── coach A signs in and writes a programme ──────────────────────────
  let screen = new Builder(store);
  screen.session('coach-a');
  eq(screen.title, '', 'coach A opens an empty builder — the unqualified draft is not theirs and is not read');
  screen.type({ title: 'Hypertrophy 8', day: 'Mon' });
  screen.type({ note: 'her left shoulder' });
  ok(store.items.has(kA), "A's work is on the device under A's own key");
  ok(!store.items.has(kB), 'and under nobody else’s');

  // The screen removes the unqualified key on sight, unread. Modelled here so
  // the sequence below is the one a real handset runs.
  store.remove(LEGACY_BUILDER_DRAFT_KEY);
  ok(!store.items.has(LEGACY_BUILDER_DRAFT_KEY), 'the legacy key is gone, and nothing ever parsed it');

  // ── the phone sleeps and the tab remounts: A must not lose anything ───
  const stillThere = screen.remount();
  stillThere.session('coach-a');
  eq(stillThere.title, 'Hypertrophy 8', 'a benign remount gives the CURRENT coach their own draft back');
  eq(stillThere.note, 'her left shoulder', 'with the note they wrote on it');
  eq(stillThere.weeks[0].days.length, 1, 'and the day they built');
  screen = stillThere;

  // ── A signs out. The tab stays mounted; the state must not. ───────────
  screen.session(null);
  eq(screen.title, '', 'signing out takes the programme off the screen as well as out of the writes');
  eq(screen.weeks[0]?.days.length, 0, 'every week with it');
  eq(screen.loaded, false, 'and the autosave is disarmed');
  eq(screen.onScreenKey, null, 'and the screen belongs to nobody');
  ok(store.items.has(kA), "A's own bytes SURVIVE under A's key — they are A's work, not litter");

  // Typing while signed out reaches no key at all.
  screen.type({ title: 'typed by nobody' });
  eq(store.items.size, 1, 'a signed-out keystroke is written nowhere rather than to a shared key');

  // ── coach B signs in on the same handset ──────────────────────────────
  screen = screen.remount();
  screen.session('coach-b');
  eq(screen.title, '', "coach B's builder is empty — A's programme is not restored into it");
  eq(screen.note, '', 'not the note either');
  eq(screen.weeks[0]?.days.length, 0, 'nor a single day of it');
  screen.type({ title: 'B beginners', day: 'Wed' });
  const aBack = readBuilderDraft<Day>(store.items.get(kA)!).draft!;
  eq(aBack.title, 'Hypertrophy 8', "and B's typing did not overwrite A's stored draft");
  eq(aBack.note, 'her left shoulder', 'nor A’s note');
  const bBack = readBuilderDraft<Day>(store.items.get(kB)!).draft!;
  eq(bBack.title, 'B beginners', "B's own work is under B's own key");

  // ── and A comes back to exactly what they left ────────────────────────
  screen = screen.remount();
  screen.session('coach-a');
  eq(screen.title, 'Hypertrophy 8', 'A signs back in to their own programme');
  eq(screen.weeks[0]?.days[0]?.day, 'Mon', 'the same day');
  eq(screen.note, 'her left shoulder', 'and the same note');
}

/* ── a straight account switch, with no signed-out gap ──────────────────── */

{
  const store = new Store();
  const screen = new Builder(store);
  screen.session('coach-a');
  screen.type({ title: 'A block', day: 'Mon' });
  // Some paths hand one account straight to the next with no null in between.
  screen.session('coach-b');
  eq(screen.title, '', "B never sees A's programme even when the session never went null");
  eq(screen.weeks[0]?.days.length, 0, 'nor any of its days');
  eq(readBuilderDraft<Day>(store.items.get(builderDraftKey('coach-a')!)!).draft!.title, 'A block',
    "and A's work is still on the device");
}

/* ── a store that will not answer must not disarm into a wipe ───────────── */

{
  const store = new Store();
  const screen = new Builder(store);
  // B already has a block of their own on this handset, from an earlier session.
  const bDraft = writeBuilderDraft<Day>({
    title: 'B twelve-week', note: 'knee', days: [dayOf('Mon')], weeks: [{ days: [dayOf('Mon')] }],
  });
  store.set(kB, bDraft);

  screen.session('coach-a');
  screen.type({ title: 'A block', day: 'Mon' });
  const aStored = store.items.get(kA)!;

  // The account switches and the read for the NEW account throws.
  store.shut = true;
  screen.session('coach-b');
  eq(screen.loaded, false, 'a read that threw leaves the autosave disarmed');
  store.shut = false;
  screen.type({ title: 'typed by B', day: 'Tue' });
  // The trap, stated as the loss it causes: an arming flag that survived the
  // key change would let this write B's near-empty builder straight over B's
  // own twelve weeks, because the read that would have filled it never landed.
  eq(store.items.get(kB), bDraft,
    "B's own stored block is untouched — a failed read is not an empty draft");
  eq(store.items.get(kA), aStored,
    "and A's stored draft is untouched too");
}

/* ── a null session with unsaved work is held, not blanked ──────────────── */

{
  const store = new Store();
  const screen = new Builder(store);
  store.shut = true;              // the read at sign-in fails, so nothing is armed
  screen.session('coach-a');
  store.shut = false;
  screen.type({ title: 'unsaved', day: 'Mon' });
  ok(!store.items.size, 'nothing was written, because nothing was armed');
  screen.session(null);           // a token refresh that failed, not a sign-out
  eq(screen.title, 'unsaved', 'work nobody has a copy of is not thrown away by a null session');
  screen.session('coach-a');      // and the member is restored on the next tick
  eq(screen.title, 'unsaved', 'and the re-read does not replay an older draft over it');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('builderDraft: ok');
