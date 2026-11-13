import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkspaceError, type WorkspaceCall } from "./transport.ts";

export const uuidSchema = z.string().uuid();

export const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .describe(
    "Revision from the latest workspace_get or organization write; never automatically overwrite a conflict.",
  );

export const dateSchema = z
  .string()
  .regex(/^(?:\d{8}T\d{6}Z)?$/)
  .describe("UTC YYYYMMDDTHHmmssZ; empty clears the value.");

export const colorSchema = z.enum([
  "berry",
  "red",
  "orange",
  "yellow",
  "olive",
  "lime",
  "green",
  "mint",
  "teal",
  "blue",
  "purple",
  "gray",
]);

export interface McpToolRegistrar {
  register: (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    read: boolean,
    run: (input: any) => Promise<unknown>,
    destructive?: boolean,
  ) => void;
  get: (path: string) => Promise<any>;
  post: (path: string, value: unknown) => Promise<any>;
  org: (value: unknown) => Promise<any>;
}

/** Creates typed HTTP/MCP tool registration helpers around a shared workspace call transport. */
export function createToolRegistrar(
  server: McpServer,
  call: WorkspaceCall,
): McpToolRegistrar {
  const register: McpToolRegistrar["register"] = (
    name,
    description,
    schema,
    read,
    run,
    destructive = !read,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema: z.object(schema).strict(),
        annotations: {
          readOnlyHint: read,
          destructiveHint: destructive,
          idempotentHint: read,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await run(input);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result ?? { ok: true }),
              },
            ],
          };
        } catch (error) {
          const e = error as Error;
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: e.message,
                  ...(e instanceof WorkspaceError
                    ? { status: e.status, outcome: e.outcome }
                    : {}),
                }),
              },
            ],
          };
        }
      },
    );
  };

  const get = (path: string) => call("GET", path);
  const post = (path: string, value: unknown) => call("POST", path, value);

  return {
    register,
    get,
    post,
    org: (value: unknown) => post("/api/organization", value),
  };
}
