import type { TaskInput } from "../tasks/arguments.ts";
import { buildCommand } from "../connection/command.ts";
import { executeProcess, type Executor } from "../connection/execute.ts";
import { workspaceIdentity, type Connection } from "../connection/settings.ts";
import {
    hydrateTaskwarriorTasks,
    type TaskwarriorTask,
} from "../tasks/model.ts";
import type { TaskAction, RecoveryList, SeriesSnapshot } from "./recovery.ts";
import type { BoardChange } from "./board.ts";
import type { Organization, OrganizationChange } from "./organization.ts";
import {
    createWorkspaceTimeClient,
    type WorkspaceTaskAddResult,
} from "./time-client.ts";

export type {
    TaskCostDetailResponse,
    TimeBillsResponse,
    TimeReceipt,
    TimeStatusResponse,
    WorkspaceTaskAddResult,
    WorkspaceTimeClient,
} from "./time-client.ts";

export type WorkspaceErrorCode = "UNAVAILABLE" | "MISMATCH" | "REJECTED";

export type WorkspaceTaskQuery = {
    filter?: string;
    scope?: "pending" | "completed" | "board" | "all";
};

export type WorkspaceTaskAddInput = TaskInput & {
    parentUuid?: string;
    taskDescription?: string;
};

export type WorkspaceTasksResult = {
    tasks: TaskwarriorTask[];
    projects: string[];
};

export class WorkspaceError extends Error {
    uncertain: boolean;
    code?: WorkspaceErrorCode;
    statusCode?: number;
    serverCode?: string;
    details?: Record<string, unknown>;
    constructor(
        message: string,
        uncertain = false,
        code?: WorkspaceErrorCode,
        meta?: {
            statusCode?: number;
            serverCode?: string;
            details?: Record<string, unknown>;
        },
    ) {
        super(message);
        this.uncertain = uncertain;
        this.code = code;
        this.statusCode = meta?.statusCode;
        this.serverCode = meta?.serverCode;
        this.details = meta?.details;
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
    ) {
        throw new Error(
            "Use a local Aster address, for example http://localhost:4180.",
        );
    }
    return url;
}

function tasksRoute(query?: WorkspaceTaskQuery): string {
    const parameters = new URLSearchParams();
    if (query?.filter !== undefined) parameters.set("filter", query.filter);
    else if (query?.scope) parameters.set("scope", query.scope);
    const qs = parameters.toString();
    return qs ? `/api/tasks?${qs}` : "/api/tasks";
}

function hydrateTaskPayload(payload: {
    tasks?: unknown[];
    projects?: unknown[];
}): WorkspaceTasksResult {
    const rawProjects = Array.isArray(payload.projects) ? payload.projects : [];
    return {
        tasks: hydrateTaskwarriorTasks(
            Array.isArray(payload.tasks) ? payload.tasks : [],
        ),
        projects: rawProjects.filter((p): p is string => typeof p === "string"),
    };
}

function createSourceVerifier(load: () => Promise<Organization>) {
    let verified = false;
    let verifying: Promise<Organization> | undefined;
    return {
        markVerified() {
            verified = true;
        },
        reset() {
            verified = false;
        },
        async verify() {
            if (verified) return;
            verifying ??= load().finally(() => {
                verifying = undefined;
            });
            await verifying;
        },
    };
}

function createSharedWorkspaceMethods(
    verify: () => Promise<void>,
    invoke: (
        route: string,
        data?: unknown,
        timeoutMs?: number,
    ) => Promise<unknown>,
) {
    const verifiedInvoke = async (
        route: string,
        data?: unknown,
        timeoutMs?: number,
    ) => {
        await verify();
        return invoke(route, data, timeoutMs);
    };

    return {
        taskAction: async (input: TaskAction) => {
            await verifiedInvoke("/api/action", input);
        },
        deleted: async () =>
            (await verifiedInvoke("/api/recovery")) as RecoveryList,
        series: async (uuid: string) =>
            (await verifiedInvoke(
                "/api/recurrence?uuid=" + encodeURIComponent(uuid),
            )) as SeriesSnapshot,
        addTask: async (input: WorkspaceTaskAddInput) =>
            (await verifiedInvoke(
                "/api/tasks",
                input,
            )) as WorkspaceTaskAddResult,
        tasks: async (
            query?: WorkspaceTaskQuery,
        ): Promise<WorkspaceTasksResult> => {
            const result = (await verifiedInvoke(
                tasksRoute(query),
                undefined,
                20000,
            )) as {
                tasks?: unknown[];
                projects?: unknown[];
            };
            return hydrateTaskPayload(result);
        },
        time: createWorkspaceTimeClient(verifiedInvoke),
    };
}

