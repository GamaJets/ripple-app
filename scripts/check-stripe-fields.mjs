#!/usr/bin/env node
// Every Stripe field name in the webhook was unverified by anything.
//
// ── the hole, proved by mutation rather than asserted ─────────────────────
//
// `check:functions` type checks supabase/functions. It says so, and on 4 Sep it
// started being true — for the app's own modules. It is NOT true through the
// three specifiers a laptop cannot fetch. That gate declares `npm:*`, `jsr:*`
// and `https://esm.sh/*` as shorthand ambient modules, which is the only shape
// that makes named imports resolve at all, and the cost of that shape is that
// every binding out of them is `any`.
//
// So on 4 Sep this was written into stripe-webhook's `invoice.payment_failed`
// branch and `npm run check:functions` printed its success line:
//
//     inv.attempt_count.toUpperCase()
//
// `attempt_count` is a `number`. There is no `toUpperCase` on a number. The
// gate that claims to type check the edge functions could not see it, because
// `inv` is `any` and `any.attempt_count` is `any` and `any.toUpperCase()` is
// fine. That mutation still passes `check:functions` today; see the note at the
// bottom of this file for what does catch it and why this gate does not.
//
// stripe-webhook/index.ts is the highest-consequence file in the product. It
// writes money records. A field name that is misspelled, renamed by Stripe, or
// simply invented is `undefined` at runtime — not an error, not a 500, nothing
// on any screen. `undefined` then goes into a money column as null, or silently
// fails an `if` and skips a branch that should have recorded a refund.
//
// ── `deno check` is the right answer and it is not available here ─────────
//
// check-functions.mjs's own closing paragraph names `deno check` as "the last
// word before a deploy that touches money". Nothing ran it. On 14 Sep 2026 the
// reason was established rather than assumed:
//
//     command -v deno            → nothing, exit 1
//     brew list --formula        → no deno
//     ls ~/.deno/bin /opt/homebrew/bin /usr/local/bin → no deno binary
//     ls ~/Library/Caches/deno   → no such directory, so nothing is cached
//     supabase --version         → 2.109.1, and the CLI ships no deno of its own
//
// Deno is not installed on this machine and there is no module cache for it to
// work from. A gate that shells out to a binary that does not exist is a gate
// that either fails every run or skips every run, and the second is worse: it
// prints a success line for a check nobody performed. That is the exact failure
// this lane exists to stop, so this file does not pretend to run `deno check`
// and is not named as if it did.
//
// ── what this gate DOES check ─────────────────────────────────────────────
//
// The narrower thing that is fully verifiable offline: FIRST-HOP FIELD NAMES.
//
// Nine edge functions bind a Stripe object to a name with an explicit type —
// `const inv = event.data.object as Stripe.Invoice`, `(charge: Stripe.Charge)`
// — and then read fields off it. Those bindings say which Stripe object it is.
// The set of fields each Stripe object has is a fact, pinned below. So every
// `inv.<name>` in the file can be compared against that set, and a name that is
// not in it is a `undefined` waiting for a live payment.
//
// This catches the class the brief calls out: a misspelled or hallucinated
// field. `inv.attemp_count`, `inv.amountDue`, `sess.amount_total_cents`,
// `payout.arrival`, `d.amount_cents` — all silently `undefined` today, all
// caught here.
//
// ── where the pinned field lists came from ────────────────────────────────
//
// Not from memory. Lifted from the .d.ts of the SDK the functions actually pin.
// stripe-webhook/index.ts line 102 is `import Stripe from 'npm:stripe@^16'` and
// line 178 is `new Stripe(key, { apiVersion: '2024-06-20' })`; all nine Stripe
// functions pin the same `^16`. On 14 Sep 2026 `^16` resolved to 16.12.0, whose
// types are written against exactly that API version. To regenerate, in a
// scratch directory — NOT in this repo, and do not add stripe to package.json,
// these are types for code that runs on Deno and has no place in the app's
// dependency tree:
//
//     npm pack stripe@^16 && tar xzf stripe-16.*.tgz
//     # then read the top-level property signatures of each `interface` inside
//     # `namespace Stripe` in package/types/*.d.ts
//
// `Event` is the one entry that is not a single interface: `Stripe.Event` is a
// union of ~250 per-event-type interfaces, every one of which extends
// `EventBase`. The fields pinned here are EventBase's, which is the set that is
// safe on any event — and the webhook reads only those five of them.
//
// ── DRIFT, and which direction it fails in ────────────────────────────────
//
// `npm:stripe@^16` is a RANGE, not a pin. The deployed function can be running
// a later 16.x than the list below was taken from, and minor releases of the
// Stripe SDK ADD fields. So the list can go stale PERMISSIVELY — a field that
// is real in 16.20 but absent from this table reads as unknown and fails the
// build. That is the safe direction: a false failure somebody fixes by
// regenerating the table, rather than a false pass. Stripe does not remove
// fields in a minor, so the dangerous direction is not reachable by drift; it
// is only reachable by someone editing the table, which is why the table says
// where it came from.
//
// For the false-failure case there is an escape hatch, and it demands a reason:
//
//     // check:stripe-fields allow amount_shipping — added in stripe 16.14, pin below is 16.12
//
// on the offending line or the line above it. An allow with no reason after the
// dash is refused.
//
// ── WHAT THIS GATE CANNOT SEE ─────────────────────────────────────────────
//
// Written out in full, because a gate that overclaims is worse than one that
// states its limits — that is the lesson check:currency-copies wrote into this
// repo on 13 Sep, and the whole reason this file exists is that check:functions
// read as a type check when it was not one.
//
//   1. TYPES. This compares NAMES ONLY. `inv.attempt_count.toUpperCase()` —
//      the mutation in the header — passes this gate, because `attempt_count`
//      is a real field. So does `if (inv.created)` on a number-vs-string
//      confusion, and so does passing `inv.customer` (string | Customer | null)
//      where a string is wanted. Only `deno check`, with the real npm:stripe
//      types, catches those.
//   2. THE SECOND HOP. `charge.refunds` is checked; `.data` on the result is
//      not. `inv.status_transitions.paid_ot` is invisible here.
//   3. Anything not reachable from an explicitly typed binding. A Stripe object
//      that arrives untyped, or through a helper whose return type is inferred,
//      is not checked — nothing declares what it is. Destructuring and
//      `inv['amount_due']` ARE detected and reported, so that blind spot cannot
//      open quietly, but they are reported rather than checked.
//   4. Whether a field that exists is the RIGHT field. `inv.total` where
//      `inv.amount_due` was meant is a correct name and a wrong number.
//   5. Whether the object is the type the cast claims. `event.data.object as
//      Stripe.Invoice` on a `charge.refunded` event is a lie this gate believes.
//      `check:functions` does not catch that either, and neither does
//      `deno check` — a cast is an assertion. Only the event-type switch above
//      each cast makes it true, and only a human reads that.
//   6. Params objects. `stripe.invoices.list({ ... })` field names are not
//      checked; those fail loudly at the API rather than silently as undefined.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = process.cwd();
const ROOTS = ['supabase/functions'];

