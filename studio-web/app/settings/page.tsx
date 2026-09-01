'use client';

// Settings — the four things about this gym that everything else is computed
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
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import {
  fetchGymProfile, saveGymProfile, parseTenantCurrency,
  payPolicyOf, payPolicyCode, PAY_POLICY_CODES, PAY_POLICY_LABEL,
  type GymProfile, type PayPolicyCode,
} from '@lib/gymPolicy';
import { parseSessionFee, parseGymName, sessionFeeFieldValue } from '@lib/gymSettings';
import { NO_CURRENCY_NOTE } from '@/lib/currency';

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
type Unread = 'loading' | 'failed' | null;

export default function Settings() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gym, setGym] = useState<GymProfile | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);

  // The four fields, as typed. Seeded from the stored row once it arrives and
  // not touched again — a re-read after a save reseeds them deliberately, so
  // what is on screen is what is in the database.
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [fee, setFee] = useState('');
  const [policy, setPolicy] = useState<PayPolicyCode | ''>('');

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
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) return;
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

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

  // Checked as the owner types, so a refusal arrives beside the field rather
  // than after the save. Each is null when the field is fine.
  const nameCheck = parseGymName(name);
  const feeCheck = parseSessionFee(fee);
  const ccyCheck = parseTenantCurrency(currency);
  const blocker =
    nameCheck.kind === 'bad' ? nameCheck.reason
    : feeCheck.kind === 'bad' ? feeCheck.reason
    : ccyCheck.kind === 'bad' ? ccyCheck.reason
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
      });
      setSaved('Saved.');
      // Re-read rather than trust the patch. The trigger normalises what was
      // written, so what is on screen after a save is what is stored — not what
      // was sent, which is the same distinction as everywhere else here.
      await load(tenantId);
    } catch (x: any) {
      setWriteErr(x?.message ?? 'The write was refused. Nothing has changed.');
    } finally { setBusy(false); }
  };

  return (
    <Shell me={me} gymName={gym?.name ?? null} gymNameUnread={!!readErr} current="/settings">
      <h1>Gym</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '72ch' }}>
        Four settings, and everything else in this console is computed from them. A blank field is a
        setting this gym has not made — which is a different thing from a zero, and every screen
        here already knows how to say so.
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
        <div style={{ padding: '26px 2px', color: 'var(--ink3)' }}>Loading…</div>
      ) : (
        <form onSubmit={save} style={{ maxWidth: 620, marginTop: 20 }}>
          <Field
            label="Gym name"
            note="What every owner, coach and member sees this gym called, on every device."
          >
            <input
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
                : `Not set — ${NO_CURRENCY_NOTE}. Until it is, a plan cannot be priced, a payment cannot be recorded and a price book cannot be imported: nothing in this console will guess at what money a figure is in.`
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
            note={
              gym?.currency
                ? `What one delivered personal-training session is worth, in ${gym.currency}. Payroll, value per client and every "at your session fee" figure multiply by it.`
                : 'What one delivered personal-training session is worth. It has no currency of its own — it is in whatever the gym charges in — so the figures built on it stay withheld until the currency above is set.'
            }
          >
            <input
              value={fee} onChange={(e) => setFee(e.target.value)}
              placeholder="Leave empty if you have not set one"
              inputMode="decimal"
              disabled={state === 'failed'}
              style={{ ...field, width: 200 }}
            />
            {feeCheck.kind === 'bad' ? <Bad>{feeCheck.reason}</Bad> : null}
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
            {blocker ? <span style={{ fontSize: 12.5, color: '#f0c04e' }}>{blocker}</span> : null}
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
            <a href="/close" style={{ color: 'var(--brand)' }}>Close</a>.
          </p>
        </form>
      )}
    </Shell>
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

function Field({ label, note, children }: {
  label: string; note: string; children: React.ReactNode;
}) {
  return (
    <section style={{
      border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)',
      padding: '14px 16px', marginBottom: 14,
    }}>
      <div className="micro">{label}</div>
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
      color: tone === 'warn' ? '#f0c04e' : 'var(--crit)',
    }}>{children}</p>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone?: 'crit' }) {
  return (
    <div style={{
      margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13, maxWidth: '72ch',
    }}>{children}</div>
  );
}
