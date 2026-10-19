import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToAccount } from 'viem/accounts';
import {
  MessageType,
  NobleEd25519Signer,
  validations,
  decodeGaslessSignedKeyRequestMetadata,
  bytesToHexString,
  hexStringToBytes,
  toFarcasterTime,
} from '@farcaster/hub-nodejs';
import { SCOPES, TTL, parseArgs, parseCastId, requestFidOf, ago, buildKeyAdd } from '../lib.mjs';

// Well-known development mnemonic (Hardhat/Anvil). Never holds anything real.
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

test('parseArgs splits flags and positionals', () => {
  assert.deepEqual(parseArgs(['hello', '--reply', '3/0xab', '--dry']), {
    flags: { reply: '3/0xab', dry: true },
    args: ['hello'],
  });
  assert.deepEqual(parseArgs(['--only-app', '9152', '--limit', '5']).flags, { 'only-app': '9152', limit: '5' });
});

test('parseCastId accepts fid/hash and rejects anything else', () => {
  const id = parseCastId('3/0x8ae98f90bfb0daa36f4364f3e2c2fee0dc8c2225');
  assert.equal(id.fid, 3);
  assert.equal(bytesToHexString(id.hash)._unsafeUnwrap(), '0x8ae98f90bfb0daa36f4364f3e2c2fee0dc8c2225');
  for (const bad of ['', '3', '0xabc', '3/0x12', 'x/0x8ae98f90bfb0daa36f4364f3e2c2fee0dc8c2225']) {
    assert.throws(() => parseCastId(bad), /Expected a cast id/);
  }
});

test('requestFidOf reads gasless keys directly', () => {
  assert.equal(requestFidOf({ requestFid: 3355244 }), 3355244);
});

test('requestFidOf decodes the SignedKeyRequest metadata of onchain keys', () => {
  // Metadata from a real KeyRegistry Add event, requested by FID 9152 (Warpcast).
  const metadata = hexStringToBytes(
    '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000023c000000000000000000000000002ef790dd7993a35fd847c053eddae940d05559600000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000065420dd50000000000000000000000000000000000000000000000000000000000000041bd0677376b4740f956a6d591e863d948bc2771d5ac109bfa57bd24127c35ca4b3cd00d56593750802eff94cd28e65b32ab06012a4940f0a5b8c25ca1e54050761b00000000000000000000000000000000000000000000000000000000000000'
  )._unsafeUnwrap();
  assert.equal(requestFidOf({ onchainEvent: { signerEventBody: { metadata } } }), 9152);
});

test('requestFidOf returns 0 when it cannot tell', () => {
  assert.equal(requestFidOf({}), 0);
  assert.equal(requestFidOf({ onchainEvent: { signerEventBody: { metadata: new Uint8Array() } } }), 0);
  assert.equal(requestFidOf({ onchainEvent: { signerEventBody: { metadata: new Uint8Array([1, 2, 3]) } } }), 0);
});

test('ago formats relative time and flags future timestamps', () => {
  const now = Date.UTC(2026, 9, 19, 12, 0, 0);
  const ts = (msAgo) => toFarcasterTime(now - msAgo)._unsafeUnwrap();
  assert.equal(ago(ts(30_000), now), '30s');
  assert.equal(ago(ts(5 * 60_000), now), '5m');
  assert.equal(ago(ts(3 * 3600_000), now), '3h');
  assert.equal(ago(ts(2 * 86400_000), now), '2d');
  assert.equal(ago(ts(-60_000), now), 'future-dated');
});

test('app key scopes can never add or remove keys', () => {
  assert.ok(!SCOPES.includes(MessageType.KEY_ADD));
  assert.ok(!SCOPES.includes(MessageType.KEY_REMOVE));
  assert.ok(TTL > 0 && TTL <= 90 * 24 * 60 * 60, 'protocol caps key ttl at 90 days');
});

test('buildKeyAdd produces a KEY_ADD the protocol accepts', async () => {
  const account = mnemonicToAccount(TEST_MNEMONIC);
  const signer = new NobleEd25519Signer(new Uint8Array(32).fill(7));
  const key = (await signer.getSignerKey())._unsafeUnwrap();
  const fid = 1234;

  const made = await buildKeyAdd({ account, fid, signer, nonce: 1 });
  assert.ok(made.isOk(), made.isErr() ? made.error.message : '');
  const msg = made.value;

  // Envelope: right type and fid, signed by the new key itself (proof of possession).
  assert.equal(msg.data.type, MessageType.KEY_ADD);
  assert.equal(msg.data.fid, fid);
  assert.deepEqual(msg.signer, key);

  // Body: the key, its limits, and the next nonce.
  const body = msg.data.keyAddBody;
  assert.deepEqual(body.key, key);
  assert.deepEqual(body.scopes, SCOPES);
  assert.equal(body.ttl, TTL);
  assert.equal(body.nonce, 1);
  assert.ok(validations.validateKeyAddBody(body, msg.data.timestamp).isOk());

  // The client is its own app, so the SignedKeyRequest names the same fid and key.
  const meta = decodeGaslessSignedKeyRequestMetadata(body.metadata);
  assert.ok(meta.isOk(), meta.isErr() ? meta.error.message : '');
  assert.equal(Number(meta.value.requestFid), fid);

  // Hash and Ed25519 signature check out the way a node checks them.
  const valid = await validations.validateMessage(msg);
  assert.ok(valid.isOk(), valid.isErr() ? valid.error.message : '');
});
