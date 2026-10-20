// The web client with no server of its own: it runs in the browser and talks
// straight to a Snapchain node's HTTP API over HTTPS (scripts/https.sh).
//
// It answers the same /api/* calls as web.mjs, so the page (client/web/index.html)
// is shared. The differences: a browser wallet signs the KEY_ADD, and the app key
// lives in this browser's localStorage instead of a file on your computer.

import {
  Message,
  ReactionType,
  makeCastAdd,
  makeCastRemove,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  makeKeyRemove,
  makeKeyRemoveBody,
  NobleEd25519Signer,
  ViemLocalEip712Signer,
  getFarcasterTime,
  bytesToHexString,
  hexStringToBytes,
} from '@farcaster/core';
import { getAddress, getTypesForEIP712Domain, serializeTypedData, bytesToHex } from 'viem';
import { NETWORK, buildKeyAdd, castText, parseCastId, requestFidOf, MAX_CAST_BYTES, castByteLength } from '../lib.mjs';

const DEFAULT_NODE = 'https://172-174-89-126.sslip.io';
const KEY = 'fc3-live-key';
const VIEWER = 'fc3-live-viewer';
const NODE = 'fc3-live-node';

const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
  set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, JSON.stringify(v)); } catch {} },
};

// #node=https://... in the link picks the node; it's remembered after that.
const fromHash = /node=([^&]+)/.exec(location.hash)?.[1];
if (fromHash) {
  store.set(NODE, decodeURIComponent(fromHash).replace(/\/$/, ''));
  history.replaceState(null, '', location.pathname);
}
const node = () => store.get(NODE) || DEFAULT_NODE;

// --- the node's HTTP API -------------------------------------------------

class NotFound extends Error {}

async function get(path, params) {
  const res = await fetch(`${node()}/v1/${path}?${new URLSearchParams(params)}`);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text }; }
  if (!res.ok || body.error) {
    const detail = /message: "([^"]+)"/.exec(body.error_detail || '')?.[1] || body.error || res.statusText;
    if (/NotFound/.test(body.error_detail || '') || res.status === 404) throw new NotFound(detail);
    throw new Error(detail);
  }
  return body;
}

async function submit(made, what) {
  if (made.isErr()) throw new Error(`${what}: ${made.error.message}`);
  const res = await fetch(`${node()}/v1/submitMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Message.encode(made.value).finish(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(`${what}: ${/message: "([^"]+)"/.exec(body.error_detail || '')?.[1] || body.error || res.statusText}`);
  }
  return made.value;
}

// HTTP returns hashes and keys as 0x hex and bytes fields as base64.
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const profiles = new Map();
async function profile(fid) {
  if (!profiles.has(fid)) {
    profiles.set(fid, (async () => {
      const p = { fid, username: `fid:${fid}`, displayName: '', pfp: '' };
      try {
        for (const m of (await get('userDataByFid', { fid })).messages) {
          const { type, value } = m.data.userDataBody;
          if (type === 'USER_DATA_TYPE_USERNAME') p.username = value;
          if (type === 'USER_DATA_TYPE_DISPLAY') p.displayName = value;
          if (type === 'USER_DATA_TYPE_PFP') p.pfp = value;
        }
      } catch {}
      return p;
    })());
  }
  return profiles.get(fid);
}

async function resolveFid(who) {
  if (/^\d+$/.test(who)) return Number(who);
  const name = who.replace(/^@/, '');
  try {
    return (await get('userNameProofByName', { name })).fid;
  } catch (e) {
    throw new Error(e instanceof NotFound ? `No account called @${name}` : e.message);
  }
}

// Same attribution as the command line: each signer key names the app that asked for it.
const appByKey = new Map();
const keysLoaded = new Map();
function loadKeys(fid) {
  if (!keysLoaded.has(fid)) {
    keysLoaded.set(fid, get('signersByFid', { fid }).then((res) => {
      for (const s of res.signers) {
        const metadata = s.onChainEvent?.signerEventBody?.metadata;
        appByKey.set(s.key, requestFidOf({ requestFid: s.requestFid, onchainEvent: metadata && { signerEventBody: { metadata: b64(metadata) } } }));
      }
    }).catch(() => {}));
  }
  return keysLoaded.get(fid);
}
const appOf = (m) => appByKey.get(m.signer) ?? 0;

// --- who is using the page -----------------------------------------------

