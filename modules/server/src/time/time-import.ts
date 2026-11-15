import { randomUUID } from "node:crypto";
import { parseTaskwarriorDate } from "../../../core/tasks/model.ts";
import { resolveActivityCategory } from "../../../core/time/classification.ts";
import {
  effectiveActivityEndMs,
  intervalsOverlap,
} from "../../../core/time/ledger.ts";
import type { Activity } from "../../../core/time/model.ts";
import {
  canonicalJson,
  hashNormalizedInput,
  TimeStoreError,
  type TimeStore,
} from "./time-store.ts";

export type RawTimewarriorInterval = {
  id?: number;
  start: string;
  end?: string;
  tags?: string[];
  annotation?: string;
};

export type TimewarriorImportPreview = {
  snapshotHash: string;
  cutoverAtMs: number;
  alreadyImportedBatchId?: string;
  totalIntervals: number;
  importableCount: number;
  conflictCount: number;
  skippedAfterCutoverCount: number;
  openAtCutoverCount: number;
  rangeStartMs?: number;
  rangeEndMs?: number;
  openIntervalsAtCutover: Array<{
    batchIndex: number;
    startMs: number;
    taskUuid?: string;
    tags: string[];
    title: string;
  }>;
  conflicts: Array<{
    batchIndex: number;
    startMs: number;
    endMs: number;
    title: string;
    reason: string;
  }>;
};

export type TimewarriorImportResult = {
  batchId: string;
  snapshotHash: string;
  reusedExistingBatch: boolean;
  importedCount: number;
  conflictCount: number;
  skippedCount: number;
  createdActivityIds: string[];
};

const UUID_TAG_PATTERN =
  /^uuid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function extractUuidAndTags(tags: string[] = []): {
  taskUuid?: string;
  cleanTags: string[];
} {
  let taskUuid: string | undefined;
  const cleanTags: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const match = UUID_TAG_PATTERN.exec(trimmed);
    if (match && !taskUuid) {
      taskUuid = match[1].toLowerCase();
    } else {
      cleanTags.push(trimmed);
    }
  }
  return { taskUuid, cleanTags };
}

function canonicalRawForHash(intervals: RawTimewarriorInterval[]) {
  return intervals
    .map((item) => ({
      start: item.start,
      ...(item.end !== undefined ? { end: item.end } : {}),
      tags: [...(item.tags ?? [])].sort(),
      ...(item.annotation ? { annotation: item.annotation } : {}),
    }))
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        String(a.end ?? "").localeCompare(String(b.end ?? "")),
    );
}

export type TaskSnapshotLookup = (taskUuid: string) =>
  | {
      description?: string;
      project?: string;
      tags?: string[];
    }
  | undefined;

