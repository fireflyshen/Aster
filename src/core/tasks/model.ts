export interface TaskwarriorAnnotation {
  entry?: string;
  description: string;
}

export interface TaskwarriorTask {
  uuid: string;
  id?: number;
  description: string;
  status: string;
  project?: string;
  tags: string[];
  priority?: string;
  urgency: number;
  due?: Date;
  scheduled?: Date;
  wait?: Date;
  until?: Date;
  start?: Date;
  end?: Date;
  recur?: string;
  depends: string[];
  annotations: TaskwarriorAnnotation[];
}

export type TaskwarriorTaskGroup = "overdue" | "today" | "pending" | "waiting";
export type TaskView = "pending" | "today" | "waiting" | "completed";

interface ExportedTask {
  uuid?: unknown;
  id?: unknown;
  description?: unknown;
  status?: unknown;
  project?: unknown;
  tags?: unknown;
  priority?: unknown;
  urgency?: unknown;
  due?: unknown;
  scheduled?: unknown;
  wait?: unknown;
  until?: unknown;
  start?: unknown;
  end?: unknown;
  recur?: unknown;
  depends?: unknown;
  annotations?: unknown;
}

function parseJsonArray(output: string): ExportedTask[] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Taskwarrior returned invalid export data.");
  const value = JSON.parse(output.slice(start, end + 1)) as unknown;
  if (!Array.isArray(value)) throw new Error("Taskwarrior export was not a task list.");
  return value as ExportedTask[];
}

export function parseTaskwarriorDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const date = compact
    ? new Date(
        Date.UTC(
          Number(compact[1]),
          Number(compact[2]) - 1,
          Number(compact[3]),
          Number(compact[4]),
          Number(compact[5]),
          Number(compact[6]),
        ),
      )
    : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function annotations(value: unknown): TaskwarriorAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { entry?: unknown; description?: unknown };
    if (typeof candidate.description !== "string") return [];
    return [
      {
        entry: typeof candidate.entry === "string" ? candidate.entry : undefined,
        description: candidate.description,
      },
    ];
  });
}

export function parseTaskwarriorTasks(output: string): TaskwarriorTask[] {
  const tasks: TaskwarriorTask[] = [];
  for (const raw of parseJsonArray(output)) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.uuid !== "string" || typeof raw.description !== "string") continue;
    tasks.push({
      uuid: raw.uuid,
      id: typeof raw.id === "number" ? raw.id : undefined,
      description: raw.description,
      status: typeof raw.status === "string" ? raw.status : "pending",
      project: typeof raw.project === "string" ? raw.project : undefined,
      tags: strings(raw.tags),
      priority: typeof raw.priority === "string" ? raw.priority : undefined,
      urgency: typeof raw.urgency === "number" ? raw.urgency : 0,
      due: parseTaskwarriorDate(raw.due),
      scheduled: parseTaskwarriorDate(raw.scheduled),
      wait: parseTaskwarriorDate(raw.wait),
      until: parseTaskwarriorDate(raw.until),
      start: parseTaskwarriorDate(raw.start),
      end: parseTaskwarriorDate(raw.end),
      recur: typeof raw.recur === "string" ? raw.recur : undefined,
      depends: strings(raw.depends),
      annotations: annotations(raw.annotations),
    });
  }
  return tasks.sort(
    (left, right) =>
      (right.end?.getTime() ?? 0) - (left.end?.getTime() ?? 0) ||
      right.urgency - left.urgency ||
      (left.due?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.due?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER),
  );
}

export function taskGroup(task: TaskwarriorTask, now = new Date()): TaskwarriorTaskGroup {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (task.wait ? task.wait > now : task.status === "waiting") return "waiting";
  if (task.due && task.due < startOfToday) return "overdue";
  if (task.due && task.due < startOfTomorrow) return "today";
  return "pending";
}

export function tasksForView(tasks: TaskwarriorTask[], view: TaskView, now = new Date()): TaskwarriorTask[] {
  return tasks.filter((task) => {
    if (view === "completed") return task.status === "completed";
    if (task.status !== "pending" && task.status !== "waiting") return false;
    const group = taskGroup(task, now);
    if (view === "today") return group === "overdue" || group === "today";
    if (view === "waiting") return group === "waiting";
    return true;
  });
}
