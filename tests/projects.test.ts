import assert from "node:assert/strict";
import test from "node:test";
import {
    projectNames,
    projectTree,
    projectTaskCount,
    remapProject,
} from "../src/core/workspace/projects.ts";
import { createTaskService } from "../src/core/tasks/service.ts";
import { resolveConnection } from "../src/core/connection/settings.ts";
import { loadTaskView } from "../src/core/workspace/task-views.ts";

test("project trees infer ancestors, search through collapsed branches and support deep nesting without recursion", () => {
    const deep = Array.from({ length: 80 }, (_, index) => String(index)).join(
        ".",
    );
    assert.equal(projectTree([deep]).at(-1)?.depth, 79);
    assert.deepEqual(projectNames(["Work.Web.UI", "Workplace"]), [
        "Work",
        "Work.Web",
        "Work.Web.UI",
        "Workplace",
    ]);
    assert.deepEqual(
        projectTree(["Work.Web.UI"], new Set(["Work"])).map((row) => row.name),
        ["Work"],
    );
    assert.deepEqual(
        projectTree(
            ["Work.Web.UI", "Work.Mobile"],
            new Set(["Work"]),
            new Set(["Work.Web.UI"]),
        ).map((row) => row.name),
        ["Work", "Work.Web", "Work.Web.UI"],
    );
    assert.equal(
        remapProject("Work.Web.UI", "Work", "Life.Product"),
        "Life.Product.Web.UI",
    );
    assert.equal(remapProject("Workplace", "Work", "Life"), "Workplace");
    assert.equal(
        projectTaskCount("Work", { Work: 1, "Work.Web": 2, Workplace: 9 }),
        3,
    );
});

test("native branch changes preserve suffixes and completion, reject collisions before writes, and never retry partial failures", async () => {
    const data = ["Work", "Work.Web", "Work.Web.UI", "Workplace"].map(
        (project, index) => ({
            uuid: `123e4567-e89b-42d3-a456-42661417400${index}`,
            description: project,
            project,
            status: index === 1 ? "completed" : "pending",
        }),
    );
    const calls: string[][] = [];
    let fail = false;
    const service = createTaskService(
        resolveConnection({ connectionMode: "local" }, "darwin"),
        async ({ args }) => {
            calls.push(args);
            if (
                args.includes("modify") &&
                fail &&
                args.includes("project.is:Work.Web")
            )
                throw new Error("failed midway");
            return {
                stdout:
                    args[0] === "--version"
                        ? "3.5.0"
                        : args.includes("export")
                          ? JSON.stringify(data)
                          : "OK",
                stderr: "",
            };
        },
    );
    assert.deepEqual(
        (await loadTaskView(service, "project:Work")).map(
            (task) => task.project,
        ),
        ["Work", "Work.Web", "Work.Web.UI"],
    );
    await service.changeProject("Work", "Product");
    assert.deepEqual(
        calls
            .filter((args) => args.includes("modify"))
            .map((args) => args.slice(0, 4)),
        [
            [
                "status.not:deleted",
                "project.is:Work.Web.UI",
                "modify",
                "project:Product.Web.UI",
            ],
            [
                "status.not:deleted",
                "project.is:Work.Web",
                "modify",
                "project:Product.Web",
            ],
            [
                "status.not:deleted",
                "project.is:Work",
                "modify",
                "project:Product",
            ],
        ],
    );
    calls.length = 0;
    await assert.rejects(
        service.changeProject("Work", "Workplace"),
        /already exists/,
    );
    assert.equal(calls.filter((args) => args.includes("modify")).length, 0);
    fail = true;
    await assert.rejects(service.changeProject("Work", "Product"), {
        outcome: "unknown",
    });
    assert.equal(calls.filter((args) => args.includes("modify")).length, 2);
    assert.ok(
        calls
            .filter((args) => args.includes("modify"))
            .every(
                (args) =>
                    !args.includes("delete") &&
                    !args.includes("status:pending"),
            ),
    );
});
