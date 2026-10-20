// Remembers the server provision.mjs created, so `fc3 node`, `fc3 client` and
// `fc3 destroy` don't need its address or provider typed again.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SERVER_FILE = join(homedir(), '.farcaster-in-3-server.json');
export const KEY_PATH = join(homedir(), '.ssh', 'farcaster_node');

// createdAt is only known when we just made the server; it drives the uptime in `fc3 status`.
export function saveServer({ provider, ip, user, createdAt }) {
  const previous = loadServer();
  const same = previous?.ip === ip;
  const server = { ...(same ? previous : {}), provider, ip, user };
  if (createdAt) server.createdAt = createdAt;
  writeFileSync(SERVER_FILE, JSON.stringify(server, null, 2));
  return server;
}

export function loadServer() {
  return existsSync(SERVER_FILE) ? JSON.parse(readFileSync(SERVER_FILE, 'utf8')) : null;
}

export function updateServer(fields) {
  const s = loadServer();
  if (s) writeFileSync(SERVER_FILE, JSON.stringify({ ...s, ...fields }, null, 2));
}

export function forgetServer() {
  rmSync(SERVER_FILE, { force: true });
}

// What every provider prints when it's done.
export function ready({ provider, ip, user }) {
  saveServer({ provider, ip, user, createdAt: new Date().toISOString() });
  const sudo = user === 'root' ? '' : 'sudo ';
  console.log(`

Done. Your server is ready at ${ip}. Saved to ${SERVER_FILE}.

Next, command 1 (installs and starts the read node):

  ./fc3 node --fid YOUR_FID

That runs this for you:
  ssh -i "${KEY_PATH}" ${user}@${ip} "curl -fsSL https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/node.sh | ${sudo}bash -s -- --fid YOUR_FID"

Your node's API will be at http://${ip}:3381 once it has synced.
`);
}
