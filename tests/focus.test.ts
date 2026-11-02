import test from "node:test";
import assert from "node:assert/strict";
import { focusProject, projectStatus } from "../src/core/workspace/focus.ts";
import {
    createSshWorkspaceClient,
    WorkspaceError,
} from "../src/core/workspace/client.ts";
import {
    resolveConnection,
    workspaceIdentity,
} from "../src/core/connection/settings.ts";
import type { Organization } from "../src/core/workspace/organization.ts";

test("legacy and external projects default to Later; only active projects and descendants belong to Focus", () => {
    const projects = [
        { name: "Work", description: "", status: "active" as const },
        { name: "Old", description: "", status: "completed" as const },
    ];
    assert.equal(projectStatus({ name: "New", description: "" }), "later");
    assert.equal(focusProject("Work.Child", projects)?.name, "Work");
    for (const name of ["Workplace", "Old", "Unknown", undefined])
        assert.equal(focusProject(name, projects), undefined);
});
test("SSH workspace verifies the local RN source, transmits one revisioned change, and never retries uncertain writes", async () => {
    const connection = resolveConnection({ connectionMode: "ssh" });
    const identity = workspaceIdentity({
        ...connection,
        kind: "local",
        sshTarget: undefined,
    });
    const organization: Organization = {
        revision: 1,
        filters: [],
        tags: [],
        projects: [{ name: "A", description: "" }],
    };
    let writeCalls = 0;
    let wrongSource = false;
    let loseReply = false;
    const client = createSshWorkspaceClient(connection, async (command) => {
        const remote = command.args.at(-1)!;
        const match = remote.match(/'([A-Za-z0-9+/]+=*)'$/)!;
        const payload = JSON.parse(Buffer.from(match[1], "base64").toString());
        assert.equal(payload.identity, identity);
        if (payload.change) {
            writeCalls++;
            if (loseReply) throw new Error("closed");
        }
        return {
            stdout: JSON.stringify({
                status: 200,
                body: payload.change
                    ? organization
                    : {
                          identity: wrongSource ? "different" : identity,
                          organization,
                      },
            }),
            stderr: "",
        };
    });
    assert.equal((await client.load()).revision, 1);
    await client.change({
        revision: 1,
        kind: "project",
        action: "status",
        name: "A",
        status: "active",
        outcome: "Ship",
    });
    assert.equal(writeCalls, 1);
    wrongSource = true;
    await assert.rejects(
        client.change({
            revision: 1,
            kind: "project",
            action: "status",
            name: "A",
            status: "later",
        }),
        /different Taskwarrior/,
    );
    assert.equal(writeCalls, 1);
    wrongSource = false;
    loseReply = true;
    await assert.rejects(
        client.change({
            revision: 1,
            kind: "project",
            action: "status",
            name: "A",
            status: "later",
        }),
        (error) => error instanceof WorkspaceError && error.uncertain,
    );
    assert.equal(writeCalls, 2);
});

test("TinyCast Focus shows selected next steps only, while Later and Today retain their own scopes", async () => {
    const { createTaskService } = await import("../src/core/tasks/service.ts");
    const { loadTaskView } =
        await import("../src/core/workspace/task-views.ts");
    const data = [
        {
            uuid: "next",
            description: "Next",
            status: "pending",
            project: "A",
            tags: [],
        },
        {
            uuid: "other",
            description: "Other",
            status: "pending",
            project: "A",
            tags: [],
        },
        {
            uuid: "due",
            description: "Due",
            status: "pending",
            project: "Paused",
            due: "20200101T000000Z",
            tags: [],
        },
    ];
    const service = createTaskService(
        resolveConnection({ connectionMode: "local" }, "darwin"),
        async ({ args }) => ({
            stdout: args[0] === "--version" ? "3.5.0" : JSON.stringify(data),
            stderr: "",
        }),
    );
    const organization: Organization = {
        revision: 1,
        filters: [],
        tags: [],
        projects: [
            {
                name: "A",
                description: "",
                status: "active",
                outcome: "Ship",
                nextTask: "next",
            },
        ],
    };
    assert.deepEqual(
        (await loadTaskView(service, "focus", organization)).map(
            (task) => task.uuid,
        ),
        ["next"],
    );
    assert.deepEqual(
        (await loadTaskView(service, "later", organization)).map(
            (task) => task.uuid,
        ),
        ["due"],
    );
    assert.deepEqual(
        (await loadTaskView(service, "today", organization)).map(
            (task) => task.uuid,
        ),
        ["due"],
    );
});
