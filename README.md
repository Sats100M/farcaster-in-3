# farcaster-in-3

Run your own Farcaster read node and client in three commands. No API keys, no permission from anyone. You bring the server.

```
node scripts/provision.mjs                 # 0. rent a server (AWS, Azure or Hetzner)
ssh ... "curl -fsSL .../node.sh | sudo bash -s -- --fid <your fid>"   # 1. Snapchain read node
npx ...                                    # 2. client (coming)
```

Work in progress. Full tutorial and site coming this week.

## What's here so far

- `scripts/provision.mjs` creates a 4 vCPU / 16 GB server with a 1 TB disk and opens the Snapchain ports. Prints the price and asks before creating anything. `--provider aws|azure|hetzner`.
- `scripts/destroy.mjs` deletes all of it so billing stops.
- `scripts/node.sh` runs on the server. It wraps the official `snapchain.sh` installer so it works non-interactively over SSH, puts the database on the data disk, and adds an `fc-node-status` command.

## Things I hit so far

- New Hetzner accounts can't create a 1 TB volume and can't ask for a limit increase until the account is older. Use another provider if your account is new.
- AWS Free plan accounts are blocked from EC2 entirely. You have to upgrade to the Paid plan (credits carry over).
- The official bootstrap script reads answers from `/dev/tty`, so piping it over SSH fails. `node.sh` pre-fills `.env` instead.

MIT licensed.
