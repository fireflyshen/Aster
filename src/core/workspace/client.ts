import type { TaskInput } from "../tasks/arguments.ts";
import { buildCommand } from "../connection/command.ts";
import { executeProcess, type Executor } from "../connection/execute.ts";
import { workspaceIdentity, type Connection } from "../connection/settings.ts";
import type { TaskAction, RecoveryList, SeriesSnapshot } from "./recovery.ts";
import type { BoardChange } from "./board.ts";
import type { Organization, OrganizationChange } from "./organization.ts";

export class WorkspaceError extends Error {
  uncertain: boolean;
  constructor(message: string, uncertain = false) {
    super(message);
    this.uncertain = uncertain;
  }
}
export function workspaceUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use a local Aster address, for example http://localhost:4180.",
    );
  return url;
}
// Metadata stays with the web service. Never edit its file from a second process.
export function createWorkspaceClient(address: string, connection: Connection) {
  const url = workspaceUrl(address);
  async function request(route: string, data?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(route, url), {
        redirect: "error",
        signal: AbortSignal.timeout(data ? 30000 : 4000),
        ...(data
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: url.origin,
              },
              body: JSON.stringify(data),
            }
          : {}),
      });
    } catch {
      throw new WorkspaceError(
        data
          ? "Move unconfirmed. Refresh the web workspace before trying again."
          : "Web workspace unavailable. Start Aster web, then refresh. Your Taskwarrior connection is independent.",
        !!data,
      );
    }
    let result: { error?: string; outcome?: string };
    try {
      result = (await response.json()) as typeof result;
    } catch {
      throw new WorkspaceError(
        "Invalid workspace response. Refresh before trying again.",
        !!data,
      );
    }
    if (!response.ok)
      throw new WorkspaceError(
        result.error || "Could not load the workspace.",
        result.outcome === "unknown" || (!!data && response.status >= 500),
      );
    return result;
  }
  async function load(): Promise<Organization> {
    const snapshot = (await request("/api/workspace")) as {
      identity: string;
      organization: Organization;
    };
    if (snapshot.identity !== workspaceIdentity(connection))
      throw new WorkspaceError(
        "Web and extension use different Taskwarrior connections. Check their connection settings.",
      );
    if (
      !snapshot.organization ||
      !Number.isInteger(snapshot.organization.revision) ||
      !Array.isArray(snapshot.organization.filters) ||
      !Array.isArray(snapshot.organization.tags)
    )
      throw new WorkspaceError(
        "Invalid workspace data. Update Aster web and refresh.",
      );
    return snapshot.organization;
  }
  async function move(change: BoardChange): Promise<Organization> {
    await load();
    return (await request("/api/organization", change)) as Organization;
  }
  async function change(input: OrganizationChange): Promise<Organization> {
    await load();
    return (await request("/api/organization", input)) as Organization;
  }
  async function taskAction(input: TaskAction) {
    await load();
    await request("/api/action", input);
  }
  async function deleted() {
    await load();
    return (await request("/api/recovery")) as RecoveryList;
  }
  async function series(uuid: string) {
    await load();
    return (await request(
      "/api/recurrence?uuid=" + encodeURIComponent(uuid),
    )) as SeriesSnapshot;
  }
  async function addTask(input: TaskInput) {
    await load();
    await request("/api/tasks", input);
  }
  return {
    load,
    move,
    change,
    taskAction,
    addTask,
    deleted,
    series,
    url: url.href,
  };
}
export type WorkspaceClient = Pick<
  ReturnType<typeof createWorkspaceClient>,
  "load" | "move" | "change" | "url"
> &
  Partial<
    Pick<
      ReturnType<typeof createWorkspaceClient>,
      "taskAction" | "addTask" | "deleted" | "series"
    >
  >;

const IPC_SCRIPT = `const http=require('node:http');const p=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));const d=p.data||p.change;const b=d?JSON.stringify(d):'';const q=http.request({socketPath:'/opt/aster/data/workspace.sock',path:p.route||(b?'/api/organization':'/api/workspace'),method:b?'POST':'GET',headers:{'Content-Type':'application/json','X-Aster-Source':p.identity}},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,body:JSON.parse(s)})))});q.setTimeout(20000,()=>q.destroy(new Error('Workspace timeout')));q.on('error',e=>{console.error(e.message);process.exitCode=1});q.end(b);`;

export function createSshWorkspaceClient(
  connection: Connection,
  executor: Executor = executeProcess,
): WorkspaceClient {
  if (connection.kind !== "ssh")
    throw new Error("SSH workspace requires an SSH connection.");
  const identity = workspaceIdentity({
    ...connection,
    kind: "local",
    sshTarget: undefined,
  });
  async function request(
    change?: OrganizationChange,
    route?: string,
    data?: TaskAction | TaskInput,
  ) {
    let reply: {
      status: number;
      body: Organization & {
        identity?: string;
        organization?: Organization;
        error?: string;
        outcome?: string;
      };
    };
    try {
      const payload = Buffer.from(
        JSON.stringify({ identity, change, route, data }),
      ).toString("base64");
      const command = buildCommand(
        { ...connection, taskCommand: "/opt/aster/runtime/node" },
        ["-e", IPC_SCRIPT, payload],
      );
      const result = await executor(command);
      reply = JSON.parse(result.stdout.trim());
    } catch {
      throw new WorkspaceError(
        change || data
          ? "Change unconfirmed. Refresh Focus before trying again."
          : "Shared Focus unavailable. Check the RN connection and refresh.",
        !!(change || data),
      );
    }
    if (reply.status !== 200)
      throw new WorkspaceError(
        reply.body.error || "Workspace request failed.",
        reply.body.outcome === "unknown" ||
          (!!(change || data) && reply.status >= 500),
      );
    return reply.body;
  }
  async function load(): Promise<Organization> {
    const result = await request();
    if (
      result.identity !== identity ||
      !result.organization ||
      !Number.isInteger(result.organization.revision) ||
      !Array.isArray(result.organization.projects)
    )
      throw new WorkspaceError(
        "Focus uses a different Taskwarrior source. Check connection settings.",
      );
    return result.organization;
  }
  async function change(input: OrganizationChange): Promise<Organization> {
    await load();
    return await request(input);
  }
  async function taskAction(input: TaskAction) {
    await load();
    await request(undefined, "/api/action", input);
  }
  async function deleted() {
    await load();
    return (await request(
      undefined,
      "/api/recovery",
    )) as unknown as RecoveryList;
  }
  async function series(uuid: string) {
    await load();
    return (await request(
      undefined,
      "/api/recurrence?uuid=" + encodeURIComponent(uuid),
    )) as unknown as SeriesSnapshot;
  }
  async function addTask(input: TaskInput) {
    await load();
    await request(undefined, "/api/tasks", input);
  }
  return {
    load,
    change,
    move: change,
    taskAction,
    addTask,
    deleted,
    series,
    url: "https://task.caten.top/",
  };
}
