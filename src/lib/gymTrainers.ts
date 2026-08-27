// Reading a gym's trainers, with their client load and delivered sessions.
//
// This is the query behind the owner's roster, and it is wanted in two places:
// the phone app's PlatformTrainersProvider, and the web console. It takes the
// Supabase client as an argument rather than importing one, so it belongs to
// neither front end and can be tested without either.
//
// Nothing here invents a figure. A trainer with no sessions gets 0 because the
// query returned no rows for them — and the caller is responsible for knowing
// that a 0 across the whole gym may mean the sessions_owner_r policy is missing
// rather than that nobody trained.

const DAY = 24 * 60 * 60 * 1000;

export interface GymTrainer {
  id: string;
  name: string;
  /** Clients assigned to this trainer, counted from `clients`. */
  clients: number;
  /**
   * Sessions booked in the last 30 days whose start time has passed.
   *
   * This is what the record shows took place, which is not the same as what
   * was confirmed delivered — an un-cancelled slot and a no-show both land
   * here. Use `delivered30` for anything that costs money.
   */
  sessions30: number;
  /** Sessions confirmed delivered — somebody recorded that they completed. */
  delivered30: number;
  /** Booked, finished, and nobody has recorded what happened yet. */
  unmarked30: number;
  /** ISO date they joined, or null if the profile has no created_at. */
  since: string | null;
}

/** Minimal shape of the Supabase client this needs — so neither front end has
 *  to agree on a version of the SDK's types. */
type Queryable = {
  from: (table: string) => any;
};

export async function fetchGymTrainers(sb: Queryable, tenantId: string): Promise<GymTrainer[]> {
  // Trainers in this tenant. RLS (trainers_owner_r) already scopes this to the
  // caller's tenant; the filter makes the intent explicit.
  const { data: trs, error } = await sb.from('trainers').select('id').eq('tenant_id', tenantId);
  if (error) throw error;

  const ids: string[] = (trs ?? []).map((r: any) => r.id);
  if (!ids.length) return [];

  // Names come from profiles, which the owner may read for their own tenant
  // (profiles_owner_tenant_r).
  // no-error-ok: an unreadable name falls back to 'Trainer'; every figure beside it is still real
  const { data: profs } = await sb.from('profiles').select('id, full_name, created_at').in('id', ids);
  const meta = new Map<string, { name: string; since: string | null }>(
    (profs ?? []).map((p: any) => [p.id, { name: (p.full_name || '').trim(), since: p.created_at ?? null }]),
  );

  // Client counts: one query for the whole tenant rather than N queries.
  //
  // Thrown, not defaulted, for the same reason the `trainers` read above throws:
  // a missing count becomes 0, and 0 clients is a statement about a trainer that
  // an owner acts on. The screen renders a thrown read as an error.
  const { data: cls, error: clsErr } = await sb.from('clients').select('trainer_id').in('trainer_id', ids);
  if (clsErr) throw clsErr;
  const clientCount = new Map<string, number>();
  (cls ?? []).forEach((c: any) => {
    if (c.trainer_id) clientCount.set(c.trainer_id, (clientCount.get(c.trainer_id) ?? 0) + 1);
  });

  // Sessions delivered: booked and already started.
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  // This one pays people. `delivered30` feeds `payroll30For`, so a swallowed
  // failure here does not merely understate a dashboard figure — every trainer
  // shows 0 delivered, nothing is left unmarked, and payroll prices out at
  // exactly zero owed. A refused read must never be able to say that.
  const { data: sess, error: sessErr } = await sb
    .from('sessions')
    .select('trainer_id, outcome')
    .in('trainer_id', ids)
    .eq('status', 'booked')
    .gte('starts_at', since)
    .lte('starts_at', new Date().toISOString());
  if (sessErr) throw sessErr;
  const sessionCount = new Map<string, number>();
  const deliveredCount = new Map<string, number>();
  const unmarkedCount = new Map<string, number>();
  (sess ?? []).forEach((s: any) => {
    if (!s.trainer_id) return;
    sessionCount.set(s.trainer_id, (sessionCount.get(s.trainer_id) ?? 0) + 1);
    if (s.outcome === 'completed') {
      deliveredCount.set(s.trainer_id, (deliveredCount.get(s.trainer_id) ?? 0) + 1);
    } else if (s.outcome == null) {
      // Null is "nobody has said yet", which is neither delivered nor cancelled.
      unmarkedCount.set(s.trainer_id, (unmarkedCount.get(s.trainer_id) ?? 0) + 1);
    }
  });

  return ids
    .map((id) => ({
      id,
      name: meta.get(id)?.name || 'Trainer',
      clients: clientCount.get(id) ?? 0,
      sessions30: sessionCount.get(id) ?? 0,
      delivered30: deliveredCount.get(id) ?? 0,
      unmarked30: unmarkedCount.get(id) ?? 0,
      since: meta.get(id)?.since ?? null,
    }))
    .sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
}

/**
 * What 30 days of *confirmed* sessions are worth.
 *
 * Null in two cases, both of which render as a dash rather than a figure:
 *   - the gym has not set a session fee. An unset fee is not a free gym.
 *   - sessions are still awaiting an outcome. Pricing those would mean paying
 *     for no-shows and un-cancelled slots, which is what this used to do: it
 *     counted every booking whose start time had passed.
 *
 * `payrollBlocker` says which, in words an owner can act on.
 */
export function payroll30For(trainers: GymTrainer[], sessionFee: number | null): number | null {
  if (sessionFee == null) return null;
  if (trainers.some((t) => t.unmarked30 > 0)) return null;
  const delivered = trainers.reduce((a, t) => a + t.delivered30, 0);
  return Math.round(delivered * sessionFee);
}

/** Why payroll cannot be priced yet, or null when it can. */
export function payrollBlocker(trainers: GymTrainer[], sessionFee: number | null): string | null {
  const unmarked = trainers.reduce((a, t) => a + t.unmarked30, 0);
  if (unmarked > 0) {
    return `${unmarked} session${unmarked === 1 ? '' : 's'} still need an outcome recorded.`;
  }
  if (sessionFee == null) return 'No session fee set.';
  return null;
}
