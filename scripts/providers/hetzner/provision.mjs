// Command 0: rent the compute for a Snapchain read node on Hetzner Cloud.
//
// Creates, all tagged app=farcaster-readnode so destroy.mjs can find them:
//   - an SSH key (~/.ssh/farcaster_node, generated if missing)
//   - a firewall that opens SSH + the three Snapchain ports
//   - a block-storage volume for the node's database
//   - the cheapest server with >= 4 vCPU and >= 16 GB RAM in your location
//
// Usage:  node scripts/provision.mjs --provider hetzner [--yes]   (HCLOUD_TOKEN in .env)
// Env:    LOCATION (default nbg1)  VOLUME_GB (default 2048)  SERVER_NAME (default snapchain-1)  ARCH (x86|arm|any, default x86)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { api, requireToken, waitForAction, sleep, LABEL, LABELS } from './api.mjs';

const LOCATION = process.env.LOCATION || 'nbg1';
const VOLUME_GB = Number(process.env.VOLUME_GB || 2048);
const NAME = process.env.SERVER_NAME || 'snapchain-1';
// x86 by default: Snapchain publishes arm64 images, but not every helper container
// in its compose file is verified on ARM. ARCH=arm or ARCH=any to widen the search.
const ARCH = process.env.ARCH || 'x86';
const MIN_CORES = 4;
const MIN_MEMORY_GB = 16;
const KEY_PATH = join(homedir(), '.ssh', 'farcaster_node');

requireToken();

// Refuse to create a second node by accident.
const existing = (await api('GET', `/servers?label_selector=${LABEL}`)).servers;
if (existing.length) {
  const s = existing[0];
  console.log(`You already have a node: ${s.name} at ${s.public_net.ipv4.ip}`);
  console.log('Run `node scripts/destroy.mjs --provider hetzner` first if you want a fresh one.');
  process.exit(0);
}

// --- Pick the cheapest server type that fits Snapchain's requirements ---

const { server_types } = await api('GET', '/server_types?per_page=50');
let available = null;
try {
  const { datacenters } = await api('GET', '/datacenters?per_page=50');
  available = new Set(
    datacenters.filter((d) => d.location.name === LOCATION).flatMap((d) => d.server_types.available)
  );
} catch {
  // Availability is a nice-to-have; fall back to the price list alone.
}

const candidates = server_types
  .filter((t) => !t.deprecated && !t.deprecation)
  .filter((t) => t.cores >= MIN_CORES && t.memory >= MIN_MEMORY_GB)
  .filter((t) => ARCH === 'any' || t.architecture === ARCH)
  .filter((t) => !available || available.has(t.id))
  .map((t) => ({ type: t, price: t.prices.find((p) => p.location === LOCATION) }))
  .filter((c) => c.price)
  .sort((a, b) => Number(a.price.price_hourly.gross) - Number(b.price.price_hourly.gross));

if (!candidates.length) {
  console.error(`No server type with ${MIN_CORES}+ vCPU / ${MIN_MEMORY_GB}+ GB is available in ${LOCATION}.`);
  console.error('Try another location, e.g. LOCATION=fsn1, hel1, ash or hil.');
  process.exit(1);
}
const { type, price } = candidates[0];

const { pricing } = await api('GET', '/pricing');
const volumeMonthly = Number(pricing.volume.price_per_gb_month.gross) * VOLUME_GB;
const serverMonthly = Number(price.price_monthly.gross);
const totalMonthly = serverMonthly + volumeMonthly;
const cur = pricing.currency;

console.log(`
Plan (${LOCATION}):
  server   ${type.name}  ${type.cores} vCPU, ${type.memory} GB RAM, ${type.architecture}   ${serverMonthly.toFixed(2)} ${cur}/mo
  volume   ${VOLUME_GB} GB block storage                         ${volumeMonthly.toFixed(2)} ${cur}/mo
  total    ~${totalMonthly.toFixed(2)} ${cur}/mo, billed hourly (~${(totalMonthly / 730).toFixed(3)} ${cur}/h)
           One week ≈ ${((totalMonthly / 730) * 168).toFixed(2)} ${cur}. Delete anytime with: node scripts/destroy.mjs --provider hetzner
`);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Create it? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

