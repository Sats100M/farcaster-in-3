# Contributing

Bug reports from people who actually ran it are the most useful thing. Open an issue with the step, the provider and the output.

## Layout

```
scripts/provision.mjs          step 0, dispatches to scripts/providers/<name>/provision.mjs
scripts/destroy.mjs            undoes step 0
scripts/providers/<name>/      one folder per cloud: provision.mjs, destroy.mjs, a small API/CLI wrapper
scripts/node.sh                step 1, runs on the server as root
client/fc.mjs                  step 2, the whole client in one file
docs/index.html                the tutorial site (GitHub Pages serves docs/)
```

## Adding a provider

Copy one of the existing provider folders. A provider needs to:

- create a server with at least 4 vCPU and 16 GB RAM, plus a 2 TB data disk
- open TCP 22, 3381, 3383 and UDP 3382
- tag or name everything so `destroy.mjs` can find it again
- show the price and ask before creating anything (skip the prompt with `--yes`)
- print the exact step 1 command at the end

`node.sh` finds the data disk on its own (Hetzner's auto-mounted volume, or any blank disk of 400 GB or more), so it shouldn't need changes.

## Before opening a PR

```
bash -n scripts/node.sh
for f in scripts/*.mjs scripts/providers/*/*.mjs client/fc.mjs; do node --check "$f"; done
```

CI also runs shellcheck on `node.sh`.

No dependencies in `scripts/`; they run on a fresh machine with only Node installed.
