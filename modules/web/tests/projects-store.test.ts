import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createOrganizationStore } from "../server/organization-store.ts";
import type {
    Organization,
    SavedProject,
} from "../../../src/core/workspace/organization.ts";

test("branch move remaps descendant metadata and filters, clears departed next steps, and deletion preserves board state", async () => {
    const directory = await mkdtemp(tmpdir() + "/aster-project-tree-");
    const task = {
        uuid: "selected",
        status: "pending",
        project: "Work.Web.UI",
    };
    const projects: SavedProject[] = [
        {
            name: "Work",
            description: "Parent",
            status: "active",
            outcome: "Ship",
            nextTask: task.uuid,
        },
        { name: "Work.Web", description: "Web branch", color: "blue" },
        {
            name: "Work.Web.UI",
            description: "Deep",
            color: "purple",
            outcome: "Interface",
            nextTask: task.uuid,
        },
        { name: "Workplace", description: "Unrelated" },
    ];
    const initial: Organization = {
        revision: 0,
        projects,
        tags: [],
        filters: [
            {
                id: "filter",
                name: "Deep",
                expression:
                    "project:Work.Web or project.is:Work.Web.UI or project:Workplace",
                description: "",
                color: "gray",
                favorite: false,
            },
        ],
        board: {
            columns: [{ id: "review", name: "Review" }],
            placements: [{ uuid: task.uuid, columnId: "review" }],
            order: [task.uuid],
        },
    };
    try {
        await writeFile(
            directory + "/organization.json",
            JSON.stringify(initial),
        );
        const store = createOrganizationStore(directory + "/organization.json");
        const native: [string, string | undefined][] = [];
        const context = {
            tasks: [task],
            projects: projects.map((p) => p.name),
            projectRecords: projects,
            changeProject: async (old: string, next?: string) => {
                native.push([old, next]);
            },
        };
        const noTag = async () => {
            throw new Error("unexpected label mutation");
        };
        for (const name of ["Work.Web.UI.Nested", "Workplace"]) {
            await assert.rejects(
                store.change(
                    {
                        kind: "project",
                        action: "save",
                        revision: 0,
                        originalName: "Work.Web",
                        item: { name, description: "Web branch" },
                    },
                    [],
                    noTag,
                    context,
                ),
            );
            assert.deepEqual(await store.read(), initial);
            assert.equal(native.length, 0);
        }
        const moved = await store.change(
            {
                kind: "project",
                action: "save",
                revision: 0,
                originalName: "Work.Web",
                item: { name: "Personal.Site", description: "Web branch" },
            },
            [],
            noTag,
            context,
        );
        assert.equal(
            moved.projects?.find((p) => p.name === "Personal.Site.UI")
                ?.nextTask,
            task.uuid,
        );
        assert.equal(
            moved.projects?.find((p) => p.name === "Personal.Site")?.color,
            "blue",
        );
        assert.equal(
            moved.projects?.find((p) => p.name === "Personal.Site.UI")?.color,
            "purple",
        );
        assert.equal(
            moved.projects?.find((p) => p.name === "Work")?.nextTask,
            "",
        );
        assert.equal(
            moved.projects?.find((p) => p.name === "Personal.Site.UI")
                ?.description,
            "Deep",
        );
        assert.equal(
            moved.filters[0].expression,
            "project:Personal.Site or project.is:Personal.Site.UI or project:Workplace",
        );
        assert.deepEqual(moved.board, initial.board);
        assert.deepEqual(native, [["Work.Web", "Personal.Site"]]);
        const deleted = await store.change(
            {
                kind: "project",
                action: "delete",
                revision: 1,
                item: { name: "Personal.Site", description: "" },
            },
            [],
            noTag,
            {
                ...context,
                projectRecords: moved.projects!,
                projects: moved.projects!.map((p) => p.name),
                tasks: [{ ...task, project: "Personal.Site.UI" }],
            },
        );
        assert.ok(
            deleted.projects?.every((p) => !p.name.startsWith("Personal.Site")),
        );
        assert.deepEqual(deleted.board, initial.board);
        assert.deepEqual(native.at(-1), ["Personal.Site", undefined]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("moving an active branch under another active goal cannot bypass Focus slots", async () => {
    const directory = await mkdtemp(tmpdir() + "/aster-project-focus-");
    try {
        const projects: SavedProject[] = ["A", "B"].map((name) => ({
            name,
            description: "",
            status: "active",
            outcome: "Ship",
        }));
        await writeFile(
            directory + "/organization.json",
            JSON.stringify({ revision: 0, projects, filters: [], tags: [] }),
        );
        const store = createOrganizationStore(directory + "/organization.json");
        await assert.rejects(
            store.change(
                {
                    kind: "project",
                    action: "save",
                    revision: 0,
                    originalName: "B",
                    item: { name: "A.B", description: "" },
                },
                [],
                async () => {},
                {
                    tasks: [],
                    projectRecords: projects,
                    projects: ["A", "B"],
                    changeProject: async () => {
                        throw new Error("must reject before native write");
                    },
                },
            ),
            /already active/,
        );
        assert.equal((await store.read()).revision, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("project colors persist without task writes, survive legacy edits and status changes, and reject invalid or stale updates", async () => {
    const directory = await mkdtemp(tmpdir() + "/aster-project-colors-");
    try {
        const file = directory + "/organization.json";
        const initial: Organization = {
            revision: 0,
            projects: [
                { name: "Work", description: "Legacy", outcome: "Ship" },
            ],
            tags: [],
            filters: [],
        };
        await writeFile(file, JSON.stringify(initial));
        const store = createOrganizationStore(file);
        const noWrite = async () => {
            throw new Error("Color edits must never write native task data");
        };
        const context = {
            tasks: [],
            projects: ["Work"],
            projectRecords: initial.projects!,
            changeProject: noWrite,
        };
        for (const color of ["invalid", null, { value: "blue" }]) {
            await assert.rejects(
                store.change(
                    {
                        kind: "project",
                        action: "save",
                        revision: 0,
                        item: { name: "Work", description: "", color },
                    } as never,
                    [],
                    noWrite,
                    context,
                ),
                /valid project color/,
            );
            assert.deepEqual(await store.read(), initial);
        }
        const saved = await store.change(
            {
                kind: "project",
                action: "save",
                revision: 0,
                item: { name: "Work", description: "Legacy", color: "blue" },
            },
            [],
            noWrite,
            context,
        );
        assert.equal(saved.projects?.[0].color, "blue");
        assert.equal(
            (await createOrganizationStore(file).read()).projects?.[0].color,
            "blue",
        );
        await store.change(
            {
                kind: "project",
                action: "save",
                revision: 1,
                item: { name: "Work", description: "Old client" },
            },
            [],
            noWrite,
            context,
        );
        assert.equal((await store.read()).projects?.[0].color, "blue");
        await store.change(
            {
                kind: "project",
                action: "status",
                revision: 2,
                name: "Work",
                status: "active",
            },
            [],
            noWrite,
            context,
        );
        assert.equal((await store.read()).projects?.[0].color, "blue");
        await assert.rejects(
            store.change(
                {
                    kind: "project",
                    action: "save",
                    revision: 2,
                    item: { name: "Work", description: "", color: "red" },
                },
                [],
                noWrite,
                context,
            ),
            { status: 409 },
        );
        assert.equal((await store.read()).projects?.[0].color, "blue");
        await store.change(
            {
                kind: "project",
                action: "save",
                revision: 3,
                item: { name: "Work", description: "", color: "gray" },
            },
            [],
            noWrite,
            context,
        );
        assert.equal((await store.read()).projects?.[0].color, "gray");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
