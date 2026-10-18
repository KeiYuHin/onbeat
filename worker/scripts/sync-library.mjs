#!/usr/bin/env node
// Uploads a song library checkout to R2 under <library>/: songs/*.json and assets/**.
//
//   node scripts/sync-library.mjs <library-dir> <library-name> [--remote]
//
// Without --remote it fills the local bucket that `wrangler dev` uses. Run it from worker/.
// It uploads every file each time and does not delete anything yet (M3.9 step 6 adds that).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const BUCKET = 'onbeat-songs';
// Run wrangler's own script with node: no shell, so paths with spaces are safe on Windows too.
const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const [dir, library, ...flags] = process.argv.slice(2);
if (!dir || !library || !/^[a-z0-9-]+$/.test(library) || library === 'public') {
  console.error('usage: node scripts/sync-library.mjs <library-dir> <library-name> [--remote]');
  console.error('library-name: lowercase letters, digits and dashes, not "public"');
  process.exit(1);
}
const where = flags.includes('--remote') ? '--remote' : '--local';
const root = resolve(process.env.INIT_CWD ?? process.cwd(), dir);

function* files(sub) {
  let names;
  try {
    names = readdirSync(join(root, sub));
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith('.')) continue; // .gitkeep and friends
    const path = join(root, sub, name);
    if (statSync(path).isDirectory()) yield* files(join(sub, name));
    else yield path;
  }
}

const uploads = [...files('songs')].filter((p) => p.endsWith('.json')).concat([...files('assets')]);
for (const path of uploads) {
  const key = `${library}/${relative(root, path).split('\\').join('/')}`;
  execFileSync(process.execPath, [wrangler, 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', path, where], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`${where === '--remote' ? 'R2' : 'local R2'}: ${key}`);
}
console.log(`${uploads.length} file(s) uploaded to ${BUCKET}/${library}/`);
