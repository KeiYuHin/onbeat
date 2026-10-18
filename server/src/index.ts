import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';
import { fsLibrary } from './songs';

const port = Number(process.env.PORT ?? 8787);
const staticDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

// npm runs this from server/, so a relative SONGS_DIR is taken from where npm was started (INIT_CWD).
const songsDir = process.env.SONGS_DIR
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.env.SONGS_DIR)
  : fileURLToPath(new URL('../../songs', import.meta.url));
const library = fsLibrary(songsDir);

const server = await startServer({ library, port, staticDir });

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a!.address);

const count = (await library.list()).length;
console.log(`OnBeat server listening on port ${server.port} with ${count} song(s) from ${songsDir}`);
console.log(`  this computer: http://localhost:${server.port}`);
for (const ip of lanIps) console.log(`  phones on the same Wi-Fi: http://${ip}:${server.port}`);
