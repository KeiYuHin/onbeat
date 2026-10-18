// Synthesizes the default drum kit into web/public/kits/default/*.wav (mono, 16-bit, 44.1kHz).
// The output is original work released under CC0. Replace any file with a real CC0 sample of the same name.
// Usage: node tools/gen-kit.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'kits', 'default');

// Deterministic noise so regenerating gives identical files.
let seed = 1;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 31 - 1;
};

function render(seconds, sample, highpassHz) {
  const n = Math.round(seconds * RATE);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = sample(i / RATE);
  if (highpassHz) highpass(data, highpassHz);
  // Normalize to -1dBFS and fade the tail to avoid clicks.
  const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const fade = Math.min(n, Math.round(0.01 * RATE));
  for (let i = 0; i < n; i++) data[i] *= (0.89 / peak) * Math.min(1, (n - i) / fade);
  return data;
}

/** One-pole high-pass, applied in place, for hats and cymbals. */
function highpass(data, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = rc / (rc + 1 / RATE);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    prevOut = a * (prevOut + x - prevIn);
    prevIn = x;
    data[i] = prevOut;
  }
  return data;
}

function sweep(f0, f1, rate) {
  // Phase of a sine whose frequency glides exponentially from f0 to f1.
  return (t) => 2 * Math.PI * (f1 * t + ((f0 - f1) / rate) * (1 - Math.exp(-rate * t)));
}

const kickPhase = sweep(160, 45, 30);
const tomPhase = sweep(240, 130, 12);
const metal = [1, 1.47, 1.83, 2.37, 2.91, 3.4].map((r) => r * 420);

const kit = {
  kick: render(0.45, (t) => Math.sin(kickPhase(t)) * Math.exp(-t * 7) + noise() * 0.3 * Math.exp(-t * 400)),
  snare: render(0.25, (t) => noise() * 0.8 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 190 * t) * 0.6 * Math.exp(-t * 30)),
  hat: render(0.08, (t) => noise() * Math.exp(-t * 60), 7000),
  crash: render(1.6, (t) => noise() * Math.exp(-t * 2.5), 5000),
  ride: render(
    0.9,
    (t) => (noise() * 0.5 + metal.reduce((s, f) => s + Math.sign(Math.sin(2 * Math.PI * f * t)), 0) * 0.08) * Math.exp(-t * 4),
    3000,
  ),
  tom: render(0.4, (t) => Math.sin(tomPhase(t)) * Math.exp(-t * 9) + noise() * 0.15 * Math.exp(-t * 80)),
};

function wav(data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries(kit)) {
  writeFileSync(join(out, `${name}.wav`), wav(data));
  console.log(`${name}.wav  ${(data.length / RATE).toFixed(2)}s`);
}
