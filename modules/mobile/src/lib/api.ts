import type { TaskwarriorTask } from "../../../../src/tasks/model.ts";
export type { TaskInput } from "../../../../src/tasks/arguments.ts";

export type Task = {
  [K in keyof TaskwarriorTask]: NonNullable<TaskwarriorTask[K]> extends Date ? string : TaskwarriorTask[K];
};
export type View = "pending" | "today" | "waiting" | "completed";
export class RequestError extends Error {
  uncertain = false;
}
export async function api<T = { ok: true }>(route: string, data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${route}`, {
      cache: "no-store",
      ...(data === undefined
        ? {}
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    });
  } catch {
    const error = new RequestError(
      data === undefined ? "无法连接 RN，请检查网络后重试。" : "结果尚未确认，请刷新检查任务后再操作。",
    );
    error.uncertain = data !== undefined;
    throw error;
  }
  if (response.status === 401 || response.redirected) throw new RequestError("登录已过期，请重新打开页面。");
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new RequestError("连接异常，请重新打开页面后检查任务。");
    error.uncertain = data !== undefined;
    throw error;
  }
  if (!response.ok) {
    const error = new RequestError(result.error || "操作未完成");
    error.uncertain = result.outcome === "unknown" || (data !== undefined && response.status >= 500);
    throw error;
  }
  return result;
}
