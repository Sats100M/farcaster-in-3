#!/usr/bin/env bash
# Puts HTTPS in front of the node's HTTP API, so a web page can use it. Browsers
# block an https:// page (like the live client on the tutorial site) from calling
# plain http://<ip>:3381.
#
# Runs Caddy in Docker with a free Let's Encrypt certificate for
# <ip-with-dashes>.sslip.io, a public DNS name that points at the IP inside it,
# so there's no domain to buy. Needs ports 80 and 443 open.
#
# Usage (as root on the node):
#   curl -fsSL <this file's raw URL> | bash
#   DOMAIN=node.example.com bash https.sh     # your own domain instead

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root." >&2
  exit 1
fi

IP=$(curl -s --max-time 5 https://api.ipify.org)
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"

mkdir -p /etc/fc-https
cat > /etc/fc-https/Caddyfile <<EOF
$DOMAIN {
	# Before a page POSTs a message (protobuf), the browser asks permission with
	# an OPTIONS request. The node doesn't answer those, so Caddy does.
	@preflight method OPTIONS
	handle @preflight {
		header Access-Control-Allow-Origin *
		header Access-Control-Allow-Methods "GET, POST, OPTIONS"
		header Access-Control-Allow-Headers content-type
		header Access-Control-Max-Age 86400
		respond 204
	}
	handle /v1/* {
		reverse_proxy 127.0.0.1:3381
	}
	respond "Snapchain read node. The API is under /v1/, for example /v1/info" 200
}
EOF

docker rm -f fc-https >/dev/null 2>&1 || true
docker run -d --name fc-https --restart unless-stopped --network host \
  -v /etc/fc-https/Caddyfile:/etc/caddy/Caddyfile:ro -v fc-https-data:/data \
  caddy:2.10 >/dev/null

echo "Getting a certificate for $DOMAIN..."
for _ in $(seq 1 40); do
  if curl -sf --max-time 5 "https://$DOMAIN/v1/info" >/dev/null; then
    echo "✓ HTTPS is live: https://$DOMAIN/v1/info"
    echo "  Use it in the live client: https://sats100m.github.io/farcaster-in-3/app/#node=https://$DOMAIN"
    exit 0
  fi
  sleep 3
done
echo "! No certificate yet. Check that ports 80 and 443 are open, then: docker logs fc-https" >&2
exit 1
