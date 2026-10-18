#!/usr/bin/env bash
# Reload one shard from the latest snapshot, for a node that skipped it.
#
# The node fetches snapshot metadata for every shard before downloading any of
# them. Snapshots are replaced daily, so on a slow first sync the later shard's
# snapshot can be gone by the time its turn comes: the download 404s, the node
# restarts, skips the snapshot and starts syncing that shard from genesis
# (weeks). fc-node-status flags this; this script fixes it.
#
# Usage (as root on the server):
#   curl -fsSL <this file's raw URL> | bash -s -- --shard 0
#
# Needs free disk of about twice the shard's size (shard 0 ~30 GB of chunks,
# ~37 GB unpacked). The node is stopped only for the unpack, a few minutes.

set -euo pipefail

SHARD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --shard) SHARD="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
if [[ ! "$SHARD" =~ ^[0-9]+$ ]]; then
  echo "Usage: reload-shard.sh --shard <n>   (the shard fc-node-status says is far behind)" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run this as root." >&2
  exit 1
fi

BASE=https://pub-d352dd8819104a778e20d08888c5a661.r2.dev
NODE=$(readlink -f ~/snapchain)
DL="$NODE/../shard$SHARD-download"

meta=$(curl -fsS "$BASE/FARCASTER_NETWORK_MAINNET/$SHARD/latest.json")
key=$(jq -r .key_base <<<"$meta")
mkdir -p "$DL"
cd "$DL"
jq -r '.chunks[]' <<<"$meta" > chunks.txt
echo "Shard $SHARD snapshot $key: $(wc -l < chunks.txt) chunks"

# Download in parallel, then check every chunk and refetch any that came back
# truncated (curl can exit cleanly on a dropped connection).
xargs -P 8 -I{} curl -fsS --retry 5 --retry-delay 3 -o {} "$BASE/$key/{}" < chunks.txt || true
for _ in 1 2 3; do
  bad=0
  while read -r c; do
    if ! gzip -t "$c" 2>/dev/null; then
      bad=$((bad + 1))
      curl -fsS --retry 5 --retry-delay 3 -o "$c" "$BASE/$key/$c" || true
    fi
  done < chunks.txt
  (( bad == 0 )) && break
  echo "refetched $bad chunks"
done
while read -r c; do gzip -t "$c"; done < chunks.txt
echo "✓ all chunks verified ($(du -sh . | cut -f1))"

# The chunks are pieces of one gzipped tar holding shard-$SHARD/.
cd "$NODE"
docker compose stop snapchain
rm -rf ".rocks/shard-$SHARD" .rocks.snapshot
while read -r c; do gunzip -c "$DL/$c"; done < "$DL/chunks.txt" | tar -x -C .rocks
docker compose start snapchain
rm -rf "$DL"
echo "✓ shard $SHARD reloaded. It catches up the last few hours on its own; watch it with fc-node-status."
