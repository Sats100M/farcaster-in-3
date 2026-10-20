# Setting up farcaster-in-3 with a coding agent

For an agent (Claude Code, Codex and the like) running commands on someone's computer. The person pastes:

```
Set up my own Farcaster read node and client with farcaster-in-3. Read https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/AGENTS.md and follow it.
```

## Rules

- **Never ask for, accept or type a recovery phrase.** If the person pastes one into the chat, tell them to treat it as leaked and move to a new test account. Only `./fc3 client` asks for it, in the person's own terminal, with input hidden. Prefer `./fc3 client --wallet`, where a browser wallet signs and no phrase is involved.
- **Ask before anything that costs money.** `./fc3 provision` shows a price and waits for a yes; let the person answer it. Suggest `--hours 48` so a forgotten server deletes itself.
- **Don't open more ports or change the firewall** beyond what the scripts do.
- **Delete what you created** when the person is done: `./fc3 destroy`.

## Steps

1. Check `node --version` is 20 or later and `git` exists. On Windows use `.\fc3` instead of `./fc3`.
2. `git clone https://github.com/Sats100M/farcaster-in-3 && cd farcaster-in-3`
3. Ask which provider the person has an account with (Azure, AWS or Hetzner) and make sure they're logged in:
   - Azure: `az login`
   - AWS: `aws login` (or `aws configure`)
   - Hetzner: `HCLOUD_TOKEN=...` in a `.env` file at the repo root. The person creates the token; don't print it back.
4. `./fc3 provision --provider <name> --hours 48`. Hand the price prompt to the person.
5. Ask for the person's FID (a number, shown on their Farcaster profile; not secret). Run `./fc3 node --fid <fid>`.
6. Run `./fc3 status` every 10–15 minutes. The snapshot download takes about two hours, catching up a few more. Done when it prints `✓ in sync`. If it says a shard skipped its snapshot, run the command it prints.
7. Tell the person to run `./fc3 client --wallet` themselves (or `./fc3 client` to type the phrase in their own terminal). The client opens in their browser.
8. Check it worked: `./fc3 whoami` shows their username and an active app key.

## If something fails

- `provision` can't find capacity: it tries other sizes and regions itself. If all fail, try another provider.
- `status` can't connect right after `node`: the API comes up after the snapshot is restored. Wait.
- `client` says the account isn't found: the node hasn't synced yet, or the address isn't the account's custody address.
- Anything else: the error text plus [the troubleshooting section](https://sats100m.github.io/farcaster-in-3/#troubleshooting) usually say what to do. Report new problems at https://github.com/Sats100M/farcaster-in-3/issues.