// --- SSH key ---

if (!existsSync(KEY_PATH)) {
  mkdirSync(join(homedir(), '.ssh'), { recursive: true });
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'farcaster-node', '-f', KEY_PATH], {
    stdio: 'inherit',
  });
}
const publicKey = readFileSync(KEY_PATH + '.pub', 'utf8').trim();
// Hetzner identifies keys by the MD5 fingerprint of the raw key bytes.
const fingerprint = createHash('md5')
  .update(Buffer.from(publicKey.split(' ')[1], 'base64'))
  .digest('hex')
  .match(/../g)
  .join(':');
let sshKey = (await api('GET', `/ssh_keys?fingerprint=${fingerprint}`)).ssh_keys[0];
if (!sshKey) {
  sshKey = (await api('POST', '/ssh_keys', { name: `farcaster-node-${Date.now()}`, public_key: publicKey, labels: LABELS }))
    .ssh_key;
}

// --- Firewall: 22 for you, 3381-3383 for the Farcaster network ---

const anywhere = ['0.0.0.0/0', '::/0'];
// Reuse the firewall from an earlier, interrupted run if there is one.
const firewall = (await api('GET', `/firewalls?label_selector=${LABEL}`)).firewalls[0] ?? (await api('POST', '/firewalls', {
  name: `${NAME}-fw`,
  labels: LABELS,
  rules: [
    { description: 'SSH', direction: 'in', protocol: 'tcp', port: '22', source_ips: anywhere },
    { description: 'Snapchain HTTP API', direction: 'in', protocol: 'tcp', port: '3381', source_ips: anywhere },
    { description: 'Snapchain gossip (QUIC)', direction: 'in', protocol: 'udp', port: '3382', source_ips: anywhere },
    { description: 'Snapchain gRPC API', direction: 'in', protocol: 'tcp', port: '3383', source_ips: anywhere },
  ],
})).firewall;
console.log(`✓ firewall ${firewall.name}`);

// --- Volume ---

let volume = (await api('GET', `/volumes?label_selector=${LABEL}`)).volumes[0];
if (!volume) {
  try {
    volume = (
      await api('POST', '/volumes', {
        name: `${NAME}-data`,
        size: VOLUME_GB,
        location: LOCATION,
        format: 'ext4',
        labels: LABELS,
      })
    ).volume;
  } catch (err) {
    if (err.message.includes('resource_limit_exceeded')) {
      console.error(`
✗ Hetzner refused a ${VOLUME_GB} GB volume: your account's storage limit is lower than that.
  New Hetzner accounts start with small limits. Ask for more (usually approved within hours):
    Cloud Console → your project → Limits → request an increase of the volume limit to 2000 GB
    Reason: "Running a Farcaster Snapchain read node, needs ~1.2 TB block storage."
  Then run this script again. Nothing billable was created.`);
      process.exit(1);
    }
    throw err;
  }
}
console.log(`✓ volume ${volume.name} (${volume.size} GB)`);

// --- Server ---

let server;
try {
  const created = await api('POST', '/servers', {
    name: NAME,
    server_type: type.name,
    image: 'ubuntu-24.04',
    location: LOCATION,
    ssh_keys: [sshKey.id],
    volumes: [volume.id],
    automount: true,
    firewalls: [{ firewall: firewall.id }],
    labels: LABELS,
  });
  server = created.server;
  await waitForAction(created.action);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  console.error('The firewall and volume were created and are billed. Clean up with: node scripts/destroy.mjs --provider hetzner');
  process.exit(1);
}

const ip = server.public_net.ipv4.ip;
console.log(`✓ server ${server.name} (${type.name}) at ${ip}`);

// Give sshd a moment to come up so the next command works first try.
process.stdout.write('  waiting for SSH');
for (let i = 0; i < 30; i++) {
  try {
    execFileSync('ssh', ['-i', KEY_PATH, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', `root@${ip}`, 'true'], {
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

  ssh -i "${KEY_PATH}" root@${ip} "curl -fsSL https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/node.sh | bash -s -- --fid YOUR_FID"

Your node's API will be at http://${ip}:3381 once it has synced.
`);
