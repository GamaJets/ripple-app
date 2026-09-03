'use client';

// Settings — the six things about this gym that everything else is computed
// from, and the first screen in this console that writes any of them.
//
// ── Why this had to exist ──────────────────────────────────────────────────
//
// Every one of the 24 `.from('tenants')` calls in studio-web was a `select`.
// The console could read what a gym charges in, what it pays per session and
// what it is called, and could change none of it — while three separate screens
// sent the owner here BY NAME to fix exactly those things:
//
//   /money   "An owner sets it on the gym settings screen, and this form works
//             the moment they have."
//   /import  the same sentence, twice, over the price-book and payments runs.
//
// There was no such screen. A gym that had not set a currency therefore could
// not create a plan, could not record a payment, could not import a price book
// and could not settle payroll — from a console that told them where to go and
// then had nowhere to send them. For a NEW gym that is the whole product
// refusing to start, with instructions.
//
// ── Two writers, one stored value ─────────────────────────────────────────
//
// `tenants.currency` is also written by the phone app's own settings sheet.
// Two clients writing one column is how 'gbp' and 'GBP' end up in the same
// product and every `===` comparison quietly stops matching — /page.tsx already
// withholds a total when the contributing rows "disagree about currency", and
// two spellings of one currency would trip it on a gym that has only ever
// charged in one.
//
// So this screen does NOT hold the rule. `parseTenantCurrency` refuses what the
// column's constraint would refuse — before the round trip, where the field is
// still on screen — and `tenants_normalise_settings`, a trigger the database
// runs on every write from every client (supabase/parts/166), is what actually
// guarantees one spelling. The console and the phone can disagree about
// whitespace and case all they like; the stored value is the same either way.
//
// ── The fifth field, and why it took a decision ────────────────────────────
//
// The brand colour. `GymProfile` has always READ `tenants.brand_color` and the
// patch could not write it, so `app/Console.tsx` themed this entire console —
// every accent, link, button and focus ring — from a column whose only control
// was on the owner's phone. A white-label console whose branding requires the
// app installed is not white-label.
//
// Widening the patch is not a free act: `tenants` is granted at TABLE level to
// `authenticated` with no per-column ACLs, so the patch type IS the boundary
// between a column and a browser form. `GymProfilePatch` in src/lib/gymPolicy.ts
// now carries, for each field it accepts, who may change it and what happens to
// what was there before — and, beside it, the four columns deliberately left out
// and why. That list is the decision; this screen is only the form for it.
//
// ── The sixth field, and the one that had nothing behind it at all ─────────
//
// The timezone. The other five were columns this console could read and not
// write; this one was not a column. Six screens in here print the phrase "in
// the gym's own timezone" over figures bucketed with `new Date()` on whatever
// machine the page is open on — /accounting over a week, /analytics over door
// entries BY HOUR, /payroll and the coach's earnings over a calendar month.
// Read at the front desk those sentences are true by accident. Read by a
// bookkeeper in another country they are false, and nothing on the page says
// which of the two is happening.
//
// `tenants.timezone` (supabase/parts/710) is the column, and this is its only
// writer. Two things about the way it is offered here are deliberate:
//
//   · There is NO default and no "detect from this browser" button. The
//     browser's zone is a fact about a laptop — part 710's header spells this
//     out — and one press of such a button would turn a bookkeeper in Lisbon
//     into a permanent, invisible claim about where the gym is. The field
//     starts empty and stays empty until somebody types where the gym is.
//   · The field is accompanied by the gym's own wall clock, live. An owner
//     cannot check whether 'Asia/Dubai' is the right STRING, and can check
//     whether the clock next to it says what the clock behind them says. That
//     is the only test of this setting a person can actually perform, so the
//     screen performs it in front of them.
//
// ── The thing on this screen that is not a setting ─────────────────────────
//
// `CardPayments` at the foot. It is not a column on `tenants` and it does not
// save with the form — it is the gym's own Stripe account, and it is here
// because `fetchGymMerchant` and `startGymOnboarding` had exactly one caller in
// the whole product and it was on the PHONE. A gym whose owner has not
// installed the owner app could not connect a payment account at all, from the
// console where every figure the money produces is read. See the doc comment on
// the component for why the return URLs are the public site's and not this
// page's.
//
// ── What it writes with ────────────────────────────────────────────────────
//
// The anon key and the signed-in owner's session, like every other screen here.
// There is no service key and there must not be one: `tenants_owner_rw` is
// `is_owner_of(tenants.id)` and is the only policy granting UPDATE, so the
// database is what decides whether this save lands. `saveGymProfile` checks the
// ROW COUNT rather than `error` alone, because a refused UPDATE is a 204 with
// no error and this sheet would otherwise say "Saved" over a row that did not
// move.
import { useCallback, useEffect, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
import { type Unread } from '@/lib/read';
import { Shell } from '@/components/Shell';
import {
  fetchGymProfile, saveGymProfile, parseTenantCurrency, parseBrandColor,
  payPolicyOf, payPolicyCode, PAY_POLICY_CODES, PAY_POLICY_LABEL,
  type GymProfile, type PayPolicyCode,
} from '@lib/gymPolicy';
import { applyBrandColour } from '@/app/Console';
import {
  parseGymZone, zoneOptions, gymTimeLabel, gymDay, readerZone, zoneGapNote,
} from '@lib/gymZone';
import { parseSessionFee, parseGymName, sessionFeeFieldValue } from '@lib/gymSettings';
import {
  fetchGymMerchant, startGymOnboarding, merchantState, type GymMerchant,
} from '@lib/gymMerchant';
import { BRAND } from '@lib/brands';
import { NO_CURRENCY_NOTE } from '@/lib/currency';
import { Banner as SharedBanner, type BannerTone } from '@/components/Banner';

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two must look different here more than anywhere. A settings screen that
 * renders empty fields over a failed read invites the owner to type the values
 * back in — and Save would then overwrite whatever is actually stored with
 * whatever they remembered. That is the failure part 151 describes in the other
 * direction: a screen that cannot see the stored value and can still replace it
 * is how a policy somebody set months ago becomes something else.
 */

export default function Settings() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gym, setGym] = useState<GymProfile | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);

  // The six fields, as typed. Seeded from the stored row once it arrives and
  // not touched again — a re-read after a save reseeds them deliberately, so
  // what is on screen is what is in the database.
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [fee, setFee] = useState('');
  const [policy, setPolicy] = useState<PayPolicyCode | ''>('');
  const [colour, setColour] = useState('');
  const [zone, setZone] = useState('');

  /**
   * A clock, ticking, so the zone in the field can be checked against a wall.
   *
   * A minute is the resolution the field shows and there is no point re-drawing
   * faster than the thing being drawn changes. It starts at null rather than at
   * `Date.now()` and is set in an effect, because Next renders this on the
   * server first and a clock rendered there is the SERVER's second — a
   * hydration mismatch, and one that would be showing the reader a time from a
   * machine in another country, which on this particular screen would be a
   * quietly hilarious way to fail.
   */
  const [tick, setTick] = useState<number | null>(null);
  useEffect(() => {
    setTick(Date.now());
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    const { profile, error } = await fetchGymProfile(supabase, tenantId);
    setGym(profile);
    setReadErr(error);
    if (profile) {
      setName(profile.name ?? '');
      setCurrency(profile.currency ?? '');
      setFee(sessionFeeFieldValue(profile.sessionFee));
      // '' is "the gym has not decided", which is a real option in the picker
      // and not the same as the conservative reading. An unrecognised stored
      // value lands here too, and the note beside the control says so.
      setPolicy(payPolicyOf(profile.payPolicy) ? (profile.payPolicy as PayPolicyCode) : '');
      // As stored, not as parsed. A value the column holds that this build
      // cannot render is still what is stored, and showing the owner a blank
      // where it sits would invite them to save the blank over it — the same
      // failure the banner about a failed read warns about, one field down.
      setColour(profile.brandColor ?? '');
      // As stored, for the reason the colour is: a value this build cannot
      // resolve is still what the column holds, and showing a blank over it
      // would invite the owner to save the blank.
      setZone(profile.timezone ?? '');
      // The console reads this column once, on mount. A save that re-seeds the
      // field without repainting would leave this screen telling the owner a
      // colour it is not drawn in.
      applyBrandColour(profile.brandColor);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      if (!who?.tenantId) return;
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gym?.name ?? null} gymNameUnread={!!readErr} current="/settings">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gym?.name ?? null} gymNameUnread={!!readErr} current="/settings">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          These settings price every plan, value every session and decide what a coach is paid for,
          so they are owner-only. The database says the same thing independently —{' '}
          <span className="mono">tenants_owner_rw</span> is the only policy that grants an update on
          this row, and it is scoped to the owner of this particular gym.
        </p>
      </Shell>
    );
  }

  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={null} current="/settings">
        <h1>Gym</h1>
        <Banner tone="crit">
          Your account is not linked to a gym, so there is no row to change. Whoever set the gym up
          needs to add you as its owner first.
        </Banner>
      </Shell>
    );
  }

  const tenantId = me.tenantId;
  const state: Unread = gym !== null ? null : readErr ? 'failed' : 'loading';

  /**
   * The sentence a field prints when its value is absent BECAUSE THE READ
   * FAILED, rather than because nobody has set it.
   *
   * Every note below branched on `gym?.currency`, `gym?.timezone` and the rest,
   * and `gym` is null when the tenant read was refused — so a gym that set its
   * currency months ago was told "Not set", by name, with instructions to go
   * and set it. src/lib/gymZone.ts:475 states the cost of exactly that: an
   * instruction to change a setting, printed over a failed read, sends an owner
   * to change something that is already correct.
   *
   * The banner above says the record would not load. This makes each field say
   * it too, because the field is what somebody is looking at.
   */
  const unread = (what: string): string | null => state === 'failed'
    ? `Not shown — the gym’s record could not be read, so this console does not know what ${what} is. That is not the same as it being unset, and saving now would replace whatever is stored with a blank.`
    : null;

  // Checked as the owner types, so a refusal arrives beside the field rather
  // than after the save. Each is null when the field is fine.
  const nameCheck = parseGymName(name);
  const feeCheck = parseSessionFee(fee);
  const ccyCheck = parseTenantCurrency(currency);
  const colCheck = parseBrandColor(colour);
  const tzCheck = parseGymZone(zone);
  const blocker =
    nameCheck.kind === 'bad' ? nameCheck.reason
    : feeCheck.kind === 'bad' ? feeCheck.reason
    : ccyCheck.kind === 'bad' ? ccyCheck.reason
    : colCheck.kind === 'bad' ? colCheck.reason
    : tzCheck.kind === 'bad' ? tzCheck.reason
    : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null); setWriteErr(null);
    if (blocker) { setWriteErr(blocker); return; }
    if (nameCheck.kind !== 'name') return;
    setBusy(true);
    try {
      await saveGymProfile(supabase, tenantId, {
        name: nameCheck.name,
        // A cleared field CLEARS the column rather than storing a zero or an
        // empty string. Both nulls are reachable on purpose: "we have not
        // decided" is a state every screen in this console already knows how to
        // render, and an invented value is not.
        currency: ccyCheck.kind === 'currency' ? ccyCheck.currency : null,
        sessionFee: feeCheck.kind === 'fee' ? feeCheck.fee : null,
        payPolicy: policy === '' ? null : policy,
        // Cleared means the gym has not chosen a colour — not black, and not
        // Studio's amber written into the gym's own row as though it had been
        // picked. Part 118 dropped the default on this column for exactly that
        // reason, and every surface already draws its own accent over a null.
        brandColor: colCheck.kind === 'color' ? colCheck.color : null,
        // Cleared means the gym has not said where it is — which puts every
        // date and hour in this console back onto whichever device is reading
        // them. That is a worse state than having a zone and it is a real one,
        // so it is reachable; the note under the field is what stops it being
        // reached by accident.
        timezone: tzCheck.kind === 'zone' ? tzCheck.zone : null,
      });
      setSaved('Saved.');
      // Re-read rather than trust the patch. The trigger normalises what was
      // written, so what is on screen after a save is what is stored — not what
      // was sent, which is the same distinction as everywhere else here.
      await load(tenantId);
    } catch (x: any) {
      setWriteErr(writeFailedText(x, {
        what: 'Those gym settings',
        unchanged: 'nothing has changed',
        howToCheck: 'Reload this page — the boxes are re-read from the stored row after every save, so what they show is what is actually stored.',
      }));
    } finally { setBusy(false); }
  };

  return (
    <Shell me={me} gymName={gym?.name ?? null} gymNameUnread={!!readErr} current="/settings">
      <h1>Gym</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '72ch' }}>
        Six settings, and everything else in this console is computed from them, dated by them or
        drawn in them. A blank field is a setting this gym has not made — which is a different thing
        from a zero, and every screen here already knows how to say so.
      </p>

      {readErr ? (
        <Banner tone="crit">
          The gym&rsquo;s record could not be read: {readErr}. The fields below are empty because
          nothing came back, not because nothing is set — saving now would replace whatever is
          stored with a blank. Reload before changing anything.
        </Banner>
      ) : null}
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {saved ? <Banner>{saved}</Banner> : null}

      {state === 'loading' ? (
        <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '26px 2px', color: 'var(--ink3)' }}>Loading…</div>
      ) : (
        <form onSubmit={save} style={{ maxWidth: 620, marginTop: 20 }}>
          <Field
            label="Gym name"
            htmlFor="gym-name"
            note="What every owner, coach and member sees this gym called, on every device."
          >
            <input
              id="gym-name"
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="What the gym is called"
              disabled={state === 'failed'}
              style={{ ...field, width: '100%' }}
            />
            {nameCheck.kind === 'bad' && name.trim() !== '' ? <Bad>{nameCheck.reason}</Bad> : null}
          </Field>

          <Field
            label="Currency"
            note={
              gym?.currency
                ? 'The three-letter ISO code this gym charges in. Every plan, pass and payment written from here is denominated in it.'
                : unread('this gym’s currency')
                  ?? `Not set — ${NO_CURRENCY_NOTE}. Until it is, a plan cannot be priced, a payment cannot be recorded and a price book cannot be imported: nothing in this console will guess at what money a figure is in.`
            }
          >
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="GBP"
              maxLength={3}
              disabled={state === 'failed'}
              // Uppercased on screen as well as on the way in, so the field
              // shows the value that will be stored rather than a lowercase
              // draft of it.
              style={{ ...field, width: 120, textTransform: 'uppercase' }}
              aria-label="The gym's ISO currency code"
            />
            {ccyCheck.kind === 'bad' ? <Bad>{ccyCheck.reason}</Bad> : null}
            {/* Said out loud rather than left to be discovered. Old rows keep
                the currency they were written in — a payment is a historical
                fact — so a gym that changes this has two currencies in its
                ledger, and the money screens already refuse to add those into
                one total rather than picking whichever came first. */}
            {gym?.currency && ccyCheck.kind === 'currency' && ccyCheck.currency !== gym.currency ? (
              <Bad tone="warn">
                Changing this does not re-denominate anything already recorded. Payments, plans and
                passes keep the currency they were written in, and any total mixing the two is
                withheld rather than added up.
              </Bad>
            ) : null}
          </Field>

          <Field
            label="Session fee"
            htmlFor="session-fee"
            note={
              gym?.currency
                ? `What one delivered personal-training session is worth, in ${gym.currency}. Payroll, value per client and every "at your session fee" figure multiply by it.`
                : unread('this gym’s session fee')
                  ?? 'What one delivered personal-training session is worth. It has no currency of its own — it is in whatever the gym charges in — so the figures built on it stay withheld until the currency above is set.'
            }
          >
            <input
              id="session-fee"
              value={fee} onChange={(e) => setFee(e.target.value)}
              placeholder="Leave empty if you have not set one"
              inputMode="decimal"
              disabled={state === 'failed'}
              style={{ ...field, width: 200 }}
            />
            {feeCheck.kind === 'bad' ? <Bad>{feeCheck.reason}</Bad> : null}
          </Field>

          <Field
            label="Timezone"
            note={
              gym?.timezone
                ? 'The gym’s own day. Every “today”, every week, every calendar month and the by-hour door chart are measured against this clock rather than against the clock of whoever opened the page.'
                // `readerZone()` is asked only once the clock has started,
                // which is to say only in the browser. Asked during Next's
                // server render it would report the SERVER's zone and then
                // change on hydration — a wrong answer about zones, printed by
                // the timezone field, which is the one place it would be least
                // forgivable.
                : unread('this gym’s timezone')
                  ?? `Not set — so every date and hour in this console is your own device’s${
                    tick != null && readerZone() ? `, which is ${readerZone()}` : ''
                  }. That is invisible and it is usually close enough to look right: it goes wrong for a colleague reading from somewhere else, and it goes wrong for everybody in the hours either side of midnight.`
            }
          >
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={zone} onChange={(e) => setZone(e.target.value)}
                placeholder="Europe/London"
                list="gym-zone-options"
                disabled={state === 'failed'}
                style={{ ...field, width: 260 }}
                aria-label="The gym's IANA timezone"
              />
              {/* A datalist rather than a <select>. `Intl.supportedValuesOf`
                  returns several hundred zones and a dropdown of those is
                  unusable; typed against a list, "Dub" reaches Dublin and Dubai
                  in two keystrokes. Where the browser has no such list the
                  datalist is simply empty and the input is an ordinary text
                  field, which still works — `parseGymZone` is what refuses a
                  wrong answer, not the picker. */}
              <datalist id="gym-zone-options">
                {zoneOptions().map((z) => <option key={z} value={z} />)}
              </datalist>
              {/* The proof. Not a formatted date — the wall clock, because the
                  wall clock is the thing an owner can look up at. */}
              {tzCheck.kind === 'zone' && tick != null ? (
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
                  {gymTimeLabel(tick, tzCheck.zone)} · {gymDay(tick, tzCheck.zone)}
                </span>
              ) : null}
            </div>
            {tzCheck.kind === 'bad' ? <Bad>{tzCheck.reason}</Bad> : null}
            {/* Said where it is actionable. An owner who has just typed the zone
                of the city they are sitting in, which is not the city the gym is
                in, gets to see that before they save rather than after a month
                of takings has been filed a day out. */}
            {tzCheck.kind === 'zone' && tick != null && zoneGapNote(tzCheck.zone) ? (
              <Bad tone="warn">{zoneGapNote(tzCheck.zone)}</Bad>
            ) : null}
            {/* The stored value cannot be resolved. Same shape as the brand
                colour's: the column holds something, nothing can render in it,
                and without this the field looks fine while every screen quietly
                falls back to the reader's clock. `tenants_timezone_check`
                refuses these at the write now, so this can only be a row from
                before part 710 — or a zone this browser is too old to know,
                which is why it says both. */}
            {gym?.timezone && parseGymZone(gym.timezone).kind !== 'zone' ? (
              <Bad>
                The stored timezone is <span className="mono">{gym.timezone}</span>, which this
                browser does not recognise, so every date and hour in this console is falling back
                to your own device&rsquo;s. Either it was written before the database began checking
                them, or this browser&rsquo;s zone list is older than the zone. Type one above to
                replace it.
              </Bad>
            ) : null}
            {/* Changing it, rather than setting it. Nothing is rewritten — every
                timestamp in this database is an instant — but which DAY a figure
                is filed under moves, for the past as well as the future, and an
                owner who has just reconciled a week deserves to know that before
                they press Save rather than when the week no longer adds up. */}
            {gym?.timezone && tzCheck.kind === 'zone' && tzCheck.zone !== gym.timezone ? (
              <Bad tone="warn">
                Changing this does not alter a single stored figure — every time in this database is
                an instant and stays exactly where it is. What moves is which day and which hour a
                screen files it under, for what has already happened as well as for what has not. A
                week you have already reconciled may come out to a different total.
              </Bad>
            ) : null}
            {/* The other direction, and the one the currency field has no
                equivalent of: clearing this does not leave a blank on screen, it
                leaves an answer that looks exactly as confident as before and is
                a different answer per reader. */}
            {gym?.timezone && tzCheck.kind === 'clear' ? (
              <Bad tone="warn">
                Emptying this does not leave the dates blank. It puts them back to whichever device
                is reading them, with nothing on any screen saying so — two people in two countries
                would then see the same gym&rsquo;s Saturday differently and neither would be told.
              </Bad>
            ) : null}
          </Field>

          {/* Two surfaces, not four. Both of these sentences used to name the
              coach app and the member app as well, and neither of them draws
              this colour.

              `setAccent` — the only thing in the mobile tree that repaints an
              app — has two call sites and both are in app/(owner)/brand.tsx.
              Nothing under app/(client) or app/(trainer) reads
              `tenants.brand_color`; a coach's app draws `trainers.brand_color`
              (src/ui/coachBrand.ts), which is that coach's own and has nothing
              to do with this field. So the true reach is the OWNER app and this
              console, and this console is the surface an owner is looking at
              while they read the sentence — which is exactly why nobody
              noticed. */}
          <Field
            label="Brand colour"
            note={
              gym?.brandColor
                ? 'The accent this console and the owner app are drawn in — every link, button, focus ring and active nav pill. It is the gym’s, not one person’s: every owner sees it, on every device they sign in on. It does not reach the coach app or the member app; those draw their own.'
                : unread('this gym’s brand colour')
                  ?? 'Not set — this gym has not chosen a colour, so every surface draws its own. Set one and this console and the owner app follow it; the coach app and the member app keep their own accent either way. Clear it again to go back.'
            }
          >
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={colour} onChange={(e) => setColour(e.target.value)}
                placeholder="Leave empty to choose no colour"
                maxLength={7}
                disabled={state === 'failed'}
                style={{ ...field, width: 200 }}
                aria-label="The gym's brand colour, as a hex code"
              />
              {/* A swatch rather than a colour picker input. `type="color"`
                  cannot express "not set" — it opens on black and posts
                  #000000, which would store a colour the owner never chose the
                  moment they touched it, which is the whole thing this screen
                  refuses to do. */}
              <span
                aria-hidden
                style={{
                  width: 26, height: 26, border: '1px solid var(--ring)',
                  background: colCheck.kind === 'color' ? colCheck.color : 'transparent',
                }}
              />
              {colCheck.kind === 'color' ? (
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink3)' }}>{colCheck.color}</span>
              ) : null}
            </div>
            {colCheck.kind === 'bad' ? <Bad>{colCheck.reason}</Bad> : null}
            {/* The stored value cannot be rendered. There is no check
                constraint on this column — the phone and this console are the
                only things that have ever validated it — so a gym can be
                holding text no theme can parse, and the console is silently
                drawing itself in Studio's amber over it. Said out loud, because
                otherwise the field looks fine and the console looks unbranded. */}
            {gym?.brandColor && parseBrandColor(gym.brandColor).kind !== 'color' ? (
              <Bad>
                The stored colour is <span className="mono">{gym.brandColor}</span>, which is not a
                hex code, so nothing is drawn in it — this console and the owner app are showing
                their own accent instead. Type one above to replace it, or empty the field to clear
                it.
              </Bad>
            ) : null}
          </Field>

          <Field
            label="What a coach is paid for"
            note="A delivered session is always paid. This is the rest of the answer, and it is the gym's to give — Sessions, Staff, Close and every coach's own earnings screen all read it from here."
          >
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as PayPolicyCode | '')}
              disabled={state === 'failed'}
              style={{ ...field, width: '100%' }}
              aria-label="What this gym pays a coach for"
            >
              <option value="">Not decided yet</option>
              {PAY_POLICY_CODES.map((c) => (
                <option key={c} value={c}>{PAY_POLICY_LABEL[c]}</option>
              ))}
            </select>
            {policy === '' ? (
              <Bad tone="warn">
                {/* This is the whole of D1 said in one place. Four screens used
                    to hold their own unsaved copy of this and reset to the
                    conservative reading on every reload, so an owner settled a
                    month against a policy they had not chosen — and the coach's
                    own earnings screen told them outright that it could not
                    read the gym's real answer. */}
                Until this is set, no screen states a policy. Payroll figures that depend on it are
                withheld rather than computed against a guess, and every coach&rsquo;s earnings
                screen says the gym has not decided instead of showing them a number that may not be
                what they are paid.
              </Bad>
            ) : null}
            {gym && gym.payPolicy && !payPolicyOf(gym.payPolicy) ? (
              <Bad>
                The stored policy is <span className="mono">{gym.payPolicy}</span>, which this build
                does not recognise, so it is being treated as not set rather than guessed at. Choose
                one above to replace it.
              </Bad>
            ) : null}
          </Field>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18 }}>
            <button type="submit" disabled={busy || !!blocker || state === 'failed'} style={primaryBtn}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {blocker ? <span style={{ fontSize: 12.5, color: 'var(--warn)' }}>{blocker}</span> : null}
          </div>

          {/* Where each of these lands, so an owner knows what they have just
              unblocked rather than going back to the screen that sent them. */}
          <p style={{ marginTop: 22, color: 'var(--ink3)', fontSize: 12.5, maxWidth: '68ch' }}>
            Currency unblocks pricing a plan and recording a payment on{' '}
            <a href="/money" style={{ color: 'var(--brand)' }}>Plans &amp; payments</a> and running a
            file through <a href="/import" style={{ color: 'var(--brand)' }}>Import</a>. The session
            fee is what <a href="/payroll" style={{ color: 'var(--brand)' }}>Payroll</a> multiplies.
            The pay policy is read by{' '}
            <a href="/sessions" style={{ color: 'var(--brand)' }}>Sessions</a>,{' '}
            <a href="/staff" style={{ color: 'var(--brand)' }}>Staff</a> and{' '}
            <a href="/close" style={{ color: 'var(--brand)' }}>Close</a>. The brand colour is what
            every screen in this console, and the owner app, draw their accent in — it takes effect
            here as soon as it saves, and in the owner app on its next load. The coach app and the
            member app are unaffected by it; what those two do take from this gym is its{' '}
            <em>name</em>.
          </p>

          {/* Said plainly rather than implied by the field above it. The column
              is new; most of the screens that print "in the gym's own timezone"
              have not been moved onto it yet, and an owner who sets this and
              assumes /accounting followed would be worse off than one who knows
              it has not — because they would stop checking. */}
          <p style={{ marginTop: 14, color: 'var(--ink3)', fontSize: 12.5, maxWidth: '68ch' }}>
            The timezone is read today by this screen, by{' '}
            <a href="/staff" style={{ color: 'var(--brand)' }}>Staff</a> — the rota&rsquo;s times and
            a coach&rsquo;s join date — and by the &ldquo;read&nbsp;…&nbsp;ago&rdquo; line in the
            owner app. <strong style={{ color: 'var(--ink2)' }}>Accounting, Analytics, the Door
            log, Payroll, Close and the coach&rsquo;s earnings still draw their days and hours in
            your own browser&rsquo;s zone</strong>, whatever this field says, and some of them
            already carry the words &ldquo;in the gym&rsquo;s own timezone&rdquo; over figures that
            are not. They are listed at the foot of{' '}
            <span className="mono">supabase/parts/710</span> so nobody has to go looking.
          </p>
        </form>
      )}

      {/* Outside the form on purpose. Nothing here is a field that saves with
          the six above — it is an account at Stripe, and it is rendered even
          when the `tenants` read failed, because whether the gym can take a
          card is a different read with a different answer. */}
      <CardPayments tenantId={tenantId} />
    </Shell>
  );
}

