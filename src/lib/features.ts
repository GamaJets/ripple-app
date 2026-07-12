// Single source of truth for the client app's secondary features. Drives the
// Explore/search directory and the slimmed Me hub so navigation stays in sync.
// Each feature is "owned" by the primary tab it belongs under (rebalanced IA):
//   train · meals · progress · me
import type { IconName } from '../ui/Icon';

export type FeatureArea = 'train' | 'meals' | 'progress' | 'me';

export interface Feature {
  key: string;
  label: string;
  note: string;
  route: string;
  icon: IconName;
  area: FeatureArea;
  keywords?: string;   // extra search terms
  soloHide?: boolean;  // hidden for self-managed (solo) clients
}

export const AREA_LABEL: Record<FeatureArea, string> = {
  train: 'Training',
  meals: 'Nutrition',
  progress: 'Progress & Insights',
  me: 'Coaching & Account',
};

export const CLIENT_FEATURES: Feature[] = [
  // ── Training ──────────────────────────────────────────────
  { key: 'week', label: 'This Week', note: 'Your week of training at a glance', route: '/(client)/week', icon: 'calendar', area: 'train', keywords: 'plan schedule' },
  { key: 'library', label: 'Exercise Library', note: 'How-to videos from your coach', route: '/(client)/library', icon: 'video', area: 'train', keywords: 'videos how to form' },
  { key: 'tools', label: 'Lifting Tools', note: '1RM, plate math & macro reference', route: '/(client)/tools', icon: 'settings', area: 'train', keywords: 'calculator 1rm plates macros' },
  { key: 'recovery', label: 'Recovery', note: 'Hydration, sleep & mobility', route: '/(client)/recovery', icon: 'water', area: 'train', keywords: 'sleep hydration mobility rest' },
  { key: 'habits', label: 'Daily Habits', note: 'Habits & water tracker', route: '/(client)/habits', icon: 'check', area: 'train', keywords: 'water streak daily' },
  { key: 'calendar', label: 'Book a Session', note: 'Month calendar · book your coach', route: '/(client)/calendar', icon: 'calendar', area: 'train', keywords: 'booking session appointment', soloHide: true },

  // ── Nutrition ─────────────────────────────────────────────
  { key: 'foodlog', label: 'Food Log', note: 'Search, barcode or photo', route: '/(client)/foodlog', icon: 'meals', area: 'meals', keywords: 'calories macros barcode photo diary' },

  // ── Progress & Insights ───────────────────────────────────
  { key: 'report', label: 'Weekly Report', note: 'Your week at a glance · share it', route: '/(client)/report', icon: 'chart', area: 'progress', keywords: 'summary' },
  { key: 'consistency', label: 'Consistency', note: '12-week training heatmap', route: '/(client)/consistency', icon: 'flame', area: 'progress', keywords: 'heatmap streak' },
  { key: 'records', label: 'Personal Records', note: 'Your best lifts, ranked', route: '/(client)/records', icon: 'trophy', area: 'progress', keywords: 'pr prs best lifts' },
  { key: 'standards', label: 'Strength Standards', note: 'How your lifts stack up', route: '/(client)/standards', icon: 'chart', area: 'progress', keywords: 'benchmark bodyweight' },
  { key: 'goal', label: 'Goal Tracker', note: 'Target weight & projected finish', route: '/(client)/goal', icon: 'target', area: 'progress', keywords: 'target projection' },
  { key: 'measurements', label: 'Body Measurements', note: 'Waist, chest, arms over time', route: '/(client)/measurements', icon: 'ruler', area: 'progress', keywords: 'waist chest arms tape' },
  { key: 'achievements', label: 'Achievements', note: 'Badges and milestones', route: '/(client)/achievements', icon: 'trophy', area: 'progress', keywords: 'badges milestones' },
  { key: 'cards', label: 'Milestone Cards', note: 'Shareable cards of your wins', route: '/(client)/cards', icon: 'share', area: 'progress', keywords: 'share card' },
  { key: 'checkin', label: 'Weekly Check-in', note: 'Send your coach a weekly pulse', route: '/(client)/checkin', icon: 'pencil', area: 'progress', keywords: 'weight mood energy coach', soloHide: true },
  { key: 'activity', label: 'Activity', note: 'Your training feed & updates', route: '/(client)/activity', icon: 'bell', area: 'progress', keywords: 'feed updates' },

  // ── Coaching & Account ────────────────────────────────────
  { key: 'trainers', label: 'Find a Trainer', note: 'Browse coaches · online or in-person', route: '/(client)/trainers', icon: 'people', area: 'me', keywords: 'coach hire book' },
  { key: 'coach', label: 'AI Coach', note: 'Chat with your AI coach', route: '/(client)/coach', icon: 'chat', area: 'me', keywords: 'ai assistant chat' },
  { key: 'messages', label: 'Messages', note: 'Chat with your coach', route: '/(client)/messages', icon: 'message', area: 'me', keywords: 'chat dm coach', soloHide: true },
  { key: 'social', label: 'Share & Social', note: 'Post progress to Instagram / TikTok', route: '/(client)/social', icon: 'share', area: 'me', keywords: 'instagram tiktok share' },
  { key: 'devices', label: 'Watch & Devices', note: 'Apple Watch, WHOOP, Garmin…', route: '/(client)/devices', icon: 'clock', area: 'me', keywords: 'apple watch wearable heart rate' },
  { key: 'music', label: 'Music & Playlists', note: 'AI workout playlists', route: '/(client)/music', icon: 'play', area: 'me', keywords: 'spotify playlist songs' },
  { key: 'appearance', label: 'Appearance', note: 'Theme & accent colour', route: '/(client)/appearance', icon: 'palette', area: 'me', keywords: 'theme dark light colour' },
  { key: 'settings', label: 'Settings', note: 'Notifications, units, legal & version', route: '/(client)/settings', icon: 'settings', area: 'me', keywords: 'notifications units legal about' },
  { key: 'switch', label: 'Switch portal', note: 'Client · Trainer · Owner', route: '/', icon: 'swap', area: 'me', keywords: 'role trainer owner' },
];

export function searchFeatures(list: Feature[], q: string): Feature[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((f) =>
    f.label.toLowerCase().includes(s) ||
    f.note.toLowerCase().includes(s) ||
    (f.keywords ? f.keywords.toLowerCase().includes(s) : false) ||
    AREA_LABEL[f.area].toLowerCase().includes(s)
  );
}
