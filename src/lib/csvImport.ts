// Bringing a gym's existing records in from a spreadsheet.
//
// This matters more than it looks. Everything else Studio does — retention,
// forecasting, payroll, the lot — is worthless against an empty record. A gym
// that cannot import its history starts from zero on day one and has no
// comparison year until it has been running Repple for twelve months.
//
// The governing decision here: **never guess at an ambiguous value.** An import
// that silently misreads 03/04/2026 as 3 April when the gym meant 4 March does
// not fail loudly — it produces a year of plausible, wrong history that nobody
// notices until a renewal date is missed. Every row that cannot be read with
// confidence comes back as a refusal with a reason, and the import reports what
// it would do before it does anything.

import { parseSheet, mapColumns, type Sheet } from './csv';

/* ── values ────────────────────────────────────────────────────────────────── */

/** Which way round a d/m/y style date is written. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const MONEY_STRIP = /[^\d.,\-()]/g;

/**
 * Parse a money column into integer minor units.
 *
 * Handles both conventions — "1,234.56" and "1.234,56" — by taking whichever
 * separator appears last as the decimal point. A lone separator followed by
 * exactly three digits is read as a thousands separator, because "1,234" in a
 * price column is a thousand-something, not one-point-two-three-four.
 *
 * Anything with more than two decimal places is refused rather than rounded:
 * a column of four-decimal figures is a unit price or an exchange rate, and
 * rounding it silently turns a data-shape problem into a money problem.
 */
export function parseMoneyCents(raw: string): Parsed<number> {
  const t = raw.trim();
  if (t === '') return { ok: false, reason: 'empty' };

  const negative = /^\(.*\)$/.test(t) || t.trimStart().startsWith('-');
  let s = t.replace(MONEY_STRIP, '').replace(/[()]/g, '').replace(/-/g, '');
  if (s === '') return { ok: false, reason: `"${raw}" has no digits` };

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalAt = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const after = s.length - at - 1;
    // Three digits after a single separator: thousands, not decimals.
    decimalAt = after === 3 ? -1 : at;
  }

  let whole: string;
  let frac = '';
  if (decimalAt >= 0) {
    whole = s.slice(0, decimalAt);
    frac = s.slice(decimalAt + 1);
    if (frac.length > 2) {
      return { ok: false, reason: `"${raw}" has ${frac.length} decimal places; money takes at most 2` };
    }
  } else {
    whole = s;
  }

  whole = whole.replace(/[.,]/g, '');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) {
    return { ok: false, reason: `"${raw}" is not a number` };
  }
  if (whole === '' && frac === '') return { ok: false, reason: `"${raw}" is not a number` };

  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return { ok: false, reason: `"${raw}" is not a number` };
  return { ok: true, value: negative ? -cents : cents };
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASHED = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/;

function ymdToIso(y: number, m: number, d: number): Parsed<string> {
  if (m < 1 || m > 12) return { ok: false, reason: `month ${m} is out of range` };
  if (d < 1 || d > 31) return { ok: false, reason: `day ${d} is out of range` };
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Round-trip catches 31 February and friends, which Date would roll forward.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, reason: `${y}-${m}-${d} is not a real date` };
  }
  return { ok: true, value: dt.toISOString().slice(0, 10) };
}

/**
 * Parse a date column to an ISO date.
 *
 * ISO input is unambiguous and always accepted. For slash/dot/dash dates the
 * order must be known: if the value itself settles it (a component above 12
 * can only be the day) it is used, otherwise `order` decides. With neither,
 * the value is refused — see `detectDateOrder`, which reads the whole column
 * first so the gym is usually never asked.
 */
export function parseDate(raw: string, order?: DateOrder): Parsed<string> {
  const t = raw.trim();
  if (t === '') return { ok: false, reason: 'empty' };

  const iso = ISO.exec(t);
  if (iso) return ymdToIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const m = SLASHED.exec(t);
  if (!m) return { ok: false, reason: `"${raw}" is not a date this can read` };

  let a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);

  // A four-digit leading component can only be a year.
  if (m[1].length === 4) return ymdToIso(a, b, c);

  // Two-digit years: a gym's records are not from the 1900s.
  if (c < 100) c += c <= 69 ? 2000 : 1900;

  const aIsDay = a > 12;
  const bIsDay = b > 12;
  if (aIsDay && bIsDay) return { ok: false, reason: `"${raw}" has two components above 12` };
  if (aIsDay) return ymdToIso(c, b, a);   // day first, settled by the value
  if (bIsDay) return ymdToIso(c, a, b);   // month first, settled by the value

  // Genuinely ambiguous: 03/04/2026 is two different real dates.
  if (!order) {
    return {
      ok: false,
      reason: `"${raw}" could be day-first or month-first — say which the file uses`,
    };
  }
  return order === 'mdy' ? ymdToIso(c, a, b) : ymdToIso(c, b, a);
}

