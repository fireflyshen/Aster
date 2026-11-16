import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskArguments,
  dependsArguments,
  stateArguments,
} from "../tasks/arguments.ts";
import { hydrateTaskwarriorTasks, tasksForView } from "../tasks/model.ts";
import { STATE_SCHEMA } from "../tasks/service-runner.ts";
import {
  allowedStateTargets,
  canTransition,
  DOING_LIMIT,
  effectiveState,
  isStateManaged,
  MAX_DOING_LIMIT,
  MIN_DOING_LIMIT,
  normalizeDoingLimit,
  PARK_DAYS,
  STATE_LABELS,
  type StateLookupTask,
  TaskStateError,
} from "../tasks/state.ts";
import { normalizePreferencesPatch } from "../workspace/preferences.ts";

test("task state constants and transitions enforce allowed state graph", () => {
  assert.equal(DOING_LIMIT, 5);
  assert.equal(PARK_DAYS, 30);
  assert.equal(STATE_LABELS.doing, "处理中");

  assert.equal(canTransition("planned", "doing"), true);
  assert.equal(canTransition("planned", "parked"), true);
  assert.equal(canTransition("planned", "completed"), true);
  assert.equal(canTransition("planned", "waiting"), false);

  assert.equal(canTransition("doing", "planned"), true);
  assert.equal(canTransition("doing", "waiting"), true);
  assert.equal(canTransition("doing", "parked"), true);
  assert.equal(canTransition("doing", "completed"), true);

  assert.equal(canTransition("waiting", "doing"), true);
  assert.equal(canTransition("waiting", "completed"), false);
  assert.equal(canTransition("waiting", "planned"), false);
  assert.equal(canTransition("waiting", "parked"), false);

  assert.equal(canTransition("parked", "planned"), true);
  assert.equal(canTransition("parked", "doing"), false);
  assert.equal(canTransition("parked", "completed"), false);

  assert.equal(canTransition("completed", "planned"), true);
  assert.equal(canTransition("completed", "doing"), false);

  assert.deepEqual(allowedStateTargets("planned"), ["doing", "parked"]);
  assert.deepEqual(allowedStateTargets("doing"), [
    "planned",
    "waiting",
    "parked",
  ]);
  assert.deepEqual(allowedStateTargets("waiting"), ["doing"]);
  assert.deepEqual(allowedStateTargets("parked"), ["planned"]);
});

test("effectiveState excludes habits, prioritizes completed, and inherits parent state", () => {
  const org = {
    projects: [
      {
        name: "Habits",
        category: "habit" as const,
        color: "green" as const,
        description: "",
      },
    ],
    subtasks: { "child-1": "parent-1" },
  };
  const habitUuids = new Set(["habit-bound-1"]);
  const parent: StateLookupTask = {
    uuid: "parent-1",
    status: "pending",
    state: "doing",
  };
  const child: StateLookupTask = {
    uuid: "child-1",
    status: "pending",
    state: "planned",
  };
  const map = new Map<string, StateLookupTask>([
    [parent.uuid, parent],
    [child.uuid, child],
  ]);

  assert.equal(
    effectiveState(
      { uuid: "h1", status: "pending", project: "Habits" },
      org,
      habitUuids,
    ),
    null,
  );
  assert.equal(
    isStateManaged(
      { uuid: "habit-bound-1", project: "Inbox" },
      org,
      habitUuids,
    ),
    false,
  );
  assert.equal(
    effectiveState(
      { uuid: "habit-bound-1", status: "pending", state: "doing" },
      org,
      habitUuids,
    ),
    null,
  );
  assert.equal(
    effectiveState(
      { uuid: "c1", status: "completed", state: "doing" },
      org,
      habitUuids,
    ),
    "completed",
  );
  assert.equal(effectiveState(child, org, habitUuids, map), "doing");
});

test("hydrateTaskwarriorTasks parses state UDA fields and warns on invalid state", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg?: unknown) => warnings.push(String(msg));
  try {
    const tasks = hydrateTaskwarriorTasks([
      {
        uuid: "11111111-1111-4111-8111-111111111111",
        description: "Valid waiting",
        status: "pending",
        state: "waiting",
        waitreason: "等待快递",
        statechanged: "20261116T100000Z",
      },
      {
        uuid: "22222222-2222-4222-8222-222222222222",
        description: "Invalid state",
        status: "pending",
        state: "bogus",
      },
    ]);
    assert.equal(tasks[0].state, "waiting");
    assert.equal(tasks[0].waitReason, "等待快递");
    assert.equal(
      tasks[0].stateChanged?.toISOString(),
      "2026-11-16T10:00:00.000Z",
    );
    assert.equal(tasks[1].state, undefined);
    assert.equal(warnings.length, 1);

    const doing = hydrateTaskwarriorTasks([
      {
        uuid: "33333333-3333-4333-8333-333333333333",
        description: "Doing task",
        status: "pending",
        state: "doing",
      },
    ]);
    assert.equal(tasksForView([...tasks, ...doing], "now").length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("stateArguments, dependsArguments, STATE_SCHEMA, and TaskStateError", () => {
  const uuid1 = "11111111-1111-4111-8111-111111111111";
  const uuid2 = "22222222-2222-4222-8222-222222222222";
  const args = stateArguments(uuid1, {
    state: "waiting",
    waitreason: "等回复",
    wait: "20261120T000000Z",
  });
  assert.ok(args.includes("state:waiting"));
  assert.ok(args.includes("waitreason:等回复"));
  assert.ok(args.includes("wait:20261120T000000Z"));
  assert.ok(args.includes("statechanged:now"));
  assert.throws(
    () => stateArguments(uuid1, { waitreason: "line1\nline2" }),
    /line breaks/,
  );
  assert.deepEqual(dependsArguments(uuid1, [uuid2, uuid2]).slice(0, 3), [
    uuid1,
    "modify",
    `depends:${uuid2}`,
  ]);
  assert.ok(
    addTaskArguments({
      description: "Test",
      tags: [],
      state: "planned",
      statechanged: "now",
    }).includes("state:planned"),
  );
  assert.equal(
    STATE_SCHEMA["uda.state.values"],
    "planned,doing,waiting,parked,",
  );
  const err = new TaskStateError(409, "STATE_DOING_LIMIT", "full", {
    limit: 5,
  });
  assert.equal(err.status, 409);
  assert.equal(err.code, "STATE_DOING_LIMIT");

  assert.equal(normalizeDoingLimit(undefined), 5);
  assert.equal(normalizeDoingLimit(2), 2);
  assert.equal(normalizeDoingLimit(20), MAX_DOING_LIMIT);
  assert.equal(normalizeDoingLimit(0), DOING_LIMIT);
  assert.equal(normalizeDoingLimit(21), DOING_LIMIT);
  assert.deepEqual(normalizePreferencesPatch({ doingLimit: 8 }), {
    doingLimit: 8,
  });
  assert.throws(() => normalizePreferencesPatch({ doingLimit: 0 }));
  assert.throws(() =>
    normalizePreferencesPatch({ doingLimit: MAX_DOING_LIMIT + 1 }),
  );
  assert.equal(MIN_DOING_LIMIT, 1);
});