/**
 * Top-level field names, per Stripe object, from stripe@16.12.0's own .d.ts.
 *
 * `Event` is `EventBase` — see the header. `Checkout.Session` and
 * `PromotionCode.Restrictions` are nested namespaces and are keyed by the name
 * as it is written in the source, which is what the cast says.
 *
 * A `Stripe.X` used in supabase/functions with no entry here FAILS the run
 * rather than being skipped. That is deliberate and it is the whole ratchet: a
 * new Stripe object arriving in the webhook must bring its field list with it,
 * or this gate would quietly stop covering the newest code — which is precisely
 * how check:functions came to read as a type check of npm:stripe.
 */
const STRIPE_FIELDS = {
  "Event": ["account", "api_version", "created", "data", "id", "livemode", "object", "pending_webhooks", "request", "type"],
  "Invoice": ["account_country", "account_name", "account_tax_ids", "amount_due", "amount_paid", "amount_remaining", "amount_shipping", "application", "application_fee_amount", "attempt_count", "attempted", "auto_advance", "automatic_tax", "automatically_finalizes_at", "billing_reason", "charge", "collection_method", "created", "currency", "custom_fields", "customer", "customer_address", "customer_email", "customer_name", "customer_phone", "customer_shipping", "customer_tax_exempt", "customer_tax_ids", "default_payment_method", "default_source", "default_tax_rates", "deleted", "description", "discount", "discounts", "due_date", "effective_at", "ending_balance", "footer", "from_invoice", "hosted_invoice_url", "id", "invoice_pdf", "issuer", "last_finalization_error", "latest_revision", "lines", "livemode", "metadata", "next_payment_attempt", "number", "object", "on_behalf_of", "paid", "paid_out_of_band", "payment_intent", "payment_settings", "period_end", "period_start", "post_payment_credit_notes_amount", "pre_payment_credit_notes_amount", "quote", "receipt_number", "rendering", "shipping_cost", "shipping_details", "starting_balance", "statement_descriptor", "status", "status_transitions", "subscription", "subscription_details", "subscription_proration_date", "subtotal", "subtotal_excluding_tax", "tax", "test_clock", "threshold_reason", "total", "total_discount_amounts", "total_excluding_tax", "total_tax_amounts", "transfer_data", "webhooks_delivered_at"],
  "Subscription": ["application", "application_fee_percent", "automatic_tax", "billing_cycle_anchor", "billing_cycle_anchor_config", "billing_thresholds", "cancel_at", "cancel_at_period_end", "canceled_at", "cancellation_details", "collection_method", "created", "currency", "current_period_end", "current_period_start", "customer", "days_until_due", "default_payment_method", "default_source", "default_tax_rates", "description", "discount", "discounts", "ended_at", "id", "invoice_settings", "items", "latest_invoice", "livemode", "metadata", "next_pending_invoice_item_invoice", "object", "on_behalf_of", "pause_collection", "payment_settings", "pending_invoice_item_interval", "pending_setup_intent", "pending_update", "schedule", "start_date", "status", "test_clock", "transfer_data", "trial_end", "trial_settings", "trial_start"],
  "Account": ["business_profile", "business_type", "capabilities", "charges_enabled", "company", "controller", "country", "created", "default_currency", "deleted", "details_submitted", "email", "external_accounts", "future_requirements", "id", "individual", "metadata", "object", "payouts_enabled", "requirements", "settings", "tos_acceptance", "type"],
  "Payout": ["amount", "application_fee", "application_fee_amount", "arrival_date", "automatic", "balance_transaction", "created", "currency", "description", "destination", "failure_balance_transaction", "failure_code", "failure_message", "id", "livemode", "metadata", "method", "object", "original_payout", "reconciliation_status", "reversed_by", "source_type", "statement_descriptor", "status", "type"],
  "Checkout.Session": ["after_expiration", "allow_promotion_codes", "amount_subtotal", "amount_total", "automatic_tax", "billing_address_collection", "cancel_url", "client_reference_id", "client_secret", "consent", "consent_collection", "created", "currency", "currency_conversion", "custom_fields", "custom_text", "customer", "customer_creation", "customer_details", "customer_email", "expires_at", "id", "invoice", "invoice_creation", "line_items", "livemode", "locale", "metadata", "mode", "object", "payment_intent", "payment_link", "payment_method_collection", "payment_method_configuration_details", "payment_method_options", "payment_method_types", "payment_status", "phone_number_collection", "recovered_from", "redirect_on_completion", "return_url", "saved_payment_method_options", "setup_intent", "shipping_address_collection", "shipping_cost", "shipping_details", "shipping_options", "status", "submit_type", "subscription", "success_url", "tax_id_collection", "total_details", "ui_mode", "url"],
  "Charge": ["amount", "amount_captured", "amount_refunded", "application", "application_fee", "application_fee_amount", "authorization_code", "balance_transaction", "billing_details", "calculated_statement_descriptor", "captured", "created", "currency", "customer", "description", "disputed", "failure_balance_transaction", "failure_code", "failure_message", "fraud_details", "id", "invoice", "level3", "livemode", "metadata", "object", "on_behalf_of", "outcome", "paid", "payment_intent", "payment_method", "payment_method_details", "radar_options", "receipt_email", "receipt_number", "receipt_url", "refunded", "refunds", "review", "shipping", "source", "source_transfer", "statement_descriptor", "statement_descriptor_suffix", "status", "transfer", "transfer_data", "transfer_group"],
  "Dispute": ["amount", "balance_transactions", "charge", "created", "currency", "evidence", "evidence_details", "id", "is_charge_refundable", "livemode", "metadata", "network_reason_code", "object", "payment_intent", "payment_method_details", "reason", "status"],
  "Refund": ["amount", "balance_transaction", "charge", "created", "currency", "description", "destination_details", "failure_balance_transaction", "failure_reason", "id", "instructions_email", "metadata", "next_action", "object", "payment_intent", "reason", "receipt_number", "source_transfer_reversal", "status", "transfer_reversal"],
  "Customer": ["address", "balance", "cash_balance", "created", "currency", "default_source", "deleted", "delinquent", "description", "discount", "email", "id", "invoice_credit_balance", "invoice_prefix", "invoice_settings", "livemode", "metadata", "name", "next_invoice_sequence", "object", "phone", "preferred_locales", "shipping", "sources", "subscriptions", "tax", "tax_exempt", "tax_ids", "test_clock"],
  "Coupon": ["amount_off", "applies_to", "created", "currency", "currency_options", "deleted", "duration", "duration_in_months", "id", "livemode", "max_redemptions", "metadata", "name", "object", "percent_off", "redeem_by", "times_redeemed", "valid"],
  "PromotionCode": ["active", "code", "coupon", "created", "customer", "expires_at", "id", "livemode", "max_redemptions", "metadata", "object", "restrictions", "times_redeemed"],
  "PromotionCode.Restrictions": ["currency_options", "first_time_transaction", "minimum_amount", "minimum_amount_currency"],
  "Price": ["active", "billing_scheme", "created", "currency", "currency_options", "custom_unit_amount", "deleted", "id", "livemode", "lookup_key", "metadata", "nickname", "object", "product", "recurring", "tax_behavior", "tiers", "tiers_mode", "transform_quantity", "type", "unit_amount", "unit_amount_decimal"],
};

