// `fc serve`: the same client as a web page, for a phone or a browser.
//
// It's a small HTTP server in front of the node. The app key stays on the
// machine running it; the browser only gets JSON. A password guards every
// request, because anyone who can use this page can post as you.

import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import {
  ReactionType,
  makeCastAdd,
  makeCastRemove,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  bytesToHexString,
} from '@farcaster/hub-nodejs';
import { parseCastId, castText, castByteLength, MAX_CAST_BYTES } from './lib.mjs';
import { openBrowser } from './wallet.mjs';
import { call, loadConfig, submit, resolveFid, profile, loadKeys, appOf, feedCasts } from './hub.mjs';

const PAGE = new URL('./web/index.html', import.meta.url);

export async function serve({ node, port = 3000, host = '127.0.0.1', password, open = false }) {
  const cfg = loadConfig(node);
  const { client, signer, dataOptions, fid: me } = cfg;
  await call(client.getInfo({ dbStats: false }), `reach node ${node || cfg.node}`);

  password ||= randomBytes(9).toString('base64url');
  const digest = (s) => createHash('sha256').update(String(s)).digest();
  const sessions = new Set();
  let failures = 0;

  const idOf = (fid, hash) => `${fid}/${bytesToHexString(hash)._unsafeUnwrap()}`;
  const hasReaction = async (type, c) =>
    (await client.getReaction({ fid: me, reactionType: type, targetCastId: { fid: c.data.fid, hash: c.hash } })).isOk();

  async function castJson(c) {
    const body = c.data.castAddBody;
    const app = appOf(c);
    const [author, liked, recasted, appProfile, parentAuthor] = await Promise.all([
      profile(client, c.data.fid),
      hasReaction(ReactionType.LIKE, c),
      hasReaction(ReactionType.RECAST, c),
      app ? profile(client, app) : null,
      body.parentCastId ? profile(client, body.parentCastId.fid) : null,
    ]);
    return {
      id: idOf(c.data.fid, c.hash),
      author,
      text: await castText(body, (fid) => profile(client, fid).then((p) => p.username)),
      embeds: body.embeds.map((e) => (e.url ? { url: e.url } : e.castId ? { cast: idOf(e.castId.fid, e.castId.hash) } : null)).filter(Boolean),
      ts: c.data.timestamp,
      parent: body.parentCastId ? { id: idOf(body.parentCastId.fid, body.parentCastId.hash), username: parentAuthor.username } : null,
      channel: body.parentUrl || null,
      app: app ? { fid: app, username: appProfile.username } : null,
      liked,
      recasted,
      mine: c.data.fid === me,
    };
  }

  function appCounts(casts) {
    const counts = new Map();
    for (const c of casts) counts.set(appOf(c), (counts.get(appOf(c)) || 0) + 1);
    return Promise.all(
      [...counts].filter(([app]) => app).sort((a, b) => b[1] - a[1])
        .map(async ([app, n]) => ({ fid: app, username: (await profile(client, app)).username, casts: n }))
    );
  }

  const api = {
    'GET /api/me': async () => ({ ...(await profile(client, me)), node: node || cfg.node }),

    'GET /api/feed': async (q) => {
      const { following, casts } = await feedCasts(client, me, { apps: true });
      const only = Number(q.get('only')) || 0;
      const hide = Number(q.get('hide')) || 0;
      let shown = casts;
      if (only) shown = shown.filter((c) => appOf(c) === only);
      if (hide) shown = shown.filter((c) => appOf(c) !== hide);
      return {
        following: following.length,
        apps: await appCounts(casts),
        casts: await Promise.all(shown.slice(0, Number(q.get('limit')) || 40).map(castJson)),
      };
    },

    'GET /api/user': async (q) => {
      const fid = await resolveFid(client, q.get('u') || '');
      await loadKeys(client, fid);
      const [p, res, follows] = await Promise.all([
        profile(client, fid),
        call(client.getCastsByFid({ fid, pageSize: 40, reverse: true }), 'read casts'),
        client.getLink({ fid: me, linkType: 'follow', targetFid: fid }),
      ]);
      return {
        ...p,
        following: follows.isOk(),
        self: fid === me,
        apps: await appCounts(res.messages),
        casts: await Promise.all(res.messages.map(castJson)),
      };
    },

    'POST /api/cast': async (_, b) => {
      const text = String(b.text || '').trim();
      if (!text) throw new Error('Write something first.');
      if (castByteLength(text) > MAX_CAST_BYTES) throw new Error(`Casts are limited to ${MAX_CAST_BYTES} bytes.`);
      const body = { text, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [], type: 0 };
      if (b.reply) body.parentCastId = parseCastId(b.reply);
      const msg = await submit(client, await makeCastAdd(body, dataOptions, signer), 'post cast');
      return { id: idOf(me, msg.hash) };
    },

    'POST /api/react': async (_, b) => {
      const type = b.kind === 'recast' ? ReactionType.RECAST : ReactionType.LIKE;
      const make = b.on ? makeReactionAdd : makeReactionRemove;
      await submit(client, await make({ type, targetCastId: parseCastId(b.id) }, dataOptions, signer), b.kind);
      return { ok: true };
    },

    'POST /api/follow': async (_, b) => {
      const targetFid = Number(b.fid);
      const make = b.on ? makeLinkAdd : makeLinkRemove;
      await submit(client, await make({ type: 'follow', targetFid }, dataOptions, signer), b.on ? 'follow' : 'unfollow');
      return { ok: true };
    },

    'POST /api/delete': async (_, b) => {
      const target = parseCastId(b.id);
      if (target.fid !== me) throw new Error('You can only delete your own casts.');
      await submit(client, await makeCastRemove({ targetHash: target.hash }, dataOptions, signer), 'delete cast');
      return { ok: true };
    },
  };

  const server = createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...headers,
      });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/') {
        return send(200, readFileSync(PAGE, 'utf8'), {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
        });
      }

      // Requests that change something must come from this page, not another site.
      if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
        return send(403, { error: 'Cross-site request refused.' });
      }
      let body = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 20000) return send(413, { error: 'Too large.' });
        }
        body = raw ? JSON.parse(raw) : {};
      }

      if (req.method === 'POST' && url.pathname === '/api/login') {
        await new Promise((r) => setTimeout(r, Math.min(failures, 20) * 250)); // slow down guessing
        if (!timingSafeEqual(digest(body.password), digest(password))) {
          failures++;
          return send(401, { error: 'Wrong password.' });
        }
        failures = 0;
        const token = randomBytes(24).toString('base64url');
        sessions.add(token);
        const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        return send(200, { ok: true }, { 'set-cookie': `fc=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
      }

      const token = /(?:^|;\s*)fc=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
      if (!token || !sessions.has(token)) return send(401, { error: 'Log in first.' });
      const handler = api[`${req.method} ${url.pathname}`];
      if (!handler) return send(404, { error: 'Not found.' });
      send(200, await handler(url.searchParams, body));
    } catch (err) {
      send(400, { error: err.message });
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve));

  const urls = host === '0.0.0.0'
    ? Object.values(networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${port}`)
    : [`http://${host}:${port}`];
  console.log(`\nWeb client for @${(await profile(client, me)).username}, through node ${node || cfg.node}\n`);
  for (const u of urls) console.log(`  ${u}`);
  console.log(`\n  password: ${password}\n`);
  if (host === '0.0.0.0') {
    // The password goes after #, which browsers never send to a server, so the
    // QR code logs a phone in without the password crossing the network in a URL.
    const link = `${urls[0]}/#${password}`;
    try {
      const { default: qr } = await import('qrcode-terminal');
      console.log('Scan with your phone (same Wi-Fi):');
      qr.generate(link, { small: true });
    } catch {}
    console.log('Anyone on this network who has the password can post as you. Plain HTTP: use it on a network you trust, or put it behind HTTPS (see the tutorial).');
  } else {
    console.log('Only this computer can open it. For your phone on the same Wi-Fi: fc serve --lan');
  }
  console.log('Ctrl+C to stop.');
  // The password rides after #, so the tab logs itself in.
  if (open) openBrowser(`http://127.0.0.1:${port}/#${encodeURIComponent(password)}`);
}
