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
  /** Sessions actually delivered in the last 30 days. */
  sessions30: number;
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
  const { data: profs } = await sb.from('profiles').select('id, full_name, created_at').in('id', ids);
  const meta = new Map<string, { name: string; since: string | null }>(
    (profs ?? []).map((p: any) => [p.id, { name: (p.full_name || '').trim(), since: p.created_at ?? null }]),
  );

  // Client counts: one query for the whole tenant rather than N queries.
  const { data: cls } = await sb.from('clients').select('trainer_id').in('trainer_id', ids);
  const clientCount = new Map<string, number>();
  (cls ?? []).forEach((c: any) => {
    if (c.trainer_id) clientCount.set(c.trainer_id, (clientCount.get(c.trainer_id) ?? 0) + 1);
  });

  // Sessions delivered: booked and already started.
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const { data: sess } = await sb
    .from('sessions')
    .select('trainer_id')
    .in('trainer_id', ids)
    .eq('status', 'booked')
    .gte('starts_at', since)
    .lte('starts_at', new Date().toISOString());
  const sessionCount = new Map<string, number>();
  (sess ?? []).forEach((s: any) => {
    if (s.trainer_id) sessionCount.set(s.trainer_id, (sessionCount.get(s.trainer_id) ?? 0) + 1);
  });

  return ids
    .map((id) => ({
      id,
      name: meta.get(id)?.name || 'Trainer',
      clients: clientCount.get(id) ?? 0,
      sessions30: sessionCount.get(id) ?? 0,
      since: meta.get(id)?.since ?? null,
    }))
    .sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
}

/** What 30 days of delivered sessions are worth, or null when the gym has not
 *  set a session fee. Never 0 — an unset fee is not a free gym. */
export function payroll30For(trainers: GymTrainer[], sessionFee: number | null): number | null {
  if (sessionFee == null) return null;
  const sessions = trainers.reduce((a, t) => a + t.sessions30, 0);
  return Math.round(sessions * sessionFee);
}
