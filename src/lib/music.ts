// ── Workout music engine ─────────────────────────────────────────────────────
// Pure, UI-free. Given a workout's type/intensity/duration it assembles a
// tempo- and energy-matched playlist. Real Spotify/Apple Music linking (OAuth /
// MusicKit) lands in the backend phase; this builds the list the AI proposes,
// which then gets pushed to the client's own service. Track pool is a curated
// seed — production swaps it for the service's catalog + the user's taste.

export type Service = 'spotify' | 'apple';
export interface Track { title: string; artist: string; bpm: number; energy: 1 | 2 | 3 | 4 | 5; genre: string }
export interface Playlist { title: string; subtitle: string; minutes: number; tracks: Track[] }

export interface GenParams {
  mode: 'strength' | 'cardio' | 'hiit' | 'mobility';
  intensity: 1 | 2 | 3;           // 1 easy · 2 moderate · 3 hard
  minutes: number;
}

const POOL: Track[] = [
  { title: 'Till I Collapse', artist: 'Eminem', bpm: 171, energy: 5, genre: 'Hip-Hop' },
  { title: 'Stronger', artist: 'Kanye West', bpm: 104, energy: 4, genre: 'Hip-Hop' },
  { title: 'POWER', artist: 'Kanye West', bpm: 154, energy: 5, genre: 'Hip-Hop' },
  { title: 'Believer', artist: 'Imagine Dragons', bpm: 125, energy: 4, genre: 'Rock' },
  { title: 'Thunderstruck', artist: 'AC/DC', bpm: 134, energy: 5, genre: 'Rock' },
  { title: 'Seven Nation Army', artist: 'The White Stripes', bpm: 124, energy: 4, genre: 'Rock' },
  { title: 'Titanium', artist: 'David Guetta, Sia', bpm: 126, energy: 4, genre: 'EDM' },
  { title: 'Levels', artist: 'Avicii', bpm: 126, energy: 5, genre: 'EDM' },
  { title: 'One More Time', artist: 'Daft Punk', bpm: 123, energy: 4, genre: 'EDM' },
  { title: 'Blinding Lights', artist: 'The Weeknd', bpm: 171, energy: 4, genre: 'Pop' },
  { title: 'Physical', artist: 'Dua Lipa', bpm: 147, energy: 5, genre: 'Pop' },
  { title: "Don't Start Now", artist: 'Dua Lipa', bpm: 124, energy: 4, genre: 'Pop' },
  { title: 'HUMBLE.', artist: 'Kendrick Lamar', bpm: 150, energy: 4, genre: 'Hip-Hop' },
  { title: 'Sicko Mode', artist: 'Travis Scott', bpm: 155, energy: 4, genre: 'Hip-Hop' },
  { title: 'Uptown Funk', artist: 'Mark Ronson, Bruno Mars', bpm: 115, energy: 4, genre: 'Funk' },
  { title: 'Lose Yourself', artist: 'Eminem', bpm: 171, energy: 5, genre: 'Hip-Hop' },
  { title: 'Eye of the Tiger', artist: 'Survivor', bpm: 109, energy: 4, genre: 'Rock' },
  { title: 'Run the World', artist: 'Beyoncé', bpm: 127, energy: 5, genre: 'Pop' },
  { title: 'Sandstorm', artist: 'Darude', bpm: 136, energy: 5, genre: 'EDM' },
  { title: 'Wake Me Up', artist: 'Avicii', bpm: 124, energy: 3, genre: 'EDM' },
  { title: 'The Nights', artist: 'Avicii', bpm: 126, energy: 3, genre: 'EDM' },
  { title: 'Weightless', artist: 'Marconi Union', bpm: 60, energy: 1, genre: 'Ambient' },
  { title: 'Sunset Lover', artist: 'Petit Biscuit', bpm: 90, energy: 2, genre: 'Chill' },
  { title: 'Breathe', artist: 'Télépopmusik', bpm: 98, energy: 2, genre: 'Chill' },
  { title: 'Intro', artist: 'The xx', bpm: 87, energy: 2, genre: 'Chill' },
  { title: 'Nightcall', artist: 'Kavinsky', bpm: 123, energy: 3, genre: 'Synthwave' },
  { title: 'Instant Crush', artist: 'Daft Punk', bpm: 109, energy: 3, genre: 'Electronic' },
];

const AVG_TRACK_MIN = 3.5;

// target energy band per mode + intensity
function targetEnergy(p: GenParams): [number, number] {
  if (p.mode === 'mobility') return p.intensity >= 3 ? [2, 3] : [1, 2];
  const band: Record<number, [number, number]> = { 1: [2, 3], 2: [3, 4], 3: [4, 5] };
  const bump = p.mode === 'hiit' ? 1 : 0; // HIIT skews a notch harder
  const lo = Math.min(5, band[p.intensity][0] + bump);
  const hi = Math.min(5, band[p.intensity][1] + bump);
  return [lo, hi];
}

const MODE_LABEL: Record<GenParams['mode'], string> = {
  strength: 'Strength', cardio: 'Cardio', hiit: 'HIIT', mobility: 'Mobility & Cool-down',
};

/** Deterministic-ish pick so the same params give a stable list, varied by `salt`. */
export function generatePlaylist(p: GenParams, salt = 0): Playlist {
  const [lo, hi] = targetEnergy(p);
  const inBand = POOL.filter((t) => t.energy >= lo && t.energy <= hi);
  const pool = inBand.length >= 4 ? inBand : POOL;
  const want = Math.max(4, Math.round(p.minutes / AVG_TRACK_MIN));
  // rotate the pool by salt, then take `want`, wrapping if needed
  // Easy / mobility → calmest & slowest first; moderate / hard → hardest & fastest first.
  const calm = p.mode === 'mobility' || p.intensity === 1;
  const sorted = [...pool].sort((a, b) => (calm ? (a.energy - b.energy || a.bpm - b.bpm) : (b.energy - a.energy || b.bpm - a.bpm)));
  const tracks: Track[] = [];
  for (let i = 0; i < want; i++) tracks.push(sorted[(i + salt) % sorted.length]);
  const minutes = Math.round(tracks.length * AVG_TRACK_MIN);
  const intensityWord = p.intensity >= 3 ? 'high-intensity' : p.intensity === 2 ? 'moderate' : 'steady';
  return {
    title: `${MODE_LABEL[p.mode]} · ${intensityWord} — ${p.minutes} min`,
    subtitle: `${tracks.length} tracks · ~${minutes} min · ${intensityWord}, ${lo === hi ? `energy ${lo}` : `energy ${lo}–${hi}`}`,
    minutes,
    tracks,
  };
}
