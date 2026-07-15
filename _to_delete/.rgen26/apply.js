const fs = require('fs');
// 1) spotify.ts — a varied, de-duped track search
{
  const F = 'src/lib/spotify.ts';
  let s = fs.readFileSync(F, 'utf8');
  const anchor = "/** Create a playlist in the user's account from {title, artist} tracks. */";
  const add = "/** Search Spotify for real tracks matching workout query seeds — varied, de-duped,\n * offset-rotated by salt so each generate pulls a fresh set from the live catalog. */\nexport async function spotifySearchTracks(queries: string[], want: number, salt: number): Promise<{ title: string; artist: string }[]> {\n  const token = await validToken();\n  if (!token) return [];\n  const h = { Authorization: 'Bearer ' + token };\n  const out: { title: string; artist: string }[] = [];\n  const seen = new Set<string>();\n  for (let qi = 0; qi < queries.length && out.length < want; qi++) {\n    const offset = Math.min(950, ((salt * 3 + qi * 5) % 19) * 50);\n    try {\n      const q = encodeURIComponent(queries[qi]);\n      const r = await (await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=50&offset=${offset}`, { headers: h })).json();\n      const items = r?.tracks?.items ?? [];\n      for (const it of items) {\n        const id = it?.id; if (!id || seen.has(id) || !it?.name) continue;\n        seen.add(id);\n        out.push({ title: it.name, artist: (it.artists ?? []).map((a: any) => a.name).filter(Boolean).join(', ') });\n        if (out.length >= want) break;\n      }\n    } catch { /* skip this query */ }\n  }\n  return out;\n}\n\n";
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('spotify anchor x' + n); process.exit(1); }
  s = s.replace(anchor, add + anchor);
  fs.writeFileSync(F, s); console.log('patched spotify.ts');
}
// 2) music.ts — query seeds per mode + intensity
{
  const F = 'src/lib/music.ts';
  let s = fs.readFileSync(F, 'utf8');
  const anchor = "export function generatePlaylist(p: GenParams, salt = 0): Playlist {";
  const add = "/** Spotify-search query seeds matched to the workout mode + intensity. */\nexport function spotifyQuerySeeds(mode: GenParams['mode'], intensity: 1 | 2 | 3): string[] {\n  const hard = intensity >= 3, easy = intensity === 1;\n  if (mode === 'mobility') return ['chill stretching', 'calm cool down', 'ambient relax', 'yoga flow', 'lofi calm'];\n  if (mode === 'hiit') return ['hiit workout', 'high intensity gym', 'pump up hype', 'hard rap workout', 'beast mode', 'sprint intervals'];\n  if (mode === 'cardio') return easy ? ['steady run', 'jogging pop', 'cardio dance', 'feel good run'] : ['running hype', 'cardio edm', 'workout pop', 'gym cardio', 'run fast'];\n  return hard ? ['gym motivation rap', 'metal workout', 'pump up rock', 'beast mode', 'heavy lifting hype'] : easy ? ['gym groove', 'workout funk', 'steady lifting', 'smooth gym'] : ['gym workout', 'lifting hip hop', 'pump rock', 'workout anthems'];\n}\n\n";
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('music anchor x' + n); process.exit(1); }
  s = s.replace(anchor, add + anchor);
  fs.writeFileSync(F, s); console.log('patched music.ts');
}
