// Talking to the node: shared by the command line (fc.mjs) and the web client (web.mjs).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  getInsecureHubRpcClient,
  UserDataType,
  NobleEd25519Signer,
  bytesToHexString,
  hexStringToBytes,
} from '@farcaster/hub-nodejs';
import { NETWORK, requestFidOf } from './lib.mjs';

export const CONFIG = join(homedir(), '.farcaster-in-3.json');

export function nodeClient(host) {
  // A bare IP or hostname means the default gRPC port.
  return getInsecureHubRpcClient(host.includes(':') ? host : `${host}:3383`);
}

// HubRpcClient returns neverthrow Results; turn errors into exceptions.
export async function call(promise, what) {
  const result = await promise;
  if (result.isErr()) throw new Error(`${what}: ${result.error.message}`);
  return result.value;
}

export function loadConfig(node) {
  if (!existsSync(CONFIG)) throw new Error('Not set up yet. Run: fc init --node <your node ip>');
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const client = nodeClient(node || cfg.node);
  const signer = new NobleEd25519Signer(hexStringToBytes(cfg.privateKey)._unsafeUnwrap());
  return { ...cfg, client, signer, dataOptions: { fid: cfg.fid, network: NETWORK } };
}

export async function submit(client, made, what) {
  if (made.isErr()) throw new Error(`${what}: ${made.error.message}`);
  // A successful response means the node validated and relayed the message,
  // not that a validator has put it in a block yet. That usually takes seconds.
  await call(client.submitMessage(made.value), what);
  return made.value;
}

export async function resolveFid(client, who) {
  if (/^\d+$/.test(who)) return Number(who);
  const name = who.replace(/^@/, '');
  const proof = await call(client.getUsernameProof({ name: new TextEncoder().encode(name) }), `look up @${name}`);
  return proof.fid;
}

// Username, display name and picture, one request per account.
const profiles = new Map();
export async function profile(client, fid) {
  if (!profiles.has(fid)) {
    const res = await client.getUserDataByFid({ fid });
    const p = { fid, username: `fid:${fid}`, displayName: '', pfp: '' };
    if (res.isOk()) {
      for (const m of res.value.messages) {
        const { type, value } = m.data.userDataBody;
        if (type === UserDataType.USERNAME) p.username = value;
        if (type === UserDataType.DISPLAY) p.displayName = value;
        if (type === UserDataType.PFP) p.pfp = value;
      }
    }
    profiles.set(fid, p);
  }
  return profiles.get(fid);
}
export const username = async (client, fid) => (await profile(client, fid)).username;

// Map each of an author's keys to the app (requestFid) it was issued to.
// This is how casts are attributed to clients: every message is signed by an
// app key, and every app key carries the FID of the app that requested it.
const appByKey = new Map();
export async function loadKeys(client, fid) {
  if (appByKey.has(`loaded:${fid}`)) return;
  const res = await client.getSignersByFid({ fid, requesterFids: [] });
  if (res.isOk()) {
    for (const s of res.value.signers) appByKey.set(bytesToHexString(s.key)._unsafeUnwrap(), requestFidOf(s));
  }
  appByKey.set(`loaded:${fid}`, true);
}
export const appOf = (msg) => appByKey.get(bytesToHexString(msg.signer)._unsafeUnwrap()) ?? 0;

// Latest casts from everyone `viewer` follows, newest first. With `apps`, each
// cast's app is known, so callers can filter on appOf().
export async function feedCasts(client, viewer, { apps = false } = {}) {
  const links = await call(client.getLinksByFid({ fid: viewer, linkType: 'follow', pageSize: 200, reverse: true }), 'read follows');
  const following = links.messages.map((m) => m.data.linkBody.targetFid).filter(Boolean);
  const perAuthor = await Promise.all(
    following.map(async (f) => {
      const res = await client.getCastsByFid({ fid: f, pageSize: 5, reverse: true });
      return res.isOk() ? res.value.messages : [];
    })
  );
  const casts = perAuthor.flat().sort((a, b) => b.data.timestamp - a.data.timestamp);
  if (apps) await Promise.all([...new Set(casts.map((c) => c.data.fid))].map((f) => loadKeys(client, f)));
  return { following, casts };
}
