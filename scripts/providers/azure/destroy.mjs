// Deletes the farcaster-readnode resource group: VM, disks, IP, firewall, all of it.
// The node's synced database is on the data disk and is deleted too.
//
// Usage:  node scripts/destroy.mjs --provider azure [--yes]

import { createInterface } from 'node:readline/promises';
import { forgetServer } from '../../server.mjs';
import { az, requireLogin, GROUP } from './az.mjs';

requireLogin();

if (!az(['group', 'exists', '-n', GROUP])) {
  forgetServer();
  console.log('Nothing to delete.');
  process.exit(0);
}

const resources = az(['resource', 'list', '-g', GROUP, '--query', '[].{name:name, type:type}'], { quiet: true });
console.log(`This will permanently delete resource group ${GROUP}:`);
for (const r of resources) console.log(`  ${r.type.split('/').pop().padEnd(22)} ${r.name}`);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "delete" to confirm: ');
  rl.close();
  if (answer.trim() !== 'delete') process.exit(0);
}

console.log('Deleting (takes a few minutes)...');
az(['group', 'delete', '-n', GROUP, '--yes'], { json: false });
forgetServer();
console.log('All gone. Billing for these resources has stopped.');
