import type { TimeEvent } from "../../../core/time/model.ts";
import type { TimeStore } from "./time-store.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_POLL_INTERVAL_MS = 30_000;

export type TimeAutoStopScheduler = ReturnType<
    typeof createTimeAutoStopScheduler
>;

/**
 * Reliable background deadline scheduler for Aster Time V1.
 * Respects `gate.enter()` so it never bypasses an exclusive restore lock,
 * settles overdue timers strictly at persisted `autoStopAtMs`, and relies on
 * transactional version checks + dedup keys inside `time-store` so late wakeups
 * or duplicate triggers never double-settle or revive closed segments.
 */
export function createTimeAutoStopScheduler(deps: {
    store: TimeStore;
    gate: { enter: () => () => void };
    now?: () => number;
    pollIntervalMs?: number;
    onSettled?: (result: { settled: boolean; event?: TimeEvent }) => void;
}) {
    const nowFn = deps.now ?? (() => Date.now());
    const pollMs = Math.max(
        1000,
        deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );

    let stopped = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;

    function clearDeadlineTimer(): void {
        if (deadlineTimer !== undefined) {
            clearTimeout(deadlineTimer);
            deadlineTimer = undefined;
        }
    }

    function arm(): void {
        if (stopped) return;
        clearDeadlineTimer();
        const nextDeadline = deps.store.getNextAutoStopDeadline();
        if (nextDeadline === null) return;
        const delayMs = Math.min(
            MAX_TIMEOUT_MS,
            Math.max(0, nextDeadline - nowFn()),
        );
        deadlineTimer = setTimeout(() => {
            deadlineTimer = undefined;
            tickNow();
        }, delayMs);
        if (typeof deadlineTimer.unref === "function") {
            deadlineTimer.unref();
        }
    }

    function tickNow(): {
        skipped?: "stopped" | "locked";
        settled: boolean;
        event?: TimeEvent;
    } {
        if (stopped) return { skipped: "stopped", settled: false };
        let release: (() => void) | undefined;
        try {
            release = deps.gate.enter();
        } catch {
            // Exclusive restore lock (423) is active: do not touch SQLite while restoring.
            return { skipped: "locked", settled: false };
        }
        try {
            const res = deps.store.settleDueTimers(nowFn());
            if (res.settled || res.event) {
                deps.onSettled?.({ settled: res.settled, event: res.event });
            }
            arm();
            return {
                settled: res.settled,
                ...(res.event ? { event: res.event } : {}),
            };
        } finally {
            release();
        }
    }

    function start(): void {
        if (stopped) return;
        if (!unsubscribe) {
            unsubscribe = deps.store.subscribeScheduleChanges(() => {
                arm();
            });
        }
        if (!pollTimer) {
            pollTimer = setInterval(() => {
                tickNow();
            }, pollMs);
            if (typeof pollTimer.unref === "function") {
                pollTimer.unref();
            }
        }
        tickNow();
    }

    function stop(): void {
        stopped = true;
        clearDeadlineTimer();
        if (pollTimer !== undefined) {
            clearInterval(pollTimer);
            pollTimer = undefined;
        }
        unsubscribe?.();
        unsubscribe = undefined;
    }

    return {
        start,
        stop,
        arm,
        tickNow,
    };
}
