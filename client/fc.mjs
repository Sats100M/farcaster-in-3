#!/usr/bin/env node
// Command 2: a minimal Farcaster client that talks only to your own read node.
//
//   fc init --node <ip>        import a seed phrase once, register this client's own app key
//   fc feed                    casts from people you follow
//   fc cast "hello"            post (also: --reply <fid>/<hash>)
//   fc follow <user>           also: unfollow
//   fc like <fid>/<hash>       also: unlike, recast
//   fc apps <user>             which apps a user posts from (for --only-app / --hide-app)
//
// Reads go to your node over gRPC (port 3383). Writes go to the same node, which
// checks them and gossips them on to the validators; read nodes keep no mempool.

import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mnemonicToAccount } from 'viem/accounts';
import {
  getInsecureHubRpcClient,
  FarcasterNetwork,
  MessageType,
  ReactionType,
  UserDataType,
  NobleEd25519Signer,
  ViemLocalEip712Signer,
  makeKeyAddBody,
  makeKeyAdd,
  makeCastAdd,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  getFarcasterTime,
  fromFarcasterTime,
  bytesToHexString,
  hexStringToBytes,
} from '@farcaster/hub-nodejs';

const CONFIG = join(homedir(), '.farcaster-in-3.json');
const NETWORK = FarcasterNetwork.MAINNET;
// What this client's key may sign. KEY_ADD/KEY_REMOVE can never be delegated, so
// a leaked app key can post as you but can't add keys, move the account or funds.
const SCOPES = [
  MessageType.CAST_ADD,
  MessageType.CAST_REMOVE,
  MessageType.REACTION_ADD,
  MessageType.REACTION_REMOVE,
  MessageType.LINK_ADD,
  MessageType.LINK_REMOVE,
];
const TTL = 30 * 24 * 60 * 60; // key expires after 30 days without use; each use extends it

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i] ?? true;
  else args.push(rest[i]);
}

const commands = { init, whoami, feed, cast, follow, unfollow, like, unlike, recast, apps };
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(command ? 1 : 0);
}
try {
  await commands[command]();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
}
process.exit();

// ---------------------------------------------------------------------------

function nodeClient(host) {
  // A bare IP or hostname means the default gRPC port.
  return getInsecureHubRpcClient(host.includes(':') ? host : `${host}:3383`);
}

// HubRpcClient returns neverthrow Results; turn errors into exceptions.
async function call(promise, what) {
  const result = await promise;
  if (result.isErr()) throw new Error(`${what}: ${result.error.message}`);
  return result.value;
}

function loadConfig() {
  if (!existsSync(CONFIG)) throw new Error('Not set up yet. Run: fc init --node <your node ip>');
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const client = nodeClient(flags.node || cfg.node);
  const signer = new NobleEd25519Signer(hexStringToBytes(cfg.privateKey)._unsafeUnwrap());
  return { ...cfg, client, signer, dataOptions: { fid: cfg.fid, network: NETWORK } };
}

async function submit(client, made, what) {
  if (made.isErr()) throw new Error(`${what}: ${made.error.message}`);
  // A successful response means the node validated and relayed the message,
  // not that a validator has put it in a block yet. That usually takes seconds.
  await call(client.submitMessage(made.value), what);
  return made.value;
}