export function analyzeTimewarriorSnapshot(
  store: TimeStore,
  input: {
    intervals: RawTimewarriorInterval[];
    cutoverAtMs: number;
    clipOpenToCutover?: boolean;
    taskLookup?: TaskSnapshotLookup;
  },
): {
  preview: TimewarriorImportPreview;
  plan: Array<{
    batchIndex: number;
    raw: RawTimewarriorInterval;
    status: "imported" | "conflict_candidate" | "skipped";
    reason?: string;
    title: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags: string[];
    startMs?: number;
    endMs?: number;
  }>;
} {
  if (!Number.isFinite(input.cutoverAtMs) || input.cutoverAtMs <= 0) {
    throw new TimeStoreError(
      400,
      "INVALID_CUTOVER",
      "A valid Time cutover timestamp is required for historical import.",
    );
  }

  const snapshotHash = hashNormalizedInput("timewarrior_snapshot", {
    cutoverAtMs: input.cutoverAtMs,
    intervals: canonicalRawForHash(input.intervals),
  });

  const existingBatch = store.withConnection((conn) => {
    return conn
      .prepare("SELECT id FROM import_batches WHERE snapshot_hash = ?")
      .get(snapshotHash) as { id: string } | undefined;
  });

  const existingActivities = store
    .queryActivities()
    .filter(
      (a): a is Activity & { startMs: number } =>
        a.kind === "located" &&
        a.reviewState !== "voided" &&
        a.reviewState !== "conflict" &&
        a.startMs !== undefined,
    );

  const acceptedRanges: Array<{ startMs: number; endMs: number }> = [];
  const plan: ReturnType<typeof analyzeTimewarriorSnapshot>["plan"] = [];
  const openIntervalsAtCutover: TimewarriorImportPreview["openIntervalsAtCutover"] =
    [];
  const conflicts: TimewarriorImportPreview["conflicts"] = [];

  let importableCount = 0;
  let conflictCount = 0;
  let skippedAfterCutoverCount = 0;
  let openAtCutoverCount = 0;
  let rangeStartMs: number | undefined;
  let rangeEndMs: number | undefined;

  const sorted = input.intervals
    .map((raw, idx) => ({ raw, idx }))
    .sort((a, b) => a.raw.start.localeCompare(b.raw.start));

  for (const { raw, idx } of sorted) {
    const startDate = parseTaskwarriorDate(raw.start);
    if (!startDate) {
      throw new TimeStoreError(
        400,
        "INVALID_TIMEWARRIOR_INTERVAL",
        `Interval at index ${idx} has an invalid start timestamp.`,
      );
    }
    const startMs = startDate.getTime();
    const { taskUuid, cleanTags } = extractUuidAndTags(raw.tags);
    const taskInfo = taskUuid ? input.taskLookup?.(taskUuid) : undefined;
    const title =
      taskInfo?.description?.trim() ||
      raw.annotation?.trim() ||
      cleanTags[0] ||
      (taskUuid ? `Task ${taskUuid.slice(0, 8)}` : "Imported activity");
    const mergedTags = [...new Set([...cleanTags, ...(taskInfo?.tags ?? [])])];

    if (startMs >= input.cutoverAtMs) {
      skippedAfterCutoverCount++;
      plan.push({
        batchIndex: idx,
        raw,
        status: "skipped",
        reason: "after_cutover",
        title,
        taskUuid,
        projectSnapshot: taskInfo?.project,
        tags: mergedTags,
        startMs,
      });
      continue;
    }

    let endMs: number;
    let clippedReason: string | undefined;
    if (!raw.end) {
      openAtCutoverCount++;
      openIntervalsAtCutover.push({
        batchIndex: idx,
        startMs,
        ...(taskUuid ? { taskUuid } : {}),
        tags: mergedTags,
        title,
      });
      if (!input.clipOpenToCutover) {
        conflictCount++;
        conflicts.push({
          batchIndex: idx,
          startMs,
          endMs: input.cutoverAtMs,
          title,
          reason: "open_interval_at_cutover",
        });
        plan.push({
          batchIndex: idx,
          raw,
          status: "conflict_candidate",
          reason: "open_interval_at_cutover",
          title,
          taskUuid,
          projectSnapshot: taskInfo?.project,
          tags: mergedTags,
          startMs,
          endMs: input.cutoverAtMs,
        });
        continue;
      }
      endMs = input.cutoverAtMs;
      clippedReason = "clipped_open_at_cutover";
    } else {
      const endDate = parseTaskwarriorDate(raw.end);
      if (!endDate || endDate.getTime() <= startMs) {
        skippedAfterCutoverCount++;
        plan.push({
          batchIndex: idx,
          raw,
          status: "skipped",
          reason: "empty_or_invalid_end",
          title,
          taskUuid,
          projectSnapshot: taskInfo?.project,
          tags: mergedTags,
          startMs,
        });
        continue;
      }
      endMs = Math.min(endDate.getTime(), input.cutoverAtMs);
      if (endDate.getTime() > input.cutoverAtMs) {
        clippedReason = "clipped_at_cutover";
      }
    }

    const overlapsExisting = existingActivities.some((act) => {
      const actEnd = effectiveActivityEndMs(act, input.cutoverAtMs);
      return (
        actEnd !== undefined &&
        intervalsOverlap(startMs, endMs, act.startMs, actEnd)
      );
    });
    const overlapsInBatch = acceptedRanges.some((range) =>
      intervalsOverlap(startMs, endMs, range.startMs, range.endMs),
    );

    if (overlapsExisting || overlapsInBatch) {
      conflictCount++;
      const reason = overlapsExisting
        ? "overlaps_existing_activity"
        : "overlaps_within_snapshot";
      conflicts.push({ batchIndex: idx, startMs, endMs, title, reason });
      plan.push({
        batchIndex: idx,
        raw,
        status: "conflict_candidate",
        reason,
        title,
        taskUuid,
        projectSnapshot: taskInfo?.project,
        tags: mergedTags,
        startMs,
        endMs,
      });
      continue;
    }

    acceptedRanges.push({ startMs, endMs });
    importableCount++;
    rangeStartMs =
      rangeStartMs === undefined ? startMs : Math.min(rangeStartMs, startMs);
    rangeEndMs = rangeEndMs === undefined ? endMs : Math.max(rangeEndMs, endMs);

    plan.push({
      batchIndex: idx,
      raw,
      status: "imported",
      reason: clippedReason,
      title,
      taskUuid,
      projectSnapshot: taskInfo?.project,
      tags: mergedTags,
      startMs,
      endMs,
    });
  }

  return {
    preview: {
      snapshotHash,
      cutoverAtMs: input.cutoverAtMs,
      ...(existingBatch ? { alreadyImportedBatchId: existingBatch.id } : {}),
      totalIntervals: input.intervals.length,
      importableCount,
      conflictCount,
      skippedAfterCutoverCount,
      openAtCutoverCount,
      ...(rangeStartMs !== undefined ? { rangeStartMs } : {}),
      ...(rangeEndMs !== undefined ? { rangeEndMs } : {}),
      openIntervalsAtCutover,
      conflicts,
    },
    plan,
  };
}

