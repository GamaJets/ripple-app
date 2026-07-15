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
  { title: "Can't Hold Us", artist: 'Macklemore & Ryan Lewis', bpm: 146, energy: 5, genre: 'Hip-Hop' },
  { title: 'Remember the Name', artist: 'Fort Minor', bpm: 84, energy: 5, genre: 'Hip-Hop' },
  { title: 'Pump It', artist: 'Black Eyed Peas', bpm: 154, energy: 5, genre: 'Hip-Hop' },
  { title: 'Turn Down for What', artist: 'DJ Snake & Lil Jon', bpm: 100, energy: 5, genre: 'EDM' },
  { title: 'Animals', artist: 'Martin Garrix', bpm: 128, energy: 5, genre: 'EDM' },
  { title: 'Bangarang', artist: 'Skrillex', bpm: 110, energy: 5, genre: 'EDM' },
  { title: 'Work Bitch', artist: 'Britney Spears', bpm: 128, energy: 5, genre: 'Pop' },
  { title: 'Welcome to the Jungle', artist: "Guns N' Roses", bpm: 123, energy: 5, genre: 'Rock' },
  { title: 'Enter Sandman', artist: 'Metallica', bpm: 123, energy: 5, genre: 'Rock' },
  { title: 'Chop Suey!', artist: 'System of a Down', bpm: 127, energy: 5, genre: 'Rock' },
  { title: 'Killing in the Name', artist: 'Rage Against the Machine', bpm: 91, energy: 5, genre: 'Rock' },
  { title: 'Bulls on Parade', artist: 'Rage Against the Machine', bpm: 105, energy: 5, genre: 'Rock' },
  { title: 'Bleed It Out', artist: 'Linkin Park', bpm: 115, energy: 5, genre: 'Rock' },
  { title: 'DNA.', artist: 'Kendrick Lamar', bpm: 140, energy: 5, genre: 'Hip-Hop' },
  { title: 'Black Skinhead', artist: 'Kanye West', bpm: 130, energy: 5, genre: 'Hip-Hop' },
  { title: 'Mo Bamba', artist: 'Sheck Wes', bpm: 146, energy: 5, genre: 'Hip-Hop' },
  { title: 'Radioactive', artist: 'Imagine Dragons', bpm: 137, energy: 4, genre: 'Rock' },
  { title: 'Whatever It Takes', artist: 'Imagine Dragons', bpm: 135, energy: 4, genre: 'Rock' },
  { title: 'Numb', artist: 'Linkin Park', bpm: 110, energy: 4, genre: 'Rock' },
  { title: 'In the End', artist: 'Linkin Park', bpm: 105, energy: 4, genre: 'Rock' },
  { title: 'Back in Black', artist: 'AC/DC', bpm: 96, energy: 4, genre: 'Rock' },
  { title: 'Highway to Hell', artist: 'AC/DC', bpm: 116, energy: 4, genre: 'Rock' },
  { title: 'Jump', artist: 'Van Halen', bpm: 130, energy: 4, genre: 'Rock' },
  { title: "Livin' on a Prayer", artist: 'Bon Jovi', bpm: 122, energy: 4, genre: 'Rock' },
  { title: 'The Final Countdown', artist: 'Europe', bpm: 118, energy: 4, genre: 'Rock' },
  { title: "Sweet Child O' Mine", artist: "Guns N' Roses", bpm: 125, energy: 4, genre: 'Rock' },
  { title: 'Shut Up and Dance', artist: 'Walk the Moon', bpm: 128, energy: 4, genre: 'Pop' },
  { title: 'Goosebumps', artist: 'Travis Scott', bpm: 130, energy: 4, genre: 'Hip-Hop' },
  { title: 'Yeah!', artist: 'Usher', bpm: 105, energy: 4, genre: 'Hip-Hop' },
  { title: '24K Magic', artist: 'Bruno Mars', bpm: 107, energy: 4, genre: 'Funk' },
  { title: 'Finesse', artist: 'Bruno Mars', bpm: 105, energy: 4, genre: 'Funk' },
  { title: 'Harder Better Faster Stronger', artist: 'Daft Punk', bpm: 123, energy: 4, genre: 'EDM' },
  { title: 'Clarity', artist: 'Zedd', bpm: 128, energy: 4, genre: 'EDM' },
  { title: 'Waiting for Love', artist: 'Avicii', bpm: 124, energy: 4, genre: 'EDM' },
  { title: 'Hey Brother', artist: 'Avicii', bpm: 125, energy: 4, genre: 'EDM' },
  { title: 'Faded', artist: 'Alan Walker', bpm: 90, energy: 4, genre: 'EDM' },
  { title: 'Lean On', artist: 'Major Lazer', bpm: 98, energy: 4, genre: 'EDM' },
  { title: 'Midnight City', artist: 'M83', bpm: 105, energy: 4, genre: 'Electronic' },
  { title: 'Chandelier', artist: 'Sia', bpm: 118, energy: 4, genre: 'Pop' },
  { title: 'Unstoppable', artist: 'Sia', bpm: 116, energy: 4, genre: 'Pop' },
  { title: 'Confident', artist: 'Demi Lovato', bpm: 123, energy: 4, genre: 'Pop' },
  { title: 'Break Free', artist: 'Ariana Grande', bpm: 130, energy: 4, genre: 'Pop' },
  { title: 'Problem', artist: 'Ariana Grande', bpm: 130, energy: 4, genre: 'Pop' },
  { title: 'SexyBack', artist: 'Justin Timberlake', bpm: 118, energy: 4, genre: 'Pop' },
  { title: 'Get Lucky', artist: 'Daft Punk', bpm: 116, energy: 3, genre: 'Funk' },
  { title: 'Around the World', artist: 'Daft Punk', bpm: 121, energy: 3, genre: 'EDM' },
  { title: 'On Top of the World', artist: 'Imagine Dragons', bpm: 118, energy: 3, genre: 'Pop' },
  { title: "Can't Stop the Feeling!", artist: 'Justin Timberlake', bpm: 113, energy: 3, genre: 'Pop' },
  { title: 'Firework', artist: 'Katy Perry', bpm: 124, energy: 3, genre: 'Pop' },
  { title: 'Roar', artist: 'Katy Perry', bpm: 90, energy: 3, genre: 'Pop' },
  { title: "Stronger (What Doesn't Kill You)", artist: 'Kelly Clarkson', bpm: 116, energy: 3, genre: 'Pop' },
  { title: 'Circles', artist: 'Post Malone', bpm: 120, energy: 3, genre: 'Pop' },
  { title: 'Sunflower', artist: 'Post Malone & Swae Lee', bpm: 90, energy: 3, genre: 'Hip-Hop' },
  { title: 'Lights', artist: 'Ellie Goulding', bpm: 120, energy: 3, genre: 'Pop' },
  { title: 'Electric Feel', artist: 'MGMT', bpm: 103, energy: 3, genre: 'Indie' },
  { title: 'Riptide', artist: 'Vance Joy', bpm: 102, energy: 3, genre: 'Indie' },
  { title: 'Home', artist: 'Edward Sharpe & The Magnetic Zeros', bpm: 100, energy: 3, genre: 'Indie' },
  { title: 'Ho Hey', artist: 'The Lumineers', bpm: 80, energy: 2, genre: 'Indie' },
  { title: 'Banana Pancakes', artist: 'Jack Johnson', bpm: 88, energy: 2, genre: 'Acoustic' },
  { title: 'Better Together', artist: 'Jack Johnson', bpm: 85, energy: 2, genre: 'Acoustic' },
  { title: 'Skinny Love', artist: 'Bon Iver', bpm: 76, energy: 2, genre: 'Indie' },
  { title: 'A Moment Apart', artist: 'ODESZA', bpm: 90, energy: 2, genre: 'Electronic' },
  { title: 'Bloom', artist: 'ODESZA', bpm: 100, energy: 2, genre: 'Electronic' },
  { title: 'Coastline', artist: 'Hollow Coves', bpm: 100, energy: 2, genre: 'Indie' },
  { title: 'Breathe Me', artist: 'Sia', bpm: 80, energy: 2, genre: 'Pop' },
  { title: 'Yellow', artist: 'Coldplay', bpm: 87, energy: 2, genre: 'Rock' },
  { title: 'Watermark', artist: 'Enya', bpm: 88, energy: 2, genre: 'Ambient' },
  { title: 'Holocene', artist: 'Bon Iver', bpm: 74, energy: 1, genre: 'Indie' },
  { title: "when the party's over", artist: 'Billie Eilish', bpm: 74, energy: 1, genre: 'Pop' },
  { title: 'The Scientist', artist: 'Coldplay', bpm: 146, energy: 1, genre: 'Rock' },
  { title: 'River Flows in You', artist: 'Yiruma', bpm: 120, energy: 1, genre: 'Classical' },
  { title: 'Nuvole Bianche', artist: 'Ludovico Einaudi', bpm: 100, energy: 1, genre: 'Classical' },
  { title: 'Experience', artist: 'Ludovico Einaudi', bpm: 130, energy: 1, genre: 'Classical' },
  { title: 'An Ending (Ascent)', artist: 'Brian Eno', bpm: 60, energy: 1, genre: 'Ambient' },
  { title: 'Avril 14th', artist: 'Aphex Twin', bpm: 80, energy: 1, genre: 'Ambient' },
  { title: 'Saturn', artist: 'Sleeping at Last', bpm: 70, energy: 1, genre: 'Ambient' },
  { title: 'Divenire', artist: 'Ludovico Einaudi', bpm: 90, energy: 1, genre: 'Classical' },
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