/* ── the gym's own Stripe account ──────────────────────────────────────────── */

/**
 * Connect onboarding, from the console.
 *
 * ── Why this is here ──────────────────────────────────────────────────────
 *
 * `fetchGymMerchant` and `startGymOnboarding` (src/lib/gymMerchant.ts) had
 * exactly one caller in the product: `app/(owner)/ops.tsx`, on the phone. So a
 * gym whose owner does not have the owner app installed could not connect a
 * payment account AT ALL — not slowly, not awkwardly, not at all — while the
 * console that shows them every figure the money produces sent them nowhere.
 * Membership sales, pass sales and renewals in the member app are all gated on
 * `canTakeDirectCharges` against this one row.
 *
 * ── The same two return URLs the phone uses, and not this page ────────────
 *
 * Stripe's account-links documentation says `refresh_url` and `return_url` "can
 * only use HTTPS in live mode". `window.location.origin` is `http://localhost`
 * for everybody developing this console, so composing the URLs from it would
 * work in test and fail on the day it went live — surfacing as the first real
 * owner failing to onboard while holding their passport and their bank details.
 * `BRAND.webOrigin` is https for every brand and the two pages behind it
 * (`web/connect-return.html`, `web/connect-refresh.html`) already exist and
 * already say the right thing.
 *
 * ── Coming back does not mean it worked ───────────────────────────────────
 *
 * Landing on `return_url` means the owner LEFT Stripe's flow, which is not the
 * same as finishing it. The truth is what `account.updated` writes onto
 * `gym_connect_accounts`, so this re-reads the row when the tab is looked at
 * again rather than congratulating anybody, and there is a button to re-read on
 * demand for the case where the webhook has not landed yet.
 */
