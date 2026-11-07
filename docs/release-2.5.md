# Aster 2.5 — Restore, reliability and editing details

This release completes the remaining reliability and editing work across web and TinyCast. Focus review and Upcoming remain deferred.

## User-visible changes

- Timer history failures are explicitly unavailable. The UI hides computed energy and durations, disables new starts and Elixir, retains Stop, and offers Retry. Invalid timer JSON and invalid calendar dates are errors rather than zero time.
- `Data & recovery` has Deleted tasks and Backups tabs. Backups support export, file validation, a current-versus-backup preview and explicit workspace replacement. A downloadable restore point is created before every replacement. Counts include native projects and labels as well as saved definitions.
- Web task labels are searchable and multiselect, support new labels, reflect selection and clear search on closing. Mobile inputs and search use 16px to avoid Safari focus zoom, with larger touch targets; desktop properties retain 36px/14px sizing.
- Repeating occurrences inherit their series' initial explicitly assigned board column. A direct placement on an occurrence wins. Moving that occurrence later does not move its siblings or change the series home. Deleted columns fall back to Unsectioned.
- TinyCast keeps two commands, My Tasks and Quick Add Task. Full task forms add native label selection, new labels, Repeat/Ends and notes. My Tasks adds Manage Notes, Edit Series and Data & Recovery; the latter lists deleted tasks and hands off full backup management to the browser.
- Shared TinyCast writes use the existing private RN socket and source identity check. Deletion uses the same recovery journal as web. Standalone native mode remains available when shared workspace is disabled; it has no shared deletion snapshot.

## Whole-workspace restoration

The restore UI accepts an Aster version 1 JSON backup, up to 8 MB. A complete timer-history section is required. It validates UUIDs, dates, organization structures, colors, filters, Focus limits and custom-field definitions. Credentials and arbitrary Taskwarrior configuration cannot be imported.

Tasks and Timewarrior intervals are reconstructed in private temporary native databases first. Both commands must prove that they honor the temporary database paths. Native exports are compared with the requested backup; unsupported data is rejected before replacing live files. SQLite copies receive integrity checks.

Before committing, the server waits for in-flight web/private-socket operations, rejects new requests with 423, and checks that the workspace has not changed since preview. It saves a before-restore JSON and SQLite snapshot. Native database files, timer data, organization, recovery journal and restored field definitions are switched with a durable manifest. A failed switch rolls back; startup repairs an interrupted switch before opening HTTP or the workspace socket. The native data and workspace must share a filesystem, as they do on RN.

Stop current timers and close other native CLI clients before applying a restore. The server cannot lock independent CLI processes; it checks native data again immediately before the switch. Restored task starts are cleared and open backup intervals end at the export timestamp. Timers are not restarted. Restored metadata receives a new revision so older clients cannot overwrite it.

Timewarrior 1.7.1 has no import command on RN. This version replays intervals through its native track/tag/annotate operations in staging and verifies exact times, tags and annotations. A timer record that cannot be reproduced by the installed native version causes a clear failure before live changes.

Restore points live in `/opt/aster/data/restore-points/`; `restored-uda.json` holds only restored custom-field definitions. Keep both in release backups. Recovery and restore points are private files, separate from immutable releases. No automatic retention deletion is introduced.

## Validation

- 52 core tests, 26 web model/recovery/restore tests and 7 HTTP/authentication tests: 85 total. Type checks, ESLint, web build and native extension build pass.
- Disposable RN Taskwarrior 3.5.0 / Timewarrior 1.7.1 databases: full task states, UDA, annotations, recurrence templates/instances, projects, filters, board placements, recovery entries and timer data survive import. Changed previews are rejected. Running snapshots restore stopped.
- Native timer failure: energy is unavailable; Start and Elixir fail without changing state; an already-started task can still be stopped.
- Simulated interrupted replacement repairs on startup. Restored field definitions survive a normal cold start, with a regression test for version detection.
- The private TinyCast bridge rejects a mismatched source and exercises add, complete, recoverable deletion, recovery listing and restoration against the same native task UUID.
- Browser: existing and new labels selected, saved and reopened; full backup preview and confirmation executed only on synthetic data. A 7-task workspace restores to the 6-task backup while the previous task and label data remain in a downloadable restore point. The 320px restore preview scrolls internally without horizontal overflow.
- Final mobile build: label trigger and search both measure 44px high with 16px text at 320px; document width and scroll width both measure 320px. No browser console errors were captured.

Production data is backed up before release; synthetic tasks are confined to the temporary QA databases.

## Deployment record

- RN release: `/opt/aster/releases/20261104-2.5.0`; previous release: `/opt/aster/releases/20261103-reliability`.
- Pre-release backup: `/opt/aster/backups/before-2.5-20261104T151637Z`, including an integrity-checked SQLite snapshot, timer data and workspace metadata.
- Health returns 200. Anonymous task, export, recovery and backup APIs return 401. Organization checksum remained unchanged during deployment.
- TinyCast 2.5.0 was imported successfully; installed My Tasks and Quick Add bundles match the final build. My Tasks connects to RN and Data & Recovery loads the deleted-task list.
- Authenticated public-page acceptance remains unverified: both the in-app browser and the Safari Aster tab redirect to Cloudflare Access on a fresh navigation. No authentication policy was changed, and no production restore was attempted.
