import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createOrganizationStore } from "../server/organization-store.ts";
import type {
  SavedTag,
  SavedFilter,
} from "../../../src/core/workspace/organization.ts";

test("organization persists empty tags and filters, rejects concurrent overwrite, and preserves data on invalid input", async () => {
  const directory = await mkdtemp(tmpdir() + "/aster-organization-");
  try {
    const store = createOrganizationStore(directory + "/organization.json");
    const effect = async () => {
      throw new Error("unexpected task write");
    };
    const filter: SavedFilter = {
      id: "",
      name: "Todo",
      color: "green",
      favorite: true,
      description: "本周任务",
      expression: "status:pending @Todo",
    };
    const saved = await store.change(
      { revision: 0, kind: "filter", action: "save", item: filter },
      [],
      effect,
    );
    assert.equal(saved.revision, 1);
    assert.equal(
      (await createOrganizationStore(directory + "/organization.json").read())
        .filters[0].name,
      "Todo",
    );
    await assert.rejects(
      store.change(
        { revision: 0, kind: "filter", action: "save", item: filter },
        [],
        effect,
      ),
      {
        status: 409,
      },
    );
    await assert.rejects(
      store.change(
        {
          revision: 1,
          kind: "filter",
          action: "save",
          item: { ...filter, name: "Other", expression: "delete" },
        },
        [],
        effect,
      ),
    );
    assert.equal((await store.read()).revision, 1);
    const tag: SavedTag = {
      id: "",
      name: "Todo",
      color: "blue",
      favorite: true,
    };
    const next = await store.change(
      { revision: 1, kind: "tag", action: "save", item: tag },
      [],
      effect,
    );
    assert.equal(next.tags[0].name, "Todo");
    assert.equal(next.filters.length, 1);
    const calls: string[] = [];
    const renamed = await store.change(
      {
        revision: 2,
        kind: "tag",
        action: "save",
        item: { ...next.tags[0], name: "Doing" },
      },
      next.tags,
      async (old, changed) => {
        calls.push(old.name + ":" + changed?.name);
      },
    );
    assert.deepEqual(calls, ["Todo:Doing"]);
    assert.equal(renamed.filters[0].expression, "status:pending +Doing");
    const removed = await store.change(
      {
        revision: 3,
        kind: "tag",
        action: "delete",
        item: renamed.tags[0],
      },
      renamed.tags,
      async () => {},
    );
    assert.equal(removed.tags.length, 0);
    assert.equal(removed.filters.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("failed remote changes leave metadata untouched; duplicate names and reserved tags are rejected", async () => {
  const directory = await mkdtemp(tmpdir() + "/aster-organization-");
  try {
    const store = createOrganizationStore(directory + "/organization.json");
    const tag: SavedTag = {
      id: "tag:Todo",
      name: "Todo",
      color: "gray",
      favorite: false,
    };
    await assert.rejects(
      store.change(
        {
          revision: 0,
          kind: "tag",
          action: "save",
          item: { ...tag, name: "Doing" },
        },
        [tag],
        async () => {
          throw new Error("connection failed");
        },
      ),
      /connection failed/,
    );
    assert.equal((await store.read()).revision, 0);
    await assert.rejects(
      store.change(
        {
          revision: 0,
          kind: "tag",
          action: "save",
          item: { ...tag, id: "", name: "todo" },
        },
        [tag],
        async () => {},
      ),
      /name already exists/,
    );
    await assert.rejects(
      store.change(
        {
          revision: 0,
          kind: "tag",
          action: "save",
          item: { ...tag, id: "", name: "READY" },
        },
        [],
        async () => {},
      ),
      /virtual tags/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project descriptions migrate legacy data, persist without task writes, and reject stale or invalid updates", async () => {
  const directory = await mkdtemp(tmpdir() + "/aster-project-");
  const file = directory + "/organization.json";
  try {
    const legacy = {
      revision: 7,
      filters: [{ id: "keep", name: "Today" }],
      tags: [{ id: "tag", name: "Work" }],
    };
    await writeFile(file, JSON.stringify(legacy));
    const store = createOrganizationStore(file);
    const effect = async () => {
      throw new Error("project descriptions must not modify Taskwarrior tasks");
    };
    const item = {
      name: "Product.launch",
      description: "Release the first version.\nKeep the scope small.",
    };
    const saved = await store.change(
      { kind: "project", action: "save", revision: 7, item },
      [],
      effect,
    );
    assert.deepEqual(saved.projects, [item]);
    assert.deepEqual(saved.filters, legacy.filters);
    assert.deepEqual(saved.tags, legacy.tags);
    assert.deepEqual((await createOrganizationStore(file).read()).projects, [
      item,
    ]);
    await assert.rejects(
      store.change(
        { kind: "project", action: "save", revision: 7, item },
        [],
        effect,
      ),
      {
        status: 409,
      },
    );
    for (const invalid of [
      { ...item, name: "" },
      { ...item, name: "bad\nname" },
      { ...item, description: "x".repeat(2001) },
      { ...item, description: null },
    ]) {
      await assert.rejects(
        store.change(
          {
            kind: "project",
            action: "save",
            revision: 8,
            item: invalid as typeof item,
          },
          [],
          effect,
        ),
      );
      assert.equal((await store.read()).revision, 8);
    }
    const cleared = await store.change(
      {
        kind: "project",
        action: "save",
        revision: 8,
        item: { ...item, description: "" },
      },
      [],
      effect,
    );
    assert.deepEqual(cleared.projects, [{ name: item.name, description: "" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("projects can be created empty, renamed with filter references, and removed without losing tasks or columns", async () => {
  const directory = await mkdtemp(tmpdir() + "/aster-project-crud-");
  try {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    const board = {
      columns: [{ id: "review", name: "Review" }],
      placements: [{ uuid, columnId: "review" }],
      order: [uuid],
    };
    await writeFile(
      directory + "/organization.json",
      JSON.stringify({ revision: 0, filters: [], tags: [], board }),
    );
    const store = createOrganizationStore(directory + "/organization.json");
    const noTagWrite = async () => {
      throw new Error("unexpected label write");
    };
    const calls: [string, string | undefined][] = [];
    const context = {
      tasks: [],
      projects: ["External", "Other"],
      changeProject: async (old: string, next?: string) => {
        calls.push([old, next]);
      },
    };
    const item = { name: "Work", description: "An empty project" };
    let saved = await store.change(
      {
        revision: 0,
        kind: "project",
        action: "save",
        originalName: "",
        item,
      },
      [],
      noTagWrite,
      context,
    );
    assert.deepEqual(saved.projects, [item]);
    assert.equal(calls.length, 0);
    await assert.rejects(
      store.change(
        {
          revision: 1,
          kind: "project",
          action: "save",
          originalName: "",
          item: { name: "work", description: "" },
        },
        [],
        noTagWrite,
        context,
      ),
      /already exists/,
    );
    await assert.rejects(
      store.change(
        {
          revision: 1,
          kind: "project",
          action: "save",
          originalName: "",
          item: { name: "External", description: "" },
        },
        [],
        noTagWrite,
        context,
      ),
      /already exists/,
    );
    saved = await store.change(
      {
        revision: 1,
        kind: "filter",
        action: "save",
        item: {
          id: "",
          name: "Work filter",
          expression: "project:Work or project.is:Work.child",
          description: "",
          color: "gray",
          favorite: false,
        },
      },
      [],
      noTagWrite,
    );
    saved = await store.change(
      {
        revision: 2,
        kind: "project",
        action: "save",
        originalName: "Work",
        item: { ...item, name: "Product launch" },
      },
      [],
      noTagWrite,
      context,
    );
    assert.deepEqual(calls, [["Work", "Product launch"]]);
    assert.equal(
      saved.filters[0].expression,
      '"project:Product launch" or "project.is:Product launch.child"',
    );
    await assert.rejects(
      store.change(
        {
          revision: 2,
          kind: "project",
          action: "delete",
          item: saved.projects![0],
        },
        [],
        noTagWrite,
        context,
      ),
      { status: 409 },
    );
    const before = await store.read();
    await assert.rejects(
      store.change(
        {
          revision: 3,
          kind: "project",
          action: "save",
          originalName: "Product launch",
          item: { ...item, name: "Changed" },
        },
        [],
        noTagWrite,
        {
          ...context,
          changeProject: async () => {
            throw new Error("write failed");
          },
        },
      ),
      /write failed/,
    );
    assert.deepEqual(await store.read(), before);
    saved = await store.change(
      {
        revision: 3,
        kind: "project",
        action: "delete",
        originalName: "Product launch",
        item: saved.projects![0],
      },
      [],
      noTagWrite,
      context,
    );
    assert.deepEqual(saved.projects, []);
    assert.deepEqual(saved.board, board);
    assert.deepEqual(calls.at(-1), ["Product launch", undefined]);
    assert.equal(saved.filters.length, 1);
    await assert.rejects(
      store.change(
        { revision: 4, kind: "project", action: "delete", item },
        [],
        noTagWrite,
        context,
      ),
      /no longer exists/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("subtask links persist atomically, reject cycles and self-parenting", async () => {
  const directory = await mkdtemp(tmpdir() + "/aster-subtask-");
  try {
    const store = createOrganizationStore(directory + "/organization.json");
    const parentUuid = "11111111-1111-4111-8111-111111111111";
    const childUuid = "22222222-2222-4222-8222-222222222222";
    const grandchildUuid = "33333333-3333-4333-8333-333333333333";

    // Link child to parent
    const linked = await store.change({
      revision: 0,
      kind: "subtask",
      action: "link",
      childUuid,
      parentUuid,
    });
    assert.equal(linked.revision, 1);
    assert.equal(linked.subtasks?.[childUuid], parentUuid);

    // Read from disk to verify persistence
    const reloaded = await createOrganizationStore(directory + "/organization.json").read();
    assert.equal(reloaded.subtasks?.[childUuid], parentUuid);

    // Link grandchild to child
    const linked2 = await store.change({
      revision: 1,
      kind: "subtask",
      action: "link",
      childUuid: grandchildUuid,
      parentUuid: childUuid,
    });
    assert.equal(linked2.revision, 2);
    assert.equal(linked2.subtasks?.[grandchildUuid], childUuid);

    // Reject self-parenting
    await assert.rejects(
      store.change({
        revision: 2,
        kind: "subtask",
        action: "link",
        childUuid: parentUuid,
        parentUuid: parentUuid,
      }),
      /cannot be a subtask of itself/,
    );

    // Reject cycle: parent -> child -> grandchild -> parent
    await assert.rejects(
      store.change({
        revision: 2,
        kind: "subtask",
        action: "link",
        childUuid: parentUuid,
        parentUuid: grandchildUuid,
      }),
      /Circular subtask dependency/,
    );

    // Unlink child
    const unlinked = await store.change({
      revision: 2,
      kind: "subtask",
      action: "unlink",
      childUuid,
    });
    assert.equal(unlinked.revision, 3);
    assert.equal(unlinked.subtasks?.[childUuid], undefined);
    assert.equal(unlinked.subtasks?.[grandchildUuid], childUuid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

