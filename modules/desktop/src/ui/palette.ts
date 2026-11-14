import { Color, environment } from "@raycast/api";

export type AsterTone =
    | "overdue"
    | "p1"
    | "p2"
    | "p3"
    | "today"
    | "tomorrow"
    | "waiting"
    | "timer"
    | "completed"
    | "favorite";

const LIGHT_TONES: Record<AsterTone, string> = {
    overdue: "#c9443b",
    p1: "#c9443b",
    p2: "#d17a15",
    p3: "#366db8",
    today: "#1e7e40",
    tomorrow: "#b56712",
    waiting: "#7d7b76",
    timer: "#1b829c",
    completed: "#1e7e40",
    favorite: "#d17a15",
};

const DARK_TONES: Record<AsterTone, string> = {
    overdue: "#eb6f66",
    p1: "#eb6f66",
    p2: "#e69530",
    p3: "#6598e0",
    today: "#43b366",
    tomorrow: "#e69530",
    waiting: "#888681",
    timer: "#3daec9",
    completed: "#43b366",
    favorite: "#e6c232",
};

function isLightAppearance(): boolean {
    try {
        return environment?.appearance === "light";
    } catch {
        return false;
    }
}

/** Resolves soft cool-mineral colors aligned with Aster Web and TUI without sharp system primaries or warm glare. */
export function toneColor(tone: AsterTone): Color.Raw {
    return (isLightAppearance() ? LIGHT_TONES : DARK_TONES)[tone];
}