/**
 * The floor, and it is the point of the exercise.
 *
 * A gate that reads Stripe bindings out of the AST stops reading them the day
 * somebody changes how the bindings are written — a helper that returns the
 * cast object, a shared `asInvoice()`, a switch that hands the handler an
 * untyped argument. None of those are wrong; all of them would empty this gate
 * while it went on printing a success line. That is what happened to the type
 * check in check:functions and it is not going to happen to this one quietly.
 *
 * 14 Sep 2026: 25 typed bindings, 254 first-hop field reads. The floors are set
 * at roughly two thirds, which is far enough below the truth that deleting a
 * handler does not trip it and far enough above zero that a refactor which
 * stops this parser seeing Stripe objects cannot pass.
 */
const MIN_BINDINGS = 16;   // 25 on 14 Sep 2026
const MIN_READS = 170;     // 254 on 14 Sep 2026

const DIR = join(ROOT, 'supabase', 'functions');
if (!existsSync(DIR)) {
  console.error('check:stripe-fields — no supabase/functions directory. Run from the repository root.');
  process.exit(1);
}

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const files = walk(DIR);
assertRootFloors('check:stripe-fields', { [ROOTS[0]]: files.length });

// ── the escape hatch ──────────────────────────────────────────────────────
//
// `// check:stripe-fields allow <field> — <reason>` on the line of the access
// or the line above it. The reason is not optional and is not decorative: the
// only legitimate use is "this field is real in a 16.x later than the table",
// and a person reading that line six months later needs to know whether it is
// still true or whether the table simply wants regenerating.
const ALLOW = /\/\/\s*check:stripe-fields\s+allow\s+([A-Za-z_$][\w$]*)\s*(?:[—–-]\s*(.*))?$/;