function CardPayments({ tenantId }: { tenantId: string }) {
  const [merchant, setMerchant] = useState<GymMerchant | null>(null);
  // Three states, not two. `merchant === null` with no error is a gym that has
  // never started onboarding — one tap from starting — and a gym whose read was
  // refused is not, and telling the second one "you have not set this up" is
  // how somebody sets it up twice.
  const [state, setState] = useState<Unread>('loading');
  const [readErr, setReadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** Set only when the browser refused to open the tab. The owner then has the
   *  link itself rather than a dead button and a shrug. */
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const read = useCallback(async () => {
    setState('loading');
    const r = await fetchGymMerchant(supabase as never, tenantId);
    if (r.ok) { setMerchant(r.value); setReadErr(null); setState(null); }
    else { setMerchant(null); setReadErr(r.reason); setState('failed'); }
  }, [tenantId]);

  useEffect(() => { void read(); }, [read]);

  // Re-read when the tab is looked at again — the owner coming back from
  // Stripe is the case this exists for, and it is the one moment the row is
  // most likely to have just changed underneath the page.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [read]);

  const start = async () => {
    setBusy(true); setMsg(null); setManualUrl(null);
    const r = await startGymOnboarding(supabase as never, {
      refreshUrl: `${BRAND.webOrigin}/connect-refresh`,
      returnUrl: `${BRAND.webOrigin}/connect-return`,
    });
    setBusy(false);
    if (!r.ok) {
      setMsg(r.error || 'Stripe setup could not be opened. Nothing has changed.');
      return;
    }
    // A new tab, so the console is still here when they come back. `window.open`
    // after an await is what a pop-up blocker stops, and a blocked pop-up
    // returns null silently — so the URL is offered as a link rather than the
    // button appearing to do nothing.
    const w = window.open(r.url, '_blank', 'noopener,noreferrer');
    if (!w) {
      setManualUrl(r.url);
      setMsg('Your browser blocked the new tab. Nothing has changed — open Stripe setup with the link below.');
    }
  };

  const s = state === null ? merchantState(merchant) : null;

  return (
    <section style={{
      border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)',
      padding: '14px 16px', marginTop: 24, maxWidth: 620,
    }}>
      <div className="micro">Card payments</div>

      {state === 'loading' ? (
        <p style={{ margin: '9px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
          Reading your gym&rsquo;s payment account…
        </p>
      ) : state === 'failed' ? (
        <>
          {/* Not "you have not set this up". A refused read is unknown, and the
              two have opposite instructions. */}
          <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--crit)', maxWidth: '64ch' }}>
            Your gym&rsquo;s payment account could not be read: {readErr}. That is not the same as
            not having one — nothing here knows either way, so nothing is offered until it does.
          </p>
          <button type="button" onClick={() => void read()} style={{ ...primaryBtn, marginTop: 10 }}>
            Try again
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--ink2)', maxWidth: '64ch' }}>
            {s!.note}
          </p>
          {s!.kind === 'blocked' ? null : (
            <button
              type="button" onClick={() => void start()} disabled={busy}
              style={{ ...primaryBtn, marginTop: 11 }}
            >
              {busy ? 'Opening Stripe…' : s!.cta}
            </button>
          )}
          {s!.kind === 'pending' ? (
            <p style={{ margin: '9px 0 0', fontSize: 12, color: 'var(--ink3)', maxWidth: '64ch' }}>
              Coming back from Stripe does not by itself mean it finished — this row is updated by
              Stripe&rsquo;s own <span className="mono">account.updated</span> webhook, which can
              land a moment later. This re-reads it whenever you come back to this tab.{' '}
              <button
                type="button" onClick={() => void read()}
                style={{
                  background: 'none', border: 'none', padding: 0, font: 'inherit',
                  color: 'var(--brand)', cursor: 'pointer', textDecoration: 'underline',
                }}
              >Check again</button>
            </p>
          ) : null}
        </>
      )}

      {/* Announced. Everything else on this page goes through Banner; the
          Stripe onboarding failures — "Stripe setup could not be opened",
          "your browser blocked the new tab" — did not, and both are the
          outcome of a button the reader just pressed. */}
      {msg ? (
        <p role="alert" aria-live="assertive" aria-atomic="true"
           style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--crit)', maxWidth: '64ch' }}>{msg}</p>
      ) : null}
      {manualUrl ? (
        <p style={{ margin: '6px 0 0', fontSize: 12.5, maxWidth: '64ch' }}>
          <a href={manualUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)' }}>
            Open Stripe setup
          </a>
        </p>
      ) : null}

      <p style={{ margin: '11px 0 0', color: 'var(--ink3)', fontSize: 12, maxWidth: '64ch' }}>
        This is the gym&rsquo;s OWN Stripe account and not the owner&rsquo;s personal coaching one.
        Selling a gym membership on a coach account would make a different legal entity the merchant
        of record for it — the charge succeeds, the money lands in the wrong company&rsquo;s balance
        and the wrong company&rsquo;s name is on the member&rsquo;s card statement, with nothing in
        the app looking wrong. Until this account can take payments, members cannot buy or renew
        anything in the app; the front desk can still record what it takes on{' '}
        <a href="/money" style={{ color: 'var(--brand)' }}>Plans &amp; payments</a>.
      </p>
    </section>
  );
}

