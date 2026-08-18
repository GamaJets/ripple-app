export interface PlatformTrainer { id: string; name: string; plan: string; clients: number; mrr: number; status: 'active' | 'trial'; since: string; }
// Empty by default. This list previously held four fabricated trainers with
// fabricated MRR, which rendered in the owner portal as real signups and real
// revenue. PLANS below is genuine pricing config and stays.
export const TRAINERS: PlatformTrainer[] = [];
export const PLANS = [
  { name: 'Starter', price: 49, feats: ['Up to 3 clients', 'Core client + trainer app', 'Email support'] },
  { name: 'Pro', price: 99, feats: ['Up to 15 clients', 'White-label colours & logo', 'Priority support'] },
  { name: 'Studio', price: 249, feats: ['Unlimited clients', 'Full white-label + own domain', 'Dedicated success manager'] },
];
