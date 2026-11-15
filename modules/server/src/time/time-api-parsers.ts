import { zonedDateTimeToUtcMs } from "../../../core/time/zone.ts";
import { TimeStoreError } from "./time-store-types.ts";

export function optionalBoolean(
    value: unknown,
    field: string,
): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
        throw new TimeStoreError(
            400,
            "INVALID_FIELD",
            `Invalid boolean: ${field}.`,
        );
    }
    return value;
}

export function optionalNullableString(
    value: unknown,
    field: string,
    max = 500,
): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "string") {
        throw new TimeStoreError(
            400,
            "INVALID_FIELD",
            `Invalid string: ${field}.`,
        );
    }
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, max);
}

export function optionalNullableNumber(
    value: unknown,
    field: string,
): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TimeStoreError(
            400,
            "INVALID_FIELD",
            `Invalid number: ${field}.`,
        );
    }
    return value;
}

export function requiredStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) {
        throw new TimeStoreError(
            400,
            "INVALID_FIELD",
            `Missing or invalid string array: ${field}.`,
        );
    }
    const out: string[] = [];
    for (const entry of value) {
        if (typeof entry !== "string" || !entry.trim()) {
            throw new TimeStoreError(
                400,
                "INVALID_FIELD",
                `Invalid array entry in ${field}.`,
            );
        }
        out.push(entry.trim().slice(0, 128));
    }
    return out;
}

function normalizeWallTime(raw: string): string {
    const trimmed = raw.trim();
    return /^\d:\d{2}(?::\d{2})?$/.test(trimmed) ? `0${trimmed}` : trimmed;
}

export function parseTimestampInput(
    body: Record<string, unknown>,
    options: {
        msKey: string;
        isoKey: string;
        dateKey: string;
        timeKey: string;
        timeZone: string;
        defaultDate: string;
    },
): number | null | undefined {
    const rawMs = body[options.msKey];
    if (rawMs === null) return null;
    if (rawMs !== undefined) {
        if (typeof rawMs !== "number" || !Number.isFinite(rawMs)) {
            throw new TimeStoreError(
                400,
                "INVALID_FIELD",
                `Invalid numeric timestamp: ${options.msKey}.`,
            );
        }
        return rawMs;
    }

    const rawIso = body[options.isoKey];
    if (rawIso === null) return null;
    if (rawIso !== undefined) {
        if (typeof rawIso !== "string" || !rawIso.trim()) {
            throw new TimeStoreError(
                400,
                "INVALID_FIELD",
                `Invalid timestamp string: ${options.isoKey}.`,
            );
        }
        const parsed = Date.parse(rawIso.trim());
        if (!Number.isFinite(parsed)) {
            throw new TimeStoreError(
                400,
                "INVALID_FIELD",
                `Invalid ISO timestamp: ${options.isoKey}.`,
            );
        }
        return parsed;
    }

    const rawTime = body[options.timeKey];
    if (rawTime === null) return null;
    if (rawTime !== undefined) {
        if (typeof rawTime !== "string" || !rawTime.trim()) {
            throw new TimeStoreError(
                400,
                "INVALID_FIELD",
                `Invalid local time: ${options.timeKey}.`,
            );
        }
        const rawDate = body[options.dateKey];
        let dateStr = options.defaultDate;
        if (rawDate !== undefined && rawDate !== null) {
            if (typeof rawDate !== "string" || !rawDate.trim()) {
                throw new TimeStoreError(
                    400,
                    "INVALID_FIELD",
                    `Invalid local date: ${options.dateKey}.`,
                );
            }
            dateStr = rawDate.trim();
        }
        try {
            return zonedDateTimeToUtcMs(
                dateStr,
                normalizeWallTime(rawTime),
                options.timeZone,
            );
        } catch (error) {
            throw new TimeStoreError(
                400,
                "INVALID_FIELD",
                error instanceof Error
                    ? error.message
                    : `Invalid local date/time for ${options.timeKey}.`,
            );
        }
    }
    return undefined;
}

export function optionalString(value: unknown, max = 500): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > max) {
        throw new TimeStoreError(
            400,
            "INVALID_INPUT",
            `Text exceeds ${max} characters.`,
        );
    }
    return trimmed;
}

export function requiredString(
    value: unknown,
    field: string,
    max = 500,
): string {
    const s = optionalString(value, max);
    if (!s) {
        throw new TimeStoreError(
            400,
            "MISSING_FIELD",
            `Missing required field: ${field}.`,
        );
    }
    return s;
}

export function requiredNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TimeStoreError(
            400,
            "INVALID_NUMBER",
            `Field ${field} must be a finite number.`,
        );
    }
    return value;
}

export function optionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TimeStoreError(
            400,
            "INVALID_NUMBER",
            "Expected a finite numeric value.",
        );
    }
    return value;
}

export function optionalStringArray(value: unknown): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string")
    ) {
        throw new TimeStoreError(
            400,
            "INVALID_ARRAY",
            "Expected an array of strings.",
        );
    }
    return value as string[];
}
