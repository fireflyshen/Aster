#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SSH_TARGET="${SSH_TARGET:-rn}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
SUFFIX="${1:-ui}"
RELEASE_ID="${STAMP}-${SUFFIX}"
REMOTE_RELEASE="/opt/aster/releases/${RELEASE_ID}"
REMOTE_BACKUP="/opt/aster/backups/before-${RELEASE_ID}"

echo "==> [1/4] Building Web bundle (dist/web/{server.mjs,client/})..."
npm run build:web

if [[ ! -f dist/web/server.mjs || ! -d dist/web/client ]]; then
  echo "Error: build output dist/web/server.mjs or dist/web/client is missing." >&2
  exit 1
fi

echo "==> [2/4] Backing up RN metadata and preparing release ${REMOTE_RELEASE} on ${SSH_TARGET}..."
PREV_RELEASE="$(ssh "$SSH_TARGET" "readlink -f /opt/aster/current || true")"
ssh "$SSH_TARGET" "mkdir -p '${REMOTE_BACKUP}' '${REMOTE_RELEASE}/client' && \
  for f in organization.json recovery.json restored-uda.json; do \
    if [ -f \"/opt/aster/data/\$f\" ]; then cp -a \"/opt/aster/data/\$f\" '${REMOTE_BACKUP}/'; fi; \
  done && \
  if [ -f /var/lib/taskwarrior/taskchampion.sqlite3 ]; then \
    /opt/aster/runtime/node -e '
      const { DatabaseSync, backup } = require(\"node:sqlite\");
      const db = new DatabaseSync(\"/var/lib/taskwarrior/taskchampion.sqlite3\", { readOnly: true });
      backup(db, \"${REMOTE_BACKUP}/taskchampion.sqlite3\").then(() => db.close());
    '; \
  fi"

echo "==> [3/4] Uploading release artifacts to ${SSH_TARGET}:${REMOTE_RELEASE}..."
tar -C dist/web -cf - server.mjs client | ssh "$SSH_TARGET" "tar -C '${REMOTE_RELEASE}' -xf -"

echo "==> [4/4] Switching /opt/aster/current -> ${REMOTE_RELEASE} and restarting aster.service..."
if ! ssh "$SSH_TARGET" "ln -sfn '${REMOTE_RELEASE}' /opt/aster/current && \
  systemctl restart aster.service && \
  systemctl is-active --quiet aster.service && \
  for i in 1 2 3 4 5; do \
    curl -fsS http://172.19.0.1:4180/healthz >/dev/null && exit 0; \
    sleep 1; \
  done; \
  exit 1"; then
  echo "!! Deployment health check failed; rolling back to ${PREV_RELEASE}..." >&2
  if [[ -n "$PREV_RELEASE" ]]; then
    ssh "$SSH_TARGET" "ln -sfn '${PREV_RELEASE}' /opt/aster/current && systemctl restart aster.service"
  fi
  exit 1
fi

echo "✓ Deployed ${RELEASE_ID} to ${SSH_TARGET} (https://task.caten.top)"
echo "  Previous release: ${PREV_RELEASE:-none}"
echo "  Backup saved at:  ${REMOTE_BACKUP}"