/**
 * Read a whole column of dates and work out the file's convention.
 *
 * One unambiguous value settles the whole file: if any row says 25/12/2026,
 * the file is day-first and every 03/04 in it can be read with confidence. This
 * is why the importer rarely has to ask.
 *
 * Returns 'ambiguous' when every value could be read both ways, and 'unknown'
 * when there is nothing parseable to go on.
 */
export function detectDateOrder(values: string[]): DateOrder | 'ambiguous' | 'unknown' {
  let sawAny = false;
  let sawDmy = false;
  let sawMdy = false;
  let sawIso = false;

  for (const raw of values) {
    const t = raw.trim();
    if (t === '') continue;
    if (ISO.test(t)) { sawIso = true; sawAny = true; continue; }
    const m = SLASHED.exec(t);
    if (!m) continue;
    sawAny = true;
    if (m[1].length === 4) { sawIso = true; continue; }
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) sawDmy = true;
    else if (b > 12 && a <= 12) sawMdy = true;
  }

  // A file containing both 25/12 and 12/25 is internally inconsistent; refusing
  // is right, because whichever way we read it, some rows land wrong.
  if (sawDmy && sawMdy) return 'ambiguous';
  if (sawDmy) return 'dmy';
  if (sawMdy) return 'mdy';
  if (sawIso) return 'ymd';
  return sawAny ? 'ambiguous' : 'unknown';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseEmail(raw: string): Parsed<string> {
  const t = raw.trim().toLowerCase();
  if (t === '') return { ok: false, reason: 'empty' };
  if (!EMAIL.test(t)) return { ok: false, reason: `"${raw}" is not an email address` };
  return { ok: true, value: t };
}

/* ── member import ─────────────────────────────────────────────────────────── */

export const MEMBER_ALIASES: Record<string, string[]> = {
  name:    ['name', 'full name', 'member', 'member name', 'customer', 'client'],
  email:   ['email', 'e-mail', 'email address'],
  plan:    ['plan', 'membership', 'membership plan', 'package', 'tier'],
  started: ['started', 'start date', 'joined', 'join date', 'member since', 'start'],
  ends:    ['ends', 'end date', 'expires', 'expiry', 'renewal', 'renews'],
  status:  ['status', 'state', 'active'],
};

export interface MemberRow {
  name: string;
  email: string | null;
  plan: string | null;
  startedOn: string | null;
  endsOn: string | null;
  status: 'active' | 'frozen' | 'cancelled' | 'expired';
}

export interface RowResult<T> {
  /** 1-based line number in the original file, counting the header. */
  line: number;
  value?: T;
  errors: string[];
}

export interface ImportPreview<T> {
  sheet: Sheet;
  /** Fields that could not be found in the header at all. */
  missingRequired: string[];
  /** Header columns that matched nothing — reported, never silently dropped. */
  unmatchedColumns: string[];
  dateOrder: DateOrder | 'ambiguous' | 'unknown';
  rows: RowResult<T>[];
  ready: T[];
  rejected: RowResult<T>[];
}

const STATUSES: Record<string, MemberRow['status']> = {
  active: 'active', current: 'active', live: 'active', yes: 'active', true: 'active', '1': 'active',
  frozen: 'frozen', paused: 'frozen', hold: 'frozen', suspended: 'frozen',
  cancelled: 'cancelled', canceled: 'cancelled', left: 'cancelled', no: 'cancelled', false: 'cancelled', '0': 'cancelled',
  expired: 'expired', lapsed: 'expired', ended: 'expired',
};

/**
 * Read a member spreadsheet without writing anything.
 *
 * Always a dry run. The caller shows the result, the gym confirms, and only
 * then does anything reach the database — an import that half-succeeded and
 * left no record of which half is the worst possible outcome.
 */
