import { createServer } from "node:http";
import { createConnection } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { body } from "./validation.ts";
import type { Organization } from "../../../src/core/workspace/organization.ts";

// Local Unix socket: existing SSH users reach the same process and revision queue.
// It never listens on TCP and does not change the public API's Access protection.
export async function startWorkspaceSocket(
    path: string,
    identity: string,
    workspace: {
        load: () => Promise<Organization>;
        change: (input: unknown) => Promise<Organization>;
    },
) {
    if (!path.startsWith("/") || path.length > 100)
        throw new Error("Use an absolute, short workspace socket path.");
    try {
        const previous = await lstat(path);
        if (!previous.isSocket())
            throw new Error("Workspace path exists and is not a socket.");
        await new Promise<void>((resolve, reject) => {
            const probe = createConnection(path);
            probe.once("connect", () => {
                probe.destroy();
                reject(new Error("Workspace socket is already serving."));
            });
            probe.once("error", (error: NodeJS.ErrnoException) => {
                if (["ECONNREFUSED", "ENOENT"].includes(error.code || ""))
                    resolve();
                else reject(error);
            });
            probe.setTimeout(1000, () => {
                probe.destroy();
                reject(new Error("Unable to verify stale workspace socket."));
            });
        });
        const current = await lstat(path).catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
            },
        );
        if (current && current.ino === previous.ino) await unlink(path);
        else if (current)
            throw new Error("Workspace socket changed during startup.");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const server = createServer(async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
            if (req.method === "GET" && req.url === "/api/workspace") {
                res.end(
                    JSON.stringify({
                        identity,
                        organization: await workspace.load(),
                    }),
                );
                return;
            }
            if (req.method !== "POST" || req.url !== "/api/organization") {
                res.writeHead(404);
                res.end("{}");
                return;
            }
            if (req.headers["x-aster-source"] !== identity) {
                res.writeHead(409);
                res.end(
                    JSON.stringify({
                        error: "Different Taskwarrior source. Check connection settings.",
                    }),
                );
                return;
            }
            res.end(JSON.stringify(await workspace.change(await body(req))));
        } catch (error) {
            const e = error as Error & { status?: number; outcome?: string };
            res.writeHead(e.status || 400);
            res.end(JSON.stringify({ error: e.message, outcome: e.outcome }));
        }
    });
    server.requestTimeout = 20000;
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => resolve());
    });
    await chmod(path, 0o600);
    return server;
}
