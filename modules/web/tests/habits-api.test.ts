import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { habitHeatmapLevel } from "../src/features/habits/heatmap-level.ts";
import { zonedDateTimeToUtcMs } from "../../core/time/zone.ts";
import { createHabitHandlers } from "../../server/src/habits/habit-api.ts";
import {
  createHabitStore,
  HabitStoreError,
} from "../../server/src/habits/habit-store.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const coreRoot = path.resolve(webRoot, "..", "core");

const compiled = esbuild.buildSync({
  entryPoints: [path.join(webRoot, "src/features/habits/habits-api.ts")],
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
const habitsApi = await import(moduleUrl);

test("web habits-api routes cleanly through real server handlers end-to-end", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aster-web-habits-"));
  const dbPath = path.join(dir, "habits.sqlite");
  // 2026-11-15 is Sunday
  const fakeNow = zonedDateTimeToUtcMs("2026-11-15", "18:00", "Asia/Shanghai");
  const store = createHabitStore(dbPath, {
    now: () => fakeNow,
    getTimezone: () => "Asia/Shanghai",
  });
  const handlers = createHabitHandlers({ store });
  const routeMap = new Map(handlers.map((r) => [`${r.method}:${r.route}`, r]));

  const fetchedUrls: string[] = [];
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const rawUrl = String(input);
    fetchedUrls.push(rawUrl);
    assert.ok(!rawUrl.startsWith("/api/api/"), `Unexpected URL: ${rawUrl}`);

    const parsed = new URL(rawUrl, "http://127.0.0.1:4180");
    const method = (init?.method || "GET").toUpperCase();
    const route = parsed.pathname.replace(/^\//, "");
    const spec = routeMap.get(`${method}:${route}`);
    if (!spec) {
      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const bodyText = typeof init?.body === "string" ? init.body : "";
    try {
      const res = await spec.handle({
        searchParams: parsed.searchParams,
        readBody: async () => (bodyText ? JSON.parse(bodyText) : {}),
        transport: "http",
      } as never);
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      if (err instanceof HabitStoreError) {
        return new Response(
          JSON.stringify({
            error: err.message,
            code: err.code,
          }),
          {
            status: err.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      throw err;
    }
  }) as typeof fetch;

  try {
    const emptyToday = await habitsApi.fetchTodayHabits();
    assert.equal(emptyToday.todayDate, "2026-11-15");
    assert.equal(emptyToday.items.length, 0);

    const { habit: reading } = await habitsApi.createHabitApi({
      title: "阅读",
      kind: "positive",
      trackTime: false,
      completionMode: "simple",
      description: "勤勉：每天阅读",
      project: "学习",
      tags: ["晚间"],
      schedule: { type: "daily" },
    });
    assert.equal(reading.title, "阅读");
    assert.equal(reading.trackTime, false);

    const { habit: workout } = await habitsApi.createHabitApi({
      title: "力量训练",
      kind: "positive",
      completionMode: "checklist",
      abEnabled: true,
      project: "身体维护",
      tags: ["晚间"],
      schedule: { type: "daily" },
      plans: [
        {
          id: "plan-a",
          name: "A 方案",
          items: [
            { id: "pushup", title: "俯卧撑", required: true },
            { id: "row", title: "划船", required: true },
          ],
        },
        {
          id: "plan-b",
          name: "B 方案",
          items: [{ id: "squat", title: "深蹲", required: true }],
        },
      ],
    });

    const { habit: noSugar } = await habitsApi.createHabitApi({
      title: "不喝含糖饮料",
      kind: "negative",
      project: "身体维护",
      schedule: { type: "daily" },
    });

    const today = await habitsApi.fetchTodayHabits();
    assert.equal(today.items.length, 3);

    // Regression: an ordinary check-in must recolor today immediately, including
    // the individual detail heatmap; undo must restore the neutral fill.
    const todayCell = async (habitId?: string) => {
      const map = await habitsApi.fetchHabitHeatmap({
        days: 30,
        habitId,
      });
      return map.cells.at(-1)!;
    };
    assert.equal(habitHeatmapLevel(await todayCell()), 0);
    assert.equal(habitHeatmapLevel(await todayCell(noSugar.id)), 0);
    const toggled = await habitsApi.togglePositiveHabitApi(
      reading.id,
      "2026-11-15",
    );
    assert.equal(toggled.evaluation.status, "achieved");
    assert.equal(habitHeatmapLevel(await todayCell()), 1);
    assert.equal(habitHeatmapLevel(await todayCell(reading.id)), 4);
    const completedDetail = await habitsApi.fetchHabitDetail(reading.id, 30);
    assert.equal(habitHeatmapLevel(completedDetail.heatmap.cells.at(-1)!), 4);
    await habitsApi.togglePositiveHabitApi(reading.id, "2026-11-15", false);
    assert.equal(habitHeatmapLevel(await todayCell(reading.id)), 0);
    await habitsApi.togglePositiveHabitApi(reading.id, "2026-11-15", true);

    const partial = await habitsApi.setChecklistItemApi({
      habitId: workout.id,
      itemId: "pushup",
      date: "2026-11-15",
      done: true,
      sets: "4",
      reps: "12",
    });
    assert.equal(partial.evaluation.status, "partial");

    const doneWorkout = await habitsApi.setChecklistItemApi({
      habitId: workout.id,
      itemId: "row",
      date: "2026-11-15",
      done: true,
    });
    assert.equal(doneWorkout.evaluation.status, "achieved");

    const planBId = workout.plans[1].id;
    const switched = await habitsApi.switchDayPlanApi({
      habitId: workout.id,
      planId: planBId,
      date: "2026-11-15",
    });
    assert.equal(switched.evaluation.planId, planBId);

    const negRec = await habitsApi.recordNegativeEventApi({
      habitId: noSugar.id,
      date: "2026-11-15",
      note: "聚餐",
    });
    assert.equal(negRec.evaluation.events.length, 1);
    assert.equal(habitHeatmapLevel(await todayCell(noSugar.id)), 0);

    const negEdited = await habitsApi.updateNegativeEventNoteApi({
      habitId: noSugar.id,
      eventId: negRec.eventId,
      note: "朋友生日聚餐",
    });
    assert.equal(negEdited.evaluation.events[0].note, "朋友生日聚餐");

    const negUndone = await habitsApi.undoNegativeEventApi({
      habitId: noSugar.id,
      date: "2026-11-15",
    });
    assert.equal(negUndone.evaluation.events.length, 0);

    const noted = await habitsApi.setHabitDailyNoteApi({
      habitId: reading.id,
      date: "2026-11-15",
      note: "读完两章",
    });
    assert.equal(noted.evaluation.note, "读完两章");

    const heatmap = await habitsApi.fetchHabitHeatmap({ days: 30 });
    assert.equal(heatmap.cells.length, 30);
    assert.equal(heatmap.cells.at(-1)?.date, "2026-11-15");
    assert.equal(heatmap.cells.at(-1)?.status, "in_progress");

    const dayDetail = await habitsApi.fetchHabitDayDetail({
      date: "2026-11-15",
    });
    assert.equal(dayDetail.items.length, 3);

    const detail = await habitsApi.fetchHabitDetail(reading.id, 30);
    assert.equal(detail.habit.id, reading.id);

    const list = await habitsApi.fetchHabitsList({ status: "active" });
    assert.equal(list.habits.length, 3);

    const updated = await habitsApi.updateHabitApi(reading.id, {
      title: "深度阅读",
    });
    assert.equal(updated.habit.title, "深度阅读");

    const paused = await habitsApi.setHabitStatusApi(reading.id, "paused");
    assert.equal(paused.habit.status, "paused");

    const deleted = await habitsApi.deleteHabitApi(noSugar.id);
    assert.equal(deleted.ok, true);

    const bound = await habitsApi.bindTaskHabitApi({
      taskUuid: "todo-uuid-1",
      title: "喝水",
      kind: "positive",
      schedule: { type: "daily" },
    });
    assert.equal(bound.habit.taskUuid, "todo-uuid-1");
    assert.equal(bound.habit.title, "喝水");

    const unbound = await habitsApi.unbindTaskHabitApi("todo-uuid-1");
    assert.equal(unbound.ok, true);

    assert.ok(fetchedUrls.length >= 18);
    for (const u of fetchedUrls) {
      assert.ok(u.startsWith("/api/habits"), `Unexpected route: ${u}`);
    }
  } finally {
    globalThis.fetch = origFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