// Metadata stays with the server. Never edit its file from a second process.
export function createWorkspaceClient(address: string, connection: Connection) {
    const url = workspaceUrl(address);
    const source = createSourceVerifier(load);

    async function request(
        route: string,
        data?: unknown,
        timeoutMs = data ? 30000 : 4000,
    ): Promise<unknown> {
        let response: Response;
        try {
            response = await fetch(new URL(route, url), {
                redirect: "error",
                signal: AbortSignal.timeout(timeoutMs),
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
                "UNAVAILABLE",
            );
        }
        let result: {
            error?: string;
            outcome?: string;
            code?: string;
            details?: Record<string, unknown>;
        };
        try {
            result = (await response.json()) as typeof result;
        } catch {
            throw new WorkspaceError(
                "Invalid workspace response. Refresh before trying again.",
                !!data,
            );
        }
        if (!response.ok) {
            throw new WorkspaceError(
                result.error || "Could not load the workspace.",
                result.outcome === "unknown" ||
                    (!!data && response.status >= 500),
                "REJECTED",
                {
                    statusCode: response.status,
                    serverCode: result.code,
                    details: result.details,
                },
            );
        }
        return result;
    }

    async function load(): Promise<Organization> {
        const snapshot = (await request("/api/workspace")) as {
            identity: string;
            organization: Organization;
        };
        if (snapshot.identity !== workspaceIdentity(connection)) {
            source.reset();
            throw new WorkspaceError(
                "Web and extension use different Taskwarrior connections. Check their connection settings.",
                false,
                "MISMATCH",
            );
        }
        if (
            !snapshot.organization ||
            !Number.isInteger(snapshot.organization.revision) ||
            !Array.isArray(snapshot.organization.filters) ||
            !Array.isArray(snapshot.organization.tags)
        ) {
            source.reset();
            throw new WorkspaceError(
                "Invalid workspace data. Update Aster web and refresh.",
            );
        }
        source.markVerified();
        return snapshot.organization;
    }

    async function move(change: BoardChange): Promise<Organization> {
        await source.verify();
        return (await request("/api/organization", change)) as Organization;
    }

    async function change(input: OrganizationChange): Promise<Organization> {
        await source.verify();
        return (await request("/api/organization", input)) as Organization;
    }

    const shared = createSharedWorkspaceMethods(() => source.verify(), request);

    return {
        load,
        move,
        change,
        ...shared,
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
            "taskAction" | "addTask" | "deleted" | "series" | "tasks" | "time"
        >
    >;

const IPC_SCRIPT = `const http=require('node:http');const p=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));const d=p.data||p.change;const b=d?JSON.stringify(d):'';const q=http.request({socketPath:'/opt/aster/data/workspace.sock',path:p.route||(b?'/api/organization':'/api/workspace'),method:b?'POST':'GET',headers:{'Content-Type':'application/json','X-Aster-Source':p.identity}},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,body:JSON.parse(s)})))});q.setTimeout(20000,()=>q.destroy(new Error('Workspace timeout')));q.on('error',e=>{console.error(e.message);process.exitCode=1});q.end(b);`;

export function createSshWorkspaceClient(
    connection: Connection,
    executor: Executor = executeProcess,
    webUrl?: string,
): WorkspaceClient {
    if (connection.kind !== "ssh") {
        throw new Error("SSH workspace requires an SSH connection.");
    }
    const identity = workspaceIdentity({
        ...connection,
        kind: "local",
        sshTarget: undefined,
    });
    const source = createSourceVerifier(load);

    async function request(
        change?: OrganizationChange,
        route?: string,
        data?: unknown,
    ) {
        let reply: {
            status: number;
            body: Organization & {
                identity?: string;
                organization?: Organization;
                error?: string;
                outcome?: string;
                code?: string;
                details?: Record<string, unknown>;
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
                    : "Shared Focus unavailable. Check the remote connection and refresh.",
                !!(change || data),
                "UNAVAILABLE",
            );
        }
        if (reply.status !== 200) {
            throw new WorkspaceError(
                reply.body.error || "Workspace request failed.",
                reply.body.outcome === "unknown" ||
                    (!!(change || data) && reply.status >= 500),
                "REJECTED",
                {
                    statusCode: reply.status,
                    serverCode: reply.body.code,
                    details: reply.body.details,
                },
            );
        }
        return reply.body;
    }

    async function load(): Promise<Organization> {
        const result = await request();
        if (
            result.identity !== identity ||
            !result.organization ||
            !Number.isInteger(result.organization.revision) ||
            !Array.isArray(result.organization.projects)
        ) {
            source.reset();
            throw new WorkspaceError(
                "Focus uses a different Taskwarrior source. Check connection settings.",
                false,
                "MISMATCH",
            );
        }
        source.markVerified();
        return result.organization;
    }

    async function change(input: OrganizationChange): Promise<Organization> {
        await source.verify();
        return await request(input);
    }

    const shared = createSharedWorkspaceMethods(
        () => source.verify(),
        (route, data) => request(undefined, route, data),
    );

    return {
        load,
        change,
        move: change,
        ...shared,
        url:
            webUrl ||
            process.env.ASTER_WEB_URL ||
            process.env.PUBLIC_ORIGIN ||
            "http://localhost:4180/",
    };
}
