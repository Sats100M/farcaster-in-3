# Trying farcaster-in-3

Thanks for testing this. Pick whichever path fits your time. Each one ends with something you can check for yourself, so you're vouching for what you saw, not for me.

Use a **test Farcaster account**, not your main one. Make one in the Farcaster app, then find its recovery phrase in the app's settings. Never paste the phrase of an account or wallet that holds anything you care about, here or anywhere else.

## 10 minutes: the client, on my node

You don't need a server. My read node is open, so you can try the client against it.

You need Node.js 20 or later and git.

```
git clone https://github.com/Sats100M/farcaster-in-3
cd farcaster-in-3
./fc3 client --node 172.174.89.126            # Windows: .\fc3 client --node 172.174.89.126
```

It asks for the test account's recovery phrase once (or add `--wallet` and approve in MetaMask or Rabby instead). Then the web client opens in your browser.

Check:

- [ ] Your feed loads and each cast says which app posted it ("via @warpcast")
- [ ] Tapping an app chip filters the feed to that app; tapping again hides it
- [ ] Post a cast. Find it in the Farcaster app or on farcaster.xyz under your test account
- [ ] Like and recast someone's cast, then undo both
- [ ] Follow someone from their profile page, then unfollow

When you're done, `./fc3 revoke` removes the key the client added. The test account goes back to how it was.

## An afternoon: the whole thing, on your own server

This is the real test: a node of your own, with nobody else's infrastructure.

```
./fc3 provision --provider hetzner --hours 24   # or azure, aws, lightsail
./fc3 node --fid <your test fid>
./fc3 status                                    # repeat until it says "in sync" (a few hours)
./fc3 client
```

`--hours 24` deletes the server after a day, so a forgotten test can't keep billing you (keep your computer on; sleep is fine). `./fc3 destroy` deletes it straight away. It costs a few dollars for the day. The [tutorial](https://sats100m.github.io/farcaster-in-3/#cost) has the exact prices.

Check:

- [ ] `provision` showed a price and asked before creating anything
- [ ] `./fc3 status` reached "in sync" on all three shards
- [ ] Your cast went through your own node: `./fc3 client` prints the node's IP, and it's yours

## Something broke?

That's useful too. [Open an issue](https://github.com/Sats100M/farcaster-in-3/issues/new) with the command and what it printed, or reply on Farcaster to [@sats100m](https://farcaster.xyz/sats100m). I fix what I can the same day and credit you in the README.

## Vouching

If it worked for you, reply under [the pinned cast](https://farcaster.xyz/sats100m) in your own words: which path you took, what you checked, anything that confused you. "Ran the client on my test account, my cast showed up on farcaster.xyz" says more than "great project".
