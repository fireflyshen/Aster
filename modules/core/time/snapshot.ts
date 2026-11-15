import { computeDurationCostCents, normalizeHourlyRateCents } from "./cost.ts";
import type { TaskCostSummary, TimerSnapshot } from "./model.ts";

export type TrackedTimerSnapshot = {
    snapshot: TimerSnapshot;
    receivedMonoMs: number;
};

/**
 * Returns true if `incoming` is strictly newer than or equal in monotonic
 * causality to `current`, preventing out-of-order responses from regressing state.
 */
export function isSnapshotNewerOrEqual(
    incoming: TimerSnapshot,
    current: TimerSnapshot | null | undefined,
): boolean {
    if (!current) return true;
    if (incoming.timeEpoch !== current.timeEpoch) {
        return incoming.timeEpoch > current.timeEpoch;
    }
    if (incoming.taskDataEpoch !== current.taskDataEpoch) {
        return incoming.taskDataEpoch > current.taskDataEpoch;
    }
    if (incoming.sessionVersion !== current.sessionVersion) {
        return incoming.sessionVersion > current.sessionVersion;
    }
    const nextAt = Date.parse(incoming.snapshotAt);
    const currAt = Date.parse(current.snapshotAt);
    if (!Number.isFinite(nextAt)) return false;
    if (!Number.isFinite(currAt)) return true;
    return nextAt >= currAt;
}

export function mergeTimerSnapshot(
    current: TrackedTimerSnapshot | null | undefined,
    incoming: TimerSnapshot,
    receivedMonoMs: number,
): TrackedTimerSnapshot {
    if (!current || isSnapshotNewerOrEqual(incoming, current.snapshot)) {
        return {
            snapshot: incoming,
            receivedMonoMs,
        };
    }
    return current;
}

export function snapshotLiveStatus(
    tracked: TrackedTimerSnapshot | null | undefined,
    currentMonoMs: number,
): {
    canTick: boolean;
    expired: boolean;
    cappedExtraSeconds: number;
    stateLabel:
        | "live"
        | "stale"
        | "pending_reconcile"
        | "restoring"
        | "unavailable"
        | "review_required"
        | "idle";
} {
    if (!tracked) {
        return {
            canTick: false,
            expired: true,
            cappedExtraSeconds: 0,
            stateLabel: "unavailable",
        };
    }
    const { snapshot, receivedMonoMs } = tracked;
    if (snapshot.state === "restoring") {
        return {
            canTick: false,
            expired: false,
            cappedExtraSeconds: 0,
            stateLabel: "restoring",
        };
    }
    if (snapshot.state === "unavailable") {
        return {
            canTick: false,
            expired: false,
            cappedExtraSeconds: 0,
            stateLabel: "unavailable",
        };
    }
    if (snapshot.state === "pending_reconcile") {
        return {
            canTick: false,
            expired: false,
            cappedExtraSeconds: 0,
            stateLabel: "pending_reconcile",
        };
    }
    const active = snapshot.activeActivity;
    if (!active) {
        return {
            canTick: false,
            expired: false,
            cappedExtraSeconds: 0,
            stateLabel: "idle",
        };
    }
    if (active.state === "review_required" || active.suspendAt) {
        return {
            canTick: false,
            expired: false,
            cappedExtraSeconds: 0,
            stateLabel: "review_required",
        };
    }
    const snapAtMs = Date.parse(snapshot.snapshotAt);
    const liveUntilMs = Date.parse(snapshot.liveUntil);
    let maxLiveMs =
        Number.isFinite(snapAtMs) && Number.isFinite(liveUntilMs)
            ? Math.max(0, liveUntilMs - snapAtMs)
            : 0;
    let autoStopMs = Number.NaN;
    if (active.autoStopAt && Number.isFinite(snapAtMs)) {
        autoStopMs = Date.parse(active.autoStopAt);
        if (Number.isFinite(autoStopMs)) {
            maxLiveMs = Math.min(maxLiveMs, Math.max(0, autoStopMs - snapAtMs));
        }
    }
    const elapsedMonoMs = Math.max(0, currentMonoMs - receivedMonoMs);
    const hitAutoStop =
        Number.isFinite(autoStopMs) &&
        Number.isFinite(snapAtMs) &&
        snapAtMs + elapsedMonoMs >= autoStopMs;
    const expired = hitAutoStop || elapsedMonoMs > maxLiveMs;
    const cappedExtraSeconds = Math.floor(
        Math.min(elapsedMonoMs, maxLiveMs) / 1000,
    );
    return {
        canTick: !expired,
        expired,
        cappedExtraSeconds,
        stateLabel: expired ? "stale" : "live",
    };
}

/**
 * Returns displayed cumulative seconds for a task under a Time snapshot.
 * Returns `undefined` when the snapshot omits this task key (unknown -> display "—"),
 * keeping explicit `0` as `0`. Never extrapolates for non-active tasks or when
 * snapshot is non-ready / review_required / expired beyond liveUntil.
 */
