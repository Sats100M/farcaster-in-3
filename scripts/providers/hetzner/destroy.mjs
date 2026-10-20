// Deletes everything provision.mjs created (server, volume, firewall), so billing stops.
// The node's synced database lives on the volume and is deleted too.
//
// Usage:  node scripts/destroy.mjs --provider hetzner [--yes]

import { createInterface } from 'node:readline/promises';
import { forgetServer } from '../../server.mjs';
import { api, requireToken, waitForAction, sleep, LABEL } from './api.mjs';

requireToken();

// Detaching after a server delete takes a few seconds; the API says "in use" until then.
async function retry(fn, tries = 10) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === tries) throw err;
      await sleep(3000);
    }
  }
}

const q = `?label_selector=${LABEL}`;
const { servers } = await api('GET', `/servers${q}`);
const { volumes } = await api('GET', `/volumes${q}`);
const { firewalls } = await api('GET', `/firewalls${q}`);

if (!servers.length && !volumes.length && !firewalls.length) {
  forgetServer();
  console.log('Nothing to delete.');
  process.exit(0);
}

console.log('This will permanently delete:');
for (const s of servers) console.log(`  server   ${s.name}  ${s.public_net.ipv4.ip}`);
for (const v of volumes) console.log(`  volume   ${v.name}  ${v.size} GB`);
for (const f of firewalls) console.log(`  firewall ${f.name}`);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "delete" to confirm: ');
  rl.close();
  if (answer.trim() !== 'delete') process.exit(0);
}

// Servers first: deleting a server detaches its volume and firewall.
for (const s of servers) {
  const { action } = await api('DELETE', `/servers/${s.id}`);
  await waitForAction(action);
  console.log(`✓ deleted server ${s.name}`);
}
for (const v of volumes) {
  await retry(() => api('DELETE', `/volumes/${v.id}`));
  console.log(`✓ deleted volume ${v.name}`);
}
for (const f of firewalls) {
  await retry(() => api('DELETE', `/firewalls/${f.id}`));
  console.log(`✓ deleted firewall ${f.name}`);
}
forgetServer();
console.log('All gone. Billing for these resources has stopped.');