function allowances(src) {
  const byLine = new Map();   // 1-based line → { field, reason }
  src.split('\n').forEach((text, i) => {
    const m = ALLOW.exec(text);
    if (m) byLine.set(i + 1, { field: m[1], reason: (m[2] ?? '').trim() });
  });
  return byLine;
}

/**
 * The Stripe object type a type node names, or null.
 *
 * Deliberately strict. A bare `Stripe.X`, optionally in a union with `null` or
 * `undefined`, and nothing else. An ARRAY is rejected — `Stripe.Refund[]` binds
 * a name whose properties are `length` and `map`, not a refund's, and an early
 * draft of this gate reported `list.map` and `embedded.length` as invented
 * Stripe fields because it unwrapped the array and believed the element type.
 */
function stripeType(node) {
  if (!node) return null;
  if (ts.isParenthesizedTypeNode(node)) return stripeType(node.type);
  if (ts.isUnionTypeNode(node)) {
    const named = node.types.filter((t) =>
      t.kind !== ts.SyntaxKind.NullKeyword
      && t.kind !== ts.SyntaxKind.UndefinedKeyword
      && !(ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword));
    return named.length === 1 ? stripeType(named[0]) : null;
  }
  if (ts.isTypeReferenceNode(node) && !node.typeArguments?.length) {
    const t = node.typeName.getText();
    return t.startsWith('Stripe.') ? t.slice('Stripe.'.length) : null;
  }
  return null;
}

