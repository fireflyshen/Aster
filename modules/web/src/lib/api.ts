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
      data === undefined
        ? "Unable to connect to RN. Check your connection and try again."
        : "Result unconfirmed. Refresh and check tasks before trying again.",
    );
    error.uncertain = data !== undefined;
    throw error;
  }
  if (response.status === 401 || response.redirected) throw new RequestError("Session expired. Reopen this page.");
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new RequestError("Connection error. Reopen this page and check your tasks.");
    error.uncertain = data !== undefined;
    throw error;
  }
  if (!response.ok) {
    const error = new RequestError(result.error || "Action failed");
    error.uncertain = result.outcome === "unknown" || (data !== undefined && response.status >= 500);
    throw error;
  }
  return result;
}
