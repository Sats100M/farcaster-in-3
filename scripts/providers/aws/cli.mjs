// Thin wrapper around the AWS CLI v2 (`aws`), shared by provision.mjs and destroy.mjs.
// Auth is whatever `aws login` / `aws configure` set up; these scripts store no keys.
import { spawnSync } from 'node:child_process';

export const REGION = process.env.AWS_REGION || 'us-east-1';
export const TAG_KEY = 'app';
export const TAG_VALUE = 'farcaster-readnode';
export const NAME_FILTER = `Name=tag:${TAG_KEY},Values=${TAG_VALUE}`;

export function aws(args, { quiet = false } = {}) {
  const res = spawnSync('aws', [...args, '--region', REGION, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', quiet ? 'pipe' : 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error?.code === 'ENOENT') {
    console.error('The AWS CLI is not installed: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html');
    process.exit(1);
  }
  if (res.status !== 0 && /explicit deny in a service control policy/.test(res.stderr)) {
    console.error(
      '\n✗ Your AWS account is blocked from using EC2 by an organization policy (SCP).\n' +
        '  Accounts on the AWS Free plan, or created through a third-party platform, can be locked this way.\n' +
        '  Upgrade the account to the Paid plan, or use another provider: --provider azure | hetzner'
    );
    process.exit(1);
  }
  if (res.status !== 0) {
    const err = new Error(`aws ${args.slice(0, 2).join(' ')} failed${res.stderr ? ': ' + res.stderr.trim() : ''}`);
    err.stderr = res.stderr || '';
    throw err;
  }
  return res.stdout.trim() ? JSON.parse(res.stdout) : {};
}

export function requireLogin() {
  try {
    return aws(['sts', 'get-caller-identity'], { quiet: true });
  } catch {
    console.error('Not logged in to AWS. Run:  aws login   (or aws configure) and try again.');
    process.exit(1);
  }
}
