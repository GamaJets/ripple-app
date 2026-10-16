// Studio analytics parsing. Compile with tsc, run with node.
import { parseStudioAnalytics, signed } from './studioAnalytics';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };

ok(parseStudioAnalytics(null) === null, 'null is not a gym');
const a = parseStudioAnalytics({
  days: 90, active_memberships: 40, members: 52, training_members: 31,
  retention: { base: 20, retained: 17 },
  sessions_per_coach: [{ trainer_id: 'a', name: 'Sam', sessions: 4 }, { trainer_id: 'b', name: 'Lee', sessions: 9 }],
  revenue: [{ currency: 'AED', month: '2026-09', cents: 100 }, { currency: 'AED', month: '2026-10', cents: 50 }, { currency: 'USD', month: '2026-10', cents: 500 }],
  inbody: { scanned_members: 5, repeat_members: 2, avg_body_fat_change: null, min_group: 3 },
})!;
ok(a.retention.pct === 85, 'retention is retained over base');
ok(parseStudioAnalytics({ retention: { base: 0, retained: 0 } })!.retention.pct === null, 'no base has no rate, not 0%');
ok(a.sessionsPerCoach[0].name === 'Lee', 'busiest coach first');
ok(a.revenue.length === 2 && a.revenue.find((r) => r.currency === 'AED')!.cents === 150, 'revenue totals per currency, never across');
ok(a.revenue.find((r) => r.currency === 'AED')!.months.length === 2, 'months kept per currency');
ok(a.inbody.avgBodyFatChange === null, 'a withheld average stays unknown');
ok(signed(-0.84) === '\u22120.8' && signed(1.2) === '+1.2' && signed(null) === null, 'signed figures');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('studioAnalytics ok');
