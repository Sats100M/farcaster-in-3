#!/usr/bin/env node
// Command 2: a minimal Farcaster client that talks only to your own read node.
//
//   fc init --node <ip>        import a seed phrase once, register this client's own app key
//                              (--wallet: approve in a browser wallet instead, no seed phrase)
//   fc feed                    casts from people you follow
//   fc cast "hello"            post (also: --reply <fid>/<hash>)
//   fc follow <user>           also: unfollow
//   fc like <fid>/<hash>       also: unlike, recast, unrecast
//   fc delete <fid>/<hash>     delete one of your casts
//   fc apps <user>             which apps a user posts from (for --only-app / --hide-app)
//   fc revoke                  remove this client's app key (no seed phrase needed)
//   fc serve                   the same client as a web page (--lan: open it on your phone)
//
// Reads go to your node over gRPC (port 3383). Writes go to the same node, which
// checks them and gossips them on to the validators; read nodes keep no mempool.

import { writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mnemonicToAccount } from 'viem/accounts';
import {
  ReactionType,
  NobleEd25519Signer,
  makeCastAdd,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  makeCastRemove,
  makeKeyRemove,
  makeKeyRemoveBodySelfRevoke,
  getFarcasterTime,
  bytesToHexString,
  hexStringToBytes,
} from '@farcaster/hub-nodejs';
import { parseArgs, parseCastId, ago, buildKeyAdd, castText } from './lib.mjs';
import { connectWallet } from './wallet.mjs';
import { CONFIG, nodeClient, call, loadConfig as load, submit, resolveFid, username, loadKeys, appOf, feedCasts } from './hub.mjs';

const [command, ...rest] = process.argv.slice(2);
const { flags, args } = parseArgs(rest);

// ---------------------------------------------------------------------------

const loadConfig = () => load(flags.node);

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

// ---------------------------------------------------------------------------

async function init() {
  const node = flags.node;
  if (!node) throw new Error('Usage: fc init --node <your node ip>');
  const client = nodeClient(node);

  const info = await call(client.getInfo({ dbStats: false }), `reach node ${node}`);
  console.log(`Connected to node ${node} (snapchain ${info.version})`);

  let account;
  let wallet;
  if (flags.wallet) {
    wallet = await connectWallet();
    account = wallet.account;
  } else {
    console.log(`
This uses your seed phrase ONCE, in memory, to sign one message that gives this
client its own app key. The phrase is never saved or sent anywhere; only the
signature is. Only paste a seed phrase into software you have read or trust.
Rather not type it? Use a browser wallet instead: fc init --node ${node} --wallet
`);
    account = mnemonicToAccount(await askSecret('Seed phrase (hidden): '));
  }
  try {
    await addKey(client, node, account);
    await wallet?.finish(true, 'Done. The terminal client has its own app key.');
  } catch (err) {
    await wallet?.finish(false, err.message);
    throw err;
  }
}

async function addKey(client, node, account) {
  const event = await call(
    client.getIdRegistryOnChainEventByAddress({ address: hexStringToBytes(account.address)._unsafeUnwrap() }),
    `find the Farcaster account owned by ${account.address} (it must be the account's custody address)`
  );
  const fid = event.fid;
  console.log(`Custody address ${account.address} owns FID ${fid} (@${await username(client, fid)})`);

  const privateKey = randomBytes(32);
  const signer = new NobleEd25519Signer(privateKey);
  const key = (await signer.getSignerKey())._unsafeUnwrap();

  const { currentUserNonce } = await call(client.getSignersByFid({ fid, requesterFids: [] }), 'read key nonce');
  const made = await buildKeyAdd({ account, fid, signer, nonce: currentUserNonce + 1 });
  await submit(client, made, 'submit KEY_ADD');

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

  let { following, casts } = await feedCasts(client, viewer, { apps: Boolean(onlyApp || hideApp) });
  if (!following.length) return console.log("You don't follow anyone yet. Try: fc follow dwr");

  if (onlyApp || hideApp) {
    if (onlyApp) casts = casts.filter((c) => appOf(c) === onlyApp);
    if (hideApp) casts = casts.filter((c) => appOf(c) !== hideApp);
    if (!casts.length) return console.log('No recent casts left after the app filter. See which apps people use with: fc apps <username>');
  }

  for (const c of casts.slice(0, limit)) {
    const body = c.data.castAddBody;
    const reply = body.parentCastId ? `  ↳ reply to ${body.parentCastId.fid}` : '';
    console.log(`@${await username(client, c.data.fid)} · ${ago(c.data.timestamp)}${reply}`);
    const text = await castText(body, (f) => username(client, f));
    if (text) console.log(`  ${text.replace(/\n/g, '\n  ')}`);
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
function unrecast() { return react(makeReactionRemove, ReactionType.RECAST, 'Unrecast'); }

async function del() {
  const { client, signer, dataOptions } = loadConfig();
  const target = parseCastId(args[0]);
  if (target.fid !== dataOptions.fid) throw new Error('You can only delete your own casts.');
  await submit(client, await makeCastRemove({ targetHash: target.hash }, dataOptions, signer), 'delete cast');
  console.log(`✓ Deleted ${args[0]}`);
}

// The app key signs its own removal (self-revoke), so this needs no seed phrase.
// It uses the per-app nonce, which this client owns because it is its own app.
async function revoke() {
  const { client, signer, dataOptions, publicKey } = loadConfig();
  const { fid } = dataOptions;
  const res = await call(client.getSignersByFid({ fid, requesterFids: [fid] }), 'read app nonce');
  const appNonce = Number(res.requesterFidNonces?.[fid] ?? 0);
  const body = makeKeyRemoveBodySelfRevoke({
    key: hexStringToBytes(publicKey)._unsafeUnwrap(),
    nonce: appNonce + 1,
    deadline: getFarcasterTime()._unsafeUnwrap() + 60 * 60,
  });
  if (body.isErr()) throw new Error(`build key removal: ${body.error.message}`);
  await submit(client, await makeKeyRemove(body.value, dataOptions, signer), 'submit KEY_REMOVE');
  console.log(`✓ App key ${publicKey.slice(0, 18)}… revoked. Delete ${CONFIG} too; run init again to get a new key.`);
}

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

async function serveWeb() {
  const { serve } = await import('./web.mjs');
  await serve({
    node: flags.node,
    port: Number(flags.port || 3000),
    host: flags.lan ? '0.0.0.0' : flags.host || '127.0.0.1',
    password: flags.password || process.env.FC_PASSWORD,
    open: Boolean(flags.open),
  });
  await new Promise(() => {}); // keep serving until Ctrl+C
}

const commands = { serve: serveWeb, init, whoami, feed, cast, delete: del, follow, unfollow, like, unlike, recast, unrecast, apps, revoke };
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(command ? 1 : 0);
}
try {
  await commands[command]();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
}
process.exit();
