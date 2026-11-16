import type {
  BindTaskHabitInput,
  CreateHabitInput,
  HabitChecklistItem,
  HabitCompletionMode,
  HabitKind,
  HabitPlan,
  HabitSchedule,
  HabitStatus,
  UpdateHabitInput,
} from "../../../core/habits/model.ts";
import type { WorkspaceRouteSpec } from "../transport/workspace-api.ts";
import {
  HabitStoreError,
  type HabitStore,
  type HabitTaskCatalog,
} from "./habit-store.ts";

function requiredString(body: Record<string, unknown>, field: string): string {
  const val = body[field];
  if (typeof val !== "string" || !val.trim()) {
    throw new HabitStoreError(400, "INVALID_INPUT", `缺少或无效字段: ${field}`);
  }
  return val.trim();
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const val = body[field];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string") {
    throw new HabitStoreError(
      400,
      "INVALID_INPUT",
      `字段 ${field} 必须是字符串`,
    );
  }
  return val;
}

function optionalNullableString(
  body: Record<string, unknown>,
  field: string,
): string | null | undefined {
  if (!(field in body)) return undefined;
  const val = body[field];
  if (val === null) return null;
  if (typeof val !== "string") {
    throw new HabitStoreError(400, "INVALID_INPUT", `字段 ${field} 格式无效`);
  }
  return val;
}

function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  if (!(field in body) || body[field] === undefined) return undefined;
  const val = body[field];
  if (!Array.isArray(val) || val.some((x) => typeof x !== "string")) {
    throw new HabitStoreError(
      400,
      "INVALID_INPUT",
      `字段 ${field} 必须是字符串数组`,
    );
  }
  return val;
}

function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
): boolean | undefined {
  if (!(field in body) || body[field] === undefined) return undefined;
  if (typeof body[field] !== "boolean") {
    throw new HabitStoreError(
      400,
      "INVALID_INPUT",
      `字段 ${field} 必须是布尔值`,
    );
  }
  return body[field] as boolean;
}

function parseSchedule(raw: unknown): HabitSchedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HabitStoreError(400, "INVALID_SCHEDULE", "执行频率格式无效。");
  }
  return raw as HabitSchedule;
}

function parsePlans(raw: unknown): HabitPlan[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new HabitStoreError(400, "INVALID_PLANS", "动作清单格式无效。");
  }
  return raw.map((plan) => {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      throw new HabitStoreError(400, "INVALID_PLANS", "动作方案格式无效。");
    }
    const p = plan as Record<string, unknown>;
    const itemsRaw = Array.isArray(p.items) ? p.items : [];
    const items: HabitChecklistItem[] = itemsRaw.map((item, idx) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new HabitStoreError(400, "INVALID_PLANS", "动作项格式无效。");
      }
      const it = item as Record<string, unknown>;
      return {
        id: typeof it.id === "string" ? it.id : `item-${idx + 1}`,
        title: typeof it.title === "string" ? it.title : "",
        required: it.required !== false,
      };
    });
    return {
      id: typeof p.id === "string" ? p.id : "default",
      name: typeof p.name === "string" ? p.name : "动作清单",
      items,
    };
  });
}

function parseSubtaskPlans(
  raw: unknown,
): Record<string, "A" | "B"> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HabitStoreError(400, "INVALID_INPUT", "子任务方案映射无效。");
  }
  const out: Record<string, "A" | "B"> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val === "A" || val === "B") {
      out[key] = val;
    }
  }
  return out;
}

