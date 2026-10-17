// Thin wrapper around the Azure CLI (`az`), shared by provision.mjs and destroy.mjs.
// Auth is whatever `az login` set up; no tokens are stored by these scripts.
import { spawnSync } from 'node:child_process';

export const GROUP = process.env.AZURE_GROUP || 'farcaster-readnode';
export const TAG = 'app=farcaster-readnode';

// On Windows `az` is a .cmd shim, which only runs through a shell.
const shell = process.platform === 'win32';

export function az(args, { json = true, quiet = false } = {}) {
  const res = spawnSync('az', json ? [...args, '-o', 'json'] : args, {
    shell,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', quiet ? 'pipe' : 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error?.code === 'ENOENT' || (shell && res.status === 9009)) {
    console.error('The Azure CLI is not installed: https://learn.microsoft.com/cli/azure/install-azure-cli');
    process.exit(1);
  }
  if (res.status !== 0) {
    const err = new Error(`az ${args.slice(0, 3).join(' ')} failed${res.stderr ? ': ' + res.stderr.trim() : ''}`);
    err.stderr = res.stderr || '';
    throw err;
  }
  return json && res.stdout.trim() ? JSON.parse(res.stdout) : res.stdout;
}

export function requireLogin() {
  try {
    return az(['account', 'show'], { quiet: true });
  } catch {
    console.error('Not logged in to Azure. Run:  az login   then try again.');
    process.exit(1);
  }
}
