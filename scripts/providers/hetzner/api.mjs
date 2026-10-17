// Tiny Hetzner Cloud API client shared by provision.mjs and destroy.mjs.
// No dependencies: Node 18+ ships fetch.

export const API = 'https://api.hetzner.cloud/v1';
export const LABEL = 'app=farcaster-readnode';
export const LABELS = { app: 'farcaster-readnode' };

const token = process.env.HCLOUD_TOKEN;

export function requireToken() {
  if (!token) {
    console.error(
      'Missing HCLOUD_TOKEN.\n' +
        'Create one in the Hetzner Cloud console: your project → Security → API Tokens → Read & Write.\n' +
        'Put it in .env as HCLOUD_TOKEN=xxxx, then run:  node scripts/provision.mjs --provider hetzner\n' +
        ''
    );
    process.exit(1);
  }
}

export async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error || {};
    throw new Error(`Hetzner API ${method} ${path} → ${res.status} ${e.code || ''}: ${e.message || res.statusText}`);
  }
  return json;
}

// Hetzner actions (create server, delete server, ...) are async; poll until done.
export async function waitForAction(action) {
  while (action.status === 'running') {
    await sleep(2000);
    action = (await api('GET', `/actions/${action.id}`)).action;
  }
  if (action.status === 'error') {
    throw new Error(`Action ${action.command} failed: ${action.error?.message}`);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