export function createHabitHandlers(deps: {
  store: HabitStore;
  loadCatalog?: () => Promise<HabitTaskCatalog>;
}): WorkspaceRouteSpec[] {
  const { store, loadCatalog } = deps;

  async function syncCatalog(): Promise<HabitTaskCatalog | undefined> {
    if (!loadCatalog) return undefined;
    const catalog = await loadCatalog();
    store.syncFromTaskCatalog(catalog);
    return catalog;
  }

  return [
    {
      method: "GET",
      route: "api/habits",
      handle: async ({ searchParams }) => {
        await syncCatalog();
        const statusParam = searchParams.get("status");
        const status =
          statusParam === "active" ||
          statusParam === "paused" ||
          statusParam === "archived" ||
          statusParam === "all"
            ? statusParam
            : "all";
        const project = searchParams.get("project") || undefined;
        const tag = searchParams.get("tag") || undefined;
        return {
          status: 200,
          body: {
            todayDate: store.todayDate(),
            timezone: store.getTimezone(),
            habits: store.listHabits({ status, project, tag }),
          },
        };
      },
    },
    {
      method: "GET",
      route: "api/habits/today",
      handle: async () => {
        await syncCatalog();
        return {
          status: 200,
          body: store.getTodayHabits(),
        };
      },
    },
    {
      method: "GET",
      route: "api/habits/detail",
      handle: async ({ searchParams }) => {
        await syncCatalog();
        const id = searchParams.get("id")?.trim();
        if (!id) {
          throw new HabitStoreError(400, "INVALID_INPUT", "缺少习惯 ID。");
        }
        const daysRaw = searchParams.get("days");
        const days = daysRaw ? Number(daysRaw) : 365;
        return {
          status: 200,
          body: store.getHabitDetail(id, Number.isFinite(days) ? days : 365),
        };
      },
    },
    {
      method: "GET",
      route: "api/habits/heatmap",
      handle: async ({ searchParams }) => {
        await syncCatalog();
        const daysRaw = searchParams.get("days");
        const days = daysRaw ? Number(daysRaw) : undefined;
        return {
          status: 200,
          body: store.getHeatmap({
            startDate: searchParams.get("startDate") || undefined,
            endDate: searchParams.get("endDate") || undefined,
            days: days && Number.isFinite(days) ? days : undefined,
            project: searchParams.get("project") || undefined,
            tag: searchParams.get("tag") || undefined,
            habitId: searchParams.get("habitId") || undefined,
          }),
        };
      },
    },
    {
      method: "GET",
      route: "api/habits/day",
      handle: async ({ searchParams }) => {
        await syncCatalog();
        return {
          status: 200,
          body: store.getDayDetail(searchParams.get("date") || undefined, {
            project: searchParams.get("project") || undefined,
            tag: searchParams.get("tag") || undefined,
            habitId: searchParams.get("habitId") || undefined,
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/bind",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const catalog = await syncCatalog();
        const input: BindTaskHabitInput = {
          taskUuid: requiredString(body, "taskUuid"),
          kind: requiredString(body, "kind") as HabitKind,
          schedule: parseSchedule(body.schedule),
          status: optionalString(body, "status") as HabitStatus | undefined,
          trackTime: optionalBoolean(body, "trackTime"),
          abEnabled: optionalBoolean(body, "abEnabled"),
          subtaskPlans: parseSubtaskPlans(body.subtaskPlans),
          effectiveFromDate: optionalString(body, "effectiveFromDate"),
          title: optionalString(body, "title"),
          description: optionalString(body, "description"),
          project: optionalNullableString(body, "project"),
          tags: optionalStringArray(body, "tags"),
        };
        return {
          status: 200,
          body: { habit: store.bindTaskHabit(input, catalog) },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/unbind",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const taskUuid = requiredString(body, "taskUuid");
        return {
          status: 200,
          body: store.unbindTaskHabit(taskUuid),
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/create",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const input: CreateHabitInput = {
          taskUuid: optionalString(body, "taskUuid"),
          title: requiredString(body, "title"),
          kind: requiredString(body, "kind") as HabitKind,
          completionMode: optionalString(body, "completionMode") as
            | HabitCompletionMode
            | undefined,
          description: optionalString(body, "description"),
          project: optionalString(body, "project"),
          tags: optionalStringArray(body, "tags"),
          trackTime: optionalBoolean(body, "trackTime"),
          abEnabled: optionalBoolean(body, "abEnabled"),
          subtaskPlans: parseSubtaskPlans(body.subtaskPlans),
          schedule: parseSchedule(body.schedule),
          plans: parsePlans(body.plans),
          createdDate: optionalString(body, "createdDate"),
        };
        return {
          status: 200,
          body: { habit: store.createHabit(input) },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/update",
      handle: async ({ readBody }) => {
        await syncCatalog();
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const patch: UpdateHabitInput = {
          title: optionalString(body, "title"),
          description: optionalString(body, "description"),
          project: optionalNullableString(body, "project"),
          tags: optionalStringArray(body, "tags"),
          completionMode: optionalString(body, "completionMode") as
            | HabitCompletionMode
            | undefined,
          trackTime: optionalBoolean(body, "trackTime"),
          abEnabled: optionalBoolean(body, "abEnabled"),
          subtaskPlans: parseSubtaskPlans(body.subtaskPlans),
          ...(body.schedule !== undefined
            ? { schedule: parseSchedule(body.schedule) }
            : {}),
          plans: parsePlans(body.plans),
          effectiveFromDate: optionalString(body, "effectiveFromDate"),
        };
        return {
          status: 200,
          body: { habit: store.updateHabit(habitId, patch) },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/status",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const status = requiredString(body, "status") as HabitStatus;
        return {
          status: 200,
          body: { habit: store.setHabitStatus(habitId, status) },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/delete",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        return {
          status: 200,
          body: store.deleteHabit(habitId),
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/toggle",
      handle: async ({ readBody }) => {
        await syncCatalog();
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const date = optionalString(body, "date");
        const completed = optionalBoolean(body, "completed");
        return {
          status: 200,
          body: {
            evaluation: store.togglePositiveHabit(habitId, date, completed),
          },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/checklist-item",
      handle: async ({ readBody }) => {
        await syncCatalog();
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const itemId = requiredString(body, "itemId");
        return {
          status: 200,
          body: {
            evaluation: store.setChecklistItem({
              habitId,
              date: optionalString(body, "date"),
              itemId,
              done: optionalBoolean(body, "done"),
              sets: optionalNullableString(body, "sets"),
              reps: optionalNullableString(body, "reps"),
              weight: optionalNullableString(body, "weight"),
              planId: optionalString(body, "planId"),
            }),
          },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/switch-plan",
      handle: async ({ readBody }) => {
        await syncCatalog();
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const planId = requiredString(body, "planId");
        const date = optionalString(body, "date");
        return {
          status: 200,
          body: { evaluation: store.switchDayPlan(habitId, date, planId) },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/negative/record",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const occurredAtMs =
          typeof body.occurredAtMs === "number" ? body.occurredAtMs : undefined;
        return {
          status: 200,
          body: store.recordNegativeEvent({
            habitId,
            date: optionalString(body, "date"),
            note: optionalString(body, "note"),
            occurredAtMs,
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/negative/undo",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        return {
          status: 200,
          body: {
            evaluation: store.undoNegativeEvent(
              habitId,
              optionalString(body, "date"),
              optionalString(body, "eventId"),
            ),
          },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/negative/note",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const eventId = requiredString(body, "eventId");
        const note = optionalString(body, "note") ?? "";
        return {
          status: 200,
          body: {
            evaluation: store.updateNegativeEventNote(habitId, eventId, note),
          },
        };
      },
    },
    {
      method: "POST",
      route: "api/habits/daily-note",
      handle: async ({ readBody }) => {
        const body = await readBody();
        const habitId = requiredString(body, "habitId");
        const note = optionalString(body, "note") ?? "";
        return {
          status: 200,
          body: {
            evaluation: store.setDailyNote(
              habitId,
              optionalString(body, "date"),
              note,
            ),
          },
        };
      },
    },
  ];
}
