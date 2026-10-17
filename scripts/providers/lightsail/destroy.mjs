// Deletes the Lightsail instance and its data disk, so billing stops.
//
// Usage:  node scripts/destroy.mjs --provider lightsail [--yes]

import { createInterface } from 'node:readline/promises';
import { aws, requireLogin } from '../aws/cli.mjs';

const NAME = process.env.SERVER_NAME || 'snapchain-1';
const DISK_NAME = `${NAME}-data`;

requireLogin();

const find = (args, key) => {
  try {
    return aws(['lightsail', ...args], { quiet: true })[key];
  } catch {
    return undefined;
  }
};
const instance = find(['get-instance', '--instance-name', NAME], 'instance');
const disk = find(['get-disk', '--disk-name', DISK_NAME], 'disk');

if (!instance && !disk) {
  console.log('Nothing to delete.');
  process.exit(0);
}

console.log('This will permanently delete:');
if (instance) console.log(`  instance ${NAME}  ${instance.bundleId}  ${instance.publicIpAddress ?? ''}`);
if (disk) console.log(`  disk     ${DISK_NAME}  ${disk.sizeInGb} GB`);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "delete" to confirm: ');
  rl.close();
  if (answer.trim() !== 'delete') process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (instance) {
  aws(['lightsail', 'delete-instance', '--instance-name', NAME], { quiet: true });
  console.log(`✓ deleted instance ${NAME}`);
}
if (disk) {
  // The disk detaches once the instance is gone; deleting it before then fails.
  for (let i = 1; ; i++) {
    try {
      aws(['lightsail', 'delete-disk', '--disk-name', DISK_NAME], { quiet: true });
      break;
    } catch (err) {
      if (i === 20) throw err;
      await sleep(5000);
    }
  }
  console.log(`✓ deleted disk ${DISK_NAME}`);
}
console.log('All gone. Billing for these resources has stopped.');
