#!/usr/bin/env bash
set -euo pipefail

# Avoid creating ._* resource fork files on macOS
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SSH_TARGET="${SSH_TARGET:-dmit}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
SUFFIX="${1:-ui}"
RELEASE_ID="${STAMP}-${SUFFIX}"
REMOTE_RELEASE="/opt/aster/releases/${RELEASE_ID}"
REMOTE_BACKUP="/opt/aster/backups/before-${RELEASE_ID}"

echo "==> [1/4] Building server and Web client (dist/server/server.mjs, dist/web/client/)..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm run build:server
  pnpm run build:web
else
  npm run build:server
  npm run build:web
fi

if [[ ! -f dist/server/server.mjs || ! -d dist/web/client ]]; then
  echo "Error: build output dist/server/server.mjs or dist/web/client is missing." >&2
  exit 1
fi

echo "==> [2/4] Backing up metadata and preparing release ${REMOTE_RELEASE} on ${SSH_TARGET}..."
PREV_RELEASE="$(ssh "$SSH_TARGET" "readlink -f /opt/aster/current || true")"
ssh "$SSH_TARGET" "mkdir -p '${REMOTE_BACKUP}' '${REMOTE_RELEASE}/client' && \
  for f in organization.json recovery.json restored-uda.json; do \
    if [ -f \"/opt/aster/data/\$f\" ]; then cp -a \"/opt/aster/data/\$f\" '${REMOTE_BACKUP}/'; fi; \
  done && \
  if [ -f /var/lib/taskwarrior/taskchampion.sqlite3 ]; then \
    if [ -x /opt/aster/runtime/node ]; then \
      /opt/aster/runtime/node -e '
        const { DatabaseSync, backup } = require(\"node:sqlite\");
        const db = new DatabaseSync(\"/var/lib/taskwarrior/taskchampion.sqlite3\", { readOnly: true });
        backup(db, \"${REMOTE_BACKUP}/taskchampion.sqlite3\").then(() => db.close());
      '; \
    elif docker ps -q -f name=aster | grep -q .; then \
      docker exec aster node -e '
        const { DatabaseSync, backup } = require(\"node:sqlite\");
        const db = new DatabaseSync(\"/var/lib/taskwarrior/taskchampion.sqlite3\", { readOnly: true });
        backup(db, \"/opt/aster/data/taskchampion-backup.sqlite3\").then(() => db.close());
      '; \
      mv -f /opt/aster/data/taskchampion-backup.sqlite3 '${REMOTE_BACKUP}/taskchampion.sqlite3'; \
    fi; \
  fi"

echo "==> [3/4] Uploading release artifacts to ${SSH_TARGET}:${REMOTE_RELEASE}..."
tar --no-xattrs --no-mac-metadata -C dist/server -cf - server.mjs | ssh "$SSH_TARGET" "tar -C '${REMOTE_RELEASE}' -xf -"
tar --no-xattrs --no-mac-metadata -C dist/web -cf - client | ssh "$SSH_TARGET" "tar -C '${REMOTE_RELEASE}' -xf -"

echo "==> [4/4] Switching /opt/aster/current -> ${REMOTE_RELEASE} and restarting service..."
RESTART_REMOTE="ln -sfn '${REMOTE_RELEASE}' /opt/aster/current && \
  if [ -f /opt/aster/compose.yml ] && docker ps -a -q -f name=aster | grep -q .; then \
    cd /opt/aster && docker compose up -d --force-recreate aster; \
  elif systemctl is-active --quiet aster.service || systemctl is-enabled --quiet aster.service 2>/dev/null; then \
    systemctl restart aster.service; \
  fi && \
  for i in \$(seq 1 10); do \
    sleep 1; \
    if curl -fsS --connect-timeout 2 http://127.0.0.1:4180/healthz >/dev/null 2>&1; then \
      exit 0; \
    fi; \
  done; \
  exit 1"

ROLLBACK_REMOTE="if [[ -n '${PREV_RELEASE}' ]]; then \
  ln -sfn '${PREV_RELEASE}' /opt/aster/current && \
  if [ -f /opt/aster/compose.yml ] && docker ps -a -q -f name=aster | grep -q .; then \
    cd /opt/aster && docker compose up -d --force-recreate aster; \
  elif systemctl is-active --quiet aster.service || systemctl is-enabled --quiet aster.service 2>/dev/null; then \
    systemctl restart aster.service; \
  fi; \
fi"

if ! ssh "$SSH_TARGET" "$RESTART_REMOTE"; then
  echo "!! Deployment health check failed; rolling back to ${PREV_RELEASE}..." >&2
  ssh "$SSH_TARGET" "$ROLLBACK_REMOTE" || true
  exit 1
fi

echo "✓ Deployed ${RELEASE_ID} to ${SSH_TARGET} (https://task.caten.top)"
echo "  Previous release: ${PREV_RELEASE:-none}"
echo "  Backup saved at:  ${REMOTE_BACKUP}"
