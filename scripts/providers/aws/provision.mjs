// Command 0 on AWS: rent the compute for a Snapchain read node.
//
// Creates, all tagged app=farcaster-readnode so destroy.mjs can find them:
//   - an EC2 key pair from ~/.ssh/farcaster_node (generated if missing)
//   - a security group opening SSH + the three Snapchain ports
//   - an Ubuntu 24.04 instance with 4 vCPU / 16 GB RAM
//   - a 1 TB gp3 data volume, deleted together with the instance
//
// Usage:  aws login, then  node scripts/provision.mjs --provider aws [--yes]
// Env:    AWS_REGION (default us-east-1)  DISK_GB (default 1024)  INSTANCE_TYPE  SERVER_NAME

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { aws, requireLogin, REGION, TAG_KEY, TAG_VALUE, NAME_FILTER } from './cli.mjs';

const DISK_GB = Number(process.env.DISK_GB || 1024);
const NAME = process.env.SERVER_NAME || 'snapchain-1';
const USER = 'ubuntu';
const KEY_NAME = 'farcaster-node';
const KEY_PATH = join(homedir(), '.ssh', 'farcaster_node');
// 4 vCPU / 16 GB, non-burstable (sync keeps the CPU busy for hours, which
// would rack up surplus charges on t3 "unlimited"). Approximate us-east-1
// on-demand prices; other regions differ a little.
const TYPES = { 'm6a.xlarge': 0.1728, 'm6i.xlarge': 0.192, 'm5.xlarge': 0.192 };
const GP3_PER_GB_MONTH = 0.08;

const identity = requireLogin();
console.log(`AWS account ${identity.Account}, region ${REGION}`);

const running = aws(['ec2', 'describe-instances', '--filters', NAME_FILTER, 'Name=instance-state-name,Values=pending,running,stopping,stopped'], {
  quiet: true,
}).Reservations.flatMap((r) => r.Instances);
if (running.length) {
  console.log(`You already have a node: ${running[0].InstanceId} at ${running[0].PublicIpAddress ?? '(no IP yet)'}`);
  console.log('Run `node scripts/destroy.mjs --provider aws` first if you want a fresh one.');
  process.exit(0);
}

const type = process.env.INSTANCE_TYPE || Object.keys(TYPES)[0];
const hourly = TYPES[type];
const diskMonthly = DISK_GB * GP3_PER_GB_MONTH;
const monthly = hourly !== undefined ? hourly * 730 + diskMonthly : undefined;
const usd = (n) => (n === undefined ? 'n/a' : `$${n.toFixed(2)}`);

console.log(`
Plan (${REGION}, approximate on-demand prices):
  instance ${type}  4 vCPU, 16 GB RAM, Ubuntu 24.04     ${usd(hourly && hourly * 730)}/mo
  volume   ${DISK_GB} GB gp3                                ${usd(diskMonthly)}/mo
  total    ~${usd(monthly)}/mo, billed per second; one week ≈ ${usd(monthly && (monthly / 730) * 168)}
           AWS credits are used first. Outbound traffic past 100 GB/mo is extra.
           Delete anytime with: node scripts/destroy.mjs --provider aws
`);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Create it? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

// --- SSH key → EC2 key pair ---

if (!existsSync(KEY_PATH)) {
  mkdirSync(join(homedir(), '.ssh'), { recursive: true });
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'farcaster-node', '-f', KEY_PATH], { stdio: 'inherit' });
}
try {
  aws(['ec2', 'describe-key-pairs', '--key-names', KEY_NAME], { quiet: true });
} catch {
  // CLI v2 takes blob arguments as base64.
  const material = Buffer.from(readFileSync(KEY_PATH + '.pub', 'utf8').trim()).toString('base64');
  aws(['ec2', 'import-key-pair', '--key-name', KEY_NAME, '--public-key-material', material,
    '--tag-specifications', `ResourceType=key-pair,Tags=[{Key=${TAG_KEY},Value=${TAG_VALUE}}]`], { quiet: true });
}
console.log(`✓ key pair ${KEY_NAME}`);

// --- Security group in the default VPC ---

const existingSg = aws(['ec2', 'describe-security-groups', '--filters', NAME_FILTER], { quiet: true }).SecurityGroups[0];
let sgId = existingSg?.GroupId;
if (!sgId) {
  sgId = aws(['ec2', 'create-security-group', '--group-name', `${NAME}-sg`,
    '--description', 'Farcaster Snapchain read node: SSH and Snapchain ports',
    '--tag-specifications', `ResourceType=security-group,Tags=[{Key=${TAG_KEY},Value=${TAG_VALUE}}]`], { quiet: true }).GroupId;
  const open = (proto, port) => `IpProtocol=${proto},FromPort=${port},ToPort=${port},IpRanges=[{CidrIp=0.0.0.0/0}]`;
  aws(['ec2', 'authorize-security-group-ingress', '--group-id', sgId, '--ip-permissions',
    open('tcp', 22),   // SSH
    open('tcp', 3381), // Snapchain HTTP API
    open('udp', 3382), // Snapchain gossip (QUIC)
    open('tcp', 3383), // Snapchain gRPC API
  ], { quiet: true });
}
console.log(`✓ security group ${sgId}: ports 22, 3381-3383 open`);

// --- Instance ---

const ami = aws(['ssm', 'get-parameter', '--name',
  '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id'], { quiet: true }).Parameter.Value;

const tags = `Tags=[{Key=${TAG_KEY},Value=${TAG_VALUE}},{Key=Name,Value=${NAME}}]`;
let instance;
try {
  instance = aws(['ec2', 'run-instances',
    '--image-id', ami,
    '--instance-type', type,
    '--key-name', KEY_NAME,
    '--security-group-ids', sgId,
    '--block-device-mappings',
    'DeviceName=/dev/sda1,Ebs={VolumeSize=64,VolumeType=gp3,DeleteOnTermination=true}',
    `DeviceName=/dev/sdf,Ebs={VolumeSize=${DISK_GB},VolumeType=gp3,DeleteOnTermination=true}`,
    '--tag-specifications', `ResourceType=instance,${tags}`, `ResourceType=volume,${tags}`,
  ], { quiet: true }).Instances[0];
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  if (/VcpuLimitExceeded/.test(err.stderr)) {
    console.error('  Your account\'s vCPU quota is below 4. Request "Running On-Demand Standard instances" ≥ 4 in Service Quotas.');
  } else if (/Unsupported|not eligible|FreeTier/i.test(err.stderr)) {
    console.error(`  ${type} is not allowed on this account. AWS Free-plan accounts must upgrade to the Paid plan first.`);
  }
  console.error('  Clean up the partial setup with: node scripts/destroy.mjs --provider aws');
  process.exit(1);
}
console.log(`  launching ${instance.InstanceId}...`);
aws(['ec2', 'wait', 'instance-running', '--instance-ids', instance.InstanceId], { quiet: true });
const ip = aws(['ec2', 'describe-instances', '--instance-ids', instance.InstanceId], { quiet: true })
  .Reservations[0].Instances[0].PublicIpAddress;
console.log(`✓ instance ${NAME} (${type}) at ${ip}`);

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
