import {
  addLocalDays,
  localDateOf,
  zonedDateTimeToUtcMs,
} from "../../../core/time/zone.ts";
import type { TaskStateManager } from "./state-changes.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export type StateAutoTransitionScheduler = ReturnType<
  typeof createStateTransitionScheduler
>;

/**
 * Background scheduler for Aster's task state machine.
 * Polls every 60s and triggers immediately at 00:00:05 in the workspace timezone
 * while holding `gate.enter()` so backup/restore locks are respected.
 */
export function createStateTransitionScheduler(deps: {
  stateManager: TaskStateManager;
  gate: { enter: () => () => void };
  getTimezone: () => string;
  now?: () => number;
  pollIntervalMs?: number;
  onPromoted?: (promotedUuids: string[]) => void;
}) {
  const nowFn = deps.now ?? (() => Date.now());
  const pollMs = Math.max(
    1_000,
    deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );

  let stopped = false;
  let midnightTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<{
    skipped?: "stopped" | "locked";
    promoted: string[];
  }> | null = null;

  function clearMidnightTimer(): void {
    if (midnightTimer !== undefined) {
      clearTimeout(midnightTimer);
      midnightTimer = undefined;
    }
  }

  function armMidnightTimer(): void {
    if (stopped) return;
    clearMidnightTimer();
    const tz = deps.getTimezone() || "Asia/Shanghai";
    const nowMs = nowFn();
    const todayStr = localDateOf(nowMs, tz);
    let targetMs = zonedDateTimeToUtcMs(todayStr, "00:00:05", tz);
    if (targetMs <= nowMs) {
      targetMs = zonedDateTimeToUtcMs(
        addLocalDays(todayStr, 1),
        "00:00:05",
        tz,
      );
    }
    const delayMs = Math.min(MAX_TIMEOUT_MS, Math.max(50, targetMs - nowMs));
    midnightTimer = setTimeout(() => {
      midnightTimer = undefined;
      void tickNow();
    }, delayMs);
    if (typeof midnightTimer.unref === "function") {
      midnightTimer.unref();
    }
  }

  async function tickNow(): Promise<{
    skipped?: "stopped" | "locked";
    promoted: string[];
  }> {
    if (stopped) return { skipped: "stopped", promoted: [] };
    if (running) return running;

    running = (async () => {
      let release: (() => void) | undefined;
      try {
        release = deps.gate.enter();
      } catch {
        return { skipped: "locked" as const, promoted: [] };
      }
      try {
        const res = await deps.stateManager.runAutoPromotions();
        if (res.promoted.length > 0) {
          deps.onPromoted?.(res.promoted);
        }
        armMidnightTimer();
        return res;
      } catch (error) {
        console.error(
          "[aster] State transition scheduler tick failed:",
          error instanceof Error ? error.message : String(error),
        );
        armMidnightTimer();
        return { promoted: [] };
      } finally {
        release();
      }
    })();

    try {
      return await running;
    } finally {
      running = null;
    }
  }

  function start(): void {
    if (stopped) return;
    armMidnightTimer();
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        void tickNow();
      }, pollMs);
      if (typeof pollTimer.unref === "function") {
        pollTimer.unref();
      }
    }
    void tickNow();
  }

  function stop(): void {
    stopped = true;
    clearMidnightTimer();
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  return {
    start,
    stop,
    tickNow,
  };
}
