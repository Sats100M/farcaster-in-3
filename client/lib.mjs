// The parts of the client that don't talk to the network, kept separate so they can be tested.

import { bytesToHex, decodeAbiParameters } from 'viem';
import {
  FarcasterNetwork,
  MessageType,
  ViemLocalEip712Signer,
  makeKeyAddBody,
  makeKeyAdd,
  fromFarcasterTime,
  getFarcasterTime,
  hexStringToBytes,
} from '@farcaster/hub-nodejs';

export const NETWORK = FarcasterNetwork.MAINNET;
// What this client's key may sign. KEY_ADD/KEY_REMOVE can never be delegated, so
// a leaked app key can post as you but can't add keys, move the account or funds.
export const SCOPES = [
  MessageType.CAST_ADD,
  MessageType.CAST_REMOVE,
  MessageType.REACTION_ADD,
  MessageType.REACTION_REMOVE,
  MessageType.LINK_ADD,
  MessageType.LINK_REMOVE,
];
export const TTL = 30 * 24 * 60 * 60; // key expires after 30 days without use; each use extends it

// `--flag value` and `--flag` (true) anywhere; everything else is positional.
export function parseArgs(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true;
    else args.push(argv[i]);
  }
  return { flags, args };
}

export function parseCastId(s) {
  const m = /^(\d+)\/(0x[0-9a-fA-F]{40})$/.exec(s || '');
  if (!m) throw new Error('Expected a cast id like 3/0xabc... (shown under each cast in `fc feed`)');
  return { fid: Number(m[1]), hash: hexStringToBytes(m[2])._unsafeUnwrap() };
}

// Gasless keys (KEY_ADD) carry requestFid directly. Keys added onchain carry it
// inside the ABI-encoded SignedKeyRequest metadata of the KeyRegistry event.
export function requestFidOf(signer) {
  if (signer.requestFid) return signer.requestFid;
  const metadata = signer.onchainEvent?.signerEventBody?.metadata;
  if (!metadata?.length) return 0;
  try {
    const [{ requestFid }] = decodeAbiParameters(
      [{ type: 'tuple', components: [
        { name: 'requestFid', type: 'uint256' }, { name: 'requestSigner', type: 'address' },
        { name: 'signature', type: 'bytes' }, { name: 'deadline', type: 'uint256' },
      ] }],
      bytesToHex(metadata)
    );
    return Number(requestFid);
  } catch {
    return 0;
  }
}

export function ago(farcasterTs, now = Date.now()) {
  const s = (now - fromFarcasterTime(farcasterTs)._unsafeUnwrap()) / 1000;
  if (s < 0) return 'future-dated'; // timestamps are set by the author's client
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Gasless app key: the custody account signs an EIP-712 KeyAdd (and the
// SignedKeyRequest, since this client acts as its own app), the new key signs
// the envelope to prove possession, and the node relays it. No Optimism tx.
// `nonce` must be one more than the account's currentUserNonce.
export async function buildKeyAdd({ account, fid, signer, nonce, deadline }) {
  const key = (await signer.getSignerKey())._unsafeUnwrap();
  const body = await makeKeyAddBody(
    {
      fid: BigInt(fid),
      key,
      scopes: SCOPES,
      ttl: TTL,
      nonce,
      deadline: deadline ?? getFarcasterTime()._unsafeUnwrap() + 60 * 60,
    },
    new ViemLocalEip712Signer(account)
  );
  if (body.isErr()) return body;
  return makeKeyAdd(body.value, { fid, network: NETWORK }, signer);
}