// ── scope, because two different `d`s live in stripe-webhook ──────────────
//
// Line 1710 is `const d = event.data.object as Stripe.Dispute`. Lines 1574 and
// 1577 are `(d: { stripe_refund_id: string | null }) => d.stripe_refund_id` and
// `(a: number, d: { amount_cents: number | null }) => …` — callback parameters
// over the app's OWN rows, in a different scope, that happen to share a letter.
// A name-keyed scan reports both of those as invented Stripe fields, which is a
// gate nobody would keep. So declarations are tracked through a real scope
// chain and a shadowing binding wins, exactly as it does at runtime.
const SCOPED = (n) =>
  ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n) || ts.isCaseBlock(n)
  || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)
  || ts.isCatchClause(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n)
  || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n);

const problems = [];
let bindings = 0;
let reads = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const allowed = allowances(src);
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const scopes = [new Map()];
  const lookup = (name) => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name);
    return undefined;
  };
  // Every bound name is declared, Stripe or not. A local `const inv = row` in an
  // inner block has to be able to hide the outer Stripe one, or the shadowing is
  // only half-modelled and the wrong half is the one that produces noise.
  const declarePattern = (name) => {
    if (ts.isIdentifier(name)) { scopes[scopes.length - 1].set(name.text, null); return; }
    name.forEachChild?.((c) => {
      if (ts.isBindingElement(c)) declarePattern(c.name);
    });
  };

  const check = (type, prop, pos, expr) => {
    const fields = STRIPE_FIELDS[type];
    const line = lineOf(pos);
    if (!fields) {
      problems.push(
        `  ${rel}:${line}  \`${expr}.${prop}\` reads a \`Stripe.${type}\`, and this gate has no field list for that type.`
        + ` Add one to STRIPE_FIELDS in scripts/check-stripe-fields.mjs, lifted from stripe@^16's own .d.ts`
        + ` (the recipe is in this file's header) — a Stripe object nobody pinned is a Stripe object nobody is checking.`);
      return;
    }
    reads++;
    if (fields.includes(prop)) return;
    const hatch = allowed.get(line) ?? allowed.get(line - 1);
    if (hatch && hatch.field === prop) {
      if (hatch.reason) return;
      problems.push(
        `  ${rel}:${line}  the allow for \`${prop}\` has no reason after the dash.`
        + ` The only good reason is that the field is real in a stripe 16.x later than the pinned table;`
        + ` write that, with the version, so the next reader can tell whether it still holds.`);
      return;
    }
    // The near-miss is worth printing. Every one of these found in anger has
    // been a transposition or a camelCase, and naming the neighbour turns a
    // thirty-second search into none.
    const near = fields.filter((f) =>
      f.replace(/_/g, '').toLowerCase() === prop.replace(/_/g, '').toLowerCase()
      || f.startsWith(prop) || prop.startsWith(f));
    problems.push(
      `  ${rel}:${line}  \`${expr}.${prop}\` — \`Stripe.${type}\` has no field \`${prop}\`.`
      + (near.length ? ` Did you mean \`${near.slice(0, 3).join('\` or \`')}\`?` : '')
      + ` Stripe returns plain JSON, so this is \`undefined\` at runtime with no error and nothing in any log —`
      + ` and in stripe-webhook that is a null written into a money column, or a branch that never runs.`
      + ` If the field is genuinely real in a later 16.x, regenerate STRIPE_FIELDS or add`
      + ` \`// check:stripe-fields allow ${prop} — <why>\`.`);
  };

  const visit = (node) => {
    const pushed = SCOPED(node);
    if (pushed) scopes.push(new Map());

    // Parameters declare into the scope the function body opened.
    if (ts.isParameter(node) && node.parent && SCOPED(node.parent)) {
      const t = stripeType(node.type);
      if (ts.isIdentifier(node.name)) {
        scopes[scopes.length - 1].set(node.name.text, t);
        if (t) bindings++;
      } else declarePattern(node.name);
    }

    if (ts.isVariableDeclaration(node)) {
      // Visit the initializer FIRST: `const inv = event.data.object as Stripe.Invoice`
      // reads `event` under the bindings that existed before `inv` did.
      if (node.initializer) visit(node.initializer);
      if (node.type) visit(node.type);
      const t = stripeType(node.type)
        ?? (node.initializer && ts.isAsExpression(node.initializer) ? stripeType(node.initializer.type) : null);
      if (ts.isIdentifier(node.name)) {
        scopes[scopes.length - 1].set(node.name.text, t);
        if (t) bindings++;
        // `const { amount_due } = inv` — a real pattern, and one this gate
        // cannot read. Reported rather than ignored so the blind spot in the
        // header stays a stated limit instead of becoming a silent one.
      } else if (node.initializer && ts.isIdentifier(node.initializer) && lookup(node.initializer.text)) {
        problems.push(
          `  ${rel}:${lineOf(node.getStart(sf))}  destructures a \`Stripe.${lookup(node.initializer.text)}\`.`
          + ` This gate reads \`${node.initializer.text}.<field>\` and cannot see through a binding pattern,`
          + ` so these field names would go unchecked. Write the reads as property accesses.`);
        declarePattern(node.name);
      } else declarePattern(node.name);
      if (pushed) scopes.pop();
      return;
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const t = lookup(node.expression.text);
      if (t) check(t, node.name.text, node.name.getStart(sf), node.expression.text);
    }

    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const t = lookup(node.expression.text);
      if (t) {
        problems.push(
          `  ${rel}:${lineOf(node.getStart(sf))}  \`${node.expression.text}[…]\` indexes a \`Stripe.${t}\`.`
          + ` A computed key is not a name this gate can compare, so the field would go unchecked.`
          + ` Write \`${node.expression.text}.<field>\`.`);
      }
    }

    node.forEachChild(visit);
    if (pushed) scopes.pop();
  };

  sf.forEachChild(visit);
}

