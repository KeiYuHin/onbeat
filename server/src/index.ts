import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';
import { loadSongFiles, saveDrumEdits } from './songs';

const port = Number(process.env.PORT ?? 8787);
const staticDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

const songsDir = process.env.SONGS_DIR ?? fileURLToPath(new URL('../../songs', import.meta.url));
const files = new Map(loadSongFiles(songsDir).map((f) => [f.song.id, f]));
const songs = [...files.values()].map((f) => f.song);

const server = await startServer({
  songs,
  port,
  staticDir,
  saveSong(songId, drums) {
    const saved = saveDrumEdits(files.get(songId)!, drums);
    files.set(songId, saved);
    console.log(`saved drum patterns to ${saved.path}`);
    return saved.song;
  },
});

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a!.address);

console.log(`OnBeat server listening on port ${server.port} with ${songs.length} song(s) from ${songsDir}`);
console.log(`  this computer: http://localhost:${server.port}`);
for (const ip of lanIps) console.log(`  phones on the same Wi-Fi: http://${ip}:${server.port}`);