export function previewMembers(text: string, order?: DateOrder): ImportPreview<MemberRow> {
  const sheet = parseSheet(text);
  const { index, unmatched } = mapColumns(sheet.header, MEMBER_ALIASES);

  const missingRequired = index.name === undefined ? ['name'] : [];

  const at = (r: string[], f: string): string =>
    index[f] === undefined ? '' : (r[index[f]] ?? '');

  // Settle the date convention from the whole file before reading any row.
  const dateCells = [
    ...(index.started !== undefined ? sheet.rows.map((r) => at(r, 'started')) : []),
    ...(index.ends !== undefined ? sheet.rows.map((r) => at(r, 'ends')) : []),
  ];
  const detected = detectDateOrder(dateCells);
  const effective: DateOrder | undefined =
    order ?? (detected === 'ambiguous' || detected === 'unknown' ? undefined : detected);

  const rows: RowResult<MemberRow>[] = sheet.rows.map((r, i) => {
    const line = i + 2; // +1 for zero-index, +1 for the header
    const errors: string[] = [];

    const name = at(r, 'name').trim();
    if (!name) errors.push('no name');

    let email: string | null = null;
    const rawEmail = at(r, 'email').trim();
    if (rawEmail) {
      const e = parseEmail(rawEmail);
      if (e.ok) email = e.value; else errors.push(e.reason);
    }

    let startedOn: string | null = null;
    const rawStart = at(r, 'started').trim();
    if (rawStart) {
      const d = parseDate(rawStart, effective);
      if (d.ok) startedOn = d.value; else errors.push(`start date: ${d.reason}`);
    }

    let endsOn: string | null = null;
    const rawEnd = at(r, 'ends').trim();
    if (rawEnd) {
      const d = parseDate(rawEnd, effective);
      if (d.ok) endsOn = d.value; else errors.push(`end date: ${d.reason}`);
    }

    if (startedOn && endsOn && endsOn < startedOn) {
      errors.push('membership ends before it starts');
    }

    const rawStatus = at(r, 'status').trim().toLowerCase();
    let status: MemberRow['status'] = 'active';
    if (rawStatus) {
      const s = STATUSES[rawStatus];
      // An unrecognised status is refused rather than defaulted to active — a
      // cancelled member imported as active gets chased for money.
      if (!s) errors.push(`status "${at(r, 'status').trim()}" is not one this recognises`);
      else status = s;
    }

    const plan = at(r, 'plan').trim() || null;
    const value: MemberRow = { name, email, plan, startedOn, endsOn, status };
    return { line, value, errors };
  });

  // A duplicate email in the file itself would create two members for one
  // person. Flag the later one; the first keeps the row.
  const seen = new Map<string, number>();
  for (const r of rows) {
    const e = r.value?.email;
    if (!e) continue;
    const first = seen.get(e);
    if (first !== undefined) r.errors.push(`duplicate of line ${first} (same email)`);
    else seen.set(e, r.line);
  }

  const rejected = rows.filter((r) => r.errors.length > 0);
  return {
    sheet,
    missingRequired,
    unmatchedColumns: unmatched,
    dateOrder: order ?? detected,
    rows,
    ready: missingRequired.length ? [] : rows.filter((r) => r.errors.length === 0).map((r) => r.value!),
    rejected,
  };
}

/* ── payment import ────────────────────────────────────────────────────────── */

export const PAYMENT_ALIASES: Record<string, string[]> = {
  member: ['member', 'name', 'customer', 'paid by', 'client'],
  email:  ['email', 'e-mail', 'email address'],
  amount: ['amount', 'total', 'paid', 'value', 'gross', 'sum'],
  date:   ['date', 'paid on', 'payment date', 'taken', 'received'],
  method: ['method', 'type', 'payment method', 'via'],
  note:   ['note', 'notes', 'reference', 'description', 'memo'],
};

export interface PaymentRow {
  memberName: string | null;
  email: string | null;
  amountCents: number;
  takenOn: string;
  method: 'card' | 'cash' | 'transfer' | 'direct_debit' | 'other';
  note: string | null;
}

const METHODS: Record<string, PaymentRow['method']> = {
  card: 'card', creditcard: 'card', debitcard: 'card', visa: 'card', mastercard: 'card', stripe: 'card',
  cash: 'cash',
  transfer: 'transfer', banktransfer: 'transfer', bacs: 'transfer', wire: 'transfer',
  directdebit: 'direct_debit', dd: 'direct_debit', gocardless: 'direct_debit', standingorder: 'direct_debit',
};