function session() {
  const key = store.get(KEY);
  if (key) return { ...key, signer: new NobleEd25519Signer(hexStringToBytes(key.privateKey)._unsafeUnwrap()) };
  const viewer = store.get(VIEWER, sessionStorage);
  if (viewer) return { fid: viewer, readOnly: true };
  const err = new Error('Connect first.');
  err.status = 401;
  throw err;
}
function writer() {
  const s = session();
  if (s.readOnly) throw new Error('Connect a wallet to cast, like or follow.');
  return { ...s, dataOptions: { fid: s.fid, network: NETWORK } };
}

// A viem-style account whose typed-data signatures come from the browser wallet.
function walletAccount(address) {
  return {
    address,
    type: 'local',
    async signTypedData(params) {
      const types = { EIP712Domain: getTypesForEIP712Domain({ domain: params.domain }), ...params.types };
      const want = '0x' + Number(params.domain.chainId).toString(16);
      // Most wallets only sign typed data for the chain they're on.
      if ((await ethereum.request({ method: 'eth_chainId' })) !== want) {
        await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
      }
      return ethereum.request({ method: 'eth_signTypedData_v4', params: [address, serializeTypedData({ ...params, types })] });
    },
  };
}

async function connectWallet(onStep) {
  if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask or Rabby, or open this page in your wallet app\'s browser.');
  const [raw] = await ethereum.request({ method: 'eth_requestAccounts' });
  const address = getAddress(raw);
  onStep(`Looking up the Farcaster account owned by ${address.slice(0, 8)}…`);
  let fid;
  try {
    fid = (await get('onChainIdRegistryEventByAddress', { address })).fid;
  } catch (e) {
    throw new Error(e instanceof NotFound ? `${address} isn't the custody address of a Farcaster account. Use the wallet that owns the account (for an account made in the Farcaster app, import its recovery phrase into a wallet first).` : e.message);
  }
  const { currentUserNonce } = await get('signersByFid', { fid });
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const signer = new NobleEd25519Signer(privateKey);
  onStep('Approve the two signatures in your wallet. They add a key for this browser; no gas, nothing onchain.');
  const made = await buildKeyAdd({ account: walletAccount(address), fid, signer, nonce: (currentUserNonce || 0) + 1 });
  onStep('Submitting to the node…');
  await submit(made, 'add key');
  const publicKey = bytesToHex((await signer.getSignerKey())._unsafeUnwrap());
  for (let i = 0; i < 20; i++) {
    const { signers } = await get('signersByFid', { fid });
    if (signers.some((s) => s.key === publicKey)) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  store.set(KEY, { fid, address, publicKey, privateKey: bytesToHex(privateKey) });
}

// --- the /api/* calls the page makes ---------------------------------------

async function hasReaction(me, type, m) {
  try {
    await get('reactionById', { fid: me, reaction_type: type, target_fid: m.data.fid, target_hash: m.hash });
    return true;
  } catch {
    return false;
  }
}

async function castJson(m, me, readOnly) {
  const body = m.data.castAddBody;
  const app = appOf(m);
  const [author, liked, recasted, appProfile, parentAuthor] = await Promise.all([
    profile(m.data.fid),
    !readOnly && hasReaction(me, 'Like', m),
    !readOnly && hasReaction(me, 'Recast', m),
    app ? profile(app) : null,
    body.parentCastId ? profile(body.parentCastId.fid) : null,
  ]);
  return {
    id: `${m.data.fid}/${m.hash}`,
    author,
    text: await castText(body, (fid) => profile(fid).then((p) => p.username)),
    embeds: (body.embeds || []).map((e) => (e.url ? { url: e.url } : e.castId ? { cast: `${e.castId.fid}/${e.castId.hash}` } : null)).filter(Boolean),
    ts: m.data.timestamp,
    parent: body.parentCastId ? { id: `${body.parentCastId.fid}/${body.parentCastId.hash}`, username: parentAuthor.username } : null,
    channel: body.parentUrl || null,
    app: app ? { fid: app, username: appProfile.username, pfp: appProfile.pfp } : null,
    liked: Boolean(liked),
    recasted: Boolean(recasted),
    mine: !readOnly && m.data.fid === me,
  };
}

function appCounts(casts) {
  const counts = new Map();
  for (const c of casts) counts.set(appOf(c), (counts.get(appOf(c)) || 0) + 1);
  return Promise.all(
    [...counts].filter(([app]) => app).sort((a, b) => b[1] - a[1])
      .map(async ([app, n]) => { const p = await profile(app); return { fid: app, username: p.username, pfp: p.pfp, casts: n }; })
  );
}

