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
BACKUP_ID="${RELEASE_ID}"
REMOTE_RELEASE="/opt/aster/releases/${RELEASE_ID}"
REMOTE_BACKUP="/opt/aster/backups/before-${RELEASE_ID}"

echo "==> [1/5] Building server and Web client (dist/server/server.mjs, dist/web/client/)..."
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

echo "==> [2/5] Uploading candidate release ${RELEASE_ID} (without activating)..."
PREV_RELEASE="$(ssh "$SSH_TARGET" "readlink -f /opt/aster/current || true")"
ssh "$SSH_TARGET" "mkdir -p '${REMOTE_RELEASE}/client' '${REMOTE_BACKUP}'"
tar --no-xattrs --no-mac-metadata -C dist/server -cf - server.mjs | ssh "$SSH_TARGET" "tar -C '${REMOTE_RELEASE}' -xf -"
tar --no-xattrs --no-mac-metadata -C dist/web -cf - client | ssh "$SSH_TARGET" "tar -C '${REMOTE_RELEASE}' -xf -"

echo "==> [3/5] Running service-runtime preflight & consistent SQLite checkpoint backup..."
BACKUP_SCRIPT="
set -euo pipefail
RUNTIME_MODE='none'
if [ -f /opt/aster/compose.yml ] && command -v docker >/dev/null 2>&1; then
  RUNTIME_MODE='docker'
elif systemctl list-unit-files aster.service >/dev/null 2>&1 || [ -x /opt/aster/runtime/node ]; then
  RUNTIME_MODE='systemd'
