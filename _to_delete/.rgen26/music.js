const fs = require('fs');
const F = 'app/(client)/music.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 50)); process.exit(1); } s = s.replace(a, b); }
// imports
rep("import { generatePlaylist, type Service, type GenParams, type Playlist } from '../../src/lib/music';",
    "import { generatePlaylist, spotifyQuerySeeds, type Service, type GenParams, type Playlist } from '../../src/lib/music';");
rep("import { connectSpotify, spotifyStatus, spotifyDisconnect, createSpotifyPlaylist } from '../../src/lib/spotify';",
    "import { connectSpotify, spotifyStatus, spotifyDisconnect, createSpotifyPlaylist, spotifySearchTracks } from '../../src/lib/spotify';");
// genBusy state
rep(" const [spotifyBusy, setSpotifyBusy] = useState(false);",
    " const [spotifyBusy, setSpotifyBusy] = useState(false);\n const [genBusy, setGenBusy] = useState(false);");
// async, Spotify-aware generate
rep(" const generate = (nextSalt = salt, nextIntensity = intensity) => {\n setSalt(nextSalt);\n setPl(generatePlaylist({ mode, intensity: nextIntensity, minutes }, nextSalt));\n };",
    " const generate = async (nextSalt = salt, nextIntensity = intensity) => {\n setSalt(nextSalt);\n const base = generatePlaylist({ mode, intensity: nextIntensity, minutes }, nextSalt);\n if (conn.spotify) {\n setGenBusy(true);\n try {\n const found = await spotifySearchTracks(spotifyQuerySeeds(mode, nextIntensity), base.tracks.length, nextSalt);\n if (found.length >= 4) {\n const energy = base.tracks[0]?.energy ?? 3;\n setPl({ ...base, subtitle: base.subtitle + ' \\u00b7 from your Spotify', tracks: found.map((f) => ({ title: f.title, artist: f.artist, bpm: 0, energy, genre: 'Spotify' })) });\n setGenBusy(false); return;\n }\n } catch { /* fall back to curated */ }\n setGenBusy(false);\n }\n setPl(base);\n };");
// generate button: show progress
rep(" <Pressable onPress={() => generate(salt + 1)} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 18 }}>\n <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{pl ? '↻ Regenerate playlist' : ' Generate workout playlist'}</Text>\n </Pressable>",
    " <Pressable onPress={() => generate(salt + 1)} disabled={genBusy} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 18, opacity: genBusy ? 0.7 : 1, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>\n {genBusy ? <ActivityIndicator color={t.brandInk} size=\"small\" /> : null}\n <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{genBusy ? 'Finding songs…' : pl ? '↻ Regenerate playlist' : ' Generate workout playlist'}</Text>\n </Pressable>");
// hide bpm when 0 (Spotify tracks have no bpm)
rep(" <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{tr.bpm} bpm</Text>",
    " <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{tr.bpm > 0 ? tr.bpm + ' bpm' : (tr.genre || '')}</Text>");
fs.writeFileSync(F, s); console.log('applied OK');
