#!/usr/bin/env node
// farcaster-in-3: your own Farcaster node and client, in three commands.
//
//   ./fc3 provision            rent a server (--provider azure|aws|lightsail|hetzner, --hours N to auto-delete)
//   ./fc3 node --fid <fid>     install and start a Snapchain read node on it
//   ./fc3 client               set up the client and open it in your browser (--wallet, --lan, --cli)
//
//   ./fc3 status               node sync, server age, auto-delete time
//   ./fc3 destroy              delete the server so billing stops
//   ./fc3 watchdog --hours N   delete it automatically after N hours (--off to cancel)
//   ./fc3 https                HTTPS for the node's API, for web clients (fc3 node does this already)
//   ./fc3 ssh                  a shell on the server
//   ./fc3 feed | cast | ...    any client command (see ./fc3 help-client)
//
// fc3 remembers the server it made, so none of these need an IP typed in.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadServer, updateServer, SERVER_FILE, KEY_PATH } from './scripts/server.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = join(ROOT, 'client');
const CLIENT_CONFIG = join(homedir(), '.farcaster-in-3.json');
const NODE_SH = 'https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/node.sh';
const WATCHDOG_LOG = join(homedir(), '.farcaster-in-3-watchdog.log');

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = rest[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

// Runs a command with this terminal attached; returns its exit code.
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm', ...opts });
  if (r.error) throw r.error;
  return r.status ?? 1;
}
const node = (script, args, opts) => run(process.execPath, [join(ROOT, script), ...args], opts);

function server() {
  const s = loadServer();
  if (s) return s;
  const ip = flag('host');
  if (ip) return { ip, user: flag('user') || 'root', provider: flag('provider') };
  throw new Error(`No server yet. Run ./fc3 provision first, or pass --host <ip> --user <ssh user> for one you already have.`);
}
const ssh = (s, remote, extra = []) =>
  run('ssh', ['-i', KEY_PATH, '-o', 'StrictHostKeyChecking=accept-new', ...extra, `${s.user}@${s.ip}`, ...(remote ? [remote] : [])]);

function hoursSince(iso) {
  return ((Date.now() - new Date(iso)) / 3600e3).toFixed(1);
}

// ---------------------------------------------------------------------------

function provision() {
  const before = loadServer()?.ip;
  const code = node('scripts/provision.mjs', rest.filter((a, i) => a !== '--hours' && rest[i - 1] !== '--hours'));
  const after = loadServer();
  if (code === 0 && after && flag('hours')) watchdogStart(Number(flag('hours')));
  if (code === 0 && after && after.ip !== before && !flag('hours')) {
    console.log('Tip: ./fc3 watchdog --hours 24 deletes the server for you if you forget.');
  }
  return code;
}

function nodeCmd() {
  const s = server();
  let fid = flag('fid');
  if (!fid && existsSync(CLIENT_CONFIG)) fid = JSON.parse(readFileSync(CLIENT_CONFIG, 'utf8')).fid;
  const sudo = s.user === 'root' ? '' : 'sudo ';
  console.log(`Installing the Snapchain read node on ${s.ip}. This takes a few minutes, then the node syncs on its own.\n`);
  // --https: the live web client on the tutorial site can only reach a node over HTTPS.
  const args = [fid ? `--fid ${fid}` : '', flag('no-https') ? '' : '--https'].join(' ');
  const code = ssh(s, `curl -fsSL ${NODE_SH} | ${sudo}bash -s -- ${args}`);
  if (code === 0) console.log(`\nWatch it sync with ./fc3 status. When it says "in sync", run ./fc3 client`);
  return code;
}

