#!/usr/bin/env node
// Mirrors a song library checkout into R2 under <library>/: songs/*.json and assets/**.
//
//   node scripts/sync-library.mjs <library-dir> <library-name> [--remote]
//
// Without --remote it fills the local bucket that `wrangler dev` uses. Run it from worker/.
// <library>/manifest.json remembers what the last sync uploaded (with hashes), so only changed
// files are uploaded and files removed from the checkout are deleted. <library>/version is
// rewritten last; rooms that are open notice it within a minute and reload their catalog.
// Validate the songs first (npm run validate-songs); this script uploads whatever it finds.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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
const scratch = mkdtempSync(join(tmpdir(), 'onbeat-sync-'));

const r2 = (...args) => execFileSync(process.execPath, [wrangler, 'r2', 'object', ...args, where], { stdio: ['ignore', 'pipe', 'pipe'] });

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

// Git stores LF; hash what git would, so a CRLF checkout on Windows doesn't count as a change.
const contents = (path) => {
  const buf = readFileSync(path);
  return path.endsWith('.json') ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n')) : buf;
};

/** key -> sha256 of what the last sync uploaded. */
function previousManifest() {
  const out = join(scratch, 'manifest.json');
  try {
    r2('get', `${BUCKET}/${library}/manifest.json`, '--file', out);
    return JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    return {}; // first sync, or a bucket filled by an older version of this script
  }
}

const local = new Map();
for (const path of [...files('songs')].filter((p) => p.endsWith('.json')).concat([...files('assets')])) {
  const key = `${library}/${relative(root, path).split('\\').join('/')}`;
  local.set(key, contents(path));
}

const before = previousManifest();
const after = {};
let uploaded = 0;
let deleted = 0;
for (const [key, body] of local) {
  const hash = createHash('sha256').update(body).digest('hex');
  after[key] = hash;
  if (before[key] === hash) continue;
  const tmp = join(scratch, 'upload');
  writeFileSync(tmp, body);
  r2('put', `${BUCKET}/${key}`, '--file', tmp, ...(key.endsWith('.json') ? ['--content-type', 'application/json'] : []));
  console.log(`uploaded ${key}`);
  uploaded++;
}
for (const key of Object.keys(before)) {
  if (local.has(key)) continue;
  r2('delete', `${BUCKET}/${key}`);
  console.log(`deleted ${key}`);
  deleted++;
}

const manifestFile = join(scratch, 'manifest.json');
writeFileSync(manifestFile, JSON.stringify(after, null, 2));
r2('put', `${BUCKET}/${library}/manifest.json`, '--file', manifestFile, '--content-type', 'application/json');
if (uploaded || deleted) {
  const versionFile = join(scratch, 'version');
  writeFileSync(versionFile, `sync ${process.env.GITHUB_SHA ?? 'local'} ${new Date().toISOString()}`);
  r2('put', `${BUCKET}/${library}/version`, '--file', versionFile);
}
console.log(`${where === '--remote' ? 'R2' : 'local R2'} ${BUCKET}/${library}/: ${uploaded} uploaded, ${deleted} deleted, ${local.size - uploaded} unchanged`);
