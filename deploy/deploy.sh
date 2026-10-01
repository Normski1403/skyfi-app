#!/usr/bin/env bash
# Build skyfid for the Pi (arm64), copy it over, (re)install the service.
#   deploy/deploy.sh [host]        default host: 4our.local
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${1:-4our.local}
GO=${GO:-$(command -v go || echo ~/.local/go/bin/go)}

echo ">> test"
(cd server && "$GO" test ./...)
echo ">> build linux/arm64"
(cd server && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 "$GO" build -trimpath -ldflags "-s -w" -o ../build/skyfid ./cmd/skyfid)
ls -lh build/skyfid

echo ">> install on $HOST"
scp -q build/skyfid deploy/skyfid.service "$HOST":/tmp/
ssh "$HOST" 'set -e
  sudo install -D -m 0755 /tmp/skyfid /opt/skyfi/skyfid
  sudo install -m 0644 /tmp/skyfid.service /etc/systemd/system/skyfid.service
  sudo systemctl daemon-reload
  sudo systemctl enable --quiet skyfid
  sudo systemctl restart skyfid
  sleep 1; systemctl --no-pager --lines=5 status skyfid | head -12'
echo ">> http://$HOST/"
