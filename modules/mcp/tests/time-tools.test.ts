import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAiServer } from "../src/server.ts";
import { socketClient, WorkspaceError } from "../src/transport.ts";

const taskUuid = "11111111-1111-4111-8111-111111111111";

test("time MCP tools validate inputs, auto-generate unique idempotency keys, and preserve explicit keys on retries", async () => {
    const calls: Array<[string, string, Record<string, unknown> | undefined]> =
        [];
    const server = createAiServer(async (method, path, body) => {
        calls.push([method, path, body as Record<string, unknown> | undefined]);
        return { ok: true };
    });
    const client = new Client({ name: "time-tools-unit", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);

    try {
        // Reject time_start missing both title and taskUuid without calling backend
        const countBefore = calls.length;
        const missingTitle = await client.callTool({
            name: "time_start",
            arguments: { explicitCategoryId: "study" },
        });
        assert.equal(missingTitle.isError, true);
        assert.equal(calls.length, countBefore);
        const missingPayload = JSON.parse(
            (missingTitle.content as Array<{ text: string }>)[0].text,
        );
        assert.match(
            missingPayload.error,
            /Provide title, taskUuid, or timingPlanId/,
        );

        // Task-linked start succeeds without title and gets unique auto-generated idempotency keys
        const start1 = await client.callTool({
            name: "time_start",
            arguments: { taskUuid, sameTaskNoop: true },
        });
        const start2 = await client.callTool({
            name: "time_start",
            arguments: { title: "Read Rust book" },
        });
        const start3 = await client.callTool({
            name: "time_start",
            arguments: { timingPlanId: "plan-abc" },
        });
        const stopPause = await client.callTool({
            name: "time_stop",
            arguments: { pause: true },
        });
        assert.ok(!start1.isError);
        assert.ok(!start2.isError);
        assert.ok(!start3.isError);
        assert.ok(!stopPause.isError);
        const body1 = calls.at(-4)?.[2];
        const body2 = calls.at(-3)?.[2];
        const body3 = calls.at(-2)?.[2];
        const body4 = calls.at(-1)?.[2];
        assert.equal(body1?.source, "bot");
        assert.equal(body2?.source, "bot");
        assert.equal(body3?.timingPlanId, "plan-abc");
        assert.equal(body4?.pause, true);
        assert.equal(typeof body1?.idempotencyKey, "string");
        assert.equal(typeof body2?.idempotencyKey, "string");
        assert.ok(String(body1?.idempotencyKey).startsWith("mcp-start:"));
        assert.ok(String(body2?.idempotencyKey).startsWith("mcp-start:"));
        assert.ok(String(body4?.idempotencyKey).startsWith("mcp-stop:"));
        assert.notEqual(body1?.idempotencyKey, body2?.idempotencyKey);

        // Explicit idempotencyKey is preserved verbatim across retries for all core Time writes
        const explicitCases: Array<[string, Record<string, unknown>, string]> =
            [
                [
                    "time_start",
                    { idempotencyKey: "retry-start-1", title: "Retry start" },
                    "retry-start-1",
                ],
                [
                    "time_log",
                    {
                        idempotencyKey: "retry-log-1",
                        title: "Retry log",
                        startMs: 1763164800000,
                        endMs: 1763168400000,
                    },
                    "retry-log-1",
                ],
                [
                    "time_estimate",
                    {
                        idempotencyKey: "retry-est-1",
                        title: "Retry est",
                        estimatedSeconds: 3600,
                    },
                    "retry-est-1",
                ],
                [
                    "time_locate",
                    {
                        idempotencyKey: "retry-loc-1",
                        activityId: "act-est-1",
                        expectedVersion: 1,
                        startMs: 1763164800000,
                        endMs: 1763168400000,
                    },
                    "retry-loc-1",
                ],
                [
                    "time_sleep_confirm",
                    {
                        idempotencyKey: "retry-sleep-1",
                        date: "2026-11-15",
                    },
                    "retry-sleep-1",
                ],
                [
                    "time_confirm",
                    {
                        idempotencyKey: "retry-confirm-1",
                        activityId: "act-1",
                        expectedVersion: 2,
                    },
                    "retry-confirm-1",
                ],
                [
                    "time_plan_create",
                    {
                        idempotencyKey: "retry-plan-new-1",
                        title: "Bounded block",
                        allowanceMinutes: 45,
                    },
                    "retry-plan-new-1",
                ],
                [
                    "time_plan_update",
                    {
                        idempotencyKey: "retry-plan-upd-1",
                        planId: "plan-1",
                        expectedVersion: 1,
                        addAllowanceMinutes: 15,
                    },
                    "retry-plan-upd-1",
                ],
                [
                    "time_plan_start",
                    {
                        idempotencyKey: "retry-plan-start-1",
                        planId: "plan-1",
                    },
                    "retry-plan-start-1",
                ],
            ];

        for (const [toolName, args, expectedKey] of explicitCases) {
            const first = await client.callTool({
                name: toolName,
                arguments: args,
            });
            const retry = await client.callTool({
                name: toolName,
                arguments: args,
            });
            assert.ok(!first.isError, JSON.stringify(first));
            assert.ok(!retry.isError, JSON.stringify(retry));
            assert.equal(
                calls.at(-2)?.[2]?.idempotencyKey,
                expectedKey,
                toolName,
            );
            assert.equal(
                calls.at(-1)?.[2]?.idempotencyKey,
                expectedKey,
                toolName,
            );
        }

        // WorkspaceError with code/details preserves structured metadata directly
        const errServer = createAiServer(async () => {
            throw new WorkspaceError(
                "version conflict",
                409,
                "aborted",
                "TIME_VERSION_CONFLICT",
                { expectedVersion: 1, actualVersion: 2 },
            );
        });
        const errClient = new Client({ name: "time-tools-err", version: "1" });
        const [ea, eb] = InMemoryTransport.createLinkedPair();
        await errServer.connect(ea);
        await errClient.connect(eb);
        try {
            const conflictRes = await errClient.callTool({
                name: "time_update",
                arguments: {
                    activityId: "act-1",
                    expectedVersion: 1,
                    patch: { title: "Updated" },
                },
            });
            assert.equal(conflictRes.isError, true);
            const conflictPayload = JSON.parse(
                (conflictRes.content as Array<{ text: string }>)[0].text,
            );
            assert.equal(conflictPayload.status, 409);
            assert.equal(conflictPayload.code, "TIME_VERSION_CONFLICT");
            assert.deepEqual(conflictPayload.details, {
                expectedVersion: 1,
                actualVersion: 2,
            });
        } finally {
            await errClient.close();
            await errServer.close();
        }
    } finally {
        await client.close();
        await server.close();
    }
});

test("socketClient + MCP Time tools propagate 409 pending reconcile, unknown write outcomes, and operation resolution over HTTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amcp-time-"));
    const socket = join(dir, "w.sock");
    const source = "time-test-source";
    let pendingActive = true;
    let simulateSocketDrop = false;
    let startPosts = 0;
    let resolvePosts = 0;

    const service = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const url = req.url || "/";
            if (url === "/api/workspace") {
                res.setHeader("content-type", "application/json");
                res.end(
                    JSON.stringify({
                        identity: source,
                        organization: { revision: 3 },
                    }),
                );
                return;
            }
            if (req.headers["x-aster-source"] !== source) {
                res.writeHead(409, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: "source mismatch" }));
                return;
            }
            const bodyText = Buffer.concat(chunks).toString("utf8");
            const body = bodyText ? JSON.parse(bodyText) : {};

            if (req.method === "POST" && url === "/api/time/start") {
                startPosts++;
                if (simulateSocketDrop) {
                    req.socket.destroy();
                    return;
                }
                if (pendingActive) {
                    res.writeHead(409, { "content-type": "application/json" });
                    res.end(
                        JSON.stringify({
                            error: "Previous coordinated operation requires reconciliation.",
                            code: "OPERATION_PENDING_RECONCILE",
                            operationId: "op-pend-1",
                            details: {
                                kind: "task_start_timer",
                                taskUuid,
                            },
                        }),
                    );
                    return;
                }
                res.setHeader("content-type", "application/json");
                res.end(
                    JSON.stringify({
                        operation: { id: "op-start-2", state: "completed" },
                        activity: {
                            id: "act-2",
                            title: body.title,
                            version: 1,
                        },
                    }),
                );
                return;
            }

            if (
                req.method === "GET" &&
                url === "/api/time/operation?id=op-pend-1"
            ) {
                res.setHeader("content-type", "application/json");
                res.end(
                    JSON.stringify({
                        operation: {
                            id: "op-pend-1",
                            kind: "task_start_timer",
                            state: pendingActive
                                ? "pending_reconcile"
                                : "completed",
                            targetTaskUuid: taskUuid,
                        },
                    }),
                );
                return;
            }

            if (
                req.method === "POST" &&
                url === "/api/time/operation/resolve"
            ) {
                resolvePosts++;
                pendingActive = false;
                res.setHeader("content-type", "application/json");
                res.end(
                    JSON.stringify({
                        resolved: true,
                        operation: {
                            id: body.operationId,
                            action: body.action,
                            state: "completed",
                        },
                    }),
                );
                return;
            }

            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "not found" }));
        });
    });

    await new Promise<void>((resolve) => service.listen(socket, resolve));
    const requester = socketClient(socket);
    const server = createAiServer(requester);
    const client = new Client({ name: "time-tools-http", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);

    try {
        // 1. Interrupted POST emits outcome: "unknown" and is never retried blindly
        simulateSocketDrop = true;
        const dropped = await client.callTool({
            name: "time_start",
            arguments: { idempotencyKey: "k-drop-1", title: "Dropped call" },
        });
        assert.equal(dropped.isError, true);
        assert.equal(startPosts, 1);
        const droppedPayload = JSON.parse(
            (dropped.content as Array<{ text: string }>)[0].text,
        );
        assert.equal(droppedPayload.outcome, "unknown");

        // 2. HTTP 409 pending reconcile surfaces status, code, and details.operationId without retrying
        simulateSocketDrop = false;
        const conflict = await client.callTool({
            name: "time_start",
            arguments: {
                idempotencyKey: "k-conflict-1",
                title: "Blocked start",
            },
        });
        assert.equal(conflict.isError, true);
        assert.equal(startPosts, 2);
        const conflictPayload = JSON.parse(
            (conflict.content as Array<{ text: string }>)[0].text,
        );
        assert.equal(conflictPayload.status, 409);
        assert.equal(conflictPayload.code, "OPERATION_PENDING_RECONCILE");
        assert.equal(conflictPayload.details?.operationId, "op-pend-1");
        assert.equal(conflictPayload.details?.taskUuid, taskUuid);

        // 3. Agent inspects pending operation via operation_get
        const inspected = await client.callTool({
            name: "operation_get",
            arguments: { id: "op-pend-1" },
        });
        assert.ok(!inspected.isError, JSON.stringify(inspected));
        const inspectedPayload = JSON.parse(
            (inspected.content as Array<{ text: string }>)[0].text,
        );
        assert.equal(inspectedPayload.operation.state, "pending_reconcile");
        assert.equal(inspectedPayload.operation.id, "op-pend-1");

        // 4. Agent resolves pending reconcile explicitly via time_operation_resolve
        const resolved = await client.callTool({
            name: "time_operation_resolve",
            arguments: { operationId: "op-pend-1", action: "accept_started" },
        });
        assert.ok(!resolved.isError, JSON.stringify(resolved));
        assert.equal(resolvePosts, 1);
        const resolvedPayload = JSON.parse(
            (resolved.content as Array<{ text: string }>)[0].text,
        );
        assert.equal(resolvedPayload.resolved, true);
        assert.equal(resolvedPayload.operation.action, "accept_started");

        // 5. Subsequent time_start succeeds cleanly once reconciled
        const nextStart = await client.callTool({
            name: "time_start",
            arguments: {
                idempotencyKey: "k-after-resolve",
                title: "Unblocked start",
            },
        });
        assert.ok(!nextStart.isError, JSON.stringify(nextStart));
        const nextPayload = JSON.parse(
            (nextStart.content as Array<{ text: string }>)[0].text,
        );
        assert.equal(nextPayload.activity.title, "Unblocked start");
    } finally {
        await client.close();
        await server.close();
        await new Promise<void>((resolve) => service.close(() => resolve()));
        await rm(dir, { recursive: true, force: true });
    }
});
