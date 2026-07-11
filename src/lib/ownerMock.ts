export interface PlatformTrainer { id: string; name: string; plan: string; clients: number; mrr: number; status: 'active' | 'trial'; since: string; }
export const TRAINERS: PlatformTrainer[] = [
  { id: 't1', name: 'Daniel Reyes', plan: 'Pro', clients: 5, mrr: 99, status: 'active', since: 'Feb 2026' },
  { id: 't2', name: 'Sara Lindqvist', plan: 'Studio', clients: 14, mrr: 249, status: 'active', since: 'Jan 2026' },
  { id: 't3', name: 'Marcus Cole', plan: 'Starter', clients: 2, mrr: 49, status: 'active', since: 'May 2026' },
  { id: 't4', name: 'Aisha Rahman', plan: 'Pro', clients: 8, mrr: 99, status: 'trial', since: 'Jul 2026' },
];
export const PLANS = [
  { name: 'Starter', price: 49, feats: ['Up to 3 clients', 'Core client + trainer app', 'Email support'] },
  { name: 'Pro', price: 99, feats: ['Up to 15 clients', 'White-label colours & logo', 'Priority support'] },
  { name: 'Studio', price: 249, feats: ['Unlimited clients', 'Full white-label + own domain', 'Dedicated success manager'] },
];
