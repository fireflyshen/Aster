# Self-Hosted Deployment

Aster ships a single-file server bundle (`dist/server/server.mjs`) and static
frontend assets (`dist/web/client/`) with zero third-party runtime dependencies
on Node.js 22.16+ and Taskwarrior 3.

Any Linux VPS with Node.js 22.16+ and Taskwarrior 3 can host Aster cleanly via
Docker Compose or `systemd` behind a reverse proxy (Caddy, Nginx, Cloudflare
Tunnel, etc.).

## Host Layout

A standard deployment places release artifacts and persistent state under
`/opt/aster`:

- `/opt/aster/current` -> active immutable release symlink pointing into
  `/opt/aster/releases/`
- `/opt/aster/aster.env` -> runtime configuration (see
  [`deploy/aster.env.example`](aster.env.example))
- `/opt/aster/data/` -> persistent workspace & ledger files:
  - `organization.json`: filters, colors, favorites, project descriptions, Focus
    state, and board columns
  - `recovery.json`: raw pre-delete task snapshots and journal
  - `time.sqlite` (+ `.barrier.json`): Time Ledger SQLite WAL database (when
    `TIME_ENABLED=1`)
  - `workspace.sock`: optional `0600` Unix socket for MCP / Go TUI / SSH desktop
    access
- `/var/lib/taskwarrior/` (or your `TASKRC` data directory): Taskwarrior 3
  database (`taskchampion.sqlite3`)
- Health check endpoint: `GET http://127.0.0.1:4180/healthz`

Example templates in `deploy/`:

- [`deploy/aster.env.example`](aster.env.example): runtime environment template
- [`deploy/aster.service`](aster.service): hardened `systemd` unit file
- [`deploy/Caddyfile.fragment`](Caddyfile.fragment): minimal Caddy reverse-proxy
  config

## Deploying Releases (`deploy/deploy.sh`)

Deploy directly from a local checkout to any SSH host configured in
`~/.ssh/config`:

```bash
SSH_TARGET=<your-vps-ssh-alias> bash deploy/deploy.sh [suffix]
```

(`npm run deploy` defaults `SSH_TARGET` to `dmit` unless `SSH_TARGET` is
overridden.)

### What `deploy/deploy.sh` does

1. **Local Build**: Runs `build:server` and `build:web`, generating
   `dist/server/server.mjs` and `dist/web/client/`.
2. **Metadata & DB Backup**: Connects to `$SSH_TARGET`, stages an atomic
   pre-release backup under `/opt/aster/backups/before-${RELEASE_ID}`
   (`organization.json`, `recovery.json`, `time.sqlite`, and online `sqlite3`
   backup of `taskchampion.sqlite3` with SHA-256 checksums and integrity
   checks).
3. **Artifact Upload**: Streams clean release artifacts to
   `/opt/aster/releases/${RELEASE_ID}` via SSH `tar`.
4. **Service Switch & Health Check**: Atomically switches `/opt/aster/current`,
   recreates Docker container `aster` (or restarts `systemd` `aster.service`),
   and polls `http://127.0.0.1:4180/healthz`.
5. **Auto-Rollback**: Automatically restores the previous `/opt/aster/current`
   symlink and service if `/healthz` fails.

### Backup Runtime & Preflight Notes

- Because containerized setups may mount only `/opt/aster/current`, `deploy.sh`
  runs candidate verification and consistency backups via one-off read-only
  mounts while keeping data volumes intact.
- For a first upgrade from a release that predates `time.sqlite`, pass
  `--allow-uninitialized-time` to the maintenance backup CLI; orphaned
  `.barrier.json`, `-wal`, or `-shm` files without a main database still abort
  to protect against partial state.
- Run isolated deployment regression tests (mocked Docker and systemd, zero
  remote SSH) with:

```bash
npm run test:deploy
```
