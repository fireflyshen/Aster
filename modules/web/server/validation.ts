import type { IncomingMessage } from "node:http";
import { isCompactTaskDate } from "../../../src/core/tasks/model.ts";
import type { TaskInput } from "../../../src/core/tasks/arguments.ts";

export async function body(req: IncomingMessage, limit = 65536) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Content is too long");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function taskInput(value: unknown): TaskInput {
  const v = value as Record<string, unknown>;
  if (
    !v ||
    typeof v.description !== "string" ||
    !v.description.trim() ||
    v.description.length > 2000 ||
    /[\0\r\n]/.test(v.description)
  )
    throw new Error("Enter a task name.");
  for (const field of ["project", "due", "priority"])
    if (
      v[field] !== undefined &&
      (typeof v[field] !== "string" ||
        (v[field] as string).length > 200 ||
        /[\0\r\n]/.test(v[field] as string))
    )
      throw new Error("Invalid field format");
  if (v.due && !isCompactTaskDate(v.due))
    throw new Error("Invalid date format");
  if (
    !Array.isArray(v.tags) ||
    v.tags.length > 30 ||
    v.tags.some(
      (t) => typeof t !== "string" || !/^\+?[\p{L}\p{N}_@.-]{1,80}$/u.test(t),
    )
  )
    throw new Error("Labels cannot contain spaces or command characters.");
  if (
    v.note !== undefined &&
    (typeof v.note !== "string" ||
      v.note.length > 8000 ||
      v.note.includes("\0"))
  )
    throw new Error("Notes must be 8,000 characters or fewer.");
  for (const field of ["recur", "until"])
    if (v[field] !== undefined && typeof v[field] !== "string")
      throw new Error("Invalid repeat setting.");
  return v as unknown as TaskInput;
}