const routes = {
  async 'GET /api/me'() {
    const s = session();
    return { ...(await profile(s.fid)), node: node().replace(/^https:\/\//, ''), readOnly: Boolean(s.readOnly), live: true };
  },

  async 'GET /api/node'() {
    const info = await get('info', {});
    return { host: node().replace(/^https:\/\//, ''), version: info.version, behind: Math.max(...info.shardInfos.map((s) => Number(s.blockDelay))) };
  },

  async 'GET /api/feed'(q) {
    const { fid: me, readOnly } = session();
    const links = await get('linksByFid', { fid: me, link_type: 'follow', pageSize: 200, reverse: true });
    const following = links.messages.map((m) => m.data.linkBody.targetFid).filter(Boolean);
    const perAuthor = await Promise.all(following.map((f) =>
      get('castsByFid', { fid: f, pageSize: 5, reverse: true }).then((r) => r.messages, () => [])));
    // castsByFid also returns CAST_REMOVE tombstones; only show casts.
    const casts = perAuthor.flat().filter((m) => m.data?.castAddBody).sort((a, b) => b.data.timestamp - a.data.timestamp);
    await Promise.all([...new Set(casts.map((c) => c.data.fid))].map(loadKeys));
    const only = Number(q.get('only')) || 0;
    const hide = Number(q.get('hide')) || 0;
    let shown = casts;
    if (only) shown = shown.filter((c) => appOf(c) === only);
    if (hide) shown = shown.filter((c) => appOf(c) !== hide);
    return {
      following: following.length,
      apps: await appCounts(casts),
      casts: await Promise.all(shown.slice(0, Number(q.get('limit')) || 40).map((c) => castJson(c, me, readOnly))),
    };
  },

  async 'GET /api/user'(q) {
    const { fid: me, readOnly } = session();
    const fid = await resolveFid(q.get('u') || '');
    await loadKeys(fid);
    const [p, res, following] = await Promise.all([
      profile(fid),
      get('castsByFid', { fid, pageSize: 40, reverse: true }),
      readOnly ? false : get('linkById', { fid: me, link_type: 'follow', target_fid: fid }).then(() => true, () => false),
    ]);
    return {
      ...p,
      following,
      self: fid === me && !readOnly,
      apps: await appCounts(res.messages.filter((m) => m.data?.castAddBody)),
      casts: await Promise.all(res.messages.filter((m) => m.data?.castAddBody).map((c) => castJson(c, me, readOnly))),
    };
  },

  async 'POST /api/cast'(_, b) {
    const { signer, dataOptions } = writer();
    const text = String(b.text || '').trim();
    if (!text) throw new Error('Write something first.');
    if (castByteLength(text) > MAX_CAST_BYTES) throw new Error(`Casts are limited to ${MAX_CAST_BYTES} bytes.`);
    const body = { text, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [], type: 0 };
    if (b.reply) body.parentCastId = parseCastId(b.reply);
    const msg = await submit(await makeCastAdd(body, dataOptions, signer), 'post cast');
    return { id: `${dataOptions.fid}/${bytesToHexString(msg.hash)._unsafeUnwrap()}` };
  },

  async 'POST /api/react'(_, b) {
    const { signer, dataOptions } = writer();
    const type = b.kind === 'recast' ? ReactionType.RECAST : ReactionType.LIKE;
    const make = b.on ? makeReactionAdd : makeReactionRemove;
    await submit(await make({ type, targetCastId: parseCastId(b.id) }, dataOptions, signer), b.kind);
    return { ok: true };
  },

  async 'POST /api/follow'(_, b) {
    const { signer, dataOptions } = writer();
    const make = b.on ? makeLinkAdd : makeLinkRemove;
    await submit(await make({ type: 'follow', targetFid: Number(b.fid) }, dataOptions, signer), b.on ? 'follow' : 'unfollow');
    return { ok: true };
  },

  async 'POST /api/delete'(_, b) {
    const { signer, dataOptions } = writer();
    const target = parseCastId(b.id);
    if (target.fid !== dataOptions.fid) throw new Error('You can only delete your own casts.');
    await submit(await makeCastRemove({ targetHash: target.hash }, dataOptions, signer), 'delete cast');
    return { ok: true };
  },

  // The custody wallet signs the removal. (A key can also remove itself, but that
  // needs the app nonce, and the HTTP API only returns it for ?requesterFids[]=<fid>
  // with unescaped brackets, which URLSearchParams never produces.)
  async 'POST /api/revoke'() {
    const { signer, dataOptions, publicKey, address } = writer();
    const { currentUserNonce } = await get('signersByFid', { fid: dataOptions.fid });
    const [current] = await ethereum.request({ method: 'eth_requestAccounts' });
    if (getAddress(current) !== address) throw new Error(`Switch your wallet to ${address}, the account's custody address.`);
    const body = await makeKeyRemoveBody({
      fid: BigInt(dataOptions.fid),
      key: hexStringToBytes(publicKey)._unsafeUnwrap(),
      nonce: (currentUserNonce || 0) + 1,
      deadline: getFarcasterTime()._unsafeUnwrap() + 3600,
    }, new ViemLocalEip712Signer(walletAccount(address)));
    if (body.isErr()) throw new Error(body.error.message);
    await submit(await makeKeyRemove(body.value, dataOptions, signer), 'remove key');
    store.set(KEY, null);
    return { ok: true };
  },
};

async function api(path, body) {
  const url = new URL(path, location.href);
  const route = routes[`${body ? 'POST' : 'GET'} ${url.pathname.replace(/^.*(\/api\/)/, '$1')}`];
  if (!route) throw new Error('Not found.');
  return route(url.searchParams, body || {});
}

// --- the first screen ----------------------------------------------------

function loginView(start, { h, toast }) {
  const host = node().replace(/^https:\/\//, '');
  const status = h('div', { class: 'status' });
  const nodeLine = h('span', { class: 'node' }, 'node ' + host);
  routes['GET /api/node']().then((n) => {
    nodeLine.replaceChildren('node ' + n.host + ' · ', h('span', { class: n.behind < 30 ? 'ok' : 'warn' }, n.behind < 30 ? 'in sync' : `${n.behind}s behind`));
  }, () => nodeLine.replaceChildren('node ' + host + ' · ', h('span', { class: 'warn' }, 'unreachable')));

  const connect = h('button', { class: 'btn wide' }, 'Connect wallet');
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    try {
      await connectWallet((msg) => (status.textContent = msg));
      start();
    } catch (e) {
      status.textContent = '';
      toast(e.message || String(e), true);
      connect.disabled = false;
    }
  });

  const browse = async (who) => {
    try {
      store.set(VIEWER, await resolveFid(who), sessionStorage);
      start();
    } catch (err) { toast(err.message, true); }
  };

  return h('div', { class: 'gate' },
    h('h1', {}, 'farcaster-in-3'),
    h('p', {}, 'A Farcaster client that runs in this page and talks to one Snapchain read node over its HTTP API. No API keys, no backend.'),
    nodeLine,

    h('h2', {}, 'post'),
    connect,
    status,
    h('p', { class: 'small' }, 'The wallet signs a KEY_ADD for a new Ed25519 key kept in this browser. No gas, nothing onchain. The key can cast, react and follow; it cannot change the account. Use a test account.'),

    h('hr'),
    h('h2', {}, 'read only'),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); browse(e.target.u.value.trim() || 'dwr'); } },
      h('input', { class: 'input', name: 'u', placeholder: 'username or fid', autocapitalize: 'none', autocorrect: 'off', enterkeyhint: 'go' }),
      h('button', { class: 'btn alt' }, 'Open feed')),
    h('div', { class: 'try' }, 'try:', ...['dwr', 'balajis.eth', 'v', 'sats100m'].map((u) =>
      h('button', { type: 'button', onclick: () => browse(u) }, u))),

    h('hr'),
    h('details', {}, h('summary', {}, 'use another node'),
      h('form', { class: 'row', onsubmit: (e) => {
        e.preventDefault();
        const v = e.target.n.value.trim().replace(/\/$/, '');
        if (!/^https:\/\//.test(v)) return toast('Needs https:// (run ./fc3 https on the node).', true);
        store.set(NODE, v);
        location.reload();
      } },
        h('input', { class: 'input', name: 'n', value: node(), autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' }),
        h('button', { class: 'btn alt' }, 'Use'))),

    h('div', { class: 'foot' },
      h('a', { href: '../' }, 'tutorial'),
      h('a', { href: 'https://github.com/Sats100M/farcaster-in-3' }, 'source')));
}

function signOut() {
  store.set(VIEWER, null, sessionStorage);
}

window.FC_LIVE = { api, loginView, signOut };
