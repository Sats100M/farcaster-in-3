#!/usr/bin/env bash
# Command 1: turn a fresh Ubuntu server into a Farcaster Snapchain read node.
#
# Wraps the official installer (farcasterxyz/snapchain scripts/snapchain.sh) so it
# runs unattended: the official bootstrap waits for keyboard answers, which breaks
# when piped over SSH. We pre-answer those prompts in .env, then hand off to it.
#
# Usage (as root on the server):
#   curl -fsSL <this file's raw URL> | bash -s -- --fid 12345
#
# --fid is your Farcaster ID. It is only used to schedule the weekly auto-upgrade
# on a day derived from your FID; no keys or secrets are involved.
# --https also puts HTTPS in front of the API (scripts/https.sh), for web clients.

set -euo pipefail

FID=""
HTTPS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fid) FID="$2"; shift 2 ;;
    --https) HTTPS=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SNAPCHAIN_SH="https://raw.githubusercontent.com/farcasterxyz/snapchain/@latest/scripts/snapchain.sh"
MIN_FREE_GB=1000

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (it installs Docker and opens ports)." >&2
  exit 1
fi

# --- Where the database goes ---
# provision.mjs attaches a big data disk. Hetzner formats and mounts it at
# /mnt/HC_Volume_<id>; Azure hands it over blank, so format and mount it at
# /mnt/data ourselves. Then put the node there and symlink ~/snapchain to it,
# because the official script always works out of ~/snapchain.
if [[ ! -e ~/snapchain ]] && ! ls -d /mnt/HC_Volume_* >/dev/null 2>&1 && ! mountpoint -q /mnt/data; then
  # A blank disk: no partitions, no filesystem, not mounted, at least 400 GB.
  BLANK=$(lsblk -dnbo NAME,SIZE,TYPE | awk '$3=="disk" && $2 >= 400*1024^3 {print $1}' | while read -r d; do
    [[ -z "$(lsblk -no FSTYPE,MOUNTPOINT "/dev/$d" | tr -d '[:space:]')" ]] && echo "$d"
  done | head -n1)
  if [[ -n "$BLANK" ]]; then
    echo "Formatting blank data disk /dev/$BLANK..."
    mkfs.ext4 -q -F "/dev/$BLANK"
    mkdir -p /mnt/data
    echo "UUID=$(blkid -s UUID -o value "/dev/$BLANK") /mnt/data ext4 defaults,nofail 0 2" >> /etc/fstab
    mount /mnt/data
  fi
fi
if [[ ! -e ~/snapchain ]]; then
  VOLUME=""
  for d in /mnt/HC_Volume_* /mnt/data; do
    [[ -d "$d" ]] && { VOLUME="$d"; break; }
  done
  if [[ -n "$VOLUME" ]]; then
    mkdir -p "$VOLUME/snapchain"
    ln -s "$VOLUME/snapchain" ~/snapchain
    echo "✓ node data will live on $VOLUME"
  else
    mkdir -p ~/snapchain
    echo "! no attached volume found, using the server's own disk"
  fi
fi

FREE_GB=$(df -BG --output=avail "$(readlink -f ~/snapchain)" | tail -n1 | tr -dc '0-9')
if (( FREE_GB < MIN_FREE_GB )); then
  echo "! only ${FREE_GB} GB free where the node will store data."
  echo "  The mainnet database is several hundred GB and growing; ${MIN_FREE_GB}+ GB is recommended."
fi

