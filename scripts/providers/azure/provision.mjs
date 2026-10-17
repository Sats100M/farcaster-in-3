// Command 0 on Azure: rent the compute for a Snapchain read node.
//
// Creates one resource group (farcaster-readnode) holding:
//   - an Ubuntu 24.04 VM with 4 vCPU / 16 GB RAM (first size your quota allows)
//   - a 1 TB Standard SSD data disk for the node's database
//   - a network security group opening SSH + the three Snapchain ports
// Deleting the resource group (destroy.mjs) removes all of it.
//
// Usage:  az login, then  node scripts/provision.mjs --provider azure [--yes]
// Env:    AZURE_LOCATION (default eastus)  DISK_GB (default 1024)  SERVER_NAME (default snapchain-1)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { az, requireLogin, GROUP, TAG } from './az.mjs';

// eastus sits next to most of Snapchain's bootstrap peers.
const LOCATION = process.env.AZURE_LOCATION || 'eastus';
const DISK_GB = Number(process.env.DISK_GB || 1024);
const NAME = process.env.SERVER_NAME || 'snapchain-1';
const USER = 'azureuser';
const KEY_PATH = join(homedir(), '.ssh', 'farcaster_node');
// 4 vCPU / 16 GB sizes in order of preference, with the quota family each draws from.
const SIZES = [
  { size: 'Standard_D4s_v5', family: 'standardDSv5Family' },
  { size: 'Standard_D4as_v5', family: 'standardDASv5Family' },
  { size: 'Standard_D4s_v4', family: 'standardDSv4Family' },
  { size: 'Standard_B4ms', family: 'standardBSFamily' },
];

const account = requireLogin();
console.log(`Azure subscription: ${account.name}`);

let existingIp;
try {
  existingIp = az(['vm', 'show', '-d', '-g', GROUP, '-n', NAME, '--query', 'publicIps'], { quiet: true });
} catch {
  // No VM yet (an earlier run may have left just the empty resource group).
}
if (existingIp !== undefined) {
  console.log(`You already have a node${existingIp ? ` at ${existingIp}` : ''} (resource group ${GROUP}).`);
  console.log('Run `node scripts/destroy.mjs --provider azure` first if you want a fresh one.');
  process.exit(0);
}

// New subscriptions have the compute/network/storage services switched off until
// registered; until then quotas read as empty. Registering is free.
for (const ns of ['Microsoft.Compute', 'Microsoft.Network', 'Microsoft.Storage']) {
  if (az(['provider', 'show', '-n', ns, '--query', 'registrationState'], { quiet: true }) !== 'Registered') {
    console.log(`  enabling ${ns} on this subscription (one-time, ~1 min)...`);
    az(['provider', 'register', '-n', ns, '--wait'], { json: false, quiet: true });
  }
}

// --- Pick a VM size the subscription has quota for ---
// Free-trial subscriptions often cap vCPUs per region and per VM family.

const usage = az(['vm', 'list-usage', '-l', LOCATION], { quiet: true });
const free = (name) => {
  const u = usage.find((x) => x.name.value === name);
  return u ? Number(u.limit) - Number(u.currentValue) : 0;
};
if (free('cores') < 4) {
  console.error(`Your subscription has only ${free('cores')} vCPUs free in ${LOCATION}; a read node needs 4.`);
  console.error('Try another region (AZURE_LOCATION=westus2, northeurope, ...) or request a quota increase in the portal.');
  process.exit(1);
}
const pick = SIZES.find((s) => free(s.family) >= 4);
if (!pick) {
  console.error(`No 4 vCPU / 16 GB size has quota in ${LOCATION}. Checked: ${SIZES.map((s) => s.size).join(', ')}`);
  console.error('Try another region with AZURE_LOCATION=..., or request a quota increase in the portal.');
  process.exit(1);
}

// --- Price estimate from Azure's public retail price API ---

async function retailPrice(filter, keep = () => true) {
  try {
    const url = 'https://prices.azure.com/api/retail/prices?$filter=' + encodeURIComponent(filter);
    const { Items } = await (await fetch(url)).json();
    return Items.find(keep)?.retailPrice;
  } catch {
    return undefined;
  }
}
const vmHourly = await retailPrice(
  `serviceName eq 'Virtual Machines' and armRegionName eq '${LOCATION}' and armSkuName eq '${pick.size}' and priceType eq 'Consumption'`,
  (i) => !i.productName.includes('Windows') && !/Spot|Low Priority/.test(i.skuName)
);
// Standard SSD tiers: E30 covers up to 1 TB, E40 up to 2 TB.
const tier = DISK_GB <= 1024 ? 'E30' : DISK_GB <= 2048 ? 'E40' : 'E50';
const diskMonthly = await retailPrice(
  `serviceName eq 'Storage' and armRegionName eq '${LOCATION}' and skuName eq '${tier} LRS' and meterName eq '${tier} LRS Disk'`
);
const fmt = (n) => (n === undefined ? '  n/a' : `$${n.toFixed(2)}`);
const monthly = vmHourly !== undefined && diskMonthly !== undefined ? vmHourly * 730 + diskMonthly : undefined;

