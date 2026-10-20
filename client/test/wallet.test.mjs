import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToAccount } from 'viem/accounts';
import { NobleEd25519Signer, validations, decodeGaslessSignedKeyRequestMetadata, toFarcasterTime } from '@farcaster/hub-nodejs';
import { connectWallet } from '../wallet.mjs';
import { buildKeyAdd } from '../lib.mjs';

const wallet = mnemonicToAccount('test test test test test test test test test test test junk');

// What a browser wallet does with eth_signTypedData_v4: parse the JSON, turn
// integer fields back into numbers, sign. Stands in for the page plus MetaMask.
function signLikeAWallet(json) {
  const { domain, types, primaryType, message } = JSON.parse(json);
  const { EIP712Domain, ...rest } = types;
  assert.ok(EIP712Domain, 'typed data must declare EIP712Domain for v4 wallets');
  const fix = (type, v) => (/^u?int/.test(type) ? (type.endsWith('[]') ? v.map(BigInt) : BigInt(v)) : v);
  const msg = Object.fromEntries(rest[primaryType].map(({ name, type }) => [name, fix(type, message[name])]));
  return wallet.signTypedData({ domain, types: rest, primaryType, message: msg });
}

async function fakePage(url, address = wallet.address) {
  await fetch(url + '/address', { method: 'POST', body: JSON.stringify({ address }) });
  const labels = [];
  for (;;) {
    const next = await (await fetch(url + '/next')).json();
    if (next.done) return { labels, done: next.done };
    if (next.waiting) { await new Promise((r) => setTimeout(r, 20)); continue; }
    labels.push(next.label);
    await fetch(url + '/signature', { method: 'POST', body: JSON.stringify({ id: next.id, signature: await signLikeAWallet(next.typedData) }) });
  }
}

test('wallet login produces the same valid KEY_ADD as the seed phrase path', async () => {
  let url;
  const ready = new Promise((resolve) => connectWallet({ open: false, onUrl: (u) => (url = u) }).then(resolve));
  while (!url) await new Promise((r) => setTimeout(r, 10));
  const page = fakePage(url);
  const { account, finish } = await ready;
  assert.equal(account.address, wallet.address);

  const signer = new NobleEd25519Signer(new Uint8Array(32).fill(7));
  const deadline = toFarcasterTime(Date.now())._unsafeUnwrap() + 3600;
  const made = await buildKeyAdd({ account, fid: 1234, signer, nonce: 1, deadline });
  assert.ok(made.isOk(), made.isErr() && made.error.message);
  await finish(true, 'ok');

  const { labels, done } = await page;
  assert.equal(labels.length, 2);
  assert.deepEqual(done, { ok: true, message: 'ok' });

  const body = made.value.data.keyAddBody;
  assert.ok(validations.validateKeyAddBody(body).isOk());
  assert.equal(Number(decodeGaslessSignedKeyRequestMetadata(body.metadata)._unsafeUnwrap().requestFid), 1234);
  assert.ok((await validations.validateMessage(made.value)).isOk());

  // Byte for byte what the seed phrase path signs.
  const direct = await buildKeyAdd({ account: wallet, fid: 1234, signer, nonce: 1, deadline });
  assert.deepEqual(body.custodySignature, direct.value.data.keyAddBody.custodySignature);
});

test('wallet login rejects requests without the token or from another host', async () => {
  let url;
  const ready = connectWallet({ open: false, onUrl: (u) => (url = u) });
  while (!url) await new Promise((r) => setTimeout(r, 10));
  const origin = new URL(url).origin;
  assert.equal((await fetch(origin + '/wrongtoken')).status, 404);
  assert.equal((await fetch(url.replace('127.0.0.1', 'localhost'))).status, 403);
  await fetch(url + '/address', { method: 'POST', body: JSON.stringify({ address: wallet.address }) });
  const { finish } = await ready;
  await finish(true, 'ok');
});
