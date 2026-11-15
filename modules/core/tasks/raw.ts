export type RawTask = Record<string, unknown> & {
  uuid: string;
  status: string;
  description: string;
  annotations?: { entry: string; description: string }[];
};

export function parseRawTasks(output: string): RawTask[] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  const data: unknown = JSON.parse(output.slice(start, end + 1));
  if (
    !Array.isArray(data) ||
    data.some(
      (task) =>
        !task ||
        typeof task.uuid !== "string" ||
        typeof task.status !== "string" ||
        typeof task.description !== "string",
    )
  )
    throw new Error("Taskwarrior returned invalid task data.");
  return data;
}

export function noteText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 8000 ||
    value.includes("\0")
  )
    throw new Error("Notes must contain 1–8,000 characters.");
  return value.trim();
}

export function importableTask(task: RawTask) {
  return Object.fromEntries(
    Object.entries(task).filter(([key]) => key !== "id" && key !== "urgency"),
  );
}
