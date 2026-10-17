# Security

## Seed phrases

`fc init` asks for the recovery phrase of the account's custody address. It is read with echo off, used in memory to sign one `KEY_ADD` (and its `SignedKeyRequest`), and dropped. It is never written to disk or sent anywhere; only the signatures go to your node. The code that does this is the `init` function in `client/fc.mjs`. Read it before you paste a phrase.

What is saved, in `~/.farcaster-in-3.json` (mode 600): your node address, your FID, and the client's app key. That key can only sign casts, cast deletions, reactions and follows. It can't add or remove keys, transfer the account or touch funds, and it expires after 30 days without use.

If you think the app key leaked, delete the file and remove the key from another app's connected apps settings, or with a custody-signed `KEY_REMOVE`.

## Cloud credentials

`provision.mjs` uses whatever the provider's CLI is logged in as (`az login`, `aws login`) or `HCLOUD_TOKEN` from `.env`. `.env` is in `.gitignore`. Nothing is sent anywhere except the provider's own API.

## Reporting a problem

Open an issue, or for something sensitive, DM [@sats100m](https://farcaster.xyz/sats100m) on Farcaster.