/* ── shared bits (same shapes as the other console pages) ──────────────────── */

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '9px 11px', fontSize: 13.5, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

/**
 * One setting, its caption and its explanation.
 *
 * `htmlFor` makes the caption a real `<label>` rather than a `<div>` that looks
 * like one. It was a div with nothing associating it, so Gym name and Session
 * fee announced nothing at all — while Currency, Timezone and Brand colour each
 * carried an `aria-label` and were fine. Two of the five settings on this
 * screen were unreachable by name, and one of them is what every payroll
 * figure in the product multiplies by.
 */
function Field({ label, note, htmlFor, children }: {
  label: string; note: string; htmlFor?: string; children: React.ReactNode;
}) {
  return (
    <section style={{
      border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)',
      padding: '14px 16px', marginBottom: 14,
    }}>
      {htmlFor
        ? <label className="micro" htmlFor={htmlFor} style={{ display: 'block' }}>{label}</label>
        : <div className="micro">{label}</div>}
      <div style={{ margin: '9px 0 8px' }}>{children}</div>
      <p style={{ margin: 0, color: 'var(--ink3)', fontSize: 12, maxWidth: '64ch' }}>{note}</p>
    </section>
  );
}

/** A refusal or a warning under the field it belongs to, rather than in a
 *  banner at the top — the owner is looking at the field. */
function Bad({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <p style={{
      margin: '8px 0 0', fontSize: 12.5, maxWidth: '64ch',
      color: tone === 'warn' ? 'var(--warn)' : 'var(--crit)',
    }}>{children}</p>
  );
}

// The banner is the shared one now: studio-web/components/Banner.tsx. This
// page carried a byte-for-byte copy of it that rendered into a plain <div>,
// so every sentence it printed — including the ones saying a write was
// REFUSED and nothing was saved — was silent to a screen reader. The shared
// component carries role="alert"/"status" and aria-live.
// The wrapper stays only for this page's own 72ch measure, which is passed
// through the shared component's `style` rather than duplicating it.
function Banner({ children, tone }: { children: React.ReactNode; tone?: BannerTone }) {
  return <SharedBanner tone={tone} style={{ maxWidth: '72ch' }}>{children}</SharedBanner>;
}
