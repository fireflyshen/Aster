import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import type { CostReportSummary } from "../../core/time/model.ts";

const compiled = buildSync({
    entryPoints: [
        new URL("../src/features/time/time-statistics.ts", import.meta.url)
            .pathname,
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    alias: { "@core": new URL("../../core", import.meta.url).pathname },
});
const { costStatisticRows } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const sleep = {
    activityId: "sleep",
    startMs: 0,
    endMs: 1000,
    date: "2026-11-15",
    confirmedSeconds: 28800,
    confirmedCostCents: 0,
    tags: [],
};
const work = {
    activityId: "work",
    startMs: 1000,
    endMs: 2000,
    date: "2026-11-15",
    confirmedSeconds: 3600,
    confirmedCostCents: 10000,
    tags: ["study", "study", "code"],
};
const report = {
    periodStartDate: "2026-11-14",
    periodEndDate: "2026-11-15",
    byProject: [
        {
            projectKey: "work",
            projectName: "Work",
            periodSeconds: 3600,
            periodCostCents: 10000,
            segments: [work],
        },
    ],
    byTask: [
        {
            taskUuid: "task",
            title: "Study",
            periodSeconds: 3600,
            periodCostCents: 10000,
            segments: [work],
        },
    ],
    unassignedSegments: [sleep, work],
} as unknown as CostReportSummary;

test("daily statistics deduplicate segment references, retain zero days and zero-cost sleep", () => {
    const rows = costStatisticRows(report, "day");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].seconds, 0);
    assert.equal(rows[1].seconds, 32400);
    assert.equal(rows[1].cost, 10000);
    assert.equal(rows[1].date, "2026-11-15");
});

test("tags count each unique tag once per segment and retain untagged time", () => {
    const rows = costStatisticRows(report, "tag");
    assert.equal(rows.find((row) => row.key === "study").seconds, 3600);
    assert.equal(rows.find((row) => row.key === "code").cost, 10000);
    assert.equal(rows.find((row) => row.key === "__untagged__").cost, 0);
});

test("project and task views use period facts rather than lifetime costs", () => {
    assert.equal(costStatisticRows(report, "project")[0].cost, 10000);
    assert.equal(costStatisticRows(report, "task")[0].seconds, 3600);
});
