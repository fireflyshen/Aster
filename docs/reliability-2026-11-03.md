# Recovery, export, recurrence and notes · 2026-11-03

The whole-workspace importer, timer error states and TinyCast recovery bridge are added in [2.5](release-2.5.md). This document records the earlier release.

## User-facing scope

- `Data & recovery` in the sidebar: searchable deleted tasks, Restore, and Export all data.
- The task editor offers native Taskwarrior repetition: daily, weekdays, weekly, biweekly, monthly, quarterly and yearly, with an optional final date. A first due date is required.
- An occurrence can be completed, edited or deleted independently. `Edit series` changes future occurrences; `Stop series` keeps existing tasks and moves the template into recovery.
- Notes are native Taskwarrior annotations. Add multiline notes, view existing notes and remove one after confirmation. Updating another field preserves notes; adding a note appends rather than replacing existing notes.
- Project-manager hover covers the name, state, count and actions together. The series editor is a subview of the task editor; it keeps the draft and avoids overlapping modals. Desktop controls stay compact; mobile controls retain larger touch targets and a fixed Save area.
- Focus review and Upcoming remain deferred.

## Recovery boundaries

Web deletions first save the raw task and board position in `recovery.json`, alongside `organization.json`. The file is atomic, mode 0600, outside release folders. Native UUID, original completion/waiting state, completion date, annotations and custom fields survive restore. Active timers stay stopped. If a column no longer exists, recovery uses Unsectioned. A newer explicit board placement wins.

The journal is written before deletion. A lost response is never retried automatically. Recovery checks native state after restart; a partially finished restore can finish board recovery without restoring the native task twice. Invalid journal data stops destructive writes rather than silently replacing the file.

Older or direct CLI/TinyCast deletions have no web pre-delete snapshot. If Taskwarrior retains the task, the UI explicitly labels the unknown original state and restores it as pending (or recurring for a template). They cannot be recovered here once Taskwarrior purges them. New web snapshots remain available after a native purge. There is no purge button or automatic journal expiry.

## Export format

`GET /api/export`, protected by the same Access JWT verification, downloads an `aster-backup`, version 1 JSON document containing:

- Raw Taskwarrior tasks across all states, including deleted tasks, recurring templates, parents, annotations, dependencies and custom attributes; plus `uda.*` definitions only.
- Persisted organization revision, project hierarchy/descriptions/colors/goals, filters, labels, board columns/placements/order, and energy metadata.
- Recovery journal.
- Raw Timewarrior intervals, including tags and unfinished intervals. If Timewarrior is unavailable, the download explicitly records `available: false`, `intervals: null` and a warning; it never claims an empty successful history.

No environment file, SSH credentials, Taskwarrior sync credentials or Cloudflare tokens are exported. Capture start/end timestamps are included. Metadata revision changes cause a read-only retry; simultaneous external CLI writes are not a cross-process transaction. Export after other writes finish when a stable snapshot matters.

This release provides download and deleted-task recovery, not an automatic whole-workspace import UI. A native restore should be rehearsed in a separate Taskwarrior database: configure the exported UDA definitions, pass `taskwarrior.tasks` as JSON to `task import -`, then compare UUIDs/statuses/notes before restoring production. Organization and recovery files are restored separately while Aster is stopped. Timewarrior intervals are archival data; no Timewarrior importer is added in this release.

## Recurrence behavior

Taskwarrior's recurring template owns the schedule. Native report generation, serialized with Aster's writes and throttled to once per minute, creates the occurrences. Each has a separate UUID and a `parent` link. Saved filters hide templates; they show actionable occurrences.

Completing an occurrence does not immediately create another when the next period is still outside Taskwarrior's generation window. Editing a series affects future generation; existing occurrences keep their current properties. This is calendar repetition, not “repeat N days after completion.” New occurrences start without an explicit Aster board placement unless separately moved.

## Validation evidence

- Isolated RN Taskwarrior 3.5.0 and Timewarrior 1.7.1 databases: native generation, all seven intervals, conversion of an existing task, literal multiline annotations, precise note removal, preservation of custom attributes and other notes.
- Delete/restore across server restart: original UUID, completed state/date, waiting state and board placement; running tasks restore stopped.
- Stop/restore template keeps existing occurrences. Direct CLI deletion has explicit fallback. Native-purged task restored from the web snapshot.
- Export with a real temporary Timewarrior interval; UDA definitions and raw tasks re-imported into a second empty native database. UUIDs, states, dates, notes, parent links, recurrence and custom fields compared.
- Automated failure tests: lost delete response, restart, metadata recovery failure and later completion without duplicate native restore; stale or invalid commands rejected before writes.

All test records are synthetic and isolated from the live task database.

## Release verification

50 core tests, 20 web model/recovery tests and 7 HTTP/authentication tests passed (77 total), along with type checks, ESLint and production build. Browser validation used synthetic tasks at 1280×800, 375×812 and 320×640 in Light/Dark appearance. Desktop property controls measured 36px/14px; mobile repeat/end controls 44px, with no horizontal page overflow at 320px. Notes were saved and reopened, a deleted task was restored, and the JSON download completed through the browser. No browser console errors were observed.

Published to `/opt/aster/releases/20261103-reliability`; backup `/opt/aster/backups/before-reliability-20261103T154855Z`. Live health is 200; unauthenticated export is 401; the public domain redirects to its existing Access login. Production organization checksum is unchanged. Browser authentication is expired, so signed-in production task writes were not used for acceptance. The full functional rehearsal used separate native databases.
