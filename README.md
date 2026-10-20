# farcaster-in-3

[![check](https://github.com/Sats100M/farcaster-in-3/actions/workflows/check.yml/badge.svg)](https://github.com/Sats100M/farcaster-in-3/actions/workflows/check.yml)

Run your own Farcaster read node and client in three commands. No API keys, no permission from anyone. You bring the server.

Tutorial: https://sats100m.github.io/farcaster-in-3/ · Try the client in your browser: https://sats100m.github.io/farcaster-in-3/app/ · [中文](https://sats100m.github.io/farcaster-in-3/zh/)

```
./fc3 provision --provider azure --hours 48   # 0. rent a server (deletes itself after 48 h)
./fc3 node --fid <your fid>                    # 1. Snapchain read node, with HTTPS
./fc3 client                                   # 2. your own client, in your browser
```

On Windows, `.c3`. You need Node.js 20+, git, and a login for Azure, AWS or Hetzner. `./fc3 destroy` deletes everything.

## What's in here

- `fc3` runs the three steps and remembers the server, so no IP is ever typed. Also `status`, `destroy`, `watchdog --hours N` (deletes the server after N hours, from your computer, so a forgotten test stops billing), `https`, `ssh`, and every client command (`./fc3 feed`, `./fc3 cast "hi"`).
- `scripts/provision.mjs` creates a 4 vCPU / 16 GB server with a 2 TB disk and opens the Snapchain ports and 80/443. Shows the price and asks before creating anything. `--provider azure|aws|lightsail|hetzner`.
- `scripts/destroy.mjs` deletes all of it so billing stops.
- `scripts/node.sh` runs on the server. Wraps the official `snapchain.sh` installer so it works non-interactively over SSH, keeps the database on the data disk, and adds `fc-node-status`.
- `scripts/https.sh` puts Caddy in front of the node's HTTP API with a free certificate for `<ip>.sslip.io`, and answers the CORS preflight the node doesn't, so web pages can post through it.
- `scripts/reload-shard.sh` fixes a node that skipped a shard's snapshot (see below). `fc-node-status` tells you when you need it.
- `client/fc.mjs` is the client. Imports a seed phrase once (or, with `init --wallet`, has MetaMask/Rabby/Coinbase Wallet sign on a local page so the phrase never leaves the wallet), registers its own gasless app key (`KEY_ADD`, no Optimism transaction), then: `feed`, `cast` (and `--reply`), `delete`, `follow`/`unfollow`, `like`/`unlike`, `recast`/`unrecast`, `--only-app` / `--hide-app` to include or exclude casts from any client, and `revoke`, which removes the app key without the seed phrase.
- `fc serve` (what `./fc3 client` opens) is the same client as a web page. `--lan` prints a QR code for your phone. The app key stays on the computer; a password guards every request.
- `client/live/` is that page with no server at all, published on the tutorial site: it runs in the browser, talks straight to a node over HTTPS, and gets its key from a browser wallet. Without a wallet you can still read anyone's feed.
- `VOUCHER.md` is a checklist for testing it, from 10 minutes to the full run.
- `AGENTS.md` lets a coding agent (Claude Code, Codex) do the setup from one pasted prompt, with rules: it never handles the recovery phrase and asks before anything that costs money.

The client only talks to your node: reads over gRPC (or HTTPS in the browser), and writes go to the same node, which relays them to the validators.

## Status

| | Tested |
|---|---|
| Step 0 on Azure | yes, from a fresh trial subscription |
| Step 0 on Hetzner, AWS EC2, Lightsail | price check and API calls only; my accounts were blocked from creating servers (see below) |
| Step 1 | yes, Ubuntu 24.04 on Azure, synced to mainnet |
| Step 2 | yes, Windows 11, Node 22. Every command run on mainnet (init, cast, reply, like, recast, undo each, delete, follow, unfollow, app filters), each result checked against the node's API: [transcript](docs/evidence/mainnet-2026-10-19.txt) |
| `init --wallet` | in CI with a stand-in wallet: the signatures match the seed phrase path byte for byte, and that path is the one proven on mainnet |
| `serve` | feed, profiles and app filter read from the mainnet node, checked at phone width in light and dark mode; writes use the same calls as the commands above |
| `fc3` | `provision` (finding an existing Azure node), `status`, `client`, passthrough commands, on Windows 11 in Git Bash and PowerShell. `watchdog` against a stand-in server: it called destroy at the deadline |
| `https.sh` | yes, on the Azure node: certificate issued, preflight answered, live client reading through it |
| Live client | reading feeds (mine and dwr's, 79 follows, apps filter) from the mainnet node in headless Chrome at phone size. Wallet connect is the same `buildKeyAdd` as above with the browser wallet as signer; not yet run with a real wallet |

If you run it on a provider or OS not listed, an issue saying it worked (or didn't) helps.

## Things I hit

- The snapshot is ~5,700 chunks of ~82 MB (~470 GB compressed), and the chunks stay on disk while it unpacks. 1 TB isn't enough, use 2 TB.
- New Hetzner accounts can't create a volume that big and can't ask for a limit increase yet.
- AWS Free plan accounts can't launch servers this size, and accounts made with the new "Projects" setup block EC2 and Lightsail even after upgrading.
- New Azure subscriptions have Compute switched off until it's registered (the script does it), and 4 vCPU sizes are often sold out per region (the script falls back).
- The node reads the snapshot list for all shards up front, and snapshots are replaced daily. My shards 1 and 2 took ~11 hours, by which time shard 0's snapshot was gone: the download 404'd, and after a restart the node skipped it and started replaying shard 0 from genesis, 570 days behind. `reload-shard.sh --shard 0` fetched the current one and it was synced an hour later.
- The official Docker image has its own `fc` command inside the container. This client is unrelated; run it as `node fc.mjs`.
- The official bootstrap reads its prompts from `/dev/tty`, and the installer ends by tailing logs forever, so piping it over SSH hangs. `node.sh` pre-fills `.env` and stops the tail once the node is up.

Sent upstream while building this:

- Snapchain: [#1045](https://github.com/farcasterxyz/snapchain/pull/1045) refetch snapshot metadata per shard, and [#1050](https://github.com/farcasterxyz/snapchain/pull/1050) restore shards missing from the DB on startup (bug: [#1044](https://github.com/farcasterxyz/snapchain/issues/1044))
- Snapchain: [#1051](https://github.com/farcasterxyz/snapchain/pull/1051) return `request_fid` for on-chain signers, [#1052](https://github.com/farcasterxyz/snapchain/pull/1052) "message not found" instead of "cast not found"
- Snapchain docs: [#1040](https://github.com/farcasterxyz/snapchain/pull/1040) node requirements, [#1041](https://github.com/farcasterxyz/snapchain/pull/1041) bootstrap needs a TTY, [#1042](https://github.com/farcasterxyz/snapchain/pull/1042) profile URL
- hub-nodejs: [#2744](https://github.com/farcasterxyz/hub-monorepo/pull/2744) every `Client.md` example fixed and run against a Snapchain node
- Farcaster docs: [#470](https://github.com/farcasterxyz/docs/pull/470) Hello World adds its key without gas, the feed guide runs as written, no more pointers to the hoyt hub
- Snapchain docs: [#1053](https://github.com/farcasterxyz/snapchain/pull/1053) the AWS node guide costs about $300/month, not $100
- Snapchain: [#1059](https://github.com/farcasterxyz/snapchain/pull/1059) paging replies, mentions and reactions looped on the first page forever (found while reading every reply to the bounty cast), [#1060](https://github.com/farcasterxyz/snapchain/pull/1060) answer CORS preflight so web pages can submit messages, [#1061](https://github.com/farcasterxyz/snapchain/pull/1061) accept `?requesterFids=1` as documented

Seed phrases: only paste one into software you've read. This client uses it in memory to sign one message and never stores or sends it. Try it with a test account first, and prefer delegated signing (approving a key from an app that already holds your account) wherever an app offers it. Details in [SECURITY.md](SECURITY.md).

Tutorial in Chinese: https://sats100m.github.io/farcaster-in-3/zh/

Want to add a provider or fix something? See [CONTRIBUTING.md](CONTRIBUTING.md).

MIT licensed.
