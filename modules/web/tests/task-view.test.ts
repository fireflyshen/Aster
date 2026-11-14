import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const coreRoot = path.resolve(webRoot, "..", "core");

const compiled = esbuild.buildSync({
    entryPoints: [path.join(webRoot, "src/app/lib/task-view.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    alias: {
        "@": path.join(webRoot, "src"),
        "@core": coreRoot,
        "@shared": path.join(webRoot, "shared"),
    },
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const { filterVisibleTasks, sortUrgencyTasks } = await import(moduleUrl);

function isoDayOffset(days: number): string {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d.toISOString();
}

const makeTask = (
    uuid: string,
    description: string,
    overrides: Record<string, unknown> = {},
) => ({
    uuid,
    description,
    status: "pending",
    tags: [],
    urgency: 1,
    depends: [],
    annotations: [],
    ...overrides,
});

const organization = {
    revision: 1,
    projects: [
        { name: "上位机v1学习", status: "active", description: "" },
        { name: "备份阅读", status: "later", description: "" },
        { name: "旧项目", status: "completed", description: "" },
    ],
    filters: [],
    tags: [],
};

test("filterVisibleTasks properly scopes focus, later, today, urgency, and strikethrough completed retention", () => {
    const focusToday = makeTask("f1", "做练习 A 组", {
        project: "上位机v1学习",
        due: isoDayOffset(0),
        urgency: 9.2,
    });
    const focusSub = makeTask("f2", "子模块学习", {
        project: "上位机v1学习.C++",
        urgency: 5.1,
    });
    const laterTask = makeTask("l1", "读架构文章", {
        project: "备份阅读",
        urgency: 12.8,
    });
    const completedProjTask = makeTask("cp1", "已完结项目遗留", {
        project: "旧项目",
        urgency: 2,
    });
    const waitingTask = makeTask("w1", "等快递", {
        wait: isoDayOffset(3),
        status: "waiting",
        urgency: 15,
    });
    const doneToday = makeTask("d1", "今天已完成", {
        project: "上位机v1学习",
        status: "completed",
        due: isoDayOffset(0),
        end: isoDayOffset(0),
        urgency: 0,
    });
    const doneOldInbox = makeTask("d2", "很久前收件箱完成", {
        status: "completed",
        end: isoDayOffset(-10),
        urgency: 0,
    });

    const all = [
        focusToday,
        focusSub,
        laterTask,
        completedProjTask,
        waitingTask,
        doneToday,
        doneOldInbox,
    ];

    assert.deepEqual(
        filterVisibleTasks({
            tasks: all,
            view: "focus",
            organization,
            inbox: false,
            currentProject: "",
            query: "",
        }).map((t: { uuid: string }) => t.uuid),
        ["f1", "f2"],
    );

    assert.deepEqual(
        filterVisibleTasks({
            tasks: all,
            view: "later",
            organization,
            inbox: false,
            currentProject: "",
            query: "",
        }).map((t: { uuid: string }) => t.uuid),
        ["l1"],
    );

    assert.deepEqual(
        filterVisibleTasks({
            tasks: all,
            view: "today",
            organization,
            inbox: false,
            currentProject: "",
            query: "",
            keepCompleted: true,
        }).map((t: { uuid: string }) => t.uuid),
        ["f1", "d1"],
    );

    const urgencyFiltered = sortUrgencyTasks(
        filterVisibleTasks({
            tasks: all,
            view: "urgency",
            organization,
            inbox: false,
            currentProject: "",
            query: "",
            keepCompleted: false,
        }),
    );
    assert.deepEqual(
        urgencyFiltered.map((t: { uuid: string }) => t.uuid),
        ["l1", "f1", "f2", "cp1"],
    );
});
