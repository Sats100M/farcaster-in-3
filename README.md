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
- `client/fc.mjs` is the client. Imports a seed phrase once, registers its own gasless app key (`KEY_ADD`, no Optimism transaction), then: `feed`, `cast`, `follow`, `like`, `recast`, and `--only-app` / `--hide-app` to include or exclude casts from any client.

The client only talks to your node: reads over gRPC, and writes go to the same node, which relays them to the validators.

## Status

| | Tested |
|---|---|
| Step 0 on Azure | yes, from a fresh trial subscription |
| Step 0 on Hetzner, AWS EC2, Lightsail | price check and API calls only; my accounts were blocked from creating servers (see below) |
| Step 1 | yes, Ubuntu 24.04 on Azure, mainnet snapshot syncing |
| Step 2 | `KEY_ADD` signing tested offline; end-to-end against a synced node next |

If you run it on a provider or OS not listed, an issue saying it worked (or didn't) helps.

## Things I hit

- The snapshot is ~5,700 chunks of ~82 MB (~470 GB compressed), and the chunks stay on disk while it unpacks. 1 TB isn't enough, use 2 TB.
- New Hetzner accounts can't create a volume that big and can't ask for a limit increase yet.
- AWS Free plan accounts can't launch servers this size, and accounts made with the new "Projects" setup block EC2 and Lightsail even after upgrading.
- New Azure subscriptions have Compute switched off until it's registered (the script does it), and 4 vCPU sizes are often sold out per region (the script falls back).
- The official bootstrap reads its prompts from `/dev/tty`, and the installer ends by tailing logs forever, so piping it over SSH hangs. `node.sh` pre-fills `.env` and stops the tail once the node is up.

Fixes sent upstream while building this: [snapchain#1040](https://github.com/farcasterxyz/snapchain/pull/1040) (README node requirements), [#1041](https://github.com/farcasterxyz/snapchain/pull/1041) (bootstrap needs a TTY), [#1042](https://github.com/farcasterxyz/snapchain/pull/1042) (profile URL).

Seed phrases: only paste one into software you've read. This client uses it in memory to sign one message and never stores or sends it. Try it with a test account first. Details in [SECURITY.md](SECURITY.md).

Want to add a provider or fix something? See [CONTRIBUTING.md](CONTRIBUTING.md).

MIT licensed.