# --- Dependencies ---
export DEBIAN_FRONTEND=noninteractive
if ! command -v jq >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq jq curl
fi
if ! command -v docker >/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# --- Pre-answer the installer's prompts ---
cd ~/snapchain
touch .env
grep -q '^AGREE_NO_REWARDS_FOR_ME=' .env || echo 'AGREE_NO_REWARDS_FOR_ME=true' >> .env
if ! grep -q '^HUB_OPERATOR_FID=' .env; then
  if [[ -n "$FID" ]]; then
    echo "HUB_OPERATOR_FID=$FID" >> .env
  else
    # Without an FID the installer can't pick an auto-upgrade day and refuses
    # to start, so skip the cron job and remind the user to upgrade by hand.
    echo 'HUB_OPERATOR_FID=0' >> .env
    grep -q '^SKIP_CRONTAB=' .env || echo 'SKIP_CRONTAB=true' >> .env
    echo "! no --fid given: weekly auto-upgrade is off. Upgrade with: cd ~/snapchain && ./snapchain.sh upgrade"
  fi
fi

# --- Hand off to the official installer ---
curl -fsSL -o snapchain.sh "$SNAPCHAIN_SH?t=$(date +%s)"
chmod +x snapchain.sh
# snapchain.sh ends by following the node's logs forever. Run it in the background,
# wait for that log tail to start (meaning the node is up), then stop the tail.
./snapchain.sh upgrade < /dev/null > upgrade.log 2>&1 &
UPGRADE_PID=$!
echo "Pulling images and starting the node (1-3 minutes)..."
for _ in $(seq 1 120); do
  pgrep -f "docker compose logs" >/dev/null && break
  kill -0 "$UPGRADE_PID" 2>/dev/null || break
  sleep 5
done
pkill -f "docker compose logs" || true
wait "$UPGRADE_PID" || true
if ! docker ps --format '{{.Names}}' | grep -q snapchain-snapchain; then
  echo "The node did not start. Last lines of ~/snapchain/upgrade.log:" >&2
  tail -n 20 upgrade.log >&2
  exit 1
fi

# --- A small status helper ---
cat > /usr/local/bin/fc-node-status <<'EOF'
#!/usr/bin/env bash
# Shows whether the read node has caught up. blockDelay = seconds each shard is behind.
if ! info=$(curl -s --max-time 5 localhost:3381/v1/info); then
  # The API only comes up after the snapshot is restored; show download progress instead.
  progress=$(docker logs --tail 300 snapchain-snapchain-1 2>&1 | grep -o 'Progress: .*' | tail -n1)
  echo "API not up yet. Snapshot download: ${progress:-starting...}"
  exit 1
fi
echo "$info" | jq -r '"version " + .version,
  (.shardInfos[] | "shard \(.shardId)  height \(.maxHeight)  behind \(.blockDelay)s")'
behind=$(echo "$info" | jq '[.shardInfos[].blockDelay | tonumber] | max')
if (( behind < 10 )); then echo "✓ in sync"; else echo "… syncing"; fi
# More than a week behind after the snapshot step means the shard's snapshot
# was skipped and it is syncing from genesis. See reload-shard.sh.
echo "$info" | jq -r '.shardInfos[] | select((.blockDelay | tonumber) > 604800) | .shardId' | while read -r s; do
  echo "! shard $s skipped its snapshot and is syncing from the start (weeks). Fix:"
  echo "  curl -fsSL https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/reload-shard.sh | sudo bash -s -- --shard $s"
done
EOF
chmod +x /usr/local/bin/fc-node-status

IP=$(curl -s --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')

if (( HTTPS )); then
  curl -fsSL https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/https.sh | bash ||     echo "! HTTPS setup failed; the node itself is fine. Retry later: curl -fsSL https://raw.githubusercontent.com/Sats100M/farcaster-in-3/main/scripts/https.sh | sudo bash"
fi
cat <<EOF

✓ Snapchain read node is starting.

A new node first downloads a database snapshot (several hundred GB), which
can take a few hours. Check progress any time with:

  fc-node-status            # sync summary
  cd ~/snapchain && ./snapchain.sh logs

When every shard is a few seconds behind, your node is synced and its API is
live at http://${IP}:3381  (try: curl http://${IP}:3381/v1/castsByFid?fid=3)

Next: command 2, the client. Run it on your own computer, pointed at this node.
EOF