export function applyTimewarriorSnapshotImport(
  store: TimeStore,
  input: {
    intervals: RawTimewarriorInterval[];
    cutoverAtMs: number;
    clipOpenToCutover?: boolean;
    taskLookup?: TaskSnapshotLookup;
    nowMs?: number;
  },
): TimewarriorImportResult {
  const { preview, plan } = analyzeTimewarriorSnapshot(store, input);
  const ts = input.nowMs ?? Date.now();

  return store.withConnection((conn) => {
    const existing = conn
      .prepare(
        "SELECT id, imported_count, conflict_count, skipped_count, meta_json FROM import_batches WHERE snapshot_hash = ?",
      )
      .get(preview.snapshotHash) as
      | {
          id: string;
          imported_count: number;
          conflict_count: number;
          skipped_count: number;
          meta_json: string;
        }
      | undefined;

    if (existing) {
      const meta = JSON.parse(existing.meta_json) as {
        createdActivityIds?: string[];
      };
      return {
        batchId: existing.id,
        snapshotHash: preview.snapshotHash,
        reusedExistingBatch: true,
        importedCount: existing.imported_count,
        conflictCount: existing.conflict_count,
        skippedCount: existing.skipped_count,
        createdActivityIds: meta.createdActivityIds ?? [],
      };
    }

    const metaRow = conn
      .prepare("SELECT policy_json, cutover_at_ms FROM time_meta WHERE id = 1")
      .get() as { policy_json: string; cutover_at_ms: number | null };
    const policy = JSON.parse(metaRow.policy_json);

    const batchId = randomUUID();
    const createdActivityIds: string[] = [];

    conn
      .prepare(
        `INSERT INTO import_batches (
          id, snapshot_hash, cutover_ms, range_start_ms, range_end_ms,
          imported_count, conflict_count, skipped_count, meta_json, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        batchId,
        preview.snapshotHash,
        input.cutoverAtMs,
        preview.rangeStartMs ?? null,
        preview.rangeEndMs ?? null,
        preview.importableCount,
        preview.conflictCount,
        preview.skippedAfterCutoverCount,
        JSON.stringify({ createdActivityIds }),
        ts,
      );

    for (const item of plan) {
      const sourceRecordId = randomUUID();
      let activityId: string | null = null;

      if (
        item.status === "imported" &&
        item.startMs !== undefined &&
        item.endMs !== undefined
      ) {
        activityId = randomUUID();
        createdActivityIds.push(activityId);
        const classified = resolveActivityCategory(policy, {
          taskUuid: item.taskUuid,
          project: item.projectSnapshot,
          tags: item.tags,
        });
        conn
          .prepare(
            `INSERT INTO activities (
              id, version, kind, title, category_id, rule_version, rule_source,
              task_uuid, project_snapshot, start_ms, end_ms, suspend_ms,
              window_start_ms, window_end_ms, target_date, estimated_seconds,
              precision, source, review_state, raw_input, note, timezone,
              import_batch_id, source_record_id, candidate_key,
              created_at_ms, updated_at_ms
            ) VALUES (?, 1, 'located', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'exact', 'timewarrior_import', 'ok', NULL, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(
            activityId,
            item.title,
            classified.categoryId,
            classified.ruleVersion,
            classified.ruleSource,
            item.taskUuid ?? null,
            item.projectSnapshot ?? null,
            item.startMs,
            item.endMs,
            item.raw.annotation ?? null,
            policy.timezone,
            batchId,
            sourceRecordId,
            ts,
            ts,
          );
      }

      conn
        .prepare(
          `INSERT INTO source_records (id, batch_id, batch_index, raw_json, activity_id, status, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceRecordId,
          batchId,
          item.batchIndex,
          canonicalJson(item.raw),
          activityId,
          item.status,
          item.reason ?? null,
        );
    }

    conn
      .prepare("UPDATE import_batches SET meta_json = ? WHERE id = ?")
      .run(JSON.stringify({ createdActivityIds }), batchId);

    if (metaRow.cutover_at_ms === null) {
      conn
        .prepare(
          "UPDATE time_meta SET cutover_at_ms = ?, updated_at_ms = ? WHERE id = 1",
        )
        .run(input.cutoverAtMs, ts);
    }

    return {
      batchId,
      snapshotHash: preview.snapshotHash,
      reusedExistingBatch: false,
      importedCount: preview.importableCount,
      conflictCount: preview.conflictCount,
      skippedCount: preview.skippedAfterCutoverCount,
      createdActivityIds,
    };
  });
}
