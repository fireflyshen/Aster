import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createOrganizationStore } from "../src/organization-store.ts";
import type {
  SavedProject,
  OrganizationChange,
} from "../../core/workspace/organization.ts";

const projects: SavedProject[] = ["A", "B", "C", "D"].map((name) => ({
  name,
  description: name,
  outcome: `Deliver ${name}`,
}));
const task = {
  uuid: "123e4567-e89b-42d3-a456-426614174000",
  status: "pending",
  project: "A",
};
async function fixture(
  run: (
    store: ReturnType<typeof createOrganizationStore>,
    context: {
      tasks: (typeof task)[];
      projects: string[];
      projectRecords: SavedProject[];
    },
  ) => Promise<void>,
) {
  const dir = await mkdtemp(tmpdir() + "/aster-focus-");
  try {
    const file = dir + "/organization.json";
    await writeFile(
      file,
      JSON.stringify({
        revision: 0,
        filters: [],
        tags: [],
        projects,
        board: {
          columns: [{ id: "custom", name: "Custom" }],
          placements: [{ uuid: task.uuid, columnId: "custom" }],
          order: [task.uuid],
        },
      }),
    );
    await run(createOrganizationStore(file), {
      tasks: [task],
      projects: projects.map((p) => p.name),
      projectRecords: projects.map((p) => ({ ...p })),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const noTaskWrite = async () => {
  throw new Error("Focus must not mutate native tasks");
};
test("three slots are enforced by the serialized store; replacement is atomic and keeps tasks and columns", async () =>
  fixture(async (store, context) => {
    for (const [revision, name] of ["A", "B", "C"].entries())
      await store.change(
        {
          revision,
          kind: "project",
          action: "status",
          name,
          status: "active",
        },
        [],
        noTaskWrite,
        context,
      );
    const before = await store.read();
    await assert.rejects(
      store.change(
        {
          revision: 3,
          kind: "project",
          action: "status",
          name: "D",
          status: "active",
        },
        [],
        noTaskWrite,
        context,
      ),
      /Three projects/,
    );
    assert.deepEqual(await store.read(), before);
    const after = await store.change(
      {
        revision: 3,
        kind: "project",
        action: "status",
        name: "D",
        status: "active",
        replaceProject: "B",
      },
      [],
      noTaskWrite,
      context,
    );
    assert.deepEqual(
      after.projects?.filter((p) => p.status === "active").map((p) => p.name),
      ["A", "C", "D"],
    );
    assert.equal(after.projects?.find((p) => p.name === "B")?.status, "later");
    assert.deepEqual(after.board, before.board);
    assert.deepEqual(context.tasks, [task]);
    await assert.rejects(
      store.change(
        {
          revision: 3,
          kind: "project",
          action: "status",
          name: "B",
          status: "active",
          replaceProject: "A",
        },
        [],
        noTaskWrite,
        context,
      ),
      { status: 409 },
    );
  }));
test("simultaneous activations cannot exceed the limit or overwrite another client", async () =>
  fixture(async (store, context) => {
    await store.change(
      {
        revision: 0,
        kind: "project",
        action: "status",
        name: "A",
        status: "active",
      },
      [],
      noTaskWrite,
      context,
    );
    await store.change(
      {
        revision: 1,
        kind: "project",
        action: "status",
        name: "B",
        status: "active",
      },
      [],
      noTaskWrite,
      context,
    );
    const results = await Promise.allSettled(
      ["C", "D"].map((name) =>
        store.change(
          {
            revision: 2,
            kind: "project",
            action: "status",
            name,
            status: "active",
          },
          [],
          noTaskWrite,
          context,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await store.read()).projects?.filter((p) => p.status === "active")
        .length,
      3,
    );
  }));
test("activation requires an outcome, save cannot bypass slots, completion acknowledges remaining tasks, and legacy edits preserve goals", async () =>
  fixture(async (store, context) => {
    await assert.rejects(
      store.change(
        {
          revision: 0,
          kind: "project",
          action: "status",
          name: "A",
          status: "active",
          outcome: "",
        },
        [],
        noTaskWrite,
        context,
      ),
      /finish line/,
    );
    await assert.rejects(
      store.change(
        {
          revision: 0,
          kind: "project",
          action: "save",
          originalName: "",
          item: {
            name: "Bypass",
            description: "",
            status: "active",
            outcome: "X",
          },
        },
        [],
        noTaskWrite,
        context,
      ),
      /status action/,
    );
    await store.change(
      {
        revision: 0,
        kind: "project",
        action: "save",
        originalName: "A",
        item: { ...projects[0], nextTask: task.uuid },
      },
      [],
      noTaskWrite,
      context,
    );
    await store.change(
      {
        revision: 1,
        kind: "project",
        action: "status",
        name: "A",
        status: "active",
      },
      [],
      noTaskWrite,
      context,
    );
    await store.change(
      {
        revision: 2,
        kind: "project",
        action: "save",
        item: { name: "A", description: "Legacy editor" },
      },
      [],
      noTaskWrite,
      context,
    );
    const saved = (await store.read()).projects?.find((p) => p.name === "A");
    assert.equal(saved?.status, "active");
    assert.equal(saved?.nextTask, task.uuid);
    assert.equal(saved?.outcome, "Deliver A");
    await assert.rejects(
      store.change(
        {
          revision: 3,
          kind: "project",
          action: "status",
          name: "A",
          status: "completed",
        },
        [],
        noTaskWrite,
        context,
      ),
      /unfinished tasks/,
    );
    await store.change(
      {
        revision: 3,
        kind: "project",
        action: "status",
        name: "A",
        status: "completed",
        remaining: "keep",
      },
      [],
      noTaskWrite,
      context,
    );
    assert.deepEqual(context.tasks, [task]);
    await assert.rejects(
      store.change(
        {
          revision: 4,
          kind: "project",
          action: "save",
          originalName: "B",
          item: { ...projects[1], nextTask: task.uuid },
        },
        [],
        noTaskWrite,
        context,
      ),
      /next task/,
    );
  }));
test("discovered projects start Later and nested projects cannot consume overlapping active slots", async () =>
  fixture(async (store, context) => {
    context.projectRecords.push({ name: "A.Child", description: "" });
    context.projects.push("A.Child");
    assert.ok((await store.read()).projects?.every((p) => !p.status));
    await store.change(
      {
        revision: 0,
        kind: "project",
        action: "status",
        name: "A",
        status: "active",
      },
      [],
      noTaskWrite,
      context,
    );
    await assert.rejects(
      store.change(
        {
          revision: 1,
          kind: "project",
          action: "status",
          name: "A.Child",
          status: "active",
          outcome: "Nested",
        },
        [],
        noTaskWrite,
        context,
      ),
      /parent or child/,
    );
  }));
