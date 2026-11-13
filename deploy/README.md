# Deployment

Aster runs independently at `https://task.caten.top`.
As of 2026-11-09, Aster is deployed on `dmit` inside Docker (`/opt/aster/compose.yml`) connected to `caddy_net`, with fallback support for systemd environments (`aster.service`).

## Architecture & Layout

- Target VPS alias: `dmit` (`root@179.255.102.39`).
- `/opt/aster/current` points to the active immutable release in `/opt/aster/releases/`.
- In Docker Compose on `dmit`, `./current` is mounted read-only to `/opt/aster/current:ro`.
- `/opt/aster/data/` holds:
  - `organization.json`: filters, colors, favorites, project descriptions, and board columns.
  - `recovery.json`: raw pre-delete task snapshots and journal.
  - `restored-uda.json`: restored custom UDA attributes.
- `/var/lib/taskwarrior/`: shared Taskwarrior 3 database (`taskchampion.sqlite3`).
- Host health check: `http://127.0.0.1:4180/healthz` (bound locally, proxied by Caddy to `https://task.caten.top`).

## Deployment Command

Deploy directly from local repository:

```bash
pnpm run deploy
```

Or with custom tag / target:

```bash
SSH_TARGET=dmit bash deploy/deploy.sh [suffix]
```

### What `pnpm run deploy` does:

1. **Local Build**: Runs `build:server` and `build:web`, generating `dist/server/server.mjs` and `dist/web/client/` (then uploaded into `/opt/aster/releases/${RELEASE_ID}/{server.mjs,client/}`). No git push or CI waiting required.
2. **Metadata & DB Backup**: Connects to the target server (`dmit`), creates an atomic backup directory under `/opt/aster/backups/before-${RELEASE_ID}`, copies metadata JSONs, and executes an online SQLite backup of `taskchampion.sqlite3`.
3. **Artifact Upload**: Streams clean release artifacts to `/opt/aster/releases/${RELEASE_ID}` via SSH tar (with macOS extended attributes stripped).
4. **Service Switch & Recreate**: Atomically updates `/opt/aster/current -> ${REMOTE_RELEASE}`, recreates the Docker container via `docker compose up -d --force-recreate aster` (or restarts `systemctl restart aster.service` if on systemd), and polls `http://127.0.0.1:4180/healthz`.
5. **Auto-Rollback**: If health checks fail within 10 seconds, it automatically rolls back the symlink and restarts the container to restore the previous release.
