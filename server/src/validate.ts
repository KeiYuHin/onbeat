// Checks a songs directory the way the server loads it, plus the library's naming rule.
//   npm run validate-songs -- <songs-dir>
// Exits non-zero naming the file and the problem, so the library's sync stops before uploading.
import { basename, resolve } from 'node:path';
import { loadSongFiles } from './songs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npm run validate-songs -- <songs-dir>');
  process.exit(2);
}
const songsDir = resolve(process.env.INIT_CWD ?? process.cwd(), dir);

try {
  const files = loadSongFiles(songsDir);
  // A song's id is its file name, its assets/ directory and its R2 key.
  const misnamed = files.filter((f) => basename(f.path) !== `${f.song.id}.json`);
  for (const f of misnamed) console.error(`${basename(f.path)}: id is "${f.song.id}", so the file must be ${f.song.id}.json`);
  if (misnamed.length) process.exit(1);
  console.log(`${files.length} song(s) OK in ${songsDir}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
