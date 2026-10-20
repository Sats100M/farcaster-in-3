// `fc init --wallet`: sign the key request with a browser wallet instead of typing a seed phrase.
//
// The client serves one page on 127.0.0.1. The page asks the wallet for its
// address, then for each EIP-712 signature the KeyAdd needs. The signing code
// is the same as the seed phrase path: it calls account.signTypedData(), and
// this account forwards that call to the wallet. The phrase never leaves the wallet.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getAddress, getTypesForEIP712Domain, serializeTypedData, verifyTypedData } from 'viem';

const LABELS = {
  SignedKeyRequest: 'Signature 1 of 2: lets this client act as its own app',
  KeyAdd: 'Signature 2 of 2: adds the client\'s app key to your account',
};

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {}
}

export async function connectWallet({ open = true, onUrl } = {}) {
  const token = randomBytes(16).toString('hex');
  const page = readFileSync(new URL('./web/wallet.html', import.meta.url), 'utf8');
  let address;
  let gotAddress;
  const addressReady = new Promise((resolve) => (gotAddress = resolve));
  let request = null; // the signature the page should ask the wallet for next
  let done = null; // { ok, message } once init has finished
  let nextId = 1;

  const server = createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    // Only this machine, only with the token from the URL we printed.
    const { port } = server.address();
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'wrong host' });
    const [, t, action] = req.url.split('?')[0].split('/');
    if (t !== token) return send(404, { error: 'not found' });

    if (req.method === 'GET' && !action) return send(200, page, 'text/html; charset=utf-8');
    if (req.method === 'GET' && action === 'next') {
      if (done) return send(200, { done });
      if (request) return send(200, { id: request.id, label: request.label, typedData: request.typedData, address });
      return send(200, { waiting: true });
    }
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { error: 'bad json' });
      }
      if (action === 'address' && !address) {
        try {
          address = getAddress(body.address);
        } catch {
          return send(400, { error: 'not an address' });
        }
        gotAddress(address);
        return send(200, { ok: true });
      }
      if (action === 'signature' && request && body.id === request.id) {
        const r = request;
        request = null;
        if (body.error) r.reject(new Error(`wallet: ${body.error}`));
        else r.resolve(body.signature);
        return send(200, { ok: true });
      }
    }
    send(400, { error: 'unexpected request' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/${token}`;

  if (onUrl) onUrl(url);
  else console.log(`Opening ${url}\nApprove in your browser wallet (MetaMask, Rabby, Coinbase Wallet...). If no tab opens, paste the link into the browser that has the wallet. Ctrl+C cancels.`);
  if (open) openBrowser(url);
  await addressReady;

  // A viem-style local account whose signatures come from the wallet.
  const account = {
    address,
    type: 'local',
    async signTypedData(params) {
      const types = { EIP712Domain: getTypesForEIP712Domain({ domain: params.domain }), ...params.types };
      const typedData = serializeTypedData({ ...params, types });
      const signature = await new Promise((resolve, reject) => {
        request = { id: nextId++, label: LABELS[params.primaryType] || params.primaryType, typedData, resolve, reject };
      });
      if (!(await verifyTypedData({ ...params, address, signature }))) {
        throw new Error(`the wallet signed with a different address than ${address}`);
      }
      return signature;
    },
  };

  return {
    account,
    // Tell the page how it ended, give it a moment to show that, then stop serving.
    async finish(ok, message) {
      done = { ok, message };
      await new Promise((r) => setTimeout(r, 2500));
      server.close();
      server.closeAllConnections?.();
    },
  };
}