fi
if [ \"\$RUNTIME_MODE\" = 'none' ]; then
  echo 'Error: unable to identify Aster container or systemd runtime.' >&2
  exit 1
fi

run_service_node() {
  if [ \"\$RUNTIME_MODE\" = 'docker' ]; then
    if docker ps -q -f name=^/aster\$ | grep -q .; then
      docker exec -i aster node \"\$@\"
    else
      cd /opt/aster && docker compose run --rm --no-deps -T --entrypoint node aster \"\$@\"
    fi
  else
    if [ ! -x /opt/aster/runtime/node ]; then
      echo 'Error: /opt/aster/runtime/node is missing or not executable.' >&2
      exit 1
    fi
    set -a
    [ -f /opt/aster/aster.env ] && . /opt/aster/aster.env
    set +a
    /opt/aster/runtime/node \"\$@\"
  fi
}

# Candidate and archived backup paths exist on the host, outside the current
# release bind mount. Use a one-off service container with explicit read-only
# mounts while retaining the service environment, user and data volumes.
run_candidate_node() {
  if [ \"\$RUNTIME_MODE\" = 'docker' ]; then
    (cd /opt/aster && docker compose run --rm --no-deps -T \
      -v '${REMOTE_RELEASE}:${REMOTE_RELEASE}:ro' \
      -v '${REMOTE_BACKUP}:${REMOTE_BACKUP}:ro' \
      --entrypoint node aster \"\$@\")
  else
    run_service_node \"\$@\"
  fi
}

# Check candidate visibility and syntax before stopping the active service.
run_candidate_node --check '${REMOTE_RELEASE}/server.mjs'

# Verify Node runtime supports node:sqlite online backup() before modifying anything.
run_service_node -e '
  const { DatabaseSync, backup } = require(\"node:sqlite\");
  if (typeof DatabaseSync !== \"function\" || typeof backup !== \"function\") {
    console.error(\"Unsupported Node runtime: node:sqlite backup() requires Node >= 22.16.0\");
    process.exit(1);
  }
'

# Determine writable staging base inside service data directory.
DATA_DIR='/opt/aster/data'
if [ -f /opt/aster/aster.env ]; then
  ORG_ENV=\$(grep -E '^ORGANIZATION_FILE=' /opt/aster/aster.env | tail -n1 | cut -d= -f2- || true)
  if [ -n \"\$ORG_ENV\" ]; then DATA_DIR=\$(dirname \"\$ORG_ENV\"); fi
fi
STAGING_DIR=\"\${DATA_DIR}/backup-staging/${BACKUP_ID}\"

# Try live drained checkpoint over WORKSPACE_SOCKET first (only valid for running service with new IPC route).
SOCK_PATH=''
if [ -f /opt/aster/aster.env ]; then
  SOCK_PATH=\$(grep -E '^WORKSPACE_SOCKET=' /opt/aster/aster.env | tail -n1 | cut -d= -f2- || true)
fi
if [ -z \"\$SOCK_PATH\" ] && [ -S /opt/aster/data/aster.sock ]; then
  SOCK_PATH='/opt/aster/data/aster.sock'
fi

LIVE_RESULT=1
if [ -n \"\$SOCK_PATH\" ]; then
  set +e
  run_service_node -e '
    const http = require(\"node:http\");
    const sock = process.argv[1];
    const backupId = process.argv[2];
    const releaseId = process.argv[3];
    const req = (method, path, headers, body) => new Promise((resolve, reject) => {
      const r = http.request({ socketPath: sock, path, method, headers }, (res) => {
        let data = \"\";
        res.on(\"data\", (c) => data += c);
        res.on(\"end\", () => resolve({ status: res.statusCode, body: data }));
      });
      r.on(\"error\", reject);
      if (body) r.write(body);
      r.end();
    });
    (async () => {
      const ws = await req(\"GET\", \"/api/workspace\", {});
      if (ws.status !== 200) process.exit(2);
      const id = JSON.parse(ws.body).identity;
      const payload = JSON.stringify({ backupId, releaseId });
      const b = await req(\"POST\", \"/api/internal/maintenance/backup\", {
        \"x-aster-source\": id,
        \"content-type\": \"application/json\",
        \"content-length\": Buffer.byteLength(payload)
      }, payload);
      if (b.status === 404) process.exit(44);
      if (b.status !== 200) { console.error(b.body); process.exit(1); }
    })().catch((e) => { console.error(e.message); process.exit(2); });
  ' \"\$SOCK_PATH\" '${BACKUP_ID}' '${RELEASE_ID}'
  LIVE_RESULT=\$?
  set -e
fi

if [ \"\$LIVE_RESULT\" -ne 0 ]; then
  # Offline or legacy release fallback: pause managed writes briefly and invoke unified snapshot helper.
  WAS_RUNNING=0
  restart_previous() {
    if [ \"\$WAS_RUNNING\" -eq 1 ]; then
      if [ \"\$RUNTIME_MODE\" = 'docker' ]; then
        cd /opt/aster && docker compose up -d aster
      else
        systemctl start aster.service
      fi
    fi
  }
  trap 'status=\$?; if [ \"\$status\" -ne 0 ]; then restart_previous; fi' EXIT
  if [ \"\$RUNTIME_MODE\" = 'docker' ] && docker ps -q -f name=^/aster\$ | grep -q .; then
    WAS_RUNNING=1
    cd /opt/aster && docker compose stop aster
  elif [ \"\$RUNTIME_MODE\" = 'systemd' ] && systemctl is-active --quiet aster.service; then
    WAS_RUNNING=1
    systemctl stop aster.service
  fi

  # The candidate defaults Time on, but a legacy active release has never
  # initialized its database. Allow that migration only with positive evidence
  # that the previous server bundle predates Time; the helper also rejects
  # orphaned barrier/WAL/SHM files even when this flag is present.
  MAINTENANCE_ARGS=(--maintenance-backup --backup-id '${BACKUP_ID}' --release-id '${RELEASE_ID}')
  if [ -r /opt/aster/current/server.mjs ]; then
    if grep -F 'time.sqlite' /opt/aster/current/server.mjs >/dev/null; then
      :
    else
      GREP_STATUS=\$?
      if [ \"\$GREP_STATUS\" -eq 1 ]; then
        MAINTENANCE_ARGS+=(--allow-uninitialized-time)
      else
        echo 'Error: cannot inspect previous release Time support.' >&2
        exit 1
      fi
    fi
  fi

  if ! run_candidate_node '${REMOTE_RELEASE}/server.mjs' \"\${MAINTENANCE_ARGS[@]}\"; then
    rm -rf \"\$STAGING_DIR\"
    echo 'Error: maintenance backup failed; release aborted without switching.' >&2
    exit 1
  fi
fi

# Verify complete manifest & sha256s in staging, then copy closed snapshot to REMOTE_BACKUP.
if [ ! -f \"\${STAGING_DIR}/manifest.json\" ]; then
  rm -rf \"\${STAGING_DIR}\"
  echo 'Error: backup manifest missing; refusing to continue.' >&2
  exit 1
fi

cp -a \"\${STAGING_DIR}/.\" '${REMOTE_BACKUP}/'
run_candidate_node -e '
  const fs = require(\"node:fs\");
  const path = require(\"node:path\");
  const crypto = require(\"node:crypto\");
  const { DatabaseSync } = require(\"node:sqlite\");
  const dir = process.argv[1];
  const m = JSON.parse(fs.readFileSync(path.join(dir, \"manifest.json\"), \"utf8\"));
  if (!m.complete) { throw new Error(\"Backup manifest not complete\"); }
  for (const rec of Object.values(m.files)) {
    if (!rec.exists) continue;
    const fp = path.join(dir, rec.relativePath);
    const buf = fs.readFileSync(fp);
    const hash = crypto.createHash(\"sha256\").update(buf).digest(\"hex\");
    if (hash !== rec.sha256 || buf.length !== rec.bytes) {
      throw new Error(\"Checksum mismatch in backup file: \" + rec.relativePath);
    }
    if (rec.relativePath.endsWith(\".sqlite\") || rec.relativePath.endsWith(\".sqlite3\")) {
      const db = new DatabaseSync(fp, { readOnly: true });
      const row = db.prepare(\"PRAGMA integrity_check\").get();
      db.close();
      if (!row || row.integrity_check !== \"ok\") throw new Error(\"SQLite integrity check failed: \" + rec.relativePath);
    }
  }
' '${REMOTE_BACKUP}' || { rm -rf '${REMOTE_BACKUP}' \"\${STAGING_DIR}\"; exit 1; }

rm -rf \"\${STAGING_DIR}\"
"

if ! ssh "$SSH_TARGET" "$BACKUP_SCRIPT"; then
  echo "!! Pre-release backup failed; deleting uploaded release and aborting." >&2
  ssh "$SSH_TARGET" "rm -rf '${REMOTE_RELEASE}' '${REMOTE_BACKUP}'" || true
  exit 1
fi

echo "==> [4/5] Activating /opt/aster/current -> ${REMOTE_RELEASE} and restarting service..."
RESTART_REMOTE="ln -sfn '${REMOTE_RELEASE}' /opt/aster/current && \
  if [ -f /opt/aster/compose.yml ] && docker ps -a -q -f name=aster | grep -q .; then \
    cd /opt/aster && docker compose up -d --force-recreate aster; \
  elif systemctl is-active --quiet aster.service || systemctl is-enabled --quiet aster.service 2>/dev/null; then \
    systemctl restart aster.service; \
  fi && \
  for i in \$(seq 1 15); do \
    sleep 1; \
    HEALTH=\$(curl -fsS --connect-timeout 2 http://127.0.0.1:4180/healthz 2>/dev/null || true); \
    if echo \"\$HEALTH\" | grep -q '\"ok\":true'; then \
      exit 0; \
    fi; \
  done; \
  exit 1"

ROLLBACK_REMOTE="if [[ -n '${PREV_RELEASE}' ]]; then \
  # Refuse unsafe downgrade if schema_version in time.sqlite exceeds previous release capability (DEP-04).
  TIME_DB='/opt/aster/data/time.sqlite'; \
  if [ -f \"\$TIME_DB\" ] && [ -x /opt/aster/runtime/node ]; then \
    SCHEMA_VER=\$(/opt/aster/runtime/node -e 'const {DatabaseSync}=require(\"node:sqlite\");const db=new DatabaseSync(process.argv[1],{readOnly:true});const r=db.prepare(\"SELECT schema_version FROM time_meta WHERE id=1\").get();db.close();console.log(r?r.schema_version:0);' \"\$TIME_DB\" 2>/dev/null || echo 999); \
    if [ \"\$SCHEMA_VER\" -gt 1 ]; then \
      echo '!! Refusing automatic downgrade: time.sqlite schema_version > 1. Keep maintenance state and restore explicitly.' >&2; \
      exit 2; \
    fi; \
  fi; \
  ln -sfn '${PREV_RELEASE}' /opt/aster/current && \
  if [ -f /opt/aster/compose.yml ] && docker ps -a -q -f name=aster | grep -q .; then \
    cd /opt/aster && docker compose up -d --force-recreate aster; \
  elif systemctl is-active --quiet aster.service || systemctl is-enabled --quiet aster.service 2>/dev/null; then \
    systemctl restart aster.service; \
  fi; \
fi"

if ! ssh "$SSH_TARGET" "$RESTART_REMOTE"; then
  echo "!! Deployment health check failed; checking rollback safety to ${PREV_RELEASE}..." >&2
  ssh "$SSH_TARGET" "$ROLLBACK_REMOTE" || true
  exit 1
fi

echo "==> [5/5] Verified release ${RELEASE_ID}"
echo "✓ Deployed ${RELEASE_ID} to ${SSH_TARGET} (https://task.caten.top)"
echo "  Previous release: ${PREV_RELEASE:-none}"
echo "  Backup saved at:  ${REMOTE_BACKUP}"
