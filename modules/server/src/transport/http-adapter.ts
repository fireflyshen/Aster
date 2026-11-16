import type { IncomingMessage, ServerResponse } from "node:http";
import { body } from "./validation.ts";
import {
  createWorkspaceRoutes,
  type WorkspaceHandlers,
} from "./workspace-api.ts";

export {
  handleAddTask,
  loadScopedTasks,
  readRecurringSeries,
} from "./workspace-api.ts";

export type JsonResponder = (status: number, data: unknown) => void;

export interface ApiRouterDeps {
  origin: string;
  enter: () => () => void;
  handlers: WorkspaceHandlers;
}

function hasValidJsonOrigin(req: IncomingMessage, origin: string): boolean {
  return (
    req.headers.origin === origin &&
    Boolean(req.headers["content-type"]?.startsWith("application/json"))
  );
}

/** Builds the HTTP adapter over the unified workspace route table. */
export function createApiHandler(deps: ApiRouterDeps) {
  const { origin, enter, handlers } = deps;
  const routes = createWorkspaceRoutes(handlers);

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
    send: JsonResponder,
  ): Promise<void> => {
    if (req.method === "POST" && !hasValidJsonOrigin(req, origin)) {
      send(403, { error: "Invalid request origin" });
      return;
    }

    const spec = routes.get(`${req.method || ""} ${route}`);
    if (!spec) {
      send(404, {});
      return;
    }

    const release = spec.skipGate ? undefined : enter();
    try {
      const searchParams = new URL(req.url || "/", origin).searchParams;
      const result = await spec.handle({
        searchParams,
        readBody: (limit) => body(req, limit),
        transport: "http",
      });
      if (result.headers) {
        for (const [name, value] of Object.entries(result.headers)) {
          res.setHeader(name, value);
        }
      }
      if (result.rawBody !== undefined) {
        res.statusCode = result.status;
        res.end(result.rawBody);
        return;
      }
      send(result.status, result.body);
    } finally {
      release?.();
    }
  };
}
