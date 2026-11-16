import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import type { TaskwarriorTask } from "../../core/tasks/model.ts";
import { TaskStateError } from "../../core/tasks/state.ts";
import { createHabitStore } from "../src/habits/habit-store.ts";
import { createOrganizationService } from "../src/organization/organization-service.ts";
import { createRecoveryService } from "../src/recovery/recovery.ts";
import { createTaskStateManager } from "../src/tasks/state-changes.ts";
import { createStateHistoryStore } from "../src/tasks/state-history.ts";
import { createStateTransitionScheduler } from "../src/tasks/state-scheduler.ts";
import { createTaskActions } from "../src/tasks/task-actions.ts";
import { createTimeCoordinator } from "../src/time/time-coordinator.ts";
import { createTimeStore } from "../src/time/time-store.ts";
import { createWorkspaceGate } from "../src/transport/workspace-gate.ts";
import {
  handleAddTask,
  loadScopedTasks,
} from "../src/transport/workspace-api.ts";

function makeFakeTaskEnv(initialTasks: TaskwarriorTask[] = []) {
  const tasks = new Map<string, TaskwarriorTask>(
    initialTasks.map((t) => [t.uuid, { ...t }]),
  );
  let seq = 1;

  const parseArgMap = (args: string[]) => {
    const out: Record<string, string> = {};
    for (const arg of args) {
      const idx = arg.indexOf(":");
      if (idx > 0 && !arg.startsWith("rc.")) {
        out[arg.slice(0, idx)] = arg.slice(idx + 1);
      }
    }
    return out;
  };

  const applyModify = (uuid: string, args: string[]) => {
    const t = tasks.get(uuid);
    if (!t) throw new Error("Task missing");
    if (args.includes("done")) {
      t.status = "completed";
      t.end = new Date();
      delete t.start;
      return "";
    }
    if (args.includes("start")) {
      t.start = new Date();
      return "";
    }
    if (args.includes("stop")) {
      delete t.start;
      return "";
    }
    if (args.includes("delete")) {
      t.status = "deleted";
      return "";
    }
    const kv = parseArgMap(args);
    if (kv.status) t.status = kv.status;
    if ("state" in kv) {
      t.state = kv.state ? (kv.state as TaskwarriorTask["state"]) : undefined;
    }
    if ("waitreason" in kv) {
      t.waitReason = kv.waitreason || undefined;
    }
    if ("wait" in kv) {
      t.wait = kv.wait
        ? new Date(
            kv.wait.replace(
              /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
              "$1-$2-$3T$4:$5:$6Z",
            ),
          )
        : undefined;
    }
    if ("scheduled" in kv) {
      t.scheduled = kv.scheduled
        ? new Date(
            kv.scheduled.replace(
              /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
              "$1-$2-$3T$4:$5:$6Z",
            ),
          )
        : undefined;
    }
    if ("depends" in kv) {
      t.depends = kv.depends ? kv.depends.split(",").filter(Boolean) : [];
    }
    if ("statechanged" in kv) {
      t.stateChanged = new Date();
    }
    return "";
  };

  let writeQueue: Promise<unknown> = Promise.resolve();
  const withWriteLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeQueue.catch(() => undefined).then(fn);
    writeQueue = next;
    return next;
  };

  const service = {
    connection: { key: "test-fake", kind: "local" as const, label: "TEST" },
    withWriteLock,
    writeUnlocked: async (args: string[]) => applyModify(args[0], args),
    loadTasks: async (scope: "pending" | "completed" = "pending") =>
      [...tasks.values()].filter((t) =>
        scope === "pending"
          ? t.status === "pending" || t.status === "waiting"
          : t.status === scope,
      ),
    loadProjects: async () => [
      ...new Set(
        [...tasks.values()].flatMap((t) => (t.project ? [t.project] : [])),
      ),
    ],
    loadTags: async () => [],
    filterTasks: async () => [],
    rawTask: async (uuid: string) => {
      const t = tasks.get(uuid);
      if (!t) throw new Error("Missing");
      return {
        uuid: t.uuid,
        status: t.status,
        description: t.description,
        project: t.project,
        tags: t.tags,
        start: t.start?.toISOString(),
        modified: new Date().toISOString(),
      };
    },
    exportTasks: async () =>
      [...tasks.values()].map((t) => ({
        uuid: t.uuid,
        status: t.status,
        description: t.description,
        project: t.project,
        tags: t.tags,
      })),
    exportDeletedTasks: async () => [],
    exportSchema: async () => ({}),
    exportTimerHistory: async () => [],
    addTask: async (input: Record<string, any>) => {
      const uuid = `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
      tasks.set(uuid, {
        uuid,
        description: input.description,
        status: "pending",
        project: input.project || undefined,
        tags: input.tags || [],
        urgency: 1,
        depends: [],
        annotations: [],
        ...(input.state ? { state: input.state } : {}),
        ...(input.waitreason ? { waitReason: input.waitreason } : {}),
        ...(input.scheduled
          ? {
              scheduled: new Date(
                input.scheduled.replace(
                  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
                  "$1-$2-$3T$4:$5:$6Z",
                ),
              ),
            }
          : {}),
        ...(input.wait
          ? {
              wait: new Date(
                input.wait.replace(
                  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
                  "$1-$2-$3T$4:$5:$6Z",
                ),
              ),
            }
          : {}),
      });
      return `Created task ${uuid}.`;
    },
    completeTask: async (uuid: string) => applyModify(uuid, [uuid, "done"]),
    reopenTask: async (uuid: string) =>
      applyModify(uuid, [uuid, "modify", "status:pending"]),
    deleteTask: async (uuid: string) => applyModify(uuid, [uuid, "delete"]),
    deleteWithSnapshot: async (
      uuid: string,
      beforeDelete: (t: any) => Promise<void>,
    ) => {
      const t = await service.rawTask(uuid);
      await beforeDelete(t);
      return applyModify(uuid, [uuid, "delete"]);
    },
    restoreTask: async (uuid: string) => {
      const t = tasks.get(uuid);
      if (t) t.status = "pending";
      return "";
    },
    startTask: async (uuid: string) => applyModify(uuid, [uuid, "start"]),
    stopTask: async (uuid: string) => applyModify(uuid, [uuid, "stop"]),
    setTaskWait: async (uuid: string, wait: string) =>
      applyModify(uuid, [uuid, "modify", `wait:${wait}`]),
  };

  return { tasks, service: service as any };
}

function uid(n: number) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
}

test("task state machine enforces transitions, 5-doing limit with replacement, waiting rules, habits, and subtasks", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-state-");
  try {
    const initial: TaskwarriorTask[] = [
      ...[1, 2, 3, 4, 5].map((i) => ({
        uuid: uid(i),
        description: `Doing ${i}`,
        status: "pending",
        state: "doing" as const,
        tags: [],
        urgency: 5 + i,
        depends: [],
        annotations: [],
      })),
      {
        uuid: uid(6),
        description: "Planned Task",
        status: "pending",
        state: "planned",
        tags: [],
        urgency: 3,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(7),
        description: "Subtask Child",
        status: "pending",
        state: "planned",
        tags: [],
        urgency: 1,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(8),
        description: "Habit Task",
        status: "pending",
        project: "Habits",
        tags: [],
        urgency: 2,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(9),
        description: "Bound Habit",
        status: "pending",
        tags: [],
        urgency: 2,
        depends: [],
        annotations: [],
      },
    ];
    const { tasks, service } = makeFakeTaskEnv(initial);
    const habitStore = createHabitStore(`${dir}/habits.sqlite`, {
      getTimezone: () => "Asia/Shanghai",
    });
    habitStore.createHabit({
      title: "Bound Habit",
      taskUuid: uid(9),
      kind: "positive",
      schedule: { type: "daily" },
    });
    const orgSvc = createOrganizationService(service, `${dir}/org.json`);
    let org = await orgSvc.change({
      revision: 0,
      kind: "project",
      action: "save",
      item: {
        name: "Habits",
        category: "habit",
        color: "green",
        description: "",
      },
    });
    org = await orgSvc.change({
      revision: org.revision,
      kind: "subtask",
      action: "link",
      childUuid: uid(7),
      parentUuid: uid(6),
    });
    const history = createStateHistoryStore(`${dir}/state-history.jsonl`);
    const recovery = createRecoveryService(
      service,
      orgSvc,
      `${dir}/recovery.json`,
      habitStore,
      history,
    );
    const stateManager = createTaskStateManager({
      service,
      organization: orgSvc,
      history,
      habitStore,
      getTimezone: () => "Asia/Shanghai",
      now: () => Date.parse("2026-11-16T10:00:00Z"),
    });
    const actions = createTaskActions(
      service,
      orgSvc,
      recovery,
      undefined,
      habitStore,
      stateManager,
    );

    // Doing limit blocked when trying to move planned -> doing without replaceUuid
    await assert.rejects(
      actions(
        { action: "state.set", uuid: uid(6), state: "doing" },
        { source: "web" },
      ),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.status === 409 &&
        err.code === "STATE_DOING_LIMIT" &&
        (err.details as any).limit === 5 &&
        (err.details as any).doing.length === 5,
    );

    // Replace uid(1) -> planned, and promote uid(6) -> doing, cascading uid(7) -> doing
    await actions(
      {
        action: "state.set",
        uuid: uid(6),
        state: "doing",
        replaceUuid: uid(1),
      },
      { source: "mcp", actor: "test" },
    );
    assert.equal(tasks.get(uid(1))?.state, "planned");
    assert.equal(tasks.get(uid(6))?.state, "doing");
    assert.equal(tasks.get(uid(7))?.state, "doing");

    // Subtask direct modification blocked
    await assert.rejects(
      actions({ action: "state.set", uuid: uid(7), state: "planned" }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.status === 409 &&
        err.code === "STATE_SUBTASK_FOLLOWS_PARENT",
    );

    // Habit exclusion (project & bound)
    await assert.rejects(
      actions({ action: "state.set", uuid: uid(8), state: "planned" }),
      (err: unknown) =>
        err instanceof TaskStateError && err.code === "STATE_HABIT_EXCLUDED",
    );
    await assert.rejects(
      actions({ action: "state.set", uuid: uid(9), state: "doing" }),
      (err: unknown) =>
        err instanceof TaskStateError && err.code === "STATE_HABIT_EXCLUDED",
    );

    // Waiting missing waitReason / checkDate -> 400
    await assert.rejects(
      actions({ action: "state.set", uuid: uid(6), state: "waiting" }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.status === 400 &&
        err.code === "STATE_WAIT_REASON_REQUIRED",
    );
    await assert.rejects(
      actions({
        action: "state.set",
        uuid: uid(6),
        state: "waiting",
        waitReason: "等快递",
      }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.status === 400 &&
        err.code === "STATE_CHECK_DATE_REQUIRED",
    );

    // Valid waiting transition + forbid direct complete/planned from waiting
    await actions({
      action: "state.set",
      uuid: uid(6),
      state: "waiting",
      waitReason: "等回复",
      checkDate: "2026-11-20",
    });
    assert.equal(tasks.get(uid(6))?.waitReason, "等回复");
    assert.equal(tasks.get(uid(7))?.state, "waiting");

    await assert.rejects(
      actions({ action: "complete", uuid: uid(6) }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.code === "STATE_TRANSITION_FORBIDDEN",
    );
    await assert.rejects(
      actions({ action: "state.set", uuid: uid(6), state: "planned" }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.code === "STATE_TRANSITION_FORBIDDEN",
    );

    // Waiting -> doing -> parked (default +30d) -> forbid doing -> parked -> planned -> reopen
    await actions({ action: "state.set", uuid: uid(6), state: "doing" });
    await actions({ action: "state.set", uuid: uid(6), state: "parked" });
    assert.ok(tasks.get(uid(6))?.wait);
    await assert.rejects(
      actions({ action: "state.set", uuid: uid(6), state: "doing" }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.code === "STATE_TRANSITION_FORBIDDEN",
    );

    // Planned -> completed records implicit planned->doing->completed without doing-limit failure
    await actions({ action: "state.set", uuid: uid(6), state: "planned" });
    await actions({ action: "complete", uuid: uid(6) }, { source: "web" });
    const entries = await history.read({ uuid: uid(6), limit: 20 });
    assert.equal(entries[0].to, "completed");
    assert.equal(entries[1].from, "planned");
    assert.equal(entries[1].to, "doing");

    // Reopen returns task to planned
    await actions({ action: "reopen", uuid: uid(6) }, { source: "tui" });
    assert.equal(tasks.get(uid(6))?.state, "planned");

    // Depends cycle detection
    await assert.rejects(
      actions({ action: "depends", uuid: uid(6), add: [uid(6)] }),
      (err: unknown) => err instanceof TaskStateError && err.status === 400,
    );
    await actions({ action: "depends", uuid: uid(6), add: [uid(2)] });
    await assert.rejects(
      actions({ action: "depends", uuid: uid(2), add: [uid(6)] }),
      (err: unknown) =>
        err instanceof TaskStateError && err.code === "STATE_DEPENDENCY_CYCLE",
    );

    // Wait on planned task behaves as schedule with deprecation warning
    const waitRes = (await actions({
      action: "wait",
      uuid: uid(6),
      wait: "20261125T000000Z",
    })) as any;
    assert.equal(waitRes.deprecated, true);
    assert.equal(
      tasks.get(uid(6))?.scheduled?.toISOString(),
      "2026-11-25T00:00:00.000Z",
    );

    // View=now query returns doing tasks only
    const nowView = await loadScopedTasks(
      service,
      orgSvc,
      new URLSearchParams("view=now"),
      "pending",
    );
    assert.equal(
      nowView.tasks.every((t: any) => t.state === "doing"),
      true,
    );

    habitStore.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("start action promotes planned tasks via timeCoordinator without creating timer on doing limit", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-state-time-");
  try {
    const initial: TaskwarriorTask[] = [
      ...[1, 2, 3, 4].map((i) => ({
        uuid: uid(i),
        description: `Doing ${i}`,
        status: "pending",
        state: "doing" as const,
        project: "Work",
        tags: [],
        urgency: 5,
        depends: [],
        annotations: [],
      })),
      {
        uuid: uid(6),
        description: "Planned Startable",
        status: "pending",
        state: "planned",
        project: "Work",
        tags: [],
        urgency: 4,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(7),
        description: "Another Planned",
        status: "pending",
        state: "planned",
        project: "Work",
        tags: [],
        urgency: 3,
        depends: [],
        annotations: [],
      },
    ];
    const { tasks, service } = makeFakeTaskEnv(initial);
    const orgSvc = createOrganizationService(service, `${dir}/org.json`);
    const history = createStateHistoryStore(`${dir}/state-history.jsonl`);
    const timeStore = await createTimeStore(`${dir}/time.sqlite`, {
      enabled: true,
    });
    const stateManager = createTaskStateManager({
      service,
      organization: orgSvc,
      history,
      getTimezone: () => "Asia/Shanghai",
    });
    const coordinator = createTimeCoordinator({
      service,
      store: timeStore,
      beforeStart: stateManager.ensureStartReady,
      prepareComplete: stateManager.prepareComplete,
    });
    const recovery = createRecoveryService(
      service,
      orgSvc,
      `${dir}/recovery.json`,
      undefined,
      history,
    );
    const actions = createTaskActions(
      service,
      orgSvc,
      recovery,
      { isEnabled: () => true, coordinator },
      undefined,
      stateManager,
    );

    // 4 doing -> starting planned uid(6) succeeds and promotes it to 5th doing
    await actions({ action: "start", uuid: uid(6) }, { source: "mcp" });
    assert.equal(tasks.get(uid(6))?.state, "doing");
    assert.equal(timeStore.getStatus().activeActivity?.taskUuid, uid(6));

    // Stop does not demote state
    await actions({ action: "stop", uuid: uid(6) });
    assert.equal(tasks.get(uid(6))?.state, "doing");
    assert.equal(timeStore.getStatus().activeActivity, null);

    // Now 5 doing -> starting planned uid(7) fails 409 STATE_DOING_LIMIT & no timer started
    await assert.rejects(
      actions({ action: "start", uuid: uid(7) }, { source: "mcp" }),
      (err: unknown) =>
        err instanceof TaskStateError && err.code === "STATE_DOING_LIMIT",
    );
    assert.equal(timeStore.getStatus().activeActivity, null);
    assert.equal(tasks.get(uid(7))?.state, "planned");

    // Waiting task cannot be completed through timeCoordinator
    await actions({
      action: "state.set",
      uuid: uid(6),
      state: "waiting",
      waitReason: "等待签字",
      checkDate: "2026-11-22",
    });
    await assert.rejects(
      actions({ action: "complete", uuid: uid(6) }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.code === "STATE_TRANSITION_FORBIDDEN",
    );

    // handleAddTask writes state:planned by default & rejects doing when full
    const created = await handleAddTask(
      service,
      orgSvc,
      { description: "New planned task", project: "Work", tags: [] },
      stateManager,
      { source: "web" },
    );
    assert.equal(tasks.get(created.uuid!)?.state, "planned");

    timeStore.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("state scheduler promotes waitingDue then planned due up to 5 and reports blocked, parkedDue, and anomalies", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-sched-");
  try {
    const initial: TaskwarriorTask[] = [
      ...[1, 2, 3].map((i) => ({
        uuid: uid(i),
        description: `Doing ${i}`,
        status: "pending",
        state: "doing" as const,
        tags: [],
        urgency: 5,
        depends: [],
        annotations: [],
      })),
      {
        uuid: uid(4),
        description: "Waiting Due",
        status: "waiting",
        state: "waiting",
        wait: new Date("2026-11-16T00:00:00Z"),
        waitReason: "等对方答复",
        tags: [],
        urgency: 2,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(5),
        description: "Planned Due High Urgency",
        status: "pending",
        state: "planned",
        scheduled: new Date("2026-11-16T00:00:00Z"),
        tags: [],
        urgency: 9,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(6),
        description: "Planned Due Overflow",
        status: "pending",
        state: "planned",
        scheduled: new Date("2026-11-16T02:00:00Z"),
        tags: [],
        urgency: 1,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(7),
        description: "Parked Review Due",
        status: "waiting",
        state: "parked",
        wait: new Date("2026-11-15T00:00:00Z"),
        tags: [],
        urgency: 1,
        depends: [],
        annotations: [],
      },
      {
        uuid: uid(8),
        description: "Anomaly Missing State",
        status: "pending",
        tags: [],
        urgency: 1,
        depends: [],
        annotations: [],
      },
    ];
    const { tasks, service } = makeFakeTaskEnv(initial);
    const orgSvc = createOrganizationService(service, `${dir}/org.json`);
    const history = createStateHistoryStore(`${dir}/state-history.jsonl`);
    const gate = createWorkspaceGate();
    const stateManager = createTaskStateManager({
      service,
      organization: orgSvc,
      history,
      getTimezone: () => "Asia/Shanghai",
      now: () => Date.parse("2026-11-16T12:00:00Z"),
    });
    const scheduler = createStateTransitionScheduler({
      stateManager,
      gate,
      getTimezone: () => "Asia/Shanghai",
      now: () => Date.parse("2026-11-16T12:00:00Z"),
      pollIntervalMs: 60_000,
    });

    const tick1 = await scheduler.tickNow();
    assert.deepEqual(tick1.promoted, [uid(4), uid(5)]);
    assert.equal(tasks.get(uid(4))?.state, "doing");
    assert.equal(tasks.get(uid(5))?.state, "doing");
    assert.equal(tasks.get(uid(6))?.state, "planned");
    assert.equal(tasks.get(uid(7))?.state, "parked");

    const summary = await stateManager.getSummary();
    assert.equal(summary.doing.length, 5);
    assert.equal(summary.promotionBlocked.length, 1);
    assert.equal(summary.promotionBlocked[0].uuid, uid(6));
    assert.equal(summary.parkedReviewDue.length, 1);
    assert.equal(summary.parkedReviewDue[0].uuid, uid(7));
    assert.equal(
      summary.anomalies.some(
        (a) => a.uuid === uid(8) && a.type === "missing_state",
      ),
      true,
    );

    scheduler.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateManager enforces configurable preferences.doingLimit dynamically", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-limit-");
  try {
    const initial: TaskwarriorTask[] = [1, 2, 3, 4].map((i) => ({
      uuid: uid(i),
      description: `Task ${i}`,
      status: "pending",
      state: i === 1 ? ("doing" as const) : ("planned" as const),
      tags: [],
      urgency: i,
      depends: [],
      annotations: [],
    }));
    const { tasks, service } = makeFakeTaskEnv(initial);
    const orgSvc = createOrganizationService(service, `${dir}/org.json`);
    const history = createStateHistoryStore(`${dir}/state-history.jsonl`);
    const stateManager = createTaskStateManager({
      service,
      organization: orgSvc,
      history,
      getTimezone: () => "Asia/Shanghai",
      now: () => Date.parse("2026-11-16T12:00:00Z"),
    });

    await orgSvc.updatePreferences({ doingLimit: 2 });
    let summary = await stateManager.getSummary();
    assert.equal(summary.limit, 2);

    await stateManager.setState({ uuid: uid(2), state: "doing" }, { source: "web" });
    await assert.rejects(
      stateManager.setState({ uuid: uid(3), state: "doing" }, { source: "web" }),
      (err: unknown) =>
        err instanceof TaskStateError &&
        err.code === "STATE_DOING_LIMIT" &&
        (err.details as { limit?: number } | undefined)?.limit === 2,
    );

    // Raising limit to 4 lets 3rd and 4th enter doing without replacement
    await orgSvc.updatePreferences({ doingLimit: 4 });
    summary = await stateManager.getSummary();
    assert.equal(summary.limit, 4);
    await stateManager.setState({ uuid: uid(3), state: "doing" }, { source: "web" });
    assert.equal(tasks.get(uid(3))?.state, "doing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