// Small seeded PRNG so a given salt yields a stable, well-shuffled order.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic-ish pick so the same params give a stable list, varied by `salt`. */
export function generatePlaylist(p: GenParams, salt = 0): Playlist {
  const [lo, hi] = targetEnergy(p);
  const inBand = POOL.filter((t) => t.energy >= lo && t.energy <= hi);
  const pool = inBand.length >= 4 ? inBand : POOL;
  const want = Math.max(4, Math.round(p.minutes / AVG_TRACK_MIN));
  // rotate the pool by salt, then take `want`, wrapping if needed
  // Deterministic shuffle by salt so each regenerate pulls a genuinely different,
  // non-repeating set from the whole in-band pool (no recycling the same few songs).
  const calm = p.mode === 'mobility' || p.intensity === 1;
  const rng = mulberry32((salt * 2654435761 + lo * 131 + hi * 17 + want * 7) >>> 0);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp; }
  const tracks = shuffled.slice(0, Math.min(want, shuffled.length));
  tracks.sort((a, b) => (calm ? (a.energy - b.energy || a.bpm - b.bpm) : (b.energy - a.energy || b.bpm - a.bpm)));
  const minutes = Math.round(tracks.length * AVG_TRACK_MIN);
  const intensityWord = p.intensity >= 3 ? 'high-intensity' : p.intensity === 2 ? 'moderate' : 'steady';
  return {
    title: `${MODE_LABEL[p.mode]} · ${intensityWord} — ${p.minutes} min`,
    subtitle: `${tracks.length} tracks · ~${minutes} min · ${intensityWord}, ${lo === hi ? `energy ${lo}` : `energy ${lo}–${hi}`}`,
    minutes,
    tracks,
  };
}