export function displayedTaskSecondsFromSnapshot(
    tracked: TrackedTimerSnapshot | null | undefined,
    taskUuid: string,
    currentMonoMs: number,
): number | undefined {
    if (!tracked) return undefined;
    const { snapshot } = tracked;
    const key = taskUuid.toLowerCase();
    if (
        !Object.prototype.hasOwnProperty.call(snapshot.taskTotalsSeconds, key)
    ) {
        return undefined;
    }
    const base = snapshot.taskTotalsSeconds[key];
    if (typeof base !== "number" || !Number.isFinite(base)) {
        return undefined;
    }
    const live = snapshotLiveStatus(tracked, currentMonoMs);
    const active = snapshot.activeActivity;
    if (
        active &&
        active.state === "running" &&
        active.taskUuid?.toLowerCase() === key &&
        snapshot.state === "ready"
    ) {
        return base + live.cappedExtraSeconds;
    }
    return base;
}

/**
 * Returns elapsed seconds for the global active activity banner (including non-task
 * activities like walking/sleeping). Stops advancing at `suspendAt`, when
 * `pending_reconcile`/`restoring`/`unavailable`, or beyond `liveUntil`.
 */
export function displayedActiveActivitySeconds(
    tracked: TrackedTimerSnapshot | null | undefined,
    currentMonoMs: number,
): number | undefined {
    const active = tracked?.snapshot.activeActivity;
    if (!tracked || !active) return undefined;
    const startedMs = Date.parse(active.startedAt);
    const snapAtMs = Date.parse(tracked.snapshot.snapshotAt);
    if (!Number.isFinite(startedMs) || !Number.isFinite(snapAtMs)) {
        return undefined;
    }
    if (active.suspendAt) {
        const suspendMs = Date.parse(active.suspendAt);
        if (Number.isFinite(suspendMs)) {
            return Math.max(0, Math.floor((suspendMs - startedMs) / 1000));
        }
    }
    const maxAutoStopSeconds = active.autoStopAt
        ? (() => {
              const autoStopMs = Date.parse(active.autoStopAt);
              return Number.isFinite(autoStopMs)
                  ? Math.max(0, Math.floor((autoStopMs - startedMs) / 1000))
                  : undefined;
          })()
        : undefined;
    const baseAtSnap = Math.max(0, Math.floor((snapAtMs - startedMs) / 1000));
    const clampedBase =
        maxAutoStopSeconds !== undefined
            ? Math.min(baseAtSnap, maxAutoStopSeconds)
            : baseAtSnap;
    if (tracked.snapshot.state !== "ready" || active.state !== "running") {
        return clampedBase;
    }
    const live = snapshotLiveStatus(tracked, currentMonoMs);
    const total = clampedBase + live.cappedExtraSeconds;
    return maxAutoStopSeconds !== undefined
        ? Math.min(total, maxAutoStopSeconds)
        : total;
}

export function displayedActiveActivityCostCents(
    tracked: TrackedTimerSnapshot | null | undefined,
    currentMonoMs: number,
): number | undefined {
    const active = tracked?.snapshot.activeActivity;
    const elapsed = displayedActiveActivitySeconds(tracked, currentMonoMs);
    if (!tracked || !active || elapsed === undefined) return undefined;
    const rate = normalizeHourlyRateCents(
        active.hourlyRateCents ?? tracked.snapshot.hourlyRateCents,
    );
    return computeDurationCostCents(elapsed, rate);
}

export function displayedTaskCostFromSnapshot(
    tracked: TrackedTimerSnapshot | null | undefined,
    taskUuid: string,
    currentMonoMs: number,
): TaskCostSummary | undefined {
    if (!tracked) return undefined;
    const key = taskUuid.toLowerCase();
    const base = tracked.snapshot.taskCosts?.[key];
    if (!base) return undefined;
    const live = snapshotLiveStatus(tracked, currentMonoMs);
    const active = tracked.snapshot.activeActivity;
    if (
        active &&
        active.state === "running" &&
        active.taskUuid?.toLowerCase() === key &&
        tracked.snapshot.state === "ready" &&
        live.cappedExtraSeconds > 0
    ) {
        const rate = normalizeHourlyRateCents(
            active.hourlyRateCents ?? tracked.snapshot.hourlyRateCents,
            base.currentHourlyRateCents,
        );
        const provisionalSeconds =
            base.provisionalSeconds + live.cappedExtraSeconds;
        const extraProvisionalCost = computeDurationCostCents(
            live.cappedExtraSeconds,
            rate,
        );
        return {
            ...base,
            provisionalSeconds,
            provisionalCostCents:
                base.provisionalCostCents + extraProvisionalCost,
        };
    }
    return base;
}
