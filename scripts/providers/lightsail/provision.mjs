// Command 0 on AWS Lightsail: rent the compute for a Snapchain read node.
//
// Lightsail is AWS's flat-price VPS service. Compared to EC2 it's simpler, includes
// several TB of outbound transfer, and works on AWS accounts whose EC2 access is
// restricted (new "project" accounts, for example).
//
// Creates, all tagged app=farcaster-readnode:
//   - an Ubuntu 24.04 instance on the cheapest bundle with >= 4 vCPU / 16 GB RAM
//   - a 1 TB block storage disk attached to it
//   - public ports 22, 3381/tcp, 3382/udp, 3383/tcp
//
// Usage:  aws login, then  node scripts/provision.mjs --provider lightsail [--yes]
// Env:    AWS_REGION (default us-east-1)  DISK_GB (default 1024)  SERVER_NAME (default snapchain-1)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { aws, requireLogin, REGION, TAG_KEY, TAG_VALUE } from '../aws/cli.mjs';

const DISK_GB = Number(process.env.DISK_GB || 1024);
const NAME = process.env.SERVER_NAME || 'snapchain-1';
const DISK_NAME = `${NAME}-data`;
const ZONE = `${REGION}a`;
const USER = 'ubuntu';
const KEY_PATH = join(homedir(), '.ssh', 'farcaster_node');
const DISK_PER_GB_MONTH = 0.1;
const TAGS = `key=${TAG_KEY},value=${TAG_VALUE}`;

const identity = requireLogin();
console.log(`AWS account ${identity.Account}, Lightsail region ${REGION}`);

try {
  const { instance } = aws(['lightsail', 'get-instance', '--instance-name', NAME], { quiet: true });
  console.log(`You already have a node: ${NAME} at ${instance.publicIpAddress}`);
  console.log('Run `node scripts/destroy.mjs --provider lightsail` first if you want a fresh one.');
  process.exit(0);
} catch {
  // Not found: carry on.
}

// --- Cheapest Linux bundle with a public IPv4 and >= 4 vCPU / 16 GB ---

const { bundles } = aws(['lightsail', 'get-bundles'], { quiet: true });
const bundle = bundles
  .filter((b) => b.isActive && b.supportedPlatforms.includes('LINUX_UNIX') && !b.bundleId.includes('ipv6'))
  .filter((b) => b.cpuCount >= 4 && b.ramSizeInGb >= 16)
  .sort((a, b) => a.price - b.price)[0];
if (!bundle) {
  console.error('No Lightsail bundle with 4 vCPU / 16 GB found in this region.');
  process.exit(1);
}

const diskMonthly = DISK_GB * DISK_PER_GB_MONTH;
const monthly = bundle.price + diskMonthly;
console.log(`
Plan (${ZONE}):
  instance ${bundle.bundleId}  ${bundle.cpuCount} vCPU, ${bundle.ramSizeInGb} GB RAM, ${bundle.transferPerMonthInGb / 1000} TB transfer   $${bundle.price.toFixed(2)}/mo
  disk     ${DISK_GB} GB block storage                                  $${diskMonthly.toFixed(2)}/mo
  total    ~$${monthly.toFixed(2)}/mo, billed per hour; one week ≈ $${((monthly / 730) * 168).toFixed(2)}
           AWS credits are used first. Delete anytime with: node scripts/destroy.mjs --provider lightsail
`);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Create it? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

// --- SSH key ---
// Lightsail's own key pairs are RSA-only, so add our ed25519 key at first boot instead.

if (!existsSync(KEY_PATH)) {
  mkdirSync(join(homedir(), '.ssh'), { recursive: true });
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'farcaster-node', '-f', KEY_PATH], { stdio: 'inherit' });
}
const publicKey = readFileSync(KEY_PATH + '.pub', 'utf8').trim();
const userData = `#!/bin/bash\necho '${publicKey}' >> /home/${USER}/.ssh/authorized_keys\n`;

// --- Instance + disk ---

aws(['lightsail', 'create-instances',
  '--instance-names', NAME,
  '--availability-zone', ZONE,
  '--blueprint-id', 'ubuntu_24_04',
  '--bundle-id', bundle.bundleId,
  '--user-data', userData,
  '--tags', TAGS,
], { quiet: true });
console.log(`✓ instance ${NAME} requested`);

aws(['lightsail', 'create-disk',
  '--disk-name', DISK_NAME,
  '--availability-zone', ZONE,
  '--size-in-gb', String(DISK_GB),
  '--tags', TAGS,
], { quiet: true });
console.log(`✓ disk ${DISK_NAME} (${DISK_GB} GB) requested`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.stdout.write('  waiting for instance and disk');
let instance;
for (;;) {
  instance = aws(['lightsail', 'get-instance', '--instance-name', NAME], { quiet: true }).instance;
  const disk = aws(['lightsail', 'get-disk', '--disk-name', DISK_NAME], { quiet: true }).disk;
  if (instance.state.name === 'running' && disk.state === 'available') break;
  process.stdout.write('.');
  await sleep(5000);
}
console.log();

aws(['lightsail', 'attach-disk', '--disk-name', DISK_NAME, '--instance-name', NAME, '--disk-path', '/dev/xvdf'], { quiet: true });
console.log('✓ disk attached');

// 3381 HTTP API, 3382 gossip (UDP/QUIC), 3383 gRPC. Replaces Lightsail's defaults (22, 80).
aws(['lightsail', 'put-instance-public-ports', '--instance-name', NAME, '--port-infos',
  'fromPort=22,toPort=22,protocol=tcp',
  'fromPort=3381,toPort=3381,protocol=tcp',
  'fromPort=3382,toPort=3382,protocol=udp',
  'fromPort=3383,toPort=3383,protocol=tcp',
], { quiet: true });
console.log('✓ firewall: ports 22, 3381-3383 open');

const ip = instance.publicIpAddress;
process.stdout.write(`  waiting for SSH on ${ip}`);
for (let i = 0; i < 40; i++) {
  try {
    execFileSync('ssh', ['-i', KEY_PATH, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', `${USER}@${ip}`, 'true'], {
      stdio: 'ignore',
    });
    break;
  } catch {
    process.stdout.write('.');
    await sleep(5000);
  }
}

console.log(`

Done. Your server is ready.

Next, command 1 (installs and starts the read node):

  ssh -i "${KEY_PATH}" ${USER}@${ip} "curl -fsSL https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/node.sh | sudo bash -s -- --fid YOUR_FID"

Your node's API will be at http://${ip}:3381 once it has synced.
`);
