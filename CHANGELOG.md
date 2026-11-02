# 2.4.0 — Daily energy & Timewarrior

- Track daily energy (100 base points, reset at 06:00) backed by Taskwarrior and Timewarrior.
- Starting or completing a task deducts a 5-point entry cost; active Timewarrior focus deducts 1 point per 3 minutes.
- Stopping an uncompleted task refunds its entry cost; accidental starts stopped within 60 seconds incur no cost.
- Block starting new tasks at 0 remaining energy with an option to restore +30 points via Elixir.

# 2.3.0 — Project colors

- Projects and subprojects use the same color palette and picker as filters and labels.
- Project icons stay consistent in sidebar trees, Focus, task rows and project selectors.
- TinyCast supports project colors in its editor and project navigation.
- Existing projects default to gray; older clients, branch moves and status changes preserve saved colors.

# 2.2.0 — Nested projects

- Expand and collapse arbitrary-depth project trees; search retains matching ancestors.
- Add subprojects and move branches using Parent project in web and TinyCast editors.
- Rename and remove complete branches while preserving task UUIDs, completion and board placement.
- Update descendant filter paths and clear next-step pointers when tasks leave a goal.
- Subprojects inherit their active ancestor's Focus slot; overlapping active goals remain blocked.

# 2.1.0

- Focus opens with up to three active projects, a finish line and one selected next step each.
- Later, pause, completion and atomic project replacement retain tasks and board positions.
- TinyCast shares the same server-enforced slots through the existing RN SSH connection.

# Changelog

## 2.0.0 — 2026-10-18

- Adapt the web workflow to TinyCast: expression capture with live preview, draft recovery and a full-field editor.
- Add project, label, native expression, saved filter and board-column views.
- Share web workspace metadata through a connection-checked local API; move columns independently of task status.
- Add completion undo and project descriptions; keep Taskwarrior available independently of the web service.
