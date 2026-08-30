// Publish a recorded session to social platforms at once. Real posting needs an
// OAuth app + upload token per platform (YouTube Data API, Instagram/Facebook Graph,
// TikTok Content API) — wired via EXPO_PUBLIC_* client ids + a server upload function.
// Until those are set, publish() reports each platform as "pending connection" and the
// trainer can still share natively. This keeps the whole flow shippable now.
import { Share } from 'react-native';

export type SocialPlatform = 'youtube' | 'instagram' | 'facebook' | 'tiktok';

export interface PlatformInfo { key: SocialPlatform; name: string; hint: string }
export const SOCIAL_PLATFORMS: PlatformInfo[] = [
  { key: 'youtube', name: 'YouTube', hint: 'Uploads as a video / Short' },
  { key: 'instagram', name: 'Instagram', hint: 'Posts as a Reel' },
  { key: 'facebook', name: 'Facebook', hint: 'Posts to your Page' },
  { key: 'tiktok', name: 'TikTok', hint: 'Uploads a video' },
];

// Connected once the platform's OAuth client id is configured (and the account linked).
export function socialConnected(p: SocialPlatform): boolean {
  // Read as literal member expressions, never through an alias. Expo's Babel
  // plugin substitutes `process.env.EXPO_PUBLIC_X` at build time by matching
  // that exact shape, so `const env = process.env; env.EXPO_PUBLIC_X` is left
  // alone and reads undefined from a bundle — every platform would report as
  // not connected however the build was configured. Same mistake as the one
  // that told testers Spotify was not set up.
  switch (p) {
    case 'youtube': return !!process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_ID;
    case 'instagram': return !!process.env.EXPO_PUBLIC_INSTAGRAM_CLIENT_ID;
    case 'facebook': return !!process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
    case 'tiktok': return !!process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY;
    default: return false;
  }
}

export interface PublishResult { posted: SocialPlatform[]; pending: SocialPlatform[] }

// Publish to every selected platform that's connected. Connected platforms would
// hand off to their upload API here; unconnected ones come back as "pending" so the
// UI can prompt to connect (or share natively in the meantime).
export async function publishToSocials(opts: { uri?: string; caption: string; platforms: SocialPlatform[] }): Promise<PublishResult> {
  const posted: SocialPlatform[] = [];
  const pending: SocialPlatform[] = [];
  // Nothing here uploads. `socialConnected()` only tests whether an
  // EXPO_PUBLIC_*_CLIENT_ID is set — it is not an OAuth session and there is no
  // linked account — yet a platform passing that test used to be pushed onto
  // `posted`, which the broadcast screen announced as "Posted to YouTube,
  // Instagram, Facebook." Nothing had been posted. Until an upload endpoint
  // exists, every selected platform comes back pending and the caller falls
  // back to the OS share sheet, which genuinely works.
  for (const p of opts.platforms) pending.push(p);
  return { posted, pending };
}

// Fallback available today: open the OS share sheet with the clip + caption so the
// trainer can post to any app manually while auto-publishing is being connected.
export async function shareSessionNatively(caption: string, uri?: string): Promise<void> {
  try { await Share.share(uri ? { message: caption, url: uri } : { message: caption }); } catch { /* cancelled */ }
}
