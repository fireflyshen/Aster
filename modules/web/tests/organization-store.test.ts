import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createOrganizationStore } from "../server/organization-store.ts";
import type { SavedTag, SavedFilter } from "../shared/organization.ts";

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
    const saved = await store.change({ revision: 0, kind: "filter", action: "save", item: filter }, [], effect);
    assert.equal(saved.revision, 1);
    assert.equal((await createOrganizationStore(directory + "/organization.json").read()).filters[0].name, "Todo");
    await assert.rejects(store.change({ revision: 0, kind: "filter", action: "save", item: filter }, [], effect), {
      status: 409,
    });
    await assert.rejects(
      store.change(
        { revision: 1, kind: "filter", action: "save", item: { ...filter, name: "Other", expression: "delete" } },
        [],
        effect,
      ),
    );
    assert.equal((await store.read()).revision, 1);
    const tag: SavedTag = { id: "", name: "Todo", color: "blue", favorite: true };
    const next = await store.change({ revision: 1, kind: "tag", action: "save", item: tag }, [], effect);
    assert.equal(next.tags[0].name, "Todo");
    assert.equal(next.filters.length, 1);
    const calls: string[] = [];
    const renamed = await store.change(
      { revision: 2, kind: "tag", action: "save", item: { ...next.tags[0], name: "Doing" } },
      next.tags,
      async (old, changed) => {
        calls.push(old.name + ":" + changed?.name);
      },
    );
    assert.deepEqual(calls, ["Todo:Doing"]);
    assert.equal(renamed.filters[0].expression, "status:pending +Doing");
    const removed = await store.change(
      { revision: 3, kind: "tag", action: "delete", item: renamed.tags[0] },
      renamed.tags,
      async () => {},
    );
    assert.equal(removed.tags.length, 0);
    assert.equal(removed.filters.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("failed RN changes leave metadata untouched; duplicate names and reserved tags are rejected", async () => {
  const directory = await mkdtemp(tmpdir() + "/aster-organization-");
  try {
    const store = createOrganizationStore(directory + "/organization.json");
    const tag: SavedTag = { id: "tag:Todo", name: "Todo", color: "gray", favorite: false };
    await assert.rejects(
      store.change({ revision: 0, kind: "tag", action: "save", item: { ...tag, name: "Doing" } }, [tag], async () => {
        throw new Error("connection failed");
      }),
      /connection failed/,
    );
    assert.equal((await store.read()).revision, 0);
    await assert.rejects(
      store.change(
        { revision: 0, kind: "tag", action: "save", item: { ...tag, id: "", name: "todo" } },
        [tag],
        async () => {},
      ),
      /name already exists/,
    );
    await assert.rejects(
      store.change(
        { revision: 0, kind: "tag", action: "save", item: { ...tag, id: "", name: "READY" } },
        [],
        async () => {},
      ),
      /virtual tags/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
