import { TimeStoreError } from "./time-store-types.ts";

export const SLEEP_PROJECT = "睡眠";

/** Project names belong to the time record; this never edits its linked task. */
export function requireActivityProject(
  project: unknown,
  categoryId?: string,
): string {
  if (typeof project === "string" && project.trim()) return project.trim();
  if (categoryId === "sleep") return SLEEP_PROJECT;
  throw new TimeStoreError(
    400,
    "PROJECT_REQUIRED",
    "请先选择时间记录所属的项目；标签可以留空。",
  );
}
