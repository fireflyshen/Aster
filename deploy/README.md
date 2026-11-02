# RN deployment

Aster runs independently at `https://task.caten.top`, with a dedicated `aster.service` under `/opt/aster`.

- `/opt/aster/current` points to the active immutable release in `releases/`.
- `/opt/aster/runtime/node` is a standalone Node.js 24 runtime. No dependency on another app after installation.
- `/opt/aster/data/organization.json` holds filters, colors, favorites, project descriptions and board columns. It is independent of releases and must be backed up.
- `/var/lib/taskwarrior` remains the shared Taskwarrior 3 database for web, SSH CLI and TinyCast. The service uses the existing Taskwarrior account and permissions; SSH clients retain their original paths.
- `/opt/aster/aster.env` contains explicit origin and Cloudflare Access configuration. File mode 0600; systemd reads it when starting the service.
- The service listens only on RN's `caddy_net` gateway, currently `172.19.0.1:4180`, not on the public interface. Caddy terminates TLS. API JWT verification also rejects direct unauthenticated requests.

Build with `npm run build:web`, copy `dist/web/{server.mjs,client/}` to a new release folder, switch `current` and restart `aster.service`. The bundle has no runtime npm dependencies. Retain the previous release to roll back; never overwrite data when updating code.

Domain setup: proxied DNS A record to RN; a separate Aster Cloudflare Access application with the existing private-user allow policy; a narrowly scoped `task.caten.top/.well-known/acme-challenge/*` Bypass application for Caddy HTTP-01 renewal. Use Full (strict) for this host after a valid origin certificate is issued. Do not change the TLS mode of other domains.

Validate: systemd active, `/healthz` 200, direct API 401, domain redirects anonymous requests to Access, and signed-in browser task creation/edit/completion. Test records must be removed from the active database after checks. Keep backup records under `/opt/aster/backups` until explicitly told to delete them.

The initial Taskwarrior reset first uses SQLite's backup API and checks integrity, saves a full export and original config, then archives the entire previous data directory. All task states in the active database start empty. Web organization definitions are migrated separately, not cleared with Taskwarrior data.

Initial deployment: 2026-10-18. Taskwarrior reset backup: `/opt/aster/backups/20261018T113846Z/` (4 records; SQLite integrity `ok`). The previous directory is retained there as `taskwarrior-original/`. Active task count after reset: 0. Cloudflare Access application: `aster`, separate application AUD, existing `Allow Me` policy.

Focus 2.1 additionally enables `WORKSPACE_SOCKET=/opt/aster/data/workspace.sock`. This Unix socket is mode 0600, uses the same server process/metadata revision queue, and is reachable by the existing SSH Taskwarrior user. No additional port or Cloudflare policy is needed. Startup probes an existing socket before removing a stale instance and refuses to replace an active socket or ordinary file. The systemd sandbox already allows AF_UNIX and writes in `/opt/aster/data`.
