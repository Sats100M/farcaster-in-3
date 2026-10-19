# farcaster-in-3

[![check](https://github.com/Sats100M/farcaster-in-3/actions/workflows/check.yml/badge.svg)](https://github.com/Sats100M/farcaster-in-3/actions/workflows/check.yml)

Run your own Farcaster read node and client in three commands. No API keys, no permission from anyone. You bring the server.

Tutorial: https://sats100m.github.io/farcaster-in-3/

```
node scripts/provision.mjs --provider azure                        # 0. rent a server
ssh ... "curl -fsSL .../scripts/node.sh | sudo bash -s -- --fid N"   # 1. Snapchain read node
cd client && npm install && node fc.mjs init --node <server-ip>     # 2. your own client
```

## What's in here

- `scripts/provision.mjs` creates a 4 vCPU / 16 GB server with a 2 TB disk and opens the Snapchain ports. Shows the price and asks before creating anything. `--provider azure|aws|lightsail|hetzner`.
- `scripts/destroy.mjs` deletes all of it so billing stops.
- `scripts/node.sh` runs on the server. Wraps the official `snapchain.sh` installer so it works non-interactively over SSH, keeps the database on the data disk, and adds `fc-node-status`.
- `scripts/reload-shard.sh` fixes a node that skipped a shard's snapshot (see below). `fc-node-status` tells you when you need it.
- `client/fc.mjs` is the client. Imports a seed phrase once, registers its own gasless app key (`KEY_ADD`, no Optimism transaction), then: `feed`, `cast`, `follow`, `like`, `recast`, and `--only-app` / `--hide-app` to include or exclude casts from any client.

The client only talks to your node: reads over gRPC, and writes go to the same node, which relays them to the validators.

## Status

| | Tested |
|---|---|
| Step 0 on Azure | yes, from a fresh trial subscription |
| Step 0 on Hetzner, AWS EC2, Lightsail | price check and API calls only; my accounts were blocked from creating servers (see below) |
| Step 1 | yes, Ubuntu 24.04 on Azure, synced to mainnet |
| Step 2 | yes, Windows 11, Node 22: `init` added a gasless app key, then [this cast](https://farcaster.xyz/sats100m/0xfdc3e931) went out through the node |

If you run it on a provider or OS not listed, an issue saying it worked (or didn't) helps.

## Things I hit

- The snapshot is ~5,700 chunks of ~82 MB (~470 GB compressed), and the chunks stay on disk while it unpacks. 1 TB isn't enough, use 2 TB.
- New Hetzner accounts can't create a volume that big and can't ask for a limit increase yet.
- AWS Free plan accounts can't launch servers this size, and accounts made with the new "Projects" setup block EC2 and Lightsail even after upgrading.
- New Azure subscriptions have Compute switched off until it's registered (the script does it), and 4 vCPU sizes are often sold out per region (the script falls back).
- The node reads the snapshot list for all shards up front, and snapshots are replaced daily. My shards 1 and 2 took ~11 hours, by which time shard 0's snapshot was gone: the download 404'd, and after a restart the node skipped it and started replaying shard 0 from genesis, 570 days behind. `reload-shard.sh --shard 0` fetched the current one and it was synced an hour later.
- The official Docker image has its own `fc` command inside the container. This client is unrelated; run it as `node fc.mjs`.
- The official bootstrap reads its prompts from `/dev/tty`, and the installer ends by tailing logs forever, so piping it over SSH hangs. `node.sh` pre-fills `.env` and stops the tail once the node is up.

Fixes sent upstream while building this: [snapchain#1040](https://github.com/farcasterxyz/snapchain/pull/1040) (README node requirements), [#1041](https://github.com/farcasterxyz/snapchain/pull/1041) (bootstrap needs a TTY), [#1042](https://github.com/farcasterxyz/snapchain/pull/1042) (profile URL), [#1045](https://github.com/farcasterxyz/snapchain/pull/1045) (snapshot rotation, issue [#1044](https://github.com/farcasterxyz/snapchain/issues/1044)).

Seed phrases: only paste one into software you've read. This client uses it in memory to sign one message and never stores or sends it. Try it with a test account first, and prefer delegated signing (approving a key from an app that already holds your account) wherever an app offers it. Details in [SECURITY.md](SECURITY.md).

Tutorial in Chinese: https://sats100m.github.io/farcaster-in-3/zh/

Want to add a provider or fix something? See [CONTRIBUTING.md](CONTRIBUTING.md).

MIT licensed.