async function client() {
  const s = loadServer();
  const nodeIp = flag('node') || s?.ip;
  if (!existsSync(join(CLIENT, 'node_modules'))) {
    console.log('Installing the client (one time)...');
    if (run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: CLIENT }) !== 0) return 1;
  }
  const cfg = existsSync(CLIENT_CONFIG) ? JSON.parse(readFileSync(CLIENT_CONFIG, 'utf8')) : null;
  // An app key works through any node, so an existing one is reused; --node only changes where requests go.
  if (!cfg) {
    if (!nodeIp) throw new Error('No node yet. Run ./fc3 provision and ./fc3 node first, or pass --node <ip>.');
    const init = ['init', '--node', nodeIp, ...(flag('wallet') ? ['--wallet'] : [])];
    if (node('client/fc.mjs', init) !== 0) return 1;
  }
  if (flag('cli')) return 0;
  const password = randomBytes(9).toString('base64url');
  const pass = ['lan', 'port', 'node'].flatMap((f) => (flag(f) === undefined ? [] : flag(f) === true ? [`--${f}`] : [`--${f}`, flag(f)]));
  return node('client/fc.mjs', ['serve', '--open', '--password', password, ...pass]);
}

function status() {
  const s = server();
  console.log(`Server ${s.ip}${s.provider ? ` on ${s.provider}` : ''}${s.createdAt ? `, up ${hoursSince(s.createdAt)} h` : ''}`);
  if (s.deleteAt) {
    const left = (new Date(s.deleteAt) - Date.now()) / 3600e3;
    console.log(`Auto-delete at ${new Date(s.deleteAt).toLocaleString()} (${left.toFixed(1)} h from now), if this computer is on.`);
  }
  return ssh(s, 'fc-node-status', ['-o', 'ConnectTimeout=10']);
}

function destroy() {
  const s = server();
  return node('scripts/destroy.mjs', ['--provider', s.provider || flag('provider') || 'aws', ...rest.filter((a) => a === '--yes')]);
}

// The watchdog runs on this computer, not on the server, because deleting the
// server needs your cloud login, which never leaves this machine. It checks the
// clock every minute, so a laptop that slept past the deadline deletes on waking.
function watchdogStart(hours) {
  if (!(hours > 0)) throw new Error('Usage: ./fc3 watchdog --hours N');
  const s = server();
  if (!s.provider) throw new Error('The watchdog needs a server made by ./fc3 provision.');
  const deleteAt = new Date(Date.now() + hours * 3600e3).toISOString();
  updateServer({ deleteAt });
  const out = openSync(WATCHDOG_LOG, 'a');
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'watchdog-run'], { detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  console.log(`✓ ${s.ip} will be deleted at ${new Date(deleteAt).toLocaleString()}. Log: ${WATCHDOG_LOG}`);
  console.log('  Leave this computer on (sleep is fine). Cancel with ./fc3 watchdog --off');
  return 0;
}

async function watchdogRun() {
  const start = loadServer();
  console.log(`${new Date().toISOString()} watching ${start?.ip}, delete at ${start?.deleteAt}`);
  for (;;) {
    const s = loadServer();
    if (!s || s.ip !== start?.ip || !s.deleteAt) return console.log(`${new Date().toISOString()} cancelled or already deleted`);
    if (Date.now() >= new Date(s.deleteAt)) {
      console.log(`${new Date().toISOString()} deadline reached, deleting ${s.ip}`);
      return node('scripts/destroy.mjs', ['--provider', s.provider, '--yes'], { stdio: 'inherit' });
    }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

function watchdog() {
  if (flag('off')) {
    updateServer({ deleteAt: undefined });
    console.log('✓ Auto-delete cancelled. Delete it yourself later with ./fc3 destroy');
    return 0;
  }
  return watchdogStart(Number(flag('hours')));
}

const commands = {
  provision,
  node: nodeCmd,
  client,
  status,
  destroy,
  watchdog,
  'watchdog-run': watchdogRun,
  ssh: () => ssh(server(), null),
  https: () => ssh(server(), `curl -fsSL ${NODE_SH.replace('node.sh', 'https.sh')} | ${server().user === 'root' ? '' : 'sudo '}bash`),
  'help-client': () => node('client/fc.mjs', []),
};

if (!command || command === 'help' || command === '--help') {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
} else {
  try {
    // Anything that isn't an fc3 command goes to the client: ./fc3 feed, ./fc3 cast "hi", ...
    const fn = commands[command] || (() => node('client/fc.mjs', [command, ...rest]));
    process.exitCode = await fn();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
}
