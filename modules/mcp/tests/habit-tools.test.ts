import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { zonedDateTimeToUtcMs } from "../../core/time/zone.ts";
import { createHabitHandlers } from "../../server/src/habits/habit-api.ts";
import { createHabitStore } from "../../server/src/habits/habit-store.ts";
import { createAiServer } from "../src/server.ts";

test("habit MCP tools support end-to-end Habit-as-a-Todo creation with A/B subtasks, checklist metrics, negative tracking, heatmap, and unbind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-mcp-habits-"));
  try {
    const fakeNow = zonedDateTimeToUtcMs(
      "2026-11-15",
      "20:00",
      "Asia/Shanghai",
    );
    const store = createHabitStore(join(dir, "habits.sqlite"), {
      now: () => fakeNow,
      getTimezone: () => "Asia/Shanghai",
    });

    const catalogTasks: Array<{
      uuid: string;
      description: string;
      project: string;
      tags: string[];
      status: string;
    }> = [];
    const subtasks: Record<string, string> = {};
    const descriptions: Record<string, string> = {};

    const habitRoutes = createHabitHandlers({
      store,
      loadCatalog: async () => ({
        tasks: catalogTasks,
        subtasks,
        descriptions,
      }),
    });
    const routeMap = new Map(
      habitRoutes.map((r) => [`${r.method} /${r.route}`, r]),
    );

    let seq = 0;
    const server = createAiServer(async (method, path, body) => {
      if (method === "POST" && path === "/api/tasks") {
        seq += 1;
        const nextUuid = `11111111-1111-4111-8111-00000000000${seq}`;
        const input = (body || {}) as {
          description: string;
          project?: string;
          tags?: string[];
          parentUuid?: string;
          taskDescription?: string;
        };
        catalogTasks.push({
          uuid: nextUuid,
          description: input.description,
          project: input.project || "",
          tags: input.tags || [],
          status: "pending",
        });
        if (input.parentUuid) {
          subtasks[nextUuid] = input.parentUuid;
        }
        if (input.taskDescription) {
          descriptions[nextUuid] = input.taskDescription;
        }
        return { ok: true, uuid: nextUuid };
      }

      const [pathname, query = ""] = path.split("?");
      const handler = routeMap.get(`${method} ${pathname}`);
      if (!handler) {
        throw new Error(`Unhandled route: ${method} ${path}`);
      }
      const res = await handler.handle({
        searchParams: new URLSearchParams(query),
        readBody: async () => (body || {}) as Record<string, unknown>,
        transport: "ipc",
      });
      return res.body;
    });

    const client = new Client({ name: "habit-tools-unit", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);

    try {
      // 1. Create A/B workout Habit-backed Todo + 2 subtasks via habit_todo_create
      const createdWorkout = await client.callTool({
        name: "habit_todo_create",
        arguments: {
          title: "力量训练",
          kind: "positive",
          trackTime: true,
          schedule: { type: "daily" },
          project: "身体维护",
          tags: ["晚间"],
          taskDescription: "循序渐进，保护肩袖",
          abEnabled: true,
          subtasks: [
            { title: "俯卧撑", plan: "A" },
            { title: "哑铃划船", plan: "B" },
          ],
        },
      });
      assert.ok(!createdWorkout.isError, JSON.stringify(createdWorkout));
      const workoutPayload = JSON.parse(
        (createdWorkout.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(workoutPayload.ok, true);
      assert.equal(workoutPayload.subtaskUuids.length, 2);
      assert.equal(workoutPayload.habit.trackTime, true);
      assert.equal(workoutPayload.habit.completionMode, "checklist");
      assert.equal(workoutPayload.habit.plans.length, 2);

      // 2. Log Plan A subtask completion with optional sets/reps/weight
      const subPushupUuid = workoutPayload.subtaskUuids[0];
      const checkRes = await client.callTool({
        name: "habit_checklist_item",
        arguments: {
          habitId: workoutPayload.taskUuid,
          itemId: subPushupUuid,
          done: true,
          sets: "3",
          reps: "15",
          weight: "自重",
        },
      });
      assert.ok(!checkRes.isError);
      const checkJson = JSON.parse(
        (checkRes.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(checkJson.evaluation.achieved, true);

      // 3. Create negative habit + record lapse with note + undo
      const createdNoSugar = await client.callTool({
        name: "habit_todo_create",
        arguments: {
          title: "不喝含糖饮料",
          kind: "negative",
          schedule: { type: "daily" },
          project: "身体维护",
        },
      });
      assert.ok(!createdNoSugar.isError);
      const noSugarPayload = JSON.parse(
        (createdNoSugar.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(noSugarPayload.habit.trackTime, false);

      const lapseRes = await client.callTool({
        name: "habit_negative_record",
        arguments: {
          habitId: noSugarPayload.taskUuid,
          note: "朋友聚餐",
        },
      });
      assert.ok(!lapseRes.isError);
      const lapseJson = JSON.parse(
        (lapseRes.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(lapseJson.evaluation.events.length, 1);
      assert.equal(lapseJson.evaluation.achieved, false);

      const undoRes = await client.callTool({
        name: "habit_negative_undo",
        arguments: { habitId: noSugarPayload.taskUuid },
      });
      assert.ok(!undoRes.isError);
      const undoJson = JSON.parse(
        (undoRes.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(undoJson.evaluation.events.length, 0);

      // 4. Query today habits + heatmap + day detail
      const todayRes = await client.callTool({
        name: "habit_today",
        arguments: {},
      });
      assert.ok(!todayRes.isError);
      const todayJson = JSON.parse(
        (todayRes.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(todayJson.items.length, 2);

      const hmRes = await client.callTool({
        name: "habit_heatmap",
        arguments: { days: 7, project: "身体维护" },
      });
      assert.ok(!hmRes.isError);
      const hmJson = JSON.parse(
        (hmRes.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(hmJson.cells.length, 7);

      // 5. Unbind habit keeps Taskwarrior Todo alive
      const unbindRes = await client.callTool({
        name: "habit_unbind",
        arguments: { taskUuid: noSugarPayload.taskUuid },
      });
      assert.ok(!unbindRes.isError);
      const listAfterUnbind = await client.callTool({
        name: "habits_list",
        arguments: { status: "active" },
      });
      const listJson = JSON.parse(
        (listAfterUnbind.content as Array<{ text: string }>)[0].text,
      );
      assert.equal(listJson.habits.length, 1);
    } finally {
      await client.close();
      await server.close();
      store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
