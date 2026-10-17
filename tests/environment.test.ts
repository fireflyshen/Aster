import assert from "node:assert/strict";
import test from "node:test";
import { prependExecutableDirectories } from "../src/connection/environment.ts";

test("prepends the configured Taskwarrior executable directory on macOS", () => {
  assert.equal(
    prependExecutableDirectories("/usr/bin:/bin:/opt/homebrew/bin", ["/opt/homebrew/bin/task"], "darwin"),
    "/opt/homebrew/bin:/usr/bin:/bin",
  );
});

test("ignores command names that do not identify an executable directory", () => {
  assert.equal(prependExecutableDirectories("C:\\Windows\\System32", ["task"], "win32"), "C:\\Windows\\System32");
});