console.log(`
Plan (${LOCATION}):
  vm       ${pick.size}  4 vCPU, 16 GB RAM, Ubuntu 24.04     ${fmt(vmHourly && vmHourly * 730)}/mo
  disk     ${DISK_GB} GB Standard SSD (${tier})                 ${fmt(diskMonthly)}/mo
  total    ~${fmt(monthly)}/mo, billed per hour; one week ≈ ${fmt(monthly && (monthly / 730) * 168)}
           Free-trial credit is used first. Delete anytime with: node scripts/destroy.mjs --provider azure
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
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'farcaster-node', '-f', KEY_PATH], { stdio: 'inherit' });
}
// az runs through cmd.exe on Windows, so a path with spaces needs quoting there.
const pubKeyArg = process.platform === 'win32' ? `"${KEY_PATH}.pub"` : `${KEY_PATH}.pub`;

// --- Resource group, VM, firewall ---

az(['group', 'create', '-n', GROUP, '-l', LOCATION, '--tags', TAG], { quiet: true });
console.log(`✓ resource group ${GROUP}`);

// Azure regularly runs out of a size in a region ("SkuNotAvailable"). Walk through
// the sizes we have quota for, then nearby regions, until one is accepted.
const regions = process.env.AZURE_LOCATION ? [LOCATION] : [LOCATION, 'eastus2', 'centralus', 'westus2', 'westus3', 'northeurope'];
let vm, used;
for (const region of regions) {
  const quota = region === LOCATION ? usage : az(['vm', 'list-usage', '-l', region], { quiet: true });
  const freeIn = (name) => {
    const u = quota.find((x) => x.name.value === name);
    return u ? Number(u.limit) - Number(u.currentValue) : 0;
  };
  if (freeIn('cores') < 4) continue;
  for (const s of SIZES.filter((s) => freeIn(s.family) >= 4)) {
    console.log(`  creating VM ${s.size} in ${region} (takes 1-3 minutes)...`);
    try {
      vm = createVm(region, s.size);
      used = { region, size: s.size };
      break;
    } catch (err) {
      if (!/SkuNotAvailable|capacity|ZonalAllocationFailed|AllocationFailed/i.test(err.stderr)) {
        console.error(`\n✗ ${err.message}`);
        console.error('  Clean up the partial setup with: node scripts/destroy.mjs --provider azure');
        process.exit(1);
      }
      console.log(`  ${s.size} is sold out in ${region}, trying the next option`);
    }
  }
  if (vm) break;
}
if (!vm) {
  console.error('\n✗ No 4 vCPU / 16 GB size was available in any region tried. Try again later or set AZURE_LOCATION.');
  console.error('  Clean up with: node scripts/destroy.mjs --provider azure');
  process.exit(1);
}

function createVm(region, size) {
  return az([
    'vm', 'create',
    '-g', GROUP, '-n', NAME, '-l', region,
    '--image', 'Ubuntu2404',
    '--size', size,
    '--admin-username', USER,
    '--ssh-key-values', pubKeyArg,
    '--os-disk-size-gb', '64',
    '--data-disk-sizes-gb', String(DISK_GB),
    '--storage-sku', 'StandardSSD_LRS',
    '--public-ip-sku', 'Standard',
    '--nsg', `${NAME}-nsg`,
    '--nsg-rule', 'SSH',
    '--tags', TAG,
  ], { quiet: true });
}
const ip = vm.publicIpAddress;
console.log(`✓ vm ${NAME} (${used.size}, ${used.region}) at ${ip}`);

// 3381 HTTP API, 3382 gossip (UDP/QUIC), 3383 gRPC. '*' covers both TCP and UDP.
az([
  'network', 'nsg', 'rule', 'create',
  '-g', GROUP, '--nsg-name', `${NAME}-nsg`, '-n', 'snapchain',
  '--priority', '1010', '--direction', 'Inbound', '--access', 'Allow',
  '--protocol', '*', '--destination-port-ranges', '3381-3383',
], { quiet: true });
console.log('✓ firewall: ports 22, 3381-3383 open');

process.stdout.write('  waiting for SSH');
for (let i = 0; i < 30; i++) {
  try {
    execFileSync('ssh', ['-i', KEY_PATH, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', `${USER}@${ip}`, 'true'], {
      stdio: 'ignore',
    });
    break;
  } catch {
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

console.log(`

Done. Your server is ready.

Next, command 1 (installs and starts the read node):

  ssh -i "${KEY_PATH}" ${USER}@${ip} "curl -fsSL https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/node.sh | sudo bash -s -- --fid YOUR_FID"

Your node's API will be at http://${ip}:3381 once it has synced.
`);