export function previewPayments(text: string, order?: DateOrder): ImportPreview<PaymentRow> {
  const sheet = parseSheet(text);
  const { index, unmatched } = mapColumns(sheet.header, PAYMENT_ALIASES);

  const missingRequired: string[] = [];
  if (index.amount === undefined) missingRequired.push('amount');
  if (index.date === undefined) missingRequired.push('date');

  const at = (r: string[], f: string): string =>
    index[f] === undefined ? '' : (r[index[f]] ?? '');

  const detected = detectDateOrder(
    index.date !== undefined ? sheet.rows.map((r) => at(r, 'date')) : [],
  );
  const effective: DateOrder | undefined =
    order ?? (detected === 'ambiguous' || detected === 'unknown' ? undefined : detected);

  const rows: RowResult<PaymentRow>[] = sheet.rows.map((r, i) => {
    const line = i + 2;
    const errors: string[] = [];

    const amt = parseMoneyCents(at(r, 'amount'));
    if (!amt.ok) errors.push(`amount: ${amt.reason}`);
    // A zero payment is a real thing (a comped month, a correction). A negative
    // one is a refund, which is not what this importer is for.
    else if (amt.value < 0) errors.push('amount is negative — refunds are not imported here');

    const d = parseDate(at(r, 'date'), effective);
    if (!d.ok) errors.push(`date: ${d.reason}`);

    let email: string | null = null;
    const rawEmail = at(r, 'email').trim();
    if (rawEmail) {
      const e = parseEmail(rawEmail);
      if (e.ok) email = e.value; else errors.push(e.reason);
    }

    const memberName = at(r, 'member').trim() || null;
    if (!memberName && !email) {
      errors.push('no member name or email — this payment cannot be attributed');
    }

    const rawMethod = at(r, 'method').trim().toLowerCase().replace(/[^a-z]/g, '');
    const method: PaymentRow['method'] = rawMethod ? (METHODS[rawMethod] ?? 'other') : 'other';

    const value: PaymentRow = {
      memberName,
      email,
      amountCents: amt.ok ? amt.value : 0,
      takenOn: d.ok ? d.value : '',
      method,
      note: at(r, 'note').trim() || null,
    };
    return { line, value, errors };
  });

  const rejected = rows.filter((r) => r.errors.length > 0);
  return {
    sheet,
    missingRequired,
    unmatchedColumns: unmatched,
    dateOrder: order ?? detected,
    rows,
    ready: missingRequired.length ? [] : rows.filter((r) => r.errors.length === 0).map((r) => r.value!),
    rejected,
  };
}

/* ── plans ─────────────────────────────────────────────────────────────────── */

export const PLAN_ALIASES: Record<string, string[]> = {
  name:     ['name', 'plan', 'plan name', 'membership', 'membership plan', 'package', 'tier', 'product'],
  price:    ['price', 'amount', 'cost', 'fee', 'rate', 'monthly', 'monthly price', 'value'],
  interval: ['interval', 'period', 'billing', 'billing period', 'frequency', 'recurrence', 'term'],
  currency: ['currency', 'ccy', 'cur'],
  active:   ['active', 'status', 'state', 'enabled', 'available'],
};

export interface PlanRow {
  name: string;
  priceCents: number;
  /** Matches membership_plans.interval — `once` is a day pass or joining fee. */
  interval: 'month' | 'year' | 'once';
  currency: string;
  active: boolean;
}

/**
 * How a billing period is written in the wild.
 *
 * Only spellings that are unambiguous appear here. "Quarterly", "weekly" and
 * "6 months" are deliberately ABSENT: membership_plans.interval accepts exactly
 * month, year and once, so there is nowhere truthful to put them. Mapping a
 * quarterly plan onto `month` would divide a gym's recurring revenue by three,
 * and onto `year` would multiply it by four. Those rows are refused with a
 * reason so somebody decides, rather than being silently repriced.
 */
const INTERVALS: Record<string, PlanRow['interval']> = {
  month: 'month', monthly: 'month', 'per month': 'month', 'a month': 'month',
  pm: 'month', mo: 'month', m: 'month', '1 month': 'month', 'every month': 'month',
  year: 'year', yearly: 'year', annual: 'year', annually: 'year',
  'per year': 'year', 'a year': 'year', pa: 'year', yr: 'year', y: 'year',
  '12 months': 'year', '1 year': 'year',
  once: 'once', 'one off': 'once', 'one-off': 'once', oneoff: 'once',
  single: 'once', 'day pass': 'once', daypass: 'once', 'drop in': 'once',
  'drop-in': 'once', joining: 'once', 'joining fee': 'once', 'sign up': 'once',
};

/** Words that mean a plan is NOT on sale. Anything else unrecognised is refused. */
const INACTIVE_WORDS = new Set([
  'no', 'n', 'false', '0', 'inactive', 'disabled', 'archived', 'retired',
  'hidden', 'off', 'discontinued', 'closed',
]);
const ACTIVE_WORDS = new Set([
  'yes', 'y', 'true', '1', 'active', 'enabled', 'live', 'on', 'available', 'current',
]);