if (bindings < MIN_BINDINGS || reads < MIN_READS) {
  console.error(
    'check:stripe-fields — this gate found almost nothing to check, so whatever it printed next\n'
    + 'would be a claim about code it never read.\n');
  console.error(`  typed Stripe bindings: ${bindings}, floor ${MIN_BINDINGS}`);
  console.error(`  first-hop field reads: ${reads}, floor ${MIN_READS}\n`);
  console.error(
    'The likely cause is not a deletion. It is that the Stripe objects are now bound in a shape this\n'
    + "parser does not recognise — a helper that returns the cast, an inferred return type, a handler\n"
    + 'taking an untyped argument. Teach the parser the new shape, or lower the floor here with a\n'
    + 'reason. Do not leave it passing on zero: that is exactly how check:functions came to read as a\n'
    + 'type check of npm:stripe when it was typing it as `any`.');
  process.exit(1);
}

if (problems.length) {
  console.error(`check:stripe-fields — ${problems.length} problem(s):\n`);
  console.error(problems.join('\n\n'));
  console.error(`
These are field NAMES only, compared against stripe@16.12.0's own .d.ts. A wrong
name on a Stripe object is \`undefined\` — not an exception, not a log line — and
supabase/functions/stripe-webhook/index.ts turns \`undefined\` into a null in a
money column or a branch that silently does not run.

This gate does not check TYPES. \`deno check\` does, and it is still the last word
before a deploy that touches money; deno is not installed here.`);
  process.exit(1);
}

console.log(
  `check:stripe-fields — ok, ${reads} first-hop field read(s) across ${bindings} typed Stripe binding(s)`
  + ` in ${files.length} edge function file(s) are real fields in stripe@16.12.0 (npm:stripe@^16, API 2024-06-20).`);
console.log(
  '  NAMES ONLY. This does not type check npm:stripe — `inv.attempt_count.toUpperCase()` passes both this');
console.log(
  '  gate and check:functions. `deno check` is what catches that, and deno is not installed here; see the');
console.log(
  '  header of this file for the full list of what it cannot see.');