// Hidden prompt for the seed phrase: nothing is echoed, nothing is written to disk.
async function askSecret(question) {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  return new Promise((resolve) => {
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value.trim().replace(/\s+/g, ' '));
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function resolveFid(client, who) {
  if (/^\d+$/.test(who)) return Number(who);
  const name = who.replace(/^@/, '');
  const proof = await call(client.getUsernameProof({ name: new TextEncoder().encode(name) }), `look up @${name}`);
  return proof.fid;
}

function parseCastId(s) {
  const m = /^(\d+)\/(0x[0-9a-fA-F]{40})$/.exec(s || '');
  if (!m) throw new Error('Expected a cast id like 3/0xabc... (shown under each cast in `fc feed`)');
  return { fid: Number(m[1]), hash: hexStringToBytes(m[2])._unsafeUnwrap() };
}

const usernames = new Map();
async function username(client, fid) {
  if (!usernames.has(fid)) {
    const res = await client.getUserData({ fid, userDataType: UserDataType.USERNAME });
    usernames.set(fid, res.isOk() ? res.value.data.userDataBody.value : `fid:${fid}`);
  }
  return usernames.get(fid);
}

// Map each of an author's keys to the app (requestFid) it was issued to.
// This is how casts are attributed to clients: every message is signed by an
// app key, and every app key carries the FID of the app that requested it.
const appByKey = new Map();
async function loadKeys(client, fid) {
  if (appByKey.has(`loaded:${fid}`)) return;
  const res = await client.getSignersByFid({ fid, requesterFids: [] });
  if (res.isOk()) {
    for (const s of res.value.signers) appByKey.set(bytesToHexString(s.key)._unsafeUnwrap(), s.requestFid ?? 0);
  }
  appByKey.set(`loaded:${fid}`, true);
}
const appOf = (msg) => appByKey.get(bytesToHexString(msg.signer)._unsafeUnwrap()) ?? 0;

function ago(farcasterTs) {
  const s = (Date.now() - fromFarcasterTime(farcasterTs)._unsafeUnwrap()) / 1000;
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ---------------------------------------------------------------------------

async function init() {
  const node = flags.node;
  if (!node) throw new Error('Usage: fc init --node <your node ip>');
  const client = nodeClient(node);

  const info = await call(client.getInfo({ dbStats: false }), `reach node ${node}`);
  console.log(`Connected to node ${node} (snapchain ${info.version})`);

  console.log(`
This uses your seed phrase ONCE, in memory, to sign one message that gives this
client its own app key. The phrase is never saved or sent anywhere; only the
signature is. Only paste a seed phrase into software you have read or trust.
`);
  const phrase = await askSecret('Seed phrase (hidden): ');
  const account = mnemonicToAccount(phrase);

  const event = await call(
    client.getIdRegistryOnChainEventByAddress({ address: hexStringToBytes(account.address)._unsafeUnwrap() }),
    `find the Farcaster account owned by ${account.address}`
  );
  const fid = event.fid;
  console.log(`Custody address ${account.address} owns FID ${fid} (@${await username(client, fid)})`);

  const privateKey = randomBytes(32);
  const signer = new NobleEd25519Signer(privateKey);
  const key = (await signer.getSignerKey())._unsafeUnwrap();

  // Gasless app key: the custody address signs an EIP-712 KeyAdd (and the
  // SignedKeyRequest, since this client acts as its own app), the new key signs
  // the envelope to prove possession, and the node relays it. No Optimism tx.
  const { currentUserNonce } = await call(client.getSignersByFid({ fid, requesterFids: [] }), 'read key nonce');
  const body = await makeKeyAddBody(
    {
      fid: BigInt(fid),
      key,
      scopes: SCOPES,
      ttl: TTL,
      nonce: currentUserNonce + 1,
      deadline: getFarcasterTime()._unsafeUnwrap() + 60 * 60,
    },
    new ViemLocalEip712Signer(account)
  );
  if (body.isErr()) throw new Error(`build key request: ${body.error.message}`);
  await submit(client, await makeKeyAdd(body.value, { fid, network: NETWORK }, signer), 'submit KEY_ADD');

  const keyHex = bytesToHexString(key)._unsafeUnwrap();
  writeFileSync(CONFIG, JSON.stringify({ node, fid, publicKey: keyHex, privateKey: bytesToHexString(privateKey)._unsafeUnwrap() }, null, 2), {
    mode: 0o600,
  });

  process.stdout.write('Waiting for the key to land in a block');
  for (let i = 0; i < 30; i++) {
    const res = await client.getSignersByFid({ fid, requesterFids: [] });
    if (res.isOk() && res.value.signers.some((s) => bytesToHexString(s.key)._unsafeUnwrap() === keyHex)) {
      console.log(`\n✓ App key ${keyHex.slice(0, 18)}… is live. Saved to ${CONFIG}`);
      console.log('Try: fc feed   or   fc cast "hello from my own node"');
      return;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`\nKey submitted and saved to ${CONFIG}, but not seen in a block yet. Run \`fc whoami\` in a minute.`);
}

async function whoami() {
  const { client, fid, publicKey, node } = loadConfig();
  const res = await call(client.getSignersByFid({ fid, requesterFids: [] }), 'read keys');
  const mine = res.signers.find((s) => bytesToHexString(s.key)._unsafeUnwrap() === publicKey);
  console.log(`@${await username(client, fid)} (FID ${fid}) via node ${node}`);
  console.log(`app key ${publicKey.slice(0, 18)}… ${mine ? `active, expires ${new Date(mine.expiresAt * 1000).toISOString().slice(0, 10)}` : 'NOT active (expired or not yet merged)'}`);
}

async function feed() {
  const { client, fid } = loadConfig();
  const limit = Number(flags.limit || 20);
  const onlyApp = flags['only-app'] && (await resolveFid(client, String(flags['only-app'])));
  const hideApp = flags['hide-app'] && (await resolveFid(client, String(flags['hide-app'])));
  const viewer = flags.fid ? await resolveFid(client, String(flags.fid)) : fid;

  const links = await call(client.getLinksByFid({ fid: viewer, linkType: 'follow', pageSize: 200, reverse: true }), 'read follows');
  const following = links.messages.map((m) => m.data.linkBody.targetFid).filter(Boolean);
  if (!following.length) return console.log('You don\'t follow anyone yet. Try: fc follow dwr');

  const perAuthor = await Promise.all(
    following.map(async (f) => {
      const res = await client.getCastsByFid({ fid: f, pageSize: 5, reverse: true });
      return res.isOk() ? res.value.messages : [];
    })
  );
  let casts = perAuthor.flat().sort((a, b) => b.data.timestamp - a.data.timestamp);

  if (onlyApp || hideApp) {
    await Promise.all([...new Set(casts.map((c) => c.data.fid))].map((f) => loadKeys(client, f)));
    if (onlyApp) casts = casts.filter((c) => appOf(c) === onlyApp);
    if (hideApp) casts = casts.filter((c) => appOf(c) !== hideApp);
  }

  for (const c of casts.slice(0, limit)) {
    const body = c.data.castAddBody;
    const reply = body.parentCastId ? `  ↳ reply to ${body.parentCastId.fid}` : '';
    console.log(`@${await username(client, c.data.fid)} · ${ago(c.data.timestamp)}${reply}`);
    if (body.text) console.log(`  ${body.text.replace(/\n/g, '\n  ')}`);
    for (const e of body.embeds) if (e.url) console.log(`  [${e.url}]`);
    console.log(`  id ${c.data.fid}/${bytesToHexString(c.hash)._unsafeUnwrap()}\n`);
  }
}

async function cast() {
  const { client, signer, dataOptions } = loadConfig();
  const text = args.join(' ');
  if (!text) throw new Error('Usage: fc cast "your text" [--reply <fid>/<hash>]');
  const body = { text, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [], type: 0 };
  if (flags.reply) body.parentCastId = parseCastId(flags.reply);
  const msg = await submit(client, await makeCastAdd(body, dataOptions, signer), 'post cast');
  console.log(`✓ Cast sent: ${dataOptions.fid}/${bytesToHexString(msg.hash)._unsafeUnwrap()}`);
}

async function link(make, verb) {
  const { client, signer, dataOptions } = loadConfig();
  if (!args[0]) throw new Error(`Usage: fc ${verb} <username or fid>`);
  const targetFid = await resolveFid(client, args[0]);
  await submit(client, await make({ type: 'follow', targetFid }, dataOptions, signer), verb);
  console.log(`✓ ${verb === 'follow' ? 'Following' : 'Unfollowed'} @${await username(client, targetFid)}`);
}
function follow() { return link(makeLinkAdd, 'follow'); }
function unfollow() { return link(makeLinkRemove, 'unfollow'); }

async function react(make, type, verb) {
  const { client, signer, dataOptions } = loadConfig();
  const targetCastId = parseCastId(args[0]);
  await submit(client, await make({ type, targetCastId }, dataOptions, signer), verb);
  console.log(`✓ ${verb} ${args[0]}`);
}
function like() { return react(makeReactionAdd, ReactionType.LIKE, 'Liked'); }
function unlike() { return react(makeReactionRemove, ReactionType.LIKE, 'Unliked'); }
function recast() { return react(makeReactionAdd, ReactionType.RECAST, 'Recast'); }

async function apps() {
  const { client } = loadConfig();
  if (!args[0]) throw new Error('Usage: fc apps <username or fid>');
  const fid = await resolveFid(client, args[0]);
  await loadKeys(client, fid);
  const res = await call(client.getCastsByFid({ fid, pageSize: 100, reverse: true }), 'read casts');
  const counts = new Map();
  for (const c of res.messages) counts.set(appOf(c), (counts.get(appOf(c)) || 0) + 1);
  console.log(`Last ${res.messages.length} casts by @${await username(client, fid)}, by app:`);
  for (const [app, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${app ? `@${await username(client, app)} (FID ${app})` : 'unknown app'}`);
  }
  console.log('\nFilter your feed with: fc feed --only-app <app>   or   fc feed --hide-app <app>');
}
