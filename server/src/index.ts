import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const staticDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

const server = await startServer({ port, staticDir });

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a!.address);

console.log(`OnBeat server listening on port ${server.port}`);
console.log(`  this computer: http://localhost:${server.port}`);
for (const ip of lanIps) console.log(`  phones on the same Wi-Fi: http://${ip}:${server.port}`);
