import assert from "node:assert/strict";
import test from "node:test";
import { loadTimewarriorIntervals } from "../src/core/tasks/timewarrior.ts";
import { resolveConnection } from "../src/core/connection/settings.ts";
const connection = resolveConnection({ connectionMode: "local" }, "darwin");
test("timer source failures and invalid JSON are never reported as an empty successful history", async () => {
  await assert.rejects(
    loadTimewarriorIntervals(connection, async () => {
      throw new Error("unavailable");
    }),
    /unavailable/,
  );
  await assert.rejects(
    loadTimewarriorIntervals(connection, async () => ({
      stdout: "{}",
      stderr: "",
    })),
    /Invalid timer/,
  );
  await assert.rejects(
    loadTimewarriorIntervals(connection, async () => ({
      stdout: '[{"start":"20260231T000000Z"}]',
      stderr: "",
    })),
    /Invalid timer/,
  );
  assert.deepEqual(
    await loadTimewarriorIntervals(connection, async () => ({
      stdout: "[]",
      stderr: "",
    })),
    [],
  );
});
