import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { TimeStore } from "../time/time-store.ts";
import type { JsonResponder } from "./http-adapter.ts";

const STATIC_MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
};

/** Resolves the built static web client directory across dev and packaged layouts. */
export function resolveClientRoot(metaUrl: string): string {
    if (process.env.CLIENT_ROOT) return resolve(process.env.CLIENT_ROOT);
    const colocated = fileURLToPath(new URL("./client/", metaUrl));
    if (existsSync(colocated)) return resolve(colocated);
    return resolve(fileURLToPath(new URL("../web/client/", metaUrl)));
}

function sendJson(res: ServerResponse): JsonResponder {
    return (status, data) => {
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(data));
    };
}

function applySecurityHeaders(res: ServerResponse, development: boolean): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
        "Content-Security-Policy",
        (development
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws:; "
            : "default-src 'self'; script-src 'self'; connect-src 'self'; ") +
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
}

async function handleHealthz(
    send: JsonResponder,
    isTimeEnabled: () => boolean,
    timeStore?: TimeStore,
): Promise<void> {
    if (!isTimeEnabled() || !timeStore) {
        send(200, { ok: true, time: { enabled: false } });
        return;
    }
    try {
        const snap = timeStore.getTimerSnapshot();
        const barrier = await timeStore.readBarrier();
        const st =
            snap.state === "restoring"
                ? { state: "restoring", timeEpoch: snap.timeEpoch }
                : {
                      state: snap.state,
                      timeEpoch: snap.timeEpoch,
                      taskDataEpoch: snap.taskDataEpoch,
                      barrierTimeEpoch: barrier.timeEpoch,
                      schemaVersion: timeStore.getStatus().schemaVersion,
                  };
        send(200, { ok: true, time: { enabled: true, ...st } });
    } catch (timeErr) {
        send(503, {
            ok: false,
            error: timeErr instanceof Error ? timeErr.message : String(timeErr),
        });
    }
}

function formatErrorPayload(error: unknown): { status: number; body: unknown } {
    const e = error as Error & {
        outcome?: string;
        status?: number;
        code?: string;
        details?: unknown;
        operationId?: string;
    };
    const fallbackUnknown =
        "Result unconfirmed. Refresh and check tasks before trying again.";
    return {
        status: e.status || 400,
        body: {
            error:
                e.outcome === "unknown" && (!e.message || !e.code)
                    ? fallbackUnknown
                    : e.message,
            outcome: e.outcome,
            ...(typeof e.code === "string" ? { code: e.code } : {}),
            ...(e.details !== undefined ? { details: e.details } : {}),
            ...(typeof e.operationId === "string"
                ? { operationId: e.operationId }
                : {}),
        },
    };
}

/** Creates the production/dev HTTP server serving `/healthz`, `/api/*`, and static client assets. */
export function createAsterHttpServer(deps: {
    origin: string;
    development: boolean;
    clientRoot: string;
    isTimeEnabled: () => boolean;
    timeStore?: TimeStore;
    handleApi: (
        req: IncomingMessage,
        res: ServerResponse,
        route: string,
        send: JsonResponder,
    ) => Promise<void>;
}) {
    const {
        origin,
        development,
        clientRoot,
        isTimeEnabled,
        timeStore,
        handleApi,
    } = deps;

    return createServer(async (req, res) => {
        const send = sendJson(res);
        applySecurityHeaders(res, development);
        try {
            const path = new URL(req.url || "/", origin).pathname;
            if (path === "/healthz") {
                await handleHealthz(send, isTimeEnabled, timeStore);
                return;
            }
            const route = path.slice(1);
            if (route.startsWith("api/")) {
                await handleApi(req, res, route, send);
                return;
            }
            if (!["GET", "HEAD"].includes(req.method || "")) {
                send(404, {});
                return;
            }
            const target = resolve(
                clientRoot,
                decodeURIComponent(route || "index.html"),
            );
            if (
                !target.startsWith(clientRoot + sep) ||
                !STATIC_MIME_TYPES[extname(target)]
            ) {
                send(404, {});
                return;
            }
            let content: Buffer;
            try {
                content = await readFile(target);
            } catch {
                send(404, {});
                return;
            }
            res.writeHead(200, {
                "Content-Type": STATIC_MIME_TYPES[extname(target)],
            });
            res.end(req.method === "HEAD" ? undefined : content);
        } catch (error) {
            const { status, body } = formatErrorPayload(error);
            send(status, body);
        }
    });
}
