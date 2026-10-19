import { getInsecureHubRpcClient, bytesToHexString, ReactionType, UserDataType } from '@farcaster/hub-nodejs';
const c = getInsecureHubRpcClient('172.174.89.126:3383');
async function fidOf(name){ const p = await c.getUsernameProof({ name: new TextEncoder().encode(name) }); return p.isOk()? p.value.fid : null; }
async function count(fn){ let n=0, pt; do { const r = await fn(pt); if (r.isErr()) break; n += r.value.messages.length; pt = r.value.nextPageToken; } while (pt?.length && n < 5000); return n; }
for (const name of ['sats100m','0xzoz','mobeen02','webthethird','zoz']) {
  const fid = await fidOf(name); if (!fid) { console.log(name, 'no fid'); continue; }
  const casts = await c.getCastsByFid({ fid, pageSize: 40, reverse: true });
  const followers = await count((pt)=>c.getLinksByTarget({ targetFid: fid, linkType: 'follow', pageSize: 1000, pageToken: pt }));
  console.log(`\n@${name} fid ${fid} followers ~${followers}`);
  for (const m of casts.value.messages) {
    const t = m.data.castAddBody?.text || ''; if (!/farcaster|snapchain|bounty|node|client|in.?three|in-3/i.test(t)) continue;
    const id = { fid, hash: m.hash };
    const likes = await count((pt)=>c.getReactionsByCast({ targetCastId: id, reactionType: ReactionType.LIKE, pageSize: 1000, pageToken: pt }));
    const recasts = await count((pt)=>c.getReactionsByCast({ targetCastId: id, reactionType: ReactionType.RECAST, pageSize: 1000, pageToken: pt }));
    const replies = await count((pt)=>c.getCastsByParent({ parentCastId: id, pageSize: 1000, pageToken: pt }));
    console.log(`  ${likes}♥ ${recasts}↻ ${replies}💬  ${bytesToHexString(m.hash)._unsafeUnwrap().slice(0,10)}  ${t.replace(/\s+/g,' ').slice(0,90)}`);
  }
}
c.close();