/**
 * Read a sheet of membership plans.
 *
 * Name and price are both required. A plan with no price is not a plan whose
 * price is zero — it is a row somebody has not finished writing, and importing
 * it as free is how a gym ends up selling memberships for nothing.
 *
 * Zero itself IS allowed, because a complimentary or staff plan is a real
 * thing a gym sells at nothing on purpose. The distinction is between an
 * absent cell and a deliberate 0.
 */
export function previewPlans(text: string): ImportPreview<PlanRow> {
  const sheet = parseSheet(text);
  const { index, unmatched } = mapColumns(sheet.header, PLAN_ALIASES);

  const missingRequired: string[] = [];
  if (index.name === undefined) missingRequired.push('name');
  if (index.price === undefined) missingRequired.push('price');

  const at = (r: string[], f: string): string =>
    index[f] === undefined ? '' : (r[index[f]] ?? '');

  // Plans carry no dates, so there is no convention to settle. Reported as
  // 'unknown' rather than omitted, because ImportPreview is shared and a
  // missing field would read as a bug in the caller.
  const seen = new Map<string, number>();

  const rows: RowResult<PlanRow>[] = sheet.rows.map((r, i) => {
    const line = i + 2; // +1 for zero-index, +1 for the header
    const errors: string[] = [];

    const name = at(r, 'name').trim();
    if (!name) errors.push('no name');

    // A price list with the same plan twice is usually two prices for one
    // thing. Importing both leaves the gym selling at whichever the UI
    // happens to list first.
    const key = name.toLowerCase();
    if (name) {
      const first = seen.get(key);
      if (first !== undefined) errors.push(`duplicate of line ${first}`);
      else seen.set(key, line);
    }

    let priceCents = 0;
    const rawPrice = at(r, 'price').trim();
    if (!rawPrice) {
      errors.push('no price — a blank price is an unfinished row, not a free plan');
    } else {
      const m = parseMoneyCents(rawPrice);
      if (m.ok) {
        if (m.value < 0) errors.push('price is negative');
        else priceCents = m.value;
      } else errors.push(`price: ${m.reason}`);
    }

    let interval: PlanRow['interval'] = 'month';
    const rawInterval = at(r, 'interval').trim().toLowerCase();
    if (rawInterval) {
      const hit = INTERVALS[rawInterval];
      if (hit) interval = hit;
      else errors.push(`billing period "${at(r, 'interval').trim()}" is not month, year or one-off`);
    }

    // Currency defaults at the database, so an absent column is fine. A
    // present one that is not a 3-letter code is not.
    let currency = 'AED';
    const rawCurrency = at(r, 'currency').trim().toUpperCase();
    if (rawCurrency) {
      if (/^[A-Z]{3}$/.test(rawCurrency)) currency = rawCurrency;
      else errors.push(`currency "${at(r, 'currency').trim()}" is not a three-letter code`);
    }

    let active = true;
    const rawActive = at(r, 'active').trim().toLowerCase();
    if (rawActive) {
      if (ACTIVE_WORDS.has(rawActive)) active = true;
      else if (INACTIVE_WORDS.has(rawActive)) active = false;
      // Same reasoning as member status: a retired plan imported as active
      // goes back on sale.
      else errors.push(`"${at(r, 'active').trim()}" is not a yes/no I can read`);
    }

    const value: PlanRow = { name, priceCents, interval, currency, active };
    return errors.length ? { line, errors } : { line, value, errors };
  });

  const ready = rows.filter((r) => r.value !== undefined).map((r) => r.value as PlanRow);
  const rejected = rows.filter((r) => r.value === undefined);

  return {
    sheet,
    missingRequired,
    unmatchedColumns: unmatched,
    dateOrder: 'unknown',
    rows,
    ready,
    rejected,
  };
}

/** One line summarising what an import would do, for the confirm step. */
export function describePreview<T>(p: ImportPreview<T>): string {
  if (p.missingRequired.length) {
    return `Cannot import: no ${p.missingRequired.join(' or ')} column found.`;
  }
  if (p.rows.length === 0) return 'That file has a header but no rows.';
  const parts = [`${p.ready.length} of ${p.rows.length} rows ready`];
  if (p.rejected.length) parts.push(`${p.rejected.length} need attention`);
  if (p.dateOrder === 'ambiguous') parts.push('date order unclear — say which the file uses');
  if (p.unmatchedColumns.length) parts.push(`ignoring ${p.unmatchedColumns.length} unrecognised column(s)`);
  return parts.join(' · ');
}
