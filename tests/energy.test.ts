import assert from "node:assert/strict";
import test from "node:test";
import {
    applyEnergyElixir,
    calculateEnergy,
    energyDayWindow,
    formatDuration,
    liveEnergySummary,
    parseTimewarriorIntervals,
} from "../src/core/workspace/energy.ts";

const uuid1 = "123e4567-e89b-42d3-a456-426614174000";
const uuid2 = "123e4567-e89b-42d3-a456-426614174001";
const uuid3 = "123e4567-e89b-42d3-a456-426614174002";

test("energy day window resets at 06:00 local time", () => {
    const beforeSix = new Date(2026, 9, 23, 5, 59, 0);
    const atSix = new Date(2026, 9, 23, 6, 0, 0);
    assert.equal(energyDayWindow(beforeSix).day, "2026-10-22");
    assert.equal(energyDayWindow(atSix).day, "2026-10-23");
});

test("starting deducts 5 entry points, Timewarrior intervals deduct 1 per 3m, and stopping refunds entry fee", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const intervals = parseTimewarriorIntervals(
        JSON.stringify([
            {
                id: 1,
                start: "20261023T100000Z",
                end: "20261023T103000Z",
                tags: [`uuid:${uuid1}`, "Deep work"],
            },
            {
                id: 2,
                start: "20261023T110000Z",
                end: "20261023T110030Z",
                tags: [`uuid:${uuid2}`, "Accidental click (<60s)"],
            },
        ]),
    );

    // Task 1 is active: 5 entry + 10 duration (30m / 3m) = 15 used, 85 remaining
    const activeSummary = calculateEnergy(
        [
            { uuid: uuid1, status: "pending", start: "20261023T100000Z" },
            { uuid: uuid2, status: "pending" },
        ],
        intervals,
        undefined,
        now,
    );
    assert.equal(activeSummary.used, 15);
    assert.equal(activeSummary.remaining, 85);
    assert.equal(activeSummary.trackedSecondsToday, 1800);
    assert.equal(activeSummary.taskSeconds[uuid1], 1800);
    assert.equal(activeSummary.taskSeconds[uuid2], undefined);

    // Stopping Task 1 refunds its 5 entry fee while keeping tracked focus time
    const stoppedSummary = calculateEnergy(
        [
            { uuid: uuid1, status: "pending" },
            { uuid: uuid2, status: "pending" },
        ],
        intervals,
        undefined,
        now,
    );
    assert.equal(stoppedSummary.used, 10);
    assert.equal(stoppedSummary.remaining, 90);

    // Completing Task 1 or directly completing Task 3 charges 5 entry fee; reopening refunds it
    const completedSummary = calculateEnergy(
        [
            { uuid: uuid1, status: "completed", end: "20261023T103000Z" },
            { uuid: uuid3, status: "completed", end: "20261023T113000Z" },
        ],
        intervals,
        undefined,
        now,
    );
    assert.equal(completedSummary.used, 20);
    assert.equal(completedSummary.remaining, 80);
});

test("last 1 point of energy clamps at 0 and Elixir always restores +30 usable points", () => {
    const now = new Date("2026-10-23T16:00:00Z");
    const intervals = parseTimewarriorIntervals(
        JSON.stringify([
            {
                id: 1,
                start: "20261023T080000Z",
                end: "20261023T140000Z",
                tags: [`uuid:${uuid1}`, "Boss dungeon (6h = 120 pts)"],
            },
        ]),
    );
    const exhausted = calculateEnergy(
        [{ uuid: uuid1, status: "completed", end: "20261023T140000Z" }],
        intervals,
        undefined,
        now,
    );
    assert.equal(exhausted.used, 125);
    assert.equal(exhausted.remaining, 0);

    const elixirState = applyEnergyElixir(exhausted);
    const restored = calculateEnergy(
        [{ uuid: uuid1, status: "completed", end: "20261023T140000Z" }],
        intervals,
        elixirState,
        now,
    );
    assert.equal(restored.remaining, 30);
    assert.equal(restored.elixirCount, 1);

    const live = liveEnergySummary(
        { ...restored, activeCount: 1, calculatedAt: "2026-10-23T16:00:00Z" },
        new Date("2026-10-23T16:06:00Z"),
    );
    assert.equal(live?.remaining, 28);
    assert.equal(formatDuration(3900), "1h 5m");
});
