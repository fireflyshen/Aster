import {
    computeContinuationCostPreview,
    computeDurationCostCents,
    formatCurrencyCny,
    formatRateConversionHint,
    normalizeHourlyRateCents,
    yuanToHourlyRateCents,
} from "../../../core/time/cost.ts";
import {
    DEFAULT_HOURLY_RATE_CENTS,
    type TaskCostSummary,
    type TimingPlan,
} from "../../../core/time/model.ts";
import { addLocalDays, localDateOf } from "../../../core/time/zone.ts";
import { WorkspaceError } from "../../../core/workspace/client.ts";

export {
    addLocalDays,
    computeContinuationCostPreview,
    computeDurationCostCents,
    DEFAULT_HOURLY_RATE_CENTS,
    formatCurrencyCny,
    formatRateConversionHint,
    localDateOf,
    normalizeHourlyRateCents,
    yuanToHourlyRateCents,
};

/** Formats a duration in seconds concisely (e.g. `45m`, `1h30m`, `2h`). */
export function formatDurationShort(seconds: number): string {
    const safe = Math.max(0, Math.round(seconds));
    if (safe < 60) return `${safe}s`;
    const totalMinutes = Math.floor(safe / 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h${mins}m`;
}

/** Formats duration in Chinese readable form for cost previews (`1 小时 30 分钟`). */
export function formatDurationCn(seconds: number): string {
    const safe = Math.max(0, Math.round(seconds));
    const totalMinutes = Math.round(safe / 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins} 分钟`;
    if (mins === 0) return `${hours} 小时`;
    return `${hours} 小时 ${mins} 分钟`;
}

export function formatClockTime(ms: number): string {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "--:--";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

export function formatDateAndClock(ms: number): string {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "--";
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${m}-${day} ${formatClockTime(ms)}`;
}

export function formatClockRange(startMs: number, endMs: number): string {
    return `${formatClockTime(startMs)}–${formatClockTime(endMs)}`;
}

/** Formats remaining auto-stop text from an autoStopAt ISO string or millisecond timestamp. */
export function formatAutoStopCountdown(
    autoStopAt: string | number | undefined,
    nowMs = Date.now(),
): string | undefined {
    if (autoStopAt === undefined) return undefined;
    const stopMs =
        typeof autoStopAt === "number" ? autoStopAt : Date.parse(autoStopAt);
    if (!Number.isFinite(stopMs)) return undefined;
    const remSec = Math.max(0, Math.floor((stopMs - nowMs) / 1000));
    const clock = formatClockTime(stopMs);
    if (remSec <= 0) {
        return `到限 ${clock}`;
    }
    const remMin = Math.max(1, Math.ceil(remSec / 60));
    return `剩余 ${remMin} 分钟 · ${clock} 停`;
}

export function normalizeClockInput(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!match) return "INVALID";
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "INVALID";
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function parsePositiveMinutes(
    raw: string,
): number | undefined | "INVALID" {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || n > 1440 * 7) return "INVALID";
    return Math.round(n);
}

export function localTimeDate(utcMs: number, timeZone?: string): string {
    const tz =
        timeZone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "Asia/Shanghai";
    return localDateOf(utcMs, tz);
}

export function timingPlanStatusLabel(plan: TimingPlan): string {
    switch (plan.status) {
        case "scheduled":
            return "未开始";
        case "active":
            return "运行中";
        case "paused":
            return "已暂停";
        case "stopped":
            return "已停止";
        case "expired":
            return "已过期";
        case "archived":
            return "已归档";
        default:
            return plan.status;
    }
}

export function formatTaskBudgetLine(summary: TaskCostSummary): string {
    if (!summary.hasBudget) return "未设预算";
    const init = formatCurrencyCny(summary.initialBudgetCents ?? 0);
    const cur = formatCurrencyCny(summary.currentBudgetCents ?? 0);
    const dur = summary.currentAllowanceSeconds
        ? ` · ${formatDurationCn(summary.currentAllowanceSeconds)}`
        : "";
    if (summary.addedBudgetCents > 0) {
        return `当前预算 ${cur}（最初 ${init}，已追加 ${formatCurrencyCny(summary.addedBudgetCents)}）${dur}`;
    }
    return `预计预算 ${init}${dur}`;
}

export function formatProjectAndTags(
    projectSnapshot?: string,
    tags?: readonly string[],
    categoryId?: string,
): string {
    const parts: string[] = [];
    if (categoryId === "sleep") parts.push("睡眠 (¥0)");
    if (projectSnapshot) parts.push(projectSnapshot);
    if (tags && tags.length > 0) {
        parts.push(tags.map((t) => `#${t}`).join(" "));
    }
    return parts.join(" · ") || "未关联项目/标签";
}

export function formatTimeActionError(error: unknown): string {
    if (error instanceof WorkspaceError) {
        if (error.serverCode === "PLAN_EXPIRED") {
            return `${error.message}（可修改最晚停止时刻后重新开始）`;
        }
        if (error.serverCode === "PLAN_EXHAUSTED") {
            return `${error.message}（可先追加时长后继续）`;
        }
        if (error.serverCode === "INTERVAL_CONFLICT") {
            return "时段与已有记录重叠，请调整开始或结束时刻。";
        }
        return error.message;
    }
    return error instanceof Error ? error.message : String(error);
}
