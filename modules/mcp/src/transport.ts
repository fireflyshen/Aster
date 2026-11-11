import { request } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type WorkspaceCall = (
    method: "GET" | "POST",
    path: string,
    data?: unknown,
) => Promise<any>;
export class WorkspaceError extends Error {
    status?: number;
    outcome?: string;
    constructor(message: string, status?: number, outcome?: string) {
        super(message);
        this.status = status;
        this.outcome = outcome;
    }
}
export function socketClient(socketPath: string): WorkspaceCall {
    let identity: string | undefined;
    function send(
        method: "GET" | "POST",
        path: string,
        data?: unknown,
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const payload =
                data === undefined ? undefined : JSON.stringify(data);
            let size = 0;
            const req = request(
                {
                    socketPath,
                    path,
                    method,
                    headers: {
                        "Content-Type": "application/json",
                        ...(identity ? { "X-Aster-Source": identity } : {}),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > 32 * 1024 * 1024)
                            req.destroy(
                                new Error("Workspace response exceeds 32 MiB."),
                            );
                        else chunks.push(chunk);
                    });
                    res.on("error", (error) => req.destroy(error));
                    res.on("end", () => {
                        try {
                            const value = JSON.parse(
                                Buffer.concat(chunks).toString("utf8"),
                            );
                            if ((res.statusCode || 500) >= 400)
                                reject(
                                    new WorkspaceError(
                                        value.error ||
                                            "Workspace request failed.",
                                        res.statusCode,
                                        value.outcome,
                                    ),
                                );
                            else resolve(value);
                        } catch {
                            reject(
                                new WorkspaceError(
                                    "Invalid workspace response. Check before retrying.",
                                    undefined,
                                    method === "POST" ? "unknown" : undefined,
                                ),
                            );
                        }
                    });
                },
            );
            req.setTimeout(30000, () =>
                req.destroy(new Error("Workspace request timed out.")),
            );
            req.on("error", (error) =>
                reject(
                    new WorkspaceError(
                        error.message +
                            (method === "POST"
                                ? " Read and check before retrying."
                                : ""),
                        undefined,
                        method === "POST" ? "unknown" : undefined,
                    ),
                ),
            );
            req.end(payload);
        });
    }
    return async (method, path, data) => {
        // Pin to the first source for this MCP session, rather than silently switching databases.
        if (!identity) {
            const workspace = await send("GET", "/api/workspace");
            if (typeof workspace.identity !== "string" || !workspace.identity)
                throw new Error("Workspace did not provide a source identity.");
            identity = workspace.identity;
        }
        const result = await send(method, path, data);
        if (path === "/api/workspace" && result.identity !== identity)
            throw new WorkspaceError(
                "Workspace source changed. Restart after checking connection settings.",
                409,
            );
        return result;
    };
}
export async function connectWorkspace(env: NodeJS.ProcessEnv = process.env) {
    if (env.ASTER_SOCKET)
        return { call: socketClient(env.ASTER_SOCKET), close: async () => {} };
    const target = env.ASTER_SSH_TARGET;
    const remote = env.ASTER_REMOTE_SOCKET || "/opt/aster/data/workspace.sock";
    if (!target || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(target))
        throw new Error(
            "Set ASTER_SOCKET or a valid ASTER_SSH_TARGET (SSH config alias).",
        );
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(remote))
        throw new Error(
            "Use an absolute ASTER_REMOTE_SOCKET without whitespace or forwarding separators.",
        );
    const dir = await mkdtemp(join(tmpdir(), "aster-mcp-"));
    const local = join(dir, "w.sock");
    const child = spawn(
        "ssh",
        [
            "-N",
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=2",
            "-L",
            `${local}:${remote}`,
            target,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
    );
    let failure: Error | undefined;
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", (error) => {
        failure = error;
    });
    child.on("exit", () => {
        failure = new Error("SSH workspace tunnel exited.");
    });
    const close = async () => {
        child.kill();
        await rm(dir, { recursive: true, force: true });
    };
    try {
        for (let i = 0; i < 240; i++) {
            if (failure) throw failure;
            if (
                await lstat(local).then(
                    (s) => s.isSocket(),
                    () => false,
                )
            )
                return { call: socketClient(local), close };
            await delay(50);
        }
        throw new Error("SSH workspace tunnel did not become ready.");
    } catch (error) {
        await close();
        throw error;
    }
}
