import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zonedDateTimeToUtcMs } from "../../core/time/zone.ts";
import { createHabitHandlers } from "../src/habits/habit-api.ts";
import { createHabitStore, HabitStoreError } from "../src/habits/habit-store.ts";

test("habit store lifecycle: positive, negative, checklist with metrics, A/B rotation, revisions, and backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-habits-"));
  try {
    // 2026-11-10 is Tuesday
    let fakeNow = zonedDateTimeToUtcMs("2026-11-10", "10:00", "Asia/Shanghai");
    const store = createHabitStore(join(dir, "habits.sqlite"), {
      now: () => fakeNow,
      getTimezone: () => "Asia/Shanghai",
    });

    // 1. Create positive simple habit
    const reading = store.createHabit({
      title: "阅读",
      kind: "positive",
      completionMode: "simple",
      description: "勤勉：每天阅读 20 分钟",
      project: "学习",
      tags: ["晚间"],
      schedule: { type: "daily" },
    });
    assert.equal(reading.title, "阅读");
    assert.equal(reading.project, "学习");

    // 2. Create negative habit
    const noSugar = store.createHabit({
      title: "不喝含糖饮料",
      kind: "negative",
      description: "节制",
      project: "身体维护",
      tags: ["饮食"],
      schedule: { type: "daily" },
    });

    // 3. Create A/B checklist training habit (Tue/Thu/Sat = [2, 4, 6])
    const lift = store.createHabit({
      title: "力量训练",
      kind: "positive",
      completionMode: "checklist",
      abEnabled: true,
      project: "身体维护",
      tags: ["晚间"],
      schedule: { type: "weekly", weekdays: [2, 4, 6] },
      plans: [
        {
          id: "A",
          name: "方案 A",
          items: [
            { id: "pushup", title: "俯卧撑", required: true },
            { id: "press", title: "哑铃卧推", required: true },
            { id: "stretch", title: "拉伸", required: false },
          ],
        },
        {
          id: "B",
          name: "方案 B",
          items: [{ id: "row", title: "划船", required: true }],
        },
      ],
    });

    // Today (Tue 11-10) should show all 3 habits
    let today = store.getTodayHabits();
    assert.equal(today.todayDate, "2026-11-10");
    assert.equal(today.items.length, 3);

    // Checklist habit rejects direct simple toggle
    assert.throws(
      () => store.togglePositiveHabit(lift.id, "2026-11-10"),
      (err: unknown) =>
        err instanceof HabitStoreError &&
        err.code === "CHECKLIST_HABIT_REQUIRES_ITEMS",
    );

    // Check pushup without metrics, press with metrics -> auto-completes Plan A (stretch is optional!)
    store.setChecklistItem({
      habitId: lift.id,
      date: "2026-11-10",
      itemId: "pushup",
      done: true,
    });
    let liftEval = store.setChecklistItem({
      habitId: lift.id,
      date: "2026-11-10",
      itemId: "press",
      done: true,
      sets: "4",
      reps: "12",
      weight: "20kg",
    });
    assert.equal(liftEval.achieved, true);
    assert.equal(liftEval.planId, "A");
    assert.equal(liftEval.checklistProgress.press.weight, "20kg");

    // Toggle reading done + record a sugar drink slip with note + undo
    store.togglePositiveHabit(reading.id, "2026-11-10", true);
    const slip = store.recordNegativeEvent({
      habitId: noSugar.id,
      date: "2026-11-10",
      note: "聚餐",
    });
    assert.equal(slip.evaluation.events.length, 1);
    assert.equal(slip.evaluation.status, "broken");
    const afterUndo = store.undoNegativeEvent(noSugar.id, "2026-11-10");
    assert.equal(afterUndo.events.length, 0);

    // Advance to Thu 2026-11-12 (skipping 11-11 where user never opened app!)
    fakeNow = zonedDateTimeToUtcMs("2026-11-12", "19:00", "Asia/Shanghai");
    today = store.getTodayHabits();
    const todayLift = today.items.find((i) => i.habit.id === lift.id);
    // Plan A completed on 11-10 -> 11-12 defaults to Plan B
    assert.equal(todayLift?.evaluation.planId, "B");

    // Partial on Plan B on 11-12? Wait: Plan B has 1 item; let's check heatmap on 11-11:
    // On 11-11: reading missed, noSugar achieved (auto after midnight!), lift unscheduled => 1/2
    const hm = store.getHeatmap({
      startDate: "2026-11-10",
      endDate: "2026-11-12",
    });
    const byDate = new Map(hm.cells.map((c) => [c.date, c]));
    assert.equal(byDate.get("2026-11-10")?.achievedCount, 3); // reading, lift, noSugar(undone)
    assert.equal(byDate.get("2026-11-10")?.status, "level4");
    assert.equal(byDate.get("2026-11-11")?.achievedCount, 1); // noSugar auto-achieved!
    assert.equal(byDate.get("2026-11-11")?.scheduledCount, 2);
    assert.equal(byDate.get("2026-11-12")?.status, "in_progress");

    // Backfill yesterday (11-11) for reading -> updates 11-11 heatmap & reading streak!
    store.togglePositiveHabit(reading.id, "2026-11-11", true);
    const detailAfterBackfill = store.getHabitDetail(reading.id, 30);
    assert.equal(detailAfterBackfill.streak.currentStreak, 2);

    // Update lift checklist on 11-12 (no log yet today -> applies today, or if logged -> tomorrow)
    store.setDailyNote(reading.id, "2026-11-12", "今天先读两页");
    // Now reading has a log today; updating reading's schedule defaults to tomorrow 11-13
    store.updateHabit(reading.id, {
      schedule: { type: "weekly", weekdays: [1, 3, 5] },
    });
    const readingDetail = store.getHabitDetail(reading.id, 30);
    // Today (Thu 11-12) still uses old daily schedule because revision took effect from 11-13!
    const todayReading = store
      .getTodayHabits()
      .items.find((i) => i.habit.id === reading.id);
    assert.equal(todayReading?.evaluation.scheduled, true);
    assert.equal(
      readingDetail.revisions[readingDetail.revisions.length - 1]
        .effectiveFromDate,
      "2026-11-13",
    );

    // Pause noSugar -> disappears from Today, preserves past streak
    store.setHabitStatus(noSugar.id, "paused");
    assert.equal(
      store.getTodayHabits().items.some((i) => i.habit.id === noSugar.id),
      false,
    );

    // Backup export & restore
    const backup = store.exportBackup();
    assert.equal(backup.habits.length, 3);

    const store2 = createHabitStore(join(dir, "habits2.sqlite"), {
      now: () => fakeNow,
      getTimezone: () => "Asia/Shanghai",
    });
    store2.restoreBackup(backup);
    assert.equal(store2.listHabits({ status: "all" }).length, 3);
    assert.equal(
      store2.getDayDetail("2026-11-10").items.find((i) => i.habit.id === lift.id)
        ?.evaluation.checklistProgress.press.weight,
      "20kg",
    );

    store.close();
    store2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("habit API handlers validate and route GET/POST requests cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-habit-api-"));
  try {
    const fakeNow = zonedDateTimeToUtcMs("2026-11-15", "09:00", "Asia/Shanghai");
    const store = createHabitStore(join(dir, "habits.sqlite"), {
      now: () => fakeNow,
      getTimezone: () => "Asia/Shanghai",
    });
    const routes = createHabitHandlers({ store });
    const map = new Map(routes.map((r) => [`${r.method} ${r.route}`, r]));

    const createRes = await map.get("POST api/habits/create")!.handle({
      searchParams: new URLSearchParams(),
      readBody: async () => ({
        title: "早睡",
        kind: "positive",
        schedule: { type: "daily" },
      }),
      transport: "http",
    });
    assert.equal(createRes.status, 200);
    const habitId = (createRes.body as { habit: { id: string } }).habit.id;

    const todayRes = await map.get("GET api/habits/today")!.handle({
      searchParams: new URLSearchParams(),
      readBody: async () => ({}),
      transport: "http",
    });
    assert.equal(todayRes.status, 200);
    assert.equal(
      (todayRes.body as { items: unknown[] }).items.length,
      1,
    );

    const toggleRes = await map.get("POST api/habits/toggle")!.handle({
      searchParams: new URLSearchParams(),
      readBody: async () => ({ habitId }),
      transport: "http",
    });
    assert.equal(toggleRes.status, 200);
    assert.equal(
      (toggleRes.body as { evaluation: { achieved: boolean } }).evaluation
        .achieved,
      true,
    );

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("task-bound habit syncs title, metadata, and real subtasks from catalog, unbinds cleanly, and cleans up on delete", () => {
  return (async () => {
    const dir = await mkdtemp(join(tmpdir(), "aster-habits-bind-"));
    try {
      const fakeNow = zonedDateTimeToUtcMs("2026-11-15", "09:00", "Asia/Shanghai");
      const store = createHabitStore(join(dir, "habits.sqlite"), {
        now: () => fakeNow,
        getTimezone: () => "Asia/Shanghai",
      });

      const catalog = {
        tasks: [
          {
            uuid: "task-train-1",
            description: "力量训练",
            project: "身体维护",
            tags: ["晚间"],
            status: "pending",
          },
          {
            uuid: "sub-pushup",
            description: "俯卧撑",
            project: "身体维护",
            tags: [],
            status: "pending",
          },
          {
            uuid: "sub-row",
            description: "划船",
            project: "身体维护",
            tags: [],
            status: "pending",
          },
        ],
        subtasks: {
          "sub-pushup": "task-train-1",
          "sub-row": "task-train-1",
        },
        descriptions: {
          "task-train-1": "保持节奏，注意热身",
        },
      };

      const bound = store.bindTaskHabit(
        {
          taskUuid: "task-train-1",
          kind: "positive",
          schedule: { type: "daily" },
          abEnabled: true,
          subtaskPlans: { "sub-row": "B" },
        },
        catalog,
      );
      assert.equal(bound.taskUuid, "task-train-1");
      assert.equal(bound.title, "力量训练");
      assert.equal(bound.project, "身体维护");
      assert.equal(bound.completionMode, "checklist");
      assert.equal(bound.plans.length, 2);
      assert.equal(bound.plans[0].items[0].id, "sub-pushup");
      assert.equal(bound.plans[1].items[0].id, "sub-row");

      // Rename task & subtask in catalog, then syncFromTaskCatalog
      catalog.tasks[0].description = "全身力量训练";
      catalog.tasks[1].description = "上斜俯卧撑";
      store.syncFromTaskCatalog(catalog);

      const synced = store.getHabitDetail("task-train-1").habit;
      assert.equal(synced.title, "全身力量训练");
      assert.equal(synced.plans[0].items[0].title, "上斜俯卧撑");

      // Delete cleanup via deleteHabitIfExists(taskUuid)
      store.deleteHabitIfExists("task-train-1");
      assert.throws(() => store.getHabitDetail("task-train-1"), HabitStoreError);
      // Calling deleteHabitIfExists again on missing id is a safe no-op
      store.deleteHabitIfExists("task-train-1");

      // Re-bind then unbind
      store.bindTaskHabit(
        {
          taskUuid: "task-train-1",
          kind: "negative",
          schedule: { type: "daily" },
        },
        catalog,
      );
      assert.equal(store.getHabitDetail("task-train-1").habit.kind, "negative");
      store.unbindTaskHabit("task-train-1");
      assert.throws(() => store.getHabitDetail("task-train-1"), HabitStoreError);

      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })();
});
